import { useState, useCallback } from 'react';
import { api, post, defaultCacheRoot, getUsername } from '../../api.js';
import { useJenkinsCfg, useToast } from '../../App.jsx';

async function pollProgress(jobUrl, buildSelector, jobId, action, { onMsg, signal }) {
  while (true) {
    if (signal?.aborted) return null;
    await new Promise(r => setTimeout(r, 2000));
    const data = await api(
      `/api/jenkins/progress?action=${encodeURIComponent(action)}` +
      `&job_url=${encodeURIComponent(jobUrl)}` +
      `&build_selector=${encodeURIComponent(buildSelector)}` +
      `&job_id=${encodeURIComponent(jobId)}`
    );
    const p = data?.progress || {};
    if (p.message || p.stage) onMsg(p.message || p.stage);
    if (p.progress != null) onMsg(`${p.message || ''} (${p.progress}%)`);
    if (p.done || p.error) return p;
  }
}

async function pollStsProgress(jobId, action, jobUrl, { onMsg, signal, prefix = '/api/jenkins' } = {}) {
  while (true) {
    if (signal?.aborted) return null;
    await new Promise(r => setTimeout(r, 3000));
    const qs = `job_id=${encodeURIComponent(jobId)}&job_url=${encodeURIComponent(jobUrl || '')}`;
    const data = await api(`${prefix}/${action}/progress?${qs}`);
    const p = data?.progress || data || {};
    if (p.message || p.stage) onMsg(p.message || p.stage);
    if (p.done || p.error) return p;
    if (p.status === 'completed' || p.status === 'done') return { done: true, ...p };
    if (p.status === 'failed' || p.status === 'error') return { error: p.error || p.message || '실패', ...p };
  }
}

const DOC_TYPES = [
  { key: 'uds', label: 'UDS', icon: '📘', desc: 'Unit Design Specification' },
  { key: 'sts', label: 'STS', icon: '📗', desc: 'Software Test Specification' },
  { key: 'suts', label: 'SUTS', icon: '📙', desc: 'Software Unit Test Specification' },
  { key: 'sits', label: 'SITS', icon: '📕', desc: 'Software Integration Test Specification' },
];

