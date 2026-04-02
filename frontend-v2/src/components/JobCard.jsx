import StatusBadge from './StatusBadge.jsx';
import { colorTone } from '../api.js';

export default function JobCard({ job, selected, onClick }) {
  const tone = colorTone(job.color);
  const lb = job.lastBuild;
  const lsb = job.lastSuccessfulBuild;
  const label = tone === 'success' ? 'SUCCESS'
    : tone === 'danger'  ? 'FAILURE'
    : tone === 'running' ? 'RUNNING'
    : tone === 'warning' ? 'UNSTABLE' : 'NONE';

  return (
    <div
      className={`job-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Job: ${job.name || job.fullName}`}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <div className="job-card-header">
        <span className="job-card-name">{job.name || job.fullName}</span>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      <div className="job-card-meta">
        {lb ? (
          <>
            <span>빌드 #{lb.number}</span>
            {lb.result && <span>{lb.result}</span>}
            {lb.timestamp && (
              <span>{new Date(lb.timestamp).toLocaleDateString('ko-KR')}</span>
            )}
          </>
        ) : (
          <span className="text-muted">빌드 이력 없음</span>
        )}
      </div>
      {lsb && lsb.number !== lb?.number && (
        <div className="job-card-meta" style={{ fontSize: 10, color: 'var(--color-success)' }}>
          최근 성공: #{lsb.number} ({lsb.timestamp ? new Date(lsb.timestamp).toLocaleDateString('ko-KR') : ''})
        </div>
      )}
    </div>
  );
}
