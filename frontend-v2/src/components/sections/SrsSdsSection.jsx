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
      // Step 1: Get requirements + mapping from SRS via requirements-preview
      const form = new FormData();
      if (docPaths.srs) form.append('req_paths', docPaths.srs);
      const scm = analysisResult?.scmList?.[0];
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
        toast('warning', `요구사항 미리보기 실패 (매핑 없이 진행): ${e.message}`);
      }

      // Step 2: Get VectorCAST test rows
      let vcastRows = [];
      try {
        const ragData = await post('/api/jenkins/report/vectorcast-rag', {
          job_url: job.url,
          cache_root: cacheRoot,
          build_selector: cfg.buildSelector || 'lastSuccessfulBuild',
        });
        vcastRows = ragData?.data?.test_rows || [];
      } catch (_) { /* VectorCAST 데이터 없으면 빈 배열로 진행 */ }

      // Step 3: Generate traceability matrix
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

function CoverageBar({ covered, partial, total }) {
  if (!total) return null;
  const covPct = Math.round((covered / total) * 100);
  const partPct = Math.round((partial / total) * 100);
  const uncovPct = 100 - covPct - partPct;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#e5e7eb' }}>
        {covPct > 0 && <div style={{ width: `${covPct}%`, background: COVERAGE_COLORS.covered.border }} />}
        {partPct > 0 && <div style={{ width: `${partPct}%`, background: COVERAGE_COLORS.partial.border }} />}
        {uncovPct > 0 && <div style={{ width: `${uncovPct}%`, background: COVERAGE_COLORS.uncovered.border }} />}
      </div>
      <div className="text-sm text-muted" style={{ display: 'flex', gap: 10 }}>
        <span style={{ color: COVERAGE_COLORS.covered.fg }}>Covered {covPct}%</span>
        {partial > 0 && <span style={{ color: COVERAGE_COLORS.partial.fg }}>Partial {partPct}%</span>}
        <span style={{ color: COVERAGE_COLORS.uncovered.fg }}>Uncovered {uncovPct}%</span>
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
  const coverage = useMemo(() => {
    if (!rows.length) return null;
    let covered = 0, partial = 0, uncovered = 0;
    for (const r of rows) {
      const st = r.status ?? 'uncovered';
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
      result = result.filter(r => (r.status ?? 'uncovered') === statusFilter);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter(r =>
        (r.req_id ?? r.id ?? '').toLowerCase().includes(q) ||
        (r.function ?? r.func ?? '').toLowerCase().includes(q) ||
        (r.file ?? r.source ?? '').toLowerCase().includes(q)
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
      {/* Coverage stats */}
      {coverage && (
        <div className="stats-row" style={{ marginBottom: 12 }}>
          <div className="stat-card">
            <div className="text-muted text-sm">전체 요구사항</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{coverage.total}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: `3px solid ${COVERAGE_COLORS.covered.border}` }}>
            <div className="text-muted text-sm">커버됨</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COVERAGE_COLORS.covered.fg }}>{coverage.covered}</div>
          </div>
          {coverage.partial > 0 && (
            <div className="stat-card" style={{ borderLeft: `3px solid ${COVERAGE_COLORS.partial.border}` }}>
              <div className="text-muted text-sm">부분</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: COVERAGE_COLORS.partial.fg }}>{coverage.partial}</div>
            </div>
          )}
          <div className="stat-card" style={{ borderLeft: `3px solid ${COVERAGE_COLORS.uncovered.border}` }}>
            <div className="text-muted text-sm">미커버</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COVERAGE_COLORS.uncovered.fg }}>{coverage.uncovered}</div>
          </div>
          <div className="stat-card">
            <div className="text-muted text-sm">커버리지</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{coverage.pct}%</div>
          </div>
        </div>
      )}

      {/* Coverage bar */}
      {coverage && (
        <div style={{ marginBottom: 12 }}>
          <CoverageBar covered={coverage.covered} partial={coverage.partial} total={coverage.total} />
        </div>
      )}

      {/* Summary pills (from API) */}
      {summary && (
        <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(summary).map(([k, v]) => (
            <span key={k} className="pill pill-info">{k}: {v}</span>
          ))}
        </div>
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
      <table className="impact-table">
        <thead>
          <tr>
            <th>요구사항 ID</th>
            <th>함수</th>
            <th>파일</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((r, i) => {
            const status = r.status ?? 'uncovered';
            const colors = COVERAGE_COLORS[status] || {};
            return (
              <tr key={i} style={{ background: colors.bg }}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.req_id ?? r.id ?? '-'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.function ?? r.func ?? '-'}</td>
                <td className="text-sm">{r.file ?? r.source ?? '-'}</td>
                <td><StatusBadge tone={coverageTone(status)}>{status}</StatusBadge></td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
