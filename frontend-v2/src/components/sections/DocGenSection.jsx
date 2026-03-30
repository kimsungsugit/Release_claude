import { useState, useCallback } from 'react';
import { post, api, defaultCacheRoot } from '../../api.js';
import { useJenkinsCfg, useToast } from '../../App.jsx';
import StatusBadge from '../StatusBadge.jsx';

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

async function pollStsProgress(jobId, action, { onMsg, signal }) {
  while (true) {
    if (signal?.aborted) return null;
    await new Promise(r => setTimeout(r, 2000));
    const data = await api(`/api/jenkins/${action}/progress?job_id=${encodeURIComponent(jobId)}`);
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

  const [lists, setLists] = useState({ uds: [], sts: [], suts: [], sits: [] });
  const [generating, setGenerating] = useState(null); // which doc type is generating
  const [genLog, setGenLog] = useState('');
  const [genProgress, setGenProgress] = useState(null);
  const [activeTab, setActiveTab] = useState('uds');

  const docPaths = (() => {
    try { return JSON.parse(localStorage.getItem('devops_v2_doc_paths') || '{}'); } catch (_) { return {}; }
  })();

  const loadLists = useCallback(async () => {
    const qs = `job_url=${encodeURIComponent(job?.url ?? '')}&cache_root=${encodeURIComponent(cacheRoot ?? '')}`;
    const [u, s, su, si] = await Promise.allSettled([
      api(`/api/jenkins/uds/list?${qs}`),
      api(`/api/jenkins/sts/list?${qs}`),
      api(`/api/jenkins/suts/list?${qs}`),
      api(`/api/jenkins/suts/list?${qs}`).catch(() => []), // SITS uses suts endpoint as fallback
    ]);
    setLists({
      uds: u.status === 'fulfilled' ? (u.value?.files ?? u.value ?? []) : [],
      sts: s.status === 'fulfilled' ? (s.value?.files ?? s.value ?? []) : [],
      suts: su.status === 'fulfilled' ? (su.value?.files ?? su.value ?? []) : [],
      sits: si.status === 'fulfilled' ? (si.value?.files ?? si.value ?? []) : [],
    });
  }, [job, cacheRoot]);

  const generateDoc = useCallback(async (docType) => {
    if (!job?.url) { toast('warning', '프로젝트를 먼저 선택하세요.'); return; }
    const label = DOC_TYPES.find(d => d.key === docType)?.label || docType.toUpperCase();
    setGenerating(docType);
    setGenLog(`${label} 생성 시작...\n`);
    setGenProgress(null);
    setActiveTab(docType);

    try {
      const formData = new FormData();
      formData.append('job_url', job.url);
      formData.append('cache_root', cacheRoot);
      formData.append('build_selector', cfg.buildSelector || 'lastSuccessfulBuild');
      if (docType === 'uds' && docPaths.template) formData.append('uds_template_path', docPaths.template);
      if (docPaths.srs) formData.append('srs_path', docPaths.srs);

      const res = await fetch(`/api/jenkins/${docType}/generate-async`, {
        method: 'POST',
        body: formData,
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
        progress = await pollStsProgress(data.job_id, docType, {
          onMsg: msg => {
            setGenLog(prev => prev + msg + '\n');
            const match = msg.match(/(\d+)%/);
            if (match) setGenProgress(Number(match[1]));
          },
          signal: null,
        });
      }

      if (progress?.error) throw new Error(progress.error);

      toast('success', `${label} 생성 완료`);
      setGenLog(prev => prev + `✓ ${label} 생성 완료\n`);
      loadLists();
    } catch (e) {
      toast('error', `${label} 생성 실패: ${e.message}`);
      setGenLog(prev => prev + `✕ 오류: ${e.message}\n`);
    } finally {
      setGenerating(null);
    }
  }, [job, cfg, cacheRoot, docPaths, toast, loadLists]);

  return (
    <div>
      {/* Generation controls */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">문서 생성</span>
          <button className="btn-sm" onClick={loadLists} disabled={!!generating}>목록 새로고침</button>
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

      {/* Document lists - tabbed */}
      <div className="panel mt-3">
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
          {DOC_TYPES.map(dt => (
            <button
              key={dt.key}
              onClick={() => setActiveTab(dt.key)}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom: activeTab === dt.key ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'none',
                fontWeight: activeTab === dt.key ? 700 : 400,
                color: activeTab === dt.key ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {dt.icon} {dt.label}
              <StatusBadge tone={lists[dt.key].length > 0 ? 'success' : 'neutral'} >
                {lists[dt.key].length}
              </StatusBadge>
            </button>
          ))}
        </div>

        <DocList
          docType={activeTab}
          files={lists[activeTab] || []}
          jobUrl={job?.url}
          cacheRoot={cacheRoot}
        />
      </div>
    </div>
  );
}

function DocList({ docType, files, jobUrl, cacheRoot }) {
  const [previewContent, setPreviewContent] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const toast = useToast();

  const loadPreview = async (filename) => {
    setPreviewLoading(true);
    try {
      const data = await api(
        `/api/jenkins/${docType}/view/${encodeURIComponent(filename)}` +
        `?job_url=${encodeURIComponent(jobUrl ?? '')}` +
        `&cache_root=${encodeURIComponent(cacheRoot ?? '')}`
      );
      setPreviewContent({ filename, data });
    } catch (e) {
      toast('error', `미리보기 실패: ${e.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  if (!files.length) {
    return (
      <div className="text-muted text-sm" style={{ padding: 12 }}>
        생성된 문서가 없습니다. 상단 버튼으로 생성하거나, 목록 새로고침을 시도하세요.
      </div>
    );
  }

  const EXT_ICON = { docx: '📝', xlsx: '📊', pdf: '📋', html: '🌐', json: '📄', md: '📝' };

  return (
    <div>
      <div className="artifact-list">
        {files.map((f, i) => {
          const name = typeof f === 'string' ? f : (f.name ?? f.filename ?? f.path ?? String(f));
          const ext = name.split('.').pop()?.toLowerCase();
          return (
            <div key={i} className="artifact-item" style={{ padding: '6px 8px' }}>
              <span className="artifact-icon">{EXT_ICON[ext] || '📄'}</span>
              <span className="artifact-name" style={{ flex: 1 }} title={name}>
                {name.length > 60 ? `...${name.slice(-57)}` : name}
              </span>
              {typeof f === 'object' && f.version && (
                <span className="pill pill-info" style={{ fontSize: 10 }}>v{f.version}</span>
              )}
              {typeof f === 'object' && f.quality_score != null && (
                <span className={`pill ${f.quality_score >= 80 ? 'pill-success' : f.quality_score >= 60 ? 'pill-warning' : 'pill-danger'}`} style={{ fontSize: 10 }}>
                  Q{f.quality_score}
                </span>
              )}
              <button
                className="btn-sm"
                onClick={() => loadPreview(name)}
                disabled={previewLoading}
                style={{ fontSize: 10, padding: '2px 6px' }}
              >
                미리보기
              </button>
              <a
                href={`/api/jenkins/${docType}/download/${encodeURIComponent(name)}?job_url=${encodeURIComponent(jobUrl ?? '')}&cache_root=${encodeURIComponent(cacheRoot ?? '')}`}
                download
                style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', padding: '2px 4px' }}
                title="다운로드"
              >↓</a>
            </div>
          );
        })}
      </div>

      {/* Preview panel */}
      {previewContent && (
        <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <div className="row" style={{ padding: '6px 10px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>미리보기: {previewContent.filename}</span>
            <button className="btn-sm" onClick={() => setPreviewContent(null)} style={{ fontSize: 10 }}>닫기</button>
          </div>
          <div className="log-box" style={{ maxHeight: 400, fontSize: 11, margin: 0, borderRadius: 0 }}>
            {typeof previewContent.data === 'string'
              ? previewContent.data
              : JSON.stringify(previewContent.data, null, 2)
            }
          </div>
        </div>
      )}
    </div>
  );
}
