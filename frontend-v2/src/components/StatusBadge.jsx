import { memo } from 'react';

export default memo(function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
});