export default function DocGenSection({ job, analysisResult }) {
  const { cfg } = useJenkinsCfg();
  const toast = useToast();
  const cacheRoot = analysisResult?.cacheRoot || defaultCacheRoot(job?.url) || cfg.cacheRoot;

  const [generating, setGenerating] = useState(null);
  const [genLog, setGenLog] = useState('');
  const [genProgress, setGenProgress] = useState(null);

  const docPaths = (() => {
    try { return JSON.parse(localStorage.getItem('devops_v2_doc_paths') || '{}'); } catch (_) { return {}; }
  })();

  const generateDoc = useCallback(async (docType) => {
    if (!job?.url) { toast('warning', '프로젝트를 먼저 선택하세요.'); return; }
    const label = DOC_TYPES.find(d => d.key === docType)?.label || docType.toUpperCase();
    setGenerating(docType);
    setGenLog(`${label} 생성 시작...\n`);
    setGenProgress(null);
    setActiveTab(docType);

    try {
      // Get source_root and linked_docs from SCM registry
      const scm = analysisResult?.scmList?.[0];
      const linkedDocs = scm?.linked_docs || {};

      const formData = new FormData();
      formData.append('job_url', job.url);
      formData.append('cache_root', cacheRoot);
      formData.append('build_selector', cfg.buildSelector || 'lastSuccessfulBuild');
      if (scm?.source_root) formData.append('source_root', scm.source_root);
      if (docPaths.template) formData.append('template_path', docPaths.template);
      if (docType === 'uds' && docPaths.template) formData.append('uds_template_path', docPaths.template);
      // Pass linked doc paths
      const srsPath = docPaths.srs || linkedDocs.srs || '';
      const sdsPath = docPaths.sds || linkedDocs.sds || '';
      const hsisPath = linkedDocs.hsis || '';
      const stpPath = linkedDocs.stp || '';
      const udsPath = linkedDocs.uds || '';
      // UDS uses req_paths; STS/SUTS use srs_path/sds_path
      if (docType === 'uds') {
        const reqPaths = [srsPath, sdsPath].filter(Boolean).join(',');
        if (reqPaths) formData.append('req_paths', reqPaths);
      } else {
        if (srsPath) formData.append('srs_path', srsPath);
        if (sdsPath) formData.append('sds_path', sdsPath);
      }
      if (hsisPath) formData.append('hsis_path', hsisPath);
      if (stpPath) formData.append('stp_path', stpPath);
      if (udsPath && docType !== 'uds') formData.append('uds_path', udsPath);

      const user = getUsername();
      // SITS uses /api/local/ endpoint with urlencoded; others use /api/jenkins/ with FormData
      const apiPrefix = docType === 'sits' ? '/api/local' : '/api/jenkins';
      let fetchBody, fetchHeaders;
      if (docType === 'sits') {
        const params = new URLSearchParams();
        for (const [k, v] of formData.entries()) params.append(k, v);
        fetchBody = params.toString();
        fetchHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
      } else {
        fetchBody = formData;
        fetchHeaders = {};
      }
      if (user) fetchHeaders['X-User'] = user;
      const res = await fetch(`${apiPrefix}/${docType}/generate-async`, {
        method: 'POST',
        body: fetchBody,
        headers: fetchHeaders,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data?.job_id) throw new Error(`${label} job_id를 받지 못했습니다.`);

      setGenLog(prev => prev + `Job ID: ${data.job_id}\n`);

      let progress;
      if (docType === 'uds') {
        progress = await pollProgress(job.url, cfg.buildSelector || 'lastSuccessfulBuild', data.job_id, 'uds', {
          onMsg: msg => {
            setGenLog(prev => prev + msg + '\n');
            const match = msg.match(/(\d+)%/);
            if (match) setGenProgress(Number(match[1]));
          },
          signal: null,
        });
      } else {
        const pollPrefix = docType === 'sits' ? '/api/local' : '/api/jenkins';
        progress = await pollStsProgress(data.job_id, docType, job.url, {
          onMsg: msg => {
            setGenLog(prev => prev + msg + '\n');
            const match = msg.match(/(\d+)%/);
            if (match) setGenProgress(Number(match[1]));
          },
          signal: null,
          prefix: pollPrefix,
        });
      }

      if (progress?.error) throw new Error(progress.error);

      toast('success', `${label} 생성 완료`);
      setGenLog(prev => prev + `✓ ${label} 생성 완료\n`);
    } catch (e) {
      toast('error', `${label} 생성 실패: ${e.message}`);
      setGenLog(prev => prev + `✕ 오류: ${e.message}\n`);
    } finally {
      setGenerating(null);
    }
  }, [job, cfg, cacheRoot, docPaths, toast, analysisResult]);

  const scm = analysisResult?.scmList?.[0];
  const linkedDocs = scm?.linked_docs || {};
  const localDocPaths = (() => {
    try { return JSON.parse(localStorage.getItem('devops_v2_doc_paths') || '{}'); } catch (_) { return {}; }
  })();

  // Merge input docs: SCM linked_docs + localStorage
  const inputDocs = [
    { key: 'srs', label: 'SRS', desc: '소프트웨어 요구사항 사양서', path: localDocPaths.srs || linkedDocs.srs || '' },
    { key: 'sds', label: 'SDS', desc: '소프트웨어 설계 사양서', path: localDocPaths.sds || linkedDocs.sds || '' },
    { key: 'hsis', label: 'HSIS', desc: 'HW/SW 인터페이스 사양서', path: linkedDocs.hsis || '' },
    { key: 'stp', label: 'STP', desc: '소프트웨어 시험 계획서', path: linkedDocs.stp || '' },
  ];
  const outputDocs = [
    { key: 'uds', label: 'UDS', desc: 'Unit Design Specification', path: linkedDocs.uds || '' },
    { key: 'sts', label: 'STS', desc: 'Software Test Specification', path: linkedDocs.sts || '' },
    { key: 'suts', label: 'SUTS', desc: 'SW Unit Test Specification', path: linkedDocs.suts || '' },
    { key: 'sits', label: 'SITS', desc: 'SW Integration Test Spec', path: linkedDocs.sits || '' },
  ];

  const [docPreview, setDocPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSheet, setPreviewSheet] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const allDocs = [
    { key: 'sds', label: 'SDS', type: 'input', path: localDocPaths.sds || linkedDocs.sds || '' },
    { key: 'uds', label: 'UDS', type: 'output', path: linkedDocs.uds || '' },
    { key: 'sts', label: 'STS', type: 'output', path: linkedDocs.sts || '' },
    { key: 'suts', label: 'SUTS', type: 'output', path: linkedDocs.suts || '' },
    { key: 'sits', label: 'SITS', type: 'output', path: linkedDocs.sits || '' },
  ];

  const loadDocPreview = useCallback(async (docKey, path) => {
    if (!path) { toast('warning', '문서 경로가 등록되지 않았습니다.'); return; }
    setPreviewLoading(true);
    setDocPreview(null);
    setPreviewSheet(0);
    try {
      const filename = path.split(/[\\/]/).pop();
      // Use generic Excel preview API for all document types
      const data = await post('/api/preview-excel', { path });
      setDocPreview({ key: docKey, label: allDocs.find(d => d.key === docKey)?.label || docKey.toUpperCase(), filename, data, _path: path });
    } catch (e) {
      toast('error', `문서 미리보기 실패: ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  }, [toast]);

  return (
    <div>
      {/* Document list - clickable for preview */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-header">
          <span className="panel-title">문서 현황</span>
        </div>
        <table className="impact-table" style={{ fontSize: 11 }}>
          <thead>
            <tr><th style={{ width: 55 }}>문서</th><th>파일명</th><th style={{ width: 60 }}>상태</th><th style={{ width: 60 }}></th></tr>
          </thead>
          <tbody>
            {allDocs.map(d => (
              <tr key={d.key} style={{ cursor: d.path ? 'pointer' : 'default' }}
                  onClick={() => d.path && loadDocPreview(d.key, d.path)}>
                <td><span className={`pill ${d.type === 'input' ? 'pill-info' : 'pill-purple'}`} style={{ fontSize: 9 }}>{d.label}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 10 }} title={d.path}>
                  {d.path ? d.path.split(/[\\/]/).pop() : <span className="text-muted">미등록</span>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {d.path ? <span className="pill pill-success" style={{ fontSize: 9 }}>등록됨</span> : <span className="pill pill-neutral" style={{ fontSize: 9 }}>-</span>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {d.path && <button className="btn-sm" style={{ fontSize: 9, padding: '1px 6px' }}
                    onClick={e => { e.stopPropagation(); loadDocPreview(d.key, d.path); }}
                    disabled={previewLoading}>보기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Document preview */}
      {docPreview && <DocPreviewPanel
        docPreview={docPreview}
        previewSheet={previewSheet}
        setPreviewSheet={setPreviewSheet}
        fullscreen={fullscreen}
        setFullscreen={setFullscreen}
        onClose={() => { setDocPreview(null); setFullscreen(false); }}
      />}

      {/* Generation controls */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">문서 생성</span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {DOC_TYPES.map(dt => (
            <button
              key={dt.key}
              className="btn-primary btn-sm"
              onClick={() => generateDoc(dt.key)}
              disabled={!!generating}
              style={{ minWidth: 120 }}
            >
              {generating === dt.key
                ? <><span className="spinner" style={{ display: 'inline-block', marginRight: 4 }} />생성 중...</>
                : `${dt.icon} ${dt.label} 생성`
              }
            </button>
          ))}
        </div>

        {/* Progress */}
        {generating && (
          <div style={{ marginBottom: 12 }}>
            {genProgress != null && (
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="text-sm" style={{ fontWeight: 600 }}>{genProgress}%</span>
                <div className="progress-bar" style={{ flex: 1 }}>
                  <div className="progress-fill" style={{ width: `${genProgress}%`, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
            <div className="log-box" style={{ maxHeight: 180, fontSize: 11 }}>{genLog}</div>
          </div>
        )}
      </div>

    </div>
  );
}

/* ── Document Preview Panel (inline / fullscreen) ── */
function DocPreviewPanel({ docPreview, previewSheet, setPreviewSheet, fullscreen, setFullscreen, onClose }) {
  const sheets = docPreview.data?.sheets || [];
  const sheet = sheets[previewSheet];
  const [page, setPage] = useState(0);
  const pageSize = fullscreen ? 200 : 100;
  const docPath = docPreview.data?.filename ? undefined : undefined; // path from allDocs

  // Reset page when switching sheets
  const switchSheet = (i) => { setPreviewSheet(i); setPage(0); };

  const containerStyle = fullscreen ? {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
    background: 'var(--panel, #fff)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  } : { marginBottom: 12 };

  const tableMaxHeight = fullscreen ? 'calc(100vh - 90px)' : 400;

  return (
    <div className={fullscreen ? '' : 'panel'} style={containerStyle}>
      {/* Header */}
      <div className="panel-header" style={{ flexShrink: 0, padding: fullscreen ? '8px 16px' : undefined }}>
        <span className="panel-title" style={{ fontSize: fullscreen ? 14 : 12 }}>
          {docPreview.label} — {docPreview.filename}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-sm" onClick={() => setFullscreen(!fullscreen)} style={{ fontSize: 10 }}>
            {fullscreen ? '축소' : '크게보기'}
          </button>
          <button className="btn-sm" onClick={onClose} style={{ fontSize: 10 }}>닫기</button>
        </div>
      </div>

      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 4, overflowX: 'auto', flexShrink: 0, padding: '0 8px' }}>
          {sheets.map((sh, i) => (
            <button key={i} onClick={() => switchSheet(i)}
              style={{
                padding: '5px 12px', fontSize: 11, border: 'none',
                borderBottom: previewSheet === i ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'none', fontWeight: previewSheet === i ? 700 : 400,
                color: previewSheet === i ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {sh.name} <span style={{ fontSize: 9, opacity: 0.7 }}>({sh.total_rows ?? sh.rows?.length ?? '?'})</span>
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {sheet ? (() => {
        const headers = sheet.headers || [];
        const allRows = sheet.rows || [];
        const totalRows = sheet.total_rows ?? allRows.length;
        const rows = allRows.slice(0, pageSize);
        const totalPages = Math.ceil(totalRows / pageSize);

        const renderCell = (cell, ci) => {
          const val = String(cell ?? '');
          // Render image if cell starts with __IMG__
          if (val.startsWith('__IMG__') && val.length > 7) {
            const imgId = val.slice(7);
            const docPath = docPreview.data?.filename;
            // Find original path from allDocs
            return <img src={`/api/preview-image?path=${encodeURIComponent(docPreview._path || '')}&image_id=${encodeURIComponent(imgId)}`}
                        alt="diagram" style={{ maxWidth: fullscreen ? 400 : 200, maxHeight: fullscreen ? 300 : 150 }}
                        onError={e => { e.target.style.display = 'none'; }} />;
          }
          return val.slice(0, fullscreen ? 200 : 60);
        };

        return (
          <div style={{ overflowX: 'auto', maxHeight: tableMaxHeight, overflowY: 'auto', flex: fullscreen ? 1 : undefined }}>
            <table className="impact-table" style={{ fontSize: fullscreen ? 11 : 10, minWidth: Math.max(headers.length * 100, 400) }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ background: 'var(--bg)' }}>
                  {headers.map((h, i) => (
                    <th key={i} style={{ whiteSpace: 'nowrap', maxWidth: fullscreen ? 300 : 150, overflow: 'hidden', textOverflow: 'ellipsis', padding: fullscreen ? '6px 10px' : '4px 6px' }}
                        title={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {(Array.isArray(row) ? row : []).map((cell, ci) => (
                      <td key={ci}
                          style={{ maxWidth: fullscreen ? 400 : 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: fullscreen ? 'pre-wrap' : 'nowrap', padding: fullscreen ? '4px 8px' : '2px 4px', fontSize: fullscreen ? 11 : 10, wordBreak: fullscreen ? 'break-word' : undefined }}
                          title={String(cell || '')}>
                        {renderCell(cell, ci)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            {totalRows > pageSize && (
              <div className="row" style={{ justifyContent: 'center', gap: 6, padding: '8px 0' }}>
                <button className="btn-sm" onClick={() => setPage(0)} disabled={page === 0}>«</button>
                <button className="btn-sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹</button>
                <span className="text-sm" style={{ padding: '4px 8px' }}>
                  {page * pageSize + 1}~{Math.min((page + 1) * pageSize, totalRows)} / {totalRows}행
                </span>
                <button className="btn-sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>›</button>
                <button className="btn-sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</button>
              </div>
            )}
          </div>
        );
      })() : <div className="text-muted text-sm" style={{ padding: 12 }}>데이터 없음</div>}
    </div>
  );
}

