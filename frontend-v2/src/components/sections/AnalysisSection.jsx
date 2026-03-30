import { useState, useCallback } from 'react';
import { post } from '../../api.js';
import { useJenkinsCfg, useToast } from '../../App.jsx';
import StatusBadge from '../StatusBadge.jsx';
import { defaultCacheRoot } from '../../api.js';

export default function AnalysisSection({ job, analysisResult }) {
  const { cfg } = useJenkinsCfg();
  const toast = useToast();
  const cacheRoot = analysisResult?.cacheRoot || defaultCacheRoot(job?.url) || cfg.cacheRoot;

  const [complexity, setComplexity] = useState(null);
  const [complexityLoading, setComplexityLoading] = useState(false);
  const [docs, setDocs] = useState(null);
  const [docsLoading, setDocsLoading] = useState(false);

  const loadComplexity = useCallback(async () => {
    setComplexityLoading(true);
    try {
      const data = await post('/api/jenkins/report/complexity', {
        job_url: job.url,
        cache_root: cacheRoot,
        build_selector: cfg.buildSelector,
      });
      setComplexity(data);
    } catch (e) {
      toast('error', `복잡도 조회 실패: ${e.message}`);
    } finally {
      setComplexityLoading(false);
    }
  }, [job, cfg, cacheRoot, toast]);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const data = await post('/api/jenkins/report/docs', {
        job_url: job.url,
        cache_root: cacheRoot,
        build_selector: cfg.buildSelector,
      });
      setDocs(data);
    } catch (e) {
      toast('error', `문서 목록 조회 실패: ${e.message}`);
    } finally {
      setDocsLoading(false);
    }
  }, [job, cfg, cacheRoot, toast]);

  const rd = analysisResult?.reportData;
  const rows = complexity?.rows ?? complexity?.functions ?? [];
  const qualityCfg = (() => {
    try { return JSON.parse(localStorage.getItem('devops_v2_quality') || '{}'); } catch (_) { return {}; }
  })();
  const threshold = qualityCfg.complexity ?? 15;

  // coverage may be a number (%) or an object {line_rate, branch_rate, ok, threshold}
  const coverageObj = (() => {
    const c = rd?.coverage;
    if (c == null) return null;
    if (typeof c === 'number') return { pct: c, line_rate: null, branch_rate: null, ok: null, threshold: null };
    if (typeof c === 'object') {
      const pct = c.line_rate != null ? Math.round(c.line_rate * 100) : null;
      return { pct, line_rate: c.line_rate, branch_rate: c.branch_rate, ok: c.ok, threshold: c.threshold };
    }
    return null;
  })();
  const coveragePct = coverageObj?.pct;

  const prqa = rd?.kpis?.prqa;
  const codeMetrics = rd?.kpis?.code_metrics;
  const tester = rd?.tester;
  const hmr = prqa?.hmr_stats;

  // Normalize docs into an array of items for display
  const docItems = (() => {
    if (!docs) return null;
    if (Array.isArray(docs)) return docs;
    if (docs.documents) return Array.isArray(docs.documents) ? docs.documents : [];
    if (docs.files) return Array.isArray(docs.files) ? docs.files : [];
    if (docs.items) return Array.isArray(docs.items) ? docs.items : [];
    return null; // fallback to raw display
  })();

  return (
    <div>
      {/* Summary stats from report */}
      {rd && (
        <div className="stats-row">
          {coveragePct != null && (
            <div className="stat-card">
              <div className="stat-value">{coveragePct.toFixed(1)}%</div>
              <div className="stat-label">코드 커버리지</div>
              {coverageObj.branch_rate != null && (
                <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                  Branch: {(coverageObj.branch_rate * 100).toFixed(1)}%
                </div>
              )}
              {coverageObj.ok != null && (
                <div style={{ marginTop: 2 }}>
                  <StatusBadge tone={coverageObj.ok ? 'success' : 'danger'}>
                    {coverageObj.ok ? 'PASS' : 'FAIL'}
                  </StatusBadge>
                </div>
              )}
            </div>
          )}
          {rd.qac_violations != null && (
            <div className="stat-card">
              <div className="stat-value" style={{ color: rd.qac_violations > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>{rd.qac_violations}</div>
              <div className="stat-label">QAC 위반</div>
            </div>
          )}
          {rd.function_count != null && (
            <div className="stat-card">
              <div className="stat-value">{rd.function_count}</div>
              <div className="stat-label">함수 수</div>
            </div>
          )}
        </div>
      )}

      {/* Code Metrics */}
      {codeMetrics && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">📐 코드 메트릭</span>
          </div>
          <div className="stats-row">
            {codeMetrics.code_files != null && (
              <div className="stat-card">
                <div className="stat-value">{codeMetrics.code_files.toLocaleString()}</div>
                <div className="stat-label">코드 파일 수</div>
              </div>
            )}
            {codeMetrics.functions != null && (
              <div className="stat-card">
                <div className="stat-value">{codeMetrics.functions.toLocaleString()}</div>
                <div className="stat-label">함수 수</div>
              </div>
            )}
            {codeMetrics.nloc != null && (
              <div className="stat-card">
                <div className="stat-value">{codeMetrics.nloc.toLocaleString()}</div>
                <div className="stat-label">NLOC</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRQA Detail */}
      {prqa && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">🔍 PRQA 상세</span>
          </div>
          <div className="stats-row">
            {prqa.rule_violation_count != null && (
              <div className="stat-card">
                <div className="stat-value" style={{ color: prqa.rule_violation_count > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  {prqa.rule_violation_count.toLocaleString()}
                </div>
                <div className="stat-label">규칙 위반 수</div>
              </div>
            )}
            {prqa.diagnostic_count != null && (
              <div className="stat-card">
                <div className="stat-value">{prqa.diagnostic_count.toLocaleString()}</div>
                <div className="stat-label">진단 수</div>
              </div>
            )}
            {prqa.file_compliance_index != null && (
              <div className="stat-card">
                <div className="stat-value">{typeof prqa.file_compliance_index === 'number' ? prqa.file_compliance_index.toFixed(1) + '%' : prqa.file_compliance_index}</div>
                <div className="stat-label">파일 준수 지수</div>
              </div>
            )}
            {prqa.project_compliance_index != null && (
              <div className="stat-card">
                <div className="stat-value">{typeof prqa.project_compliance_index === 'number' ? prqa.project_compliance_index.toFixed(1) + '%' : prqa.project_compliance_index}</div>
                <div className="stat-label">프로젝트 준수 지수</div>
              </div>
            )}
          </div>

          {/* Violated / Compliant rules */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 12px' }}>
            {prqa.violated_rules != null && (
              <div>
                <span className="text-sm text-muted">위반 규칙: </span>
                {Array.isArray(prqa.violated_rules) ? (
                  prqa.violated_rules.length > 0
                    ? prqa.violated_rules.map((r, i) => <span key={i} className="pill" style={{ marginRight: 4, marginBottom: 2 }}>{r}</span>)
                    : <span className="text-sm" style={{ color: 'var(--color-success)' }}>없음</span>
                ) : (
                  <span className="text-sm">{prqa.violated_rules}</span>
                )}
              </div>
            )}
            {prqa.compliant_rules != null && (
              <div>
                <span className="text-sm text-muted">준수 규칙: </span>
                {Array.isArray(prqa.compliant_rules) ? (
                  <span className="text-sm">{prqa.compliant_rules.length}개</span>
                ) : (
                  <span className="text-sm">{prqa.compliant_rules}</span>
                )}
              </div>
            )}
          </div>

          {/* HMR Stats */}
          {hmr && (
            <div style={{ padding: '4px 12px 8px' }}>
              <div className="text-sm text-muted" style={{ marginBottom: 4 }}>HMR 복잡도 통계</div>
              <div className="stats-row">
                {hmr.vg_max != null && (
                  <div className="stat-card">
                    <div className="stat-value">{hmr.vg_max}</div>
                    <div className="stat-label">VG Max</div>
                  </div>
                )}
                {hmr.vg_p95 != null && (
                  <div className="stat-card">
                    <div className="stat-value">{hmr.vg_p95}</div>
                    <div className="stat-label">VG P95</div>
                  </div>
                )}
                {hmr.vg_mean != null && (
                  <div className="stat-card">
                    <div className="stat-value">{typeof hmr.vg_mean === 'number' ? hmr.vg_mean.toFixed(1) : hmr.vg_mean}</div>
                    <div className="stat-label">VG Mean</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VectorCAST Tester Summary */}
      {tester && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">🧪 VectorCAST 요약</span>
          </div>
          <div className="stats-row">
            {tester.total != null && (
              <div className="stat-card">
                <div className="stat-value">{tester.total.toLocaleString()}</div>
                <div className="stat-label">전체 테스트</div>
              </div>
            )}
            {tester.passed != null && (
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--color-success)' }}>{tester.passed.toLocaleString()}</div>
                <div className="stat-label">통과</div>
              </div>
            )}
            {tester.failed != null && (
              <div className="stat-card">
                <div className="stat-value" style={{ color: tester.failed > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{tester.failed.toLocaleString()}</div>
                <div className="stat-label">실패</div>
              </div>
            )}
            {tester.errors != null && (
              <div className="stat-card">
                <div className="stat-value" style={{ color: tester.errors > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>{tester.errors.toLocaleString()}</div>
                <div className="stat-label">에러</div>
              </div>
            )}
            {tester.pass_rate != null && (
              <div className="stat-card">
                <div className="stat-value">{typeof tester.pass_rate === 'number' ? tester.pass_rate.toFixed(1) + '%' : tester.pass_rate}</div>
                <div className="stat-label">통과율</div>
              </div>
            )}
          </div>
          {tester.coverage != null && (
            <div style={{ padding: '4px 12px 8px' }}>
              <div className="text-sm text-muted">
                커버리지: {typeof tester.coverage === 'number' ? tester.coverage.toFixed(1) + '%' : typeof tester.coverage === 'object' ? `Statement ${((tester.coverage.statement ?? tester.coverage.line_rate ?? 0) * 100).toFixed(1)}% / Branch ${((tester.coverage.branch ?? tester.coverage.branch_rate ?? 0) * 100).toFixed(1)}%` : tester.coverage}
              </div>
            </div>
          )}
          {tester.environments != null && (
            <div style={{ padding: '0 12px 8px' }}>
              <div className="text-sm text-muted">
                환경: {Array.isArray(tester.environments) ? tester.environments.length + '개' : tester.environments}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Complexity */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">📊 복잡도 분석</span>
          <button className="btn-sm" onClick={loadComplexity} disabled={complexityLoading}>
            {complexityLoading ? <span className="spinner" /> : '불러오기'}
          </button>
        </div>
        {rows.length > 0 ? (
          <table className="impact-table">
            <thead>
              <tr><th>함수</th><th>파일</th><th>복잡도</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.function ?? r.name ?? '-'}</td>
                  <td className="text-sm" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file ?? r.path ?? '-'}</td>
                  <td>
                    <StatusBadge tone={(r.complexity ?? r.cc ?? 0) > threshold ? 'danger' : (r.complexity ?? r.cc ?? 0) > threshold * 0.7 ? 'warning' : 'success'}>
                      {r.complexity ?? r.cc ?? '-'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted text-sm">불러오기 버튼을 클릭하세요.</div>
        )}
      </div>

      {/* Docs */}
      <div className="panel mt-3">
        <div className="panel-header">
          <span className="panel-title">📄 문서 목록</span>
          <button className="btn-sm" onClick={loadDocs} disabled={docsLoading}>
            {docsLoading ? <span className="spinner" /> : '불러오기'}
          </button>
        </div>
        {docs ? (
          docItems && docItems.length > 0 ? (
            <table className="impact-table">
              <thead>
                <tr>
                  <th>문서명</th>
                  <th>유형</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {docItems.map((d, i) => {
                  const name = typeof d === 'string' ? d : (d.name ?? d.title ?? d.filename ?? d.path ?? '-');
                  const docType = typeof d === 'object' ? (d.type ?? d.category ?? '-') : '-';
                  const status = typeof d === 'object' ? (d.status ?? d.state ?? null) : null;
                  return (
                    <tr key={i}>
                      <td className="text-sm" style={{ fontFamily: 'monospace', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</td>
                      <td><span className="pill">{docType}</span></td>
                      <td>
                        {status != null ? (
                          <StatusBadge tone={status === 'ok' || status === 'pass' || status === 'approved' ? 'success' : status === 'fail' || status === 'rejected' ? 'danger' : 'neutral'}>
                            {status}
                          </StatusBadge>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="log-box" style={{ maxHeight: 300 }}>
              {typeof docs === 'string' ? docs : JSON.stringify(docs, null, 2)}
            </div>
          )
        ) : (
          <div className="text-muted text-sm">불러오기 버튼을 클릭하세요.</div>
        )}
      </div>
    </div>
  );
}
