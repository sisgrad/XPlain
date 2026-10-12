import type { SessionDriftSummary } from '@shared/types';

/** Small inline badge describing how far code drifted from an explanation. */
export function DriftChip({ drift, compact }: { drift: SessionDriftSummary | undefined; compact?: boolean }) {
  if (!drift || drift.level === 'fresh') return null;
  const label =
    drift.level === 'lost'
      ? 'code not found'
      : drift.level === 'outdated'
        ? compact
          ? 'outdated'
          : `outdated · ${drift.changedLines} line${drift.changedLines === 1 ? '' : 's'}`
        : compact
          ? 'code changed'
          : `code changed · ${drift.changedLines} line${drift.changedLines === 1 ? '' : 's'}`;
  const icon = drift.level === 'drifted' ? 'codicon-edit' : 'codicon-warning';
  const title =
    drift.codeModifiedAt
      ? `Code modified ${new Date(drift.codeModifiedAt).toLocaleString()} · ${drift.changedBlocks}/${drift.blocks} block(s) changed`
      : `${drift.changedBlocks}/${drift.blocks} block(s) changed`;
  return (
    <span class={`chip drift drift-${drift.level}`} title={title}>
      <span class={`codicon ${icon}`} /> {label}
    </span>
  );
}
