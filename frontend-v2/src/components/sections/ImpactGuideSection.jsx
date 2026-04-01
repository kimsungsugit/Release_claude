import { useState, useCallback, useMemo } from 'react';
import { post, api, defaultCacheRoot } from '../../api.js';
import { useJenkinsCfg, useToast } from '../../App.jsx';
import StatusBadge from '../StatusBadge.jsx';

const CHANGE_TYPE_KO = { BODY: '본문', HEADER: '헤더', SIGNATURE: '시그니처', NEW: '신규', DELETE: '삭제', VARIABLE: '변수' };
const DOC_STATUS = {
  review_required: { tone: 'warning', label: '검토 필요' },
  completed: { tone: 'success', label: '완료' },
  planned: { tone: 'info', label: '계획됨' },
  skipped: { tone: 'neutral', label: '건너뜀' },
  failed: { tone: 'danger', label: '실패' },
};

export default function ImpactGuideSection({ job, analysisResult }) {
  const { cfg } = useJenkinsCfg();
  const toast = useToast();
  const cacheRoot = analysisResult?.cacheRoot || defaultCacheRoot(job?.url) || cfg.cacheRoot;

  const impact = analysisResult?.impactData;
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedFn, setSelectedFn] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [hopFilter, setHopFilter] = useState('all');
  const [docFilter, setDocFilter] = useState('all');
  const [demoMode, setDemoMode] = useState(false);

  // Demo data
  const demoFunctions = {
    'g_DrvIn_Main': 'BODY', 's_MotorSpdCtrl_AutoClose': 'BODY',
    's_AntipinchDetect_Close': 'SIGNATURE', 'g_Ap_BuzzerCtrl_Func': 'BODY', 's_DoorStateCtrl': 'BODY',
  };
  const demoImpact = {
    direct: ['g_DrvIn_Main', 's_MotorSpdCtrl_AutoClose', 's_AntipinchDetect_Close'],
    indirect_1hop: ['g_Ap_BuzzerCtrl_Func'], indirect_2hop: ['s_DoorStateCtrl'],
  };
  const activeFnEntries = demoMode ? Object.entries(demoFunctions) : changedFnEntries;
  const activeImpactGroups = demoMode ? demoImpact : impactGroups;
  const activeChangedFiles = demoMode ? ['DrvIn_Main_PDS.c', 'Ap_MotorCtrl_PDS.c'] : changedFiles;

  const filteredGuide = useMemo(() => {
    if (!guide) return [];
    let items = guide.details;
    if (hopFilter !== 'all') items = items.filter(d => d.hop === hopFilter);
    if (docFilter === 'has_reqs') items = items.filter(d => d.requirements.length > 0);
    else if (docFilter === 'has_sts') items = items.filter(d => d.stsTestCases.length > 0);
    else if (docFilter === 'has_suts') items = items.filter(d => d.sutsTestCases.length > 0);
    else if (docFilter === 'no_mapping') items = items.filter(d => d.requirements.length === 0 && d.stsTestCases.length === 0);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      items = items.filter(d =>
        d.function.toLowerCase().includes(q) ||
        d.requirements.some(r => r.toLowerCase().includes(q)) ||
        d.stsTestCases.some(tc => tc.toLowerCase().includes(q))
      );
    }
    return items;
  }, [guide, hopFilter, docFilter, searchTerm]);

  const changedFiles = impact?.trigger?.changed_files ?? impact?.changed_files ?? [];
  const changedFunctions = impact?.changed_function_types ?? {};
  const changedFnEntries = Object.entries(changedFunctions);
  const actions = impact?.actions ?? impact?.documents ?? {};
  const linkedDocs = impact?._linked_docs ?? analysisResult?.scmList?.[0]?.linked_docs ?? {};
  const impactGroups = impact?.impact ?? {};

  // Build detailed guide
  const buildGuide = useCallback(async () => {
    if (!activeFnEntries.length) {
      toast('info', '변경된 함수가 없습니다.');
      return;
    }
    setLoading(true);
    try {
      // 1. UDS func→req mapping
      let udsMapping = [];
      if (linkedDocs.uds) {
        try {
          const d = await post('/api/jenkins/uds/extract-mapping', { uds_path: linkedDocs.uds });
          udsMapping = d?.mapping_pairs ?? [];
        } catch (_) {}
      }

      // 2. STS req→TC mapping
      let stsTCs = [];
      if (linkedDocs.sts) {
        try {
          const d = await post('/api/jenkins/sts/extract-traceability', { path: linkedDocs.sts });
          stsTCs = d?.vcast_rows ?? [];
        } catch (_) {}
      }

      // 3. SUTS func→TC mapping
      let sutsTCs = [];
      if (linkedDocs.suts) {
        try {
          const d = await post('/api/jenkins/sts/extract-traceability', { path: linkedDocs.suts });
          sutsTCs = d?.vcast_rows ?? [];
        } catch (_) {}
      }

      // Build per-function guide
      const funcToReqs = {};
      for (const mp of udsMapping) {
        for (const fn of (mp.source_ids || [])) {
          if (!funcToReqs[fn]) funcToReqs[fn] = new Set();
          funcToReqs[fn].add(mp.requirement_id);
        }
      }

      const reqToStsTCs = {};
      for (const row of stsTCs) {
        if (!reqToStsTCs[row.requirement_id]) reqToStsTCs[row.requirement_id] = new Set();
        reqToStsTCs[row.requirement_id].add(row.testcase);
      }

      const fnToSutsTCs = {};
      for (const row of sutsTCs) {
        const fn = row.unit || '';
        if (!fnToSutsTCs[fn]) fnToSutsTCs[fn] = new Set();
        fnToSutsTCs[fn].add(row.testcase);
      }

      const details = [];
      const allReqs = new Set();
      const allStsTcs = new Set();

      for (const [fn, changeType] of activeFnEntries) {
        const reqs = funcToReqs[fn] ? [...funcToReqs[fn]] : [];
        reqs.forEach(r => allReqs.add(r));

        const stsTcSet = new Set();
        for (const rid of reqs) {
          (reqToStsTCs[rid] || new Set()).forEach(tc => { stsTcSet.add(tc); allStsTcs.add(tc); });
        }

        const sutsTcList = fnToSutsTCs[fn] ? [...fnToSutsTCs[fn]] : [];
        const hop = (activeImpactGroups.direct || []).includes(fn) ? 'direct'
          : (activeImpactGroups.indirect_1hop || []).includes(fn) ? '1-hop'
          : (activeImpactGroups.indirect_2hop || []).includes(fn) ? '2-hop' : 'direct';

        details.push({
          function: fn,
          changeType,
          hop,
          requirements: reqs,
          stsTestCases: [...stsTcSet],
          sutsTestCases: sutsTcList,
          udsAction: actions.uds,
          stsAction: actions.sts,
          sutsAction: actions.suts,
          sdsAction: actions.sds,
        });
      }

      setGuide({
        details,
        summary: {
          changedFiles: changedFiles.length,
          changedFunctions: changedFnEntries.length,
          impactedReqs: allReqs.size,
          impactedStsTCs: allStsTcs.size,
          directFns: (impactGroups.direct || []).length,
          hop1Fns: (impactGroups.indirect_1hop || []).length,
          hop2Fns: (impactGroups.indirect_2hop || []).length,
        },
      });
      toast('success', '영향도 가이드 생성 완료');
    } catch (e) {
      toast('error', `가이드 생성 실패: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [activeFnEntries, linkedDocs, actions, activeImpactGroups, activeChangedFiles, toast]);


  if (!impact && !demoMode) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🔍</div>
        <div className="empty-title">변경 영향도 분석 결과가 없습니다</div>
        <div className="empty-desc">대시보드에서 동기화 & 분석을 실행하세요.<br />SCM에 base_ref가 설정되어야 변경 파일을 감지합니다.</div>
        <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setDemoMode(true)}>데모 데이터로 보기</button>
      </div>
    );
  }

  if (activeFnEntries.length === 0 && !demoMode) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🔍</div>
        <div className="empty-title">변경된 함수가 없습니다</div>
        <div className="empty-desc">SCM에 변경 사항이 감지되지 않았습니다.</div>
        <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => setDemoMode(true)}>데모 데이터로 보기</button>
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-header">
          <span className="panel-title">변경 영향도 요약</span>
          <button className="btn-primary btn-sm" onClick={buildGuide} disabled={loading}>
            {loading ? '분석 중...' : '상세 가이드 생성'}
          </button>
        </div>

        {demoMode && <div className="pill pill-warning" style={{ marginBottom: 8 }}>데모 모드 — 시뮬레이션 데이터</div>}

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{activeChangedFiles.length}</div>
            <div className="stat-label">변경 파일</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{activeFnEntries.length}</div>
            <div className="stat-label">변경 함수</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{(activeImpactGroups.direct || []).length}</div>
            <div className="stat-label">직접 영향</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{(activeImpactGroups.indirect_1hop || []).length + (activeImpactGroups.indirect_2hop || []).length}</div>
            <div className="stat-label">간접 영향</div>
          </div>
          {guide && (
            <>
              <div className="stat-card" style={{ borderLeft: '3px solid var(--color-warning)' }}>
                <div className="stat-value">{guide.summary.impactedReqs}</div>
                <div className="stat-label">영향 요구사항</div>
              </div>
              <div className="stat-card" style={{ borderLeft: '3px solid var(--color-info)' }}>
                <div className="stat-value">{guide.summary.impactedStsTCs}</div>
                <div className="stat-label">검토 TC</div>
              </div>
            </>
          )}
        </div>

        {/* Document impact status */}
        {Object.keys(actions).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="text-sm" style={{ fontWeight: 600, marginBottom: 6 }}>문서별 영향</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['uds', 'sts', 'suts', 'sits', 'sds'].map(k => {
                const a = actions[k];
                if (!a) return null;
                const st = DOC_STATUS[a.status] || { tone: 'neutral', label: a.status };
                return (
                  <div key={k} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', minWidth: 100 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase' }}>{k}</div>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    {a.function_count > 0 && <span className="text-muted" style={{ fontSize: 10, marginLeft: 4 }}>{a.function_count} 함수</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Detailed guide */}
      {guide && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">함수별 변경 가이드 ({guide.details.length}개)</span>
          </div>

          {/* Search + Filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="text" placeholder="함수명, 요구사항 ID 검색..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }} />
            <select value={hopFilter} onChange={e => setHopFilter(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="all">전체 영향</option>
              <option value="direct">직접 영향</option>
              <option value="1-hop">1-hop</option>
              <option value="2-hop">2-hop</option>
            </select>
            <select value={docFilter} onChange={e => setDocFilter(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="all">전체 문서</option>
              <option value="has_reqs">요구사항 있음</option>
              <option value="has_sts">STS TC 있음</option>
              <option value="has_suts">SUTS TC 있음</option>
              <option value="no_mapping">매핑 없음</option>
            </select>
            <span className="text-muted text-sm">{filteredGuide.length}/{guide.details.length}건</span>
          </div>

          <table className="impact-table" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>함수</th>
                <th style={{ width: 60 }}>변경</th>
                <th style={{ width: 50 }}>영향</th>
                <th>요구사항</th>
                <th>STS TC</th>
                <th>SUTS TC</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredGuide.map((d, i) => (
                <tr key={i} style={{ background: d.hop === 'direct' ? 'var(--bg)' : undefined }}>
                  <td style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 600 }}>{d.function}</td>
                  <td><span className="pill pill-warning" style={{ fontSize: 9 }}>{CHANGE_TYPE_KO[d.changeType] || d.changeType}</span></td>
                  <td><span className={`pill ${d.hop === 'direct' ? 'pill-danger' : 'pill-info'}`} style={{ fontSize: 9 }}>{d.hop}</span></td>
                  <td style={{ fontSize: 10 }}>
                    {d.requirements.length > 0
                      ? <span title={d.requirements.join(', ')} style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
                          onClick={() => window.__detailSection?.('srssds')}>
                          {d.requirements.length}개 ({d.requirements.slice(0, 2).join(', ')}{d.requirements.length > 2 ? '...' : ''})
                        </span>
                      : <span className="text-muted">-</span>}
                  </td>
                  <td style={{ fontSize: 10 }}>
                    {d.stsTestCases.length > 0
                      ? <span className="pill pill-info" style={{ fontSize: 9 }}>{d.stsTestCases.length} TC</span>
                      : <span className="text-muted">-</span>}
                  </td>
                  <td style={{ fontSize: 10 }}>
                    {d.sutsTestCases.length > 0
                      ? <span className="pill pill-info" style={{ fontSize: 9 }}>{d.sutsTestCases.length} TC</span>
                      : <span className="text-muted">-</span>}
                  </td>
                  <td>
                    <button className="btn-sm" style={{ fontSize: 9, padding: '1px 4px' }}
                      onClick={() => setSelectedFn(selectedFn === d.function ? null : d.function)}>
                      {selectedFn === d.function ? '접기' : '상세'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Detail panel for selected function */}
          {selectedFn && (() => {
            const d = guide.details.find(x => x.function === selectedFn);
            if (!d) return null;
            return (
              <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                  {d.function} <span className="pill pill-warning" style={{ fontSize: 10 }}>{CHANGE_TYPE_KO[d.changeType] || d.changeType}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {/* UDS */}
                  <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: 'var(--accent)' }}>UDS 업데이트</div>
                    {d.requirements.length > 0 ? (
                      <>
                        <div className="text-sm">함수 스펙 항목의 Description, Input/Output Parameters, Called/Calling Function을 변경 사항에 맞게 업데이트하세요.</div>
                        <div style={{ marginTop: 4, fontSize: 10 }}>
                          <span className="text-muted">관련 요구사항:</span> {d.requirements.join(', ')}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm">
                        {(d.changeType || '').toUpperCase() === 'HEADER'
                          ? '헤더 파일 변경 — 이 헤더를 include하는 모든 소스 파일의 함수 스펙을 확인하세요. 매크로/타입 정의 변경이 함수 동작에 영향을 줄 수 있습니다.'
                          : 'UDS에 해당 함수 매핑이 없습니다. 신규 함수라면 UDS에 Function Information 항목을 추가하세요.'}
                      </div>
                    )}
                  </div>

                  {/* STS */}
                  <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: 'var(--accent)' }}>STS 검토</div>
                    {d.stsTestCases.length > 0 ? (
                      <>
                        <div className="text-sm"><strong>{d.stsTestCases.length}개 TC</strong>의 Pre-condition, Test Action, Expected Result를 검토하세요.</div>
                        <div style={{ marginTop: 4, fontSize: 10, maxHeight: 80, overflow: 'auto' }}>
                          {d.stsTestCases.slice(0, 15).map(tc => (
                            <span key={tc} className="pill pill-neutral" style={{ fontSize: 9, margin: 1 }}>{tc}</span>
                          ))}
                          {d.stsTestCases.length > 15 && <span className="text-muted" style={{ fontSize: 9 }}> +{d.stsTestCases.length - 15}개</span>}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm">
                        {(d.changeType || '').toUpperCase() === 'HEADER'
                          ? '헤더 변경으로 인한 간접 영향 — 관련 함수의 TC를 확인하세요.'
                          : '직접 매핑된 TC 없음. 관련 요구사항의 TC를 수동 확인하세요.'}
                      </div>
                    )}
                  </div>

                  {/* SUTS */}
                  <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: 'var(--accent)' }}>SUTS 업데이트</div>
                    {d.sutsTestCases.length > 0 ? (
                      <div className="text-sm">{d.sutsTestCases.length}개 단위 테스트 시퀀스의 Input/Expected Result를 업데이트하세요.</div>
                    ) : <div className="text-sm text-muted">해당 단위 TC 없음</div>}
                  </div>

                  {/* SDS */}
                  <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: 'var(--accent)' }}>SDS 확인</div>
                    <div className="text-sm">해당 함수가 속한 SW Component의 인터페이스 및 동작 설명을 확인하세요.</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
