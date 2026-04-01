import { useState, useCallback, useMemo } from 'react';
import { post, getUsername } from '../../api.js';
import { useJenkinsCfg, useToast } from '../../App.jsx';
import StatusBadge from '../StatusBadge.jsx';
import { defaultCacheRoot } from '../../api.js';

export default function SrsSdsSection({ job, analysisResult }) {
  const { cfg } = useJenkinsCfg();
  const toast = useToast();
  const cacheRoot = analysisResult?.cacheRoot || defaultCacheRoot(job?.url) || cfg.cacheRoot;

  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(false);

  const localDocPaths = (() => {
    try { return JSON.parse(localStorage.getItem('devops_v2_doc_paths') || '{}'); } catch (_) { return {}; }
  })();

  // Merge: SCM linked_docs takes priority, then localStorage
  const scmLinked = analysisResult?.scmList?.[0]?.linked_docs || {};
  const docPaths = {
    srs: localDocPaths.srs || scmLinked.srs || '',
    sds: localDocPaths.sds || scmLinked.sds || '',
    hsis: localDocPaths.hsis || scmLinked.hsis || '',
    stp: localDocPaths.stp || scmLinked.stp || '',
  };

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      // Step 1: Get requirements from SRS
      const form = new FormData();
      if (docPaths.srs) form.append('req_paths', docPaths.srs);
      const scm = analysisResult?.scmList?.[0];
      const linkedDocs = scm?.linked_docs || {};
      if (scm?.source_root) form.append('source_root', scm.source_root);

      let reqItems = [];
      let mappingPairs = [];
      try {
        const user = getUsername();
        const previewRes = await fetch('/api/jenkins/uds/requirements-preview', {
          method: 'POST', body: form,
          headers: user ? { 'X-User': user } : {},
        });
        if (previewRes.ok) {
          const previewData = await previewRes.json();
          reqItems = previewData?.preview?.items || [];
          mappingPairs = previewData?.traceability?.mapping_pairs
            || previewData?.mapping || [];
        }
      } catch (e) {
        toast('warning', `요구사항 미리보기 실패: ${e.message}`);
      }

      // Step 2: Extract func→req mapping from UDS document
      if (mappingPairs.length === 0 && linkedDocs.uds) {
        try {
          const udsMapping = await post('/api/jenkins/uds/extract-mapping', {
            uds_path: linkedDocs.uds,
          });
          mappingPairs = udsMapping?.mapping_pairs || [];
          if (mappingPairs.length > 0) {
            toast('info', `UDS에서 ${mappingPairs.length}개 매핑 추출`);
          }
        } catch (_) { /* UDS 매핑 추출 실패 — 빈 매핑으로 진행 */ }
      }

      // Step 3: Collect test rows from all sources
      let vcastRows = [];

      // 3a. STS traceability (요구사항↔TC 직접 매핑 — 가장 정확)
      if (linkedDocs.sts) {
        try {
          const stsData = await post('/api/jenkins/sts/extract-traceability', { path: linkedDocs.sts });
          if (stsData?.vcast_rows?.length) {
            vcastRows.push(...stsData.vcast_rows);
          }
        } catch (_) {}
      }

      // 3b. SUTS traceability
      if (linkedDocs.suts) {
        try {
          const sutsData = await post('/api/jenkins/sts/extract-traceability', { path: linkedDocs.suts });
          if (sutsData?.vcast_rows?.length) {
            vcastRows.push(...sutsData.vcast_rows);
          }
        } catch (_) {}
      }

      // 3c. VectorCAST (함수 기반 — UDS 매핑 통해 연결)
      try {
        const ragData = await post('/api/jenkins/report/vectorcast-rag', {
          job_url: job.url,
          cache_root: cacheRoot,
          build_selector: cfg.buildSelector || 'lastSuccessfulBuild',
        });
        const rawRows = ragData?.data?.test_rows || [];

        const funcToReqs = {};
        for (const mp of mappingPairs) {
          for (const fn of (mp.source_ids || [])) {
            if (!funcToReqs[fn]) funcToReqs[fn] = [];
            funcToReqs[fn].push(mp.requirement_id);
          }
        }

        for (const row of rawRows) {
          const fn = row.subprogram || '';
          const reqs = funcToReqs[fn] || [];
          for (const rid of reqs) {
            vcastRows.push({ ...row, requirement_id: rid, testcase: fn, source: 'VectorCAST' });
          }
        }
      } catch (_) {}

      // Step 4: Generate traceability matrix
      const data = await post('/api/jenkins/uds/traceability-matrix', {
        requirement_items: reqItems,
        mapping_pairs: mappingPairs,
        vcast_rows: vcastRows,
      });
      setMatrix(data);
    } catch (e) {
      toast('error', `추적성 매트릭스 조회 실패: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [job, cfg, cacheRoot, docPaths.srs, docPaths.sds, toast]);

  const impactData = analysisResult?.impactData;
  const impacts = impactData?.impacts ?? impactData?.impact_items ?? [];
  const changedFiles = impactData?.changed_files ?? [];
  const impactedDocs = impactData?.impacted_docs ?? impactData?.impacted_documents ?? [];

  // Linked docs from SCM registry
  const linkedDocs = analysisResult?.scmList?.[0]?.linked_docs;
  const linkedDocEntries = useMemo(() => {
    if (!linkedDocs || typeof linkedDocs !== 'object') return [];
    return Object.entries(linkedDocs).filter(([, v]) => v);
  }, [linkedDocs]);

  return (
    <div>
      {/* Input doc status */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">입력 문서 현황</span>
        </div>
        <div className="field-group">
          {[
            { label: 'SRS', path: docPaths.srs, fromScm: !localDocPaths.srs && !!scmLinked.srs },
            { label: 'SDS', path: docPaths.sds, fromScm: !localDocPaths.sds && !!scmLinked.sds },
            { label: 'HSIS', path: docPaths.hsis, fromScm: !localDocPaths.hsis && !!scmLinked.hsis },
            { label: 'STP', path: docPaths.stp, fromScm: !localDocPaths.stp && !!scmLinked.stp },
          ].map(({ label, path, fromScm }) => (
            <div key={label} className="artifact-item" style={{ background: 'var(--bg)' }}>
              <span className="pill pill-purple" style={{ minWidth: 40, textAlign: 'center' }}>{label}</span>
              {path ? (
                <>
                  <span className="artifact-name" title={path}>
                    {path.split(/[\\/]/).pop()}
                  </span>
                  {fromScm && <span className="pill pill-info" style={{ fontSize: 9 }}>SCM</span>}
                  <StatusBadge tone="success">등록됨</StatusBadge>
                </>
              ) : (
                <>
                  <span className="text-muted text-sm">설정 탭 또는 SCM에서 경로를 등록하세요</span>
                  <StatusBadge tone="neutral">미등록</StatusBadge>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Linked docs from SCM registry */}
      {linkedDocEntries.length > 0 && (
        <div className="panel mt-3">
          <div className="panel-header">
            <span className="panel-title">SCM 연결 문서</span>
            <StatusBadge tone="info">{linkedDocEntries.length}건</StatusBadge>
          </div>
          <div className="field-group">
            {linkedDocEntries.map(([docType, docPath]) => {
              const fileName = typeof docPath === 'string'
                ? docPath.split('/').pop().split('\\').pop()
                : docPath?.name ?? String(docPath);
              const fullPath = typeof docPath === 'string' ? docPath : docPath?.path ?? String(docPath);
              return (
                <div key={docType} className="artifact-item" style={{ background: 'var(--bg)' }}>
                  <span className="pill pill-purple" style={{ minWidth: 44, textAlign: 'center' }}>
                    {docType.toUpperCase()}
                  </span>
                  <span className="artifact-name" title={fullPath}>{fileName}</span>
                  <span className="text-muted text-sm" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    {fullPath}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Impact data: changed files and impacted documents */}
      {impactData && (changedFiles.length > 0 || impactedDocs.length > 0) && (
        <div className="panel mt-3">
          <div className="panel-header">
            <span className="panel-title">영향 분석 결과</span>
          </div>

          {/* Stats row */}
          <div className="stats-row" style={{ marginBottom: 12 }}>
            <div className="stat-card">
              <div className="text-muted text-sm">변경 파일</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{changedFiles.length}</div>
            </div>
            <div className="stat-card">
              <div className="text-muted text-sm">영향 문서</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{impactedDocs.length}</div>
            </div>
            {impacts.length > 0 && (
              <div className="stat-card">
                <div className="text-muted text-sm">영향 요구사항</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{impacts.length}</div>
              </div>
            )}
          </div>

          {/* Changed files */}
          {changedFiles.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="text-sm" style={{ fontWeight: 700, marginBottom: 6 }}>변경 파일</div>
              <div className="artifact-list">
                {changedFiles.map((f, i) => {
                  const path = typeof f === 'string' ? f : f.path;
                  const action = typeof f === 'object' ? f.action : undefined;
                  return (
                    <div key={i} className="artifact-item">
                      <span style={{ fontSize: 11, marginRight: 4 }}>
                        {action === 'A' ? '🟢' : action === 'D' ? '🔴' : '🟡'}
                      </span>
                      <span className="artifact-name" style={{ fontFamily: 'monospace', fontSize: 11 }}>{path}</span>
                      {action && <span className="pill pill-neutral">{action}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Impacted documents */}
          {impactedDocs.length > 0 && (
            <div>
              <div className="text-sm" style={{ fontWeight: 700, marginBottom: 6 }}>영향받는 문서</div>
              <table className="impact-table">
                <thead>
                  <tr><th>문서명</th><th>유형</th><th>상태</th></tr>
                </thead>
                <tbody>
                  {impactedDocs.map((doc, i) => {
                    const name = doc.name ?? doc.doc_name ?? doc.path ?? '-';
                    const type = doc.type ?? doc.doc_type ?? '-';
                    const status = doc.status ?? 'unknown';
                    const tone = status === 'updated' ? 'success'
                      : status === 'outdated' ? 'danger'
                      : status === 'review_needed' ? 'warning'
                      : 'neutral';
                    return (
                      <tr key={i}>
                        <td className="text-sm">{name}</td>
                        <td><span className="pill pill-purple">{type.toUpperCase()}</span></td>
                        <td><StatusBadge tone={tone}>{status}</StatusBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Impact summary - requirement level */}
      {impacts.length > 0 && (
        <div className="panel mt-3">
          <div className="panel-header">
            <span className="panel-title">영향받는 요구사항</span>
            <StatusBadge tone="warning">{impacts.length}건</StatusBadge>
          </div>
          <table className="impact-table">
            <thead>
              <tr><th>요구사항 ID</th><th>설명</th><th>문서</th><th>영향 수준</th></tr>
            </thead>
            <tbody>
              {impacts.map((item, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{item.req_id ?? item.id ?? '-'}</td>
                  <td className="text-sm">{item.description ?? item.desc ?? '-'}</td>
                  <td className="text-sm">{item.doc ?? item.document ?? '-'}</td>
                  <td>
                    <StatusBadge tone={item.level === 'high' ? 'danger' : item.level === 'medium' ? 'warning' : 'info'}>
                      {item.level ?? '-'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Traceability matrix */}
      <div className="panel mt-3">
        <div className="panel-header">
          <span className="panel-title">추적성 매트릭스</span>
          <button className="btn-sm" onClick={loadMatrix} disabled={loading}>
            {loading ? <span className="spinner" /> : '매트릭스 생성'}
          </button>
        </div>
        {matrix ? (
          <TraceMatrix matrix={matrix} />
        ) : (
          <div className="text-muted text-sm">
            SRS/SDS 경로를 설정 탭에서 등록한 후 매트릭스 생성 버튼을 클릭하세요.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Coverage helpers ── */
const COVERAGE_COLORS = {
  covered:   { bg: '#dcfce7', fg: '#166534', border: '#86efac' },
  partial:   { bg: '#fef9c3', fg: '#854d0e', border: '#fde047' },
  uncovered: { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
};

function coverageTone(status) {
  if (status === 'covered')   return 'success';
  if (status === 'partial')   return 'warning';
  if (status === 'uncovered') return 'danger';
  return 'neutral';
}

function CoverageBar({ covered, partial, total, onFilter }) {
  if (!total) return null;
  const covPct = Math.round((covered / total) * 100);
  const partPct = Math.round((partial / total) * 100);
  const uncovPct = 100 - covPct - partPct;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', background: '#e5e7eb', cursor: 'pointer' }}>
        {covPct > 0 && <div onClick={() => onFilter?.('covered')} title="Covered만 보기" style={{ width: `${covPct}%`, background: COVERAGE_COLORS.covered.border }} />}
        {partPct > 0 && <div onClick={() => onFilter?.('partial')} title="Partial만 보기" style={{ width: `${partPct}%`, background: COVERAGE_COLORS.partial.border }} />}
        {uncovPct > 0 && <div onClick={() => onFilter?.('uncovered')} title="Uncovered만 보기" style={{ width: `${uncovPct}%`, background: COVERAGE_COLORS.uncovered.border }} />}
      </div>
      <div className="text-sm text-muted" style={{ display: 'flex', gap: 10 }}>
        <span style={{ color: COVERAGE_COLORS.covered.fg, cursor: 'pointer' }} onClick={() => onFilter?.('covered')}>Covered {covPct}%</span>
        {partial > 0 && <span style={{ color: COVERAGE_COLORS.partial.fg, cursor: 'pointer' }} onClick={() => onFilter?.('partial')}>Partial {partPct}%</span>}
        <span style={{ color: COVERAGE_COLORS.uncovered.fg, cursor: 'pointer' }} onClick={() => onFilter?.('uncovered')}>Uncovered {uncovPct}%</span>
        <span style={{ cursor: 'pointer', opacity: 0.5 }} onClick={() => onFilter?.('all')}>전체</span>
      </div>
    </div>
  );
}

const PAGE_SIZE = 30;

function TraceMatrix({ matrix }) {
  const inner = matrix?.matrix ?? matrix;
  const rows = Array.isArray(inner?.rows) ? inner.rows : (Array.isArray(inner?.items) ? inner.items : []);
  const summary = inner?.summary ?? matrix?.summary;

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Compute coverage statistics
  // Derive status from source_ids and test_ids if not provided by API
  const deriveStatus = (r) => {
    if (r.status && r.status !== 'uncovered') return r.status;
    const hasSrc = (r.source_ids ?? []).length > 0;
    const hasTest = (r.test_ids ?? r.tests ?? []).length > 0;
    if (hasSrc && hasTest) return 'covered';
    if (hasSrc || hasTest) return 'partial';
    return 'uncovered';
  };

  const coverage = useMemo(() => {
    if (!rows.length) return null;
    let covered = 0, partial = 0, uncovered = 0;
    for (const r of rows) {
      const st = deriveStatus(r);
      if (st === 'covered') covered++;
      else if (st === 'partial') partial++;
      else uncovered++;
    }
    const total = rows.length;
    return { covered, partial, uncovered, total, pct: Math.round((covered / total) * 100) };
  }, [rows]);

  // Filter rows by search term and status
  const filtered = useMemo(() => {
    let result = rows;
    if (statusFilter !== 'all') {
      result = result.filter(r => deriveStatus(r) === statusFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(r =>
        (r.requirement_id ?? r.req_id ?? r.id ?? '').toLowerCase().includes(q) ||
        (r.source_ids ?? []).join(' ').toLowerCase().includes(q) ||
        (r.test_ids ?? []).join(' ').toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, searchTerm, statusFilter]);

  // Reset visible count when filters change
  const displayedRows = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  if (!rows.length) {
    return <div className="log-box">{JSON.stringify(matrix, null, 2)}</div>;
  }

  return (
    <div>
      {/* Coverage summary table */}
      {coverage && (
        <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '10px 14px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
            추적성 요약
          </div>

          {/* Summary table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>구분</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 80 }}>건수</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 80 }}>비율</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>설명</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '6px 12px', fontWeight: 600 }}>전체 요구사항 (SRS)</td>
                <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{coverage.total}</td>
                <td style={{ padding: '6px 12px', textAlign: 'center' }}>100%</td>
                <td style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>SRS 문서에서 추출된 요구사항</td>
              </tr>
              <tr style={{ background: COVERAGE_COLORS.covered.bg }}>
                <td style={{ padding: '6px 12px', fontWeight: 600, color: COVERAGE_COLORS.covered.fg }}>
                  Covered (설계+테스트 완료)
                </td>
                <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700, fontSize: 14, color: COVERAGE_COLORS.covered.fg }}>{coverage.covered}</td>
                <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 600, color: COVERAGE_COLORS.covered.fg }}>{coverage.pct}%</td>
                <td style={{ padding: '6px 12px', fontSize: 11 }}>UDS 소스 매핑 + STS/VectorCAST 테스트 매핑 모두 존재</td>
              </tr>
              {coverage.partial > 0 && (
                <tr style={{ background: COVERAGE_COLORS.partial.bg }}>
                  <td style={{ padding: '6px 12px', fontWeight: 600, color: COVERAGE_COLORS.partial.fg }}>
                    Partial (테스트만 존재)
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700, fontSize: 14, color: COVERAGE_COLORS.partial.fg }}>{coverage.partial}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 600, color: COVERAGE_COLORS.partial.fg }}>{Math.round(coverage.partial / coverage.total * 100)}%</td>
                  <td style={{ padding: '6px 12px', fontSize: 11 }}>STS 테스트 매핑 있으나 UDS 소스 매핑 없음 (비기능/HW/시스템 레벨 요구사항)</td>
                </tr>
              )}
              {coverage.uncovered > 0 && (
                <tr style={{ background: COVERAGE_COLORS.uncovered.bg }}>
                  <td style={{ padding: '6px 12px', fontWeight: 600, color: COVERAGE_COLORS.uncovered.fg }}>
                    Uncovered (미추적)
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700, fontSize: 14, color: COVERAGE_COLORS.uncovered.fg }}>{coverage.uncovered}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 600, color: COVERAGE_COLORS.uncovered.fg }}>{Math.round(coverage.uncovered / coverage.total * 100)}%</td>
                  <td style={{ padding: '6px 12px', fontSize: 11 }}>설계 및 테스트 매핑 모두 없음</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 700 }}>SW 구현 대상 커버리지</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, fontSize: 16, color: 'var(--color-success)' }}>
                  {coverage.covered}/{coverage.covered + coverage.uncovered}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, fontSize: 16, color: 'var(--color-success)' }}>
                  {coverage.covered + coverage.uncovered > 0 ? Math.round(coverage.covered / (coverage.covered + coverage.uncovered) * 100) : 0}%
                </td>
                <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                  UDS에 설계된 SW 구현 대상 기준 (Partial 제외)
                </td>
              </tr>
              <tr style={{ background: 'var(--bg)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 700 }}>테스트 추적 커버리지</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, fontSize: 16, color: 'var(--color-success)' }}>
                  {summary?.mapped_test_count ?? (coverage.covered + coverage.partial)}/{coverage.total}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, fontSize: 16, color: 'var(--color-success)' }}>
                  {Math.round(((summary?.mapped_test_count ?? (coverage.covered + coverage.partial)) / coverage.total) * 100)}%
                </td>
                <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                  STS/SUTS/VectorCAST 테스트 매핑 기준
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Coverage bar */}
      {coverage && (
        <div style={{ marginBottom: 12 }}>
          <CoverageBar covered={coverage.covered} partial={coverage.partial} total={coverage.total}
            onFilter={(status) => { setStatusFilter(status === 'all' ? 'all' : status); setVisibleCount(PAGE_SIZE); }} />
        </div>
      )}

      {/* Data sources */}
      {summary && (
        <details style={{ marginBottom: 12 }}>
          <summary className="text-sm" style={{ cursor: 'pointer', fontWeight: 600 }}>데이터 소스 상세</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <div style={{ padding: 8, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>설계 추적 (UDS)</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{summary.mapped_source_count ?? coverage.covered} / {coverage.total}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>UDS 함수 → 요구사항 매핑</div>
            </div>
            <div style={{ padding: 8, background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>테스트 추적 (STS+VCast)</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{summary.mapped_test_count ?? (coverage.covered + coverage.partial)} / {coverage.total}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>STS TC + VectorCAST → 요구사항 매핑</div>
            </div>
          </div>
        </details>
      )}

      {/* Search and filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="요구사항 ID, 함수, 파일 검색..."
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setVisibleCount(PAGE_SIZE); }}
          style={{
            flex: 1, minWidth: 180, padding: '6px 10px', fontSize: 13,
            border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
          style={{
            padding: '6px 10px', fontSize: 13,
            border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        >
          <option value="all">전체 상태</option>
          <option value="covered">Covered</option>
          <option value="partial">Partial</option>
          <option value="uncovered">Uncovered</option>
        </select>
        <span className="text-muted text-sm">
          {filtered.length}건{filtered.length !== rows.length ? ` / ${rows.length}건` : ''}
        </span>
      </div>

      {/* Matrix table */}
      <div style={{ overflowX: 'auto' }}>
      <table className="impact-table" style={{ minWidth: 700 }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: 'middle', width: 100 }}>요구사항 ID</th>
            <th colSpan={1} style={{ textAlign: 'center', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>설계</th>
            <th colSpan={2} style={{ textAlign: 'center', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>검증</th>
            <th rowSpan={2} style={{ verticalAlign: 'middle', width: 80 }}>상태</th>
          </tr>
          <tr>
            <th style={{ fontSize: 10 }}>UDS 함수</th>
            <th style={{ fontSize: 10 }}>STS TC</th>
            <th style={{ fontSize: 10 }}>VectorCAST</th>
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((r, i) => {
            const status = deriveStatus(r);
            const colors = COVERAGE_COLORS[status] || {};
            const srcFuncs = r.source_ids ?? [];
            const allTests = r.test_ids ?? r.tests ?? [];
            // Separate STS vs VectorCAST tests
            const rawTests = Array.isArray(r.tests) ? r.tests : [];
            const stsTests = rawTests.filter(t => (t.source || '') === 'STS' || (t.source || '') === 'SUTS');
            const vcastTests = rawTests.filter(t => (t.source || '') === 'VectorCAST' || (!(t.source || '').includes('STS') && !(t.source || '').includes('SUTS')));
            const stsCount = stsTests.length || (allTests.length > 0 && rawTests.length === 0 ? allTests.length : 0);
            const vcastCount = vcastTests.length;

            return (
              <tr key={i} style={{ background: colors.bg }}>
                <td style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                  {r.requirement_id ?? r.req_id ?? r.id ?? '-'}
                </td>
                <td style={{ fontSize: 10, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={srcFuncs.join(', ')}>
                  {srcFuncs.length > 0
                    ? <><span className="pill pill-info" style={{ fontSize: 9 }}>{srcFuncs.length}</span> {srcFuncs.slice(0, 3).join(', ')}{srcFuncs.length > 3 ? '...' : ''}</>
                    : <span className="text-muted">-</span>
                  }
                </td>
                <td style={{ fontSize: 10, textAlign: 'center' }}>
                  {stsCount > 0
                    ? <span className="pill pill-success" style={{ fontSize: 9 }}>{stsCount} TC</span>
                    : <span className="text-muted">-</span>
                  }
                </td>
                <td style={{ fontSize: 10, textAlign: 'center' }}>
                  {vcastCount > 0
                    ? <span className="pill pill-info" style={{ fontSize: 9 }}>{vcastCount}</span>
                    : <span className="text-muted">-</span>
                  }
                </td>
                <td style={{ textAlign: 'center' }}>
                  <StatusBadge tone={coverageTone(status)}>{status}</StatusBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* Show more / pagination */}
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <button
            className="btn-sm"
            onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
          >
            더 보기 ({filtered.length - visibleCount}건 남음)
          </button>
        </div>
      )}
      {!hasMore && filtered.length > PAGE_SIZE && (
        <div className="text-muted text-sm" style={{ textAlign: 'center', padding: '6px 0' }}>
          전체 {filtered.length}건 표시됨
        </div>
      )}
    </div>
  );
}
