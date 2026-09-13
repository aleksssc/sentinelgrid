export function DirectoryLoading({ label, description }: { label: string; description: string }) {
  return (
    <div className="sg-page-shell" role="status" aria-busy="true" aria-label={label}>
      <div className="sg-page animate-pulse motion-reduce:animate-none">
        <div className="sg-organization-header" aria-hidden="true">
          <div className="min-w-0 space-y-3"><div className="h-7 w-52 rounded bg-surface-raised" /><div className="h-3 w-64 max-w-full rounded bg-surface-raised" /></div>
          <div className="h-9 w-48 rounded-lg bg-surface-raised" />
        </div>
        <div className="sg-compact-summary" aria-hidden="true"><div className="h-4 w-64 rounded bg-surface-raised" /></div>
        <div className="sg-surface sg-panel-body space-y-4" aria-hidden="true">
          <div className="h-4 w-20 rounded bg-surface-raised" />
          <div className="h-10 w-full max-w-sm rounded-lg bg-surface-inset" />
          <div className="sg-client-skeleton">{[0, 1, 2, 3].map((row) => <div key={row} />)}</div>
        </div>
        <span className="sr-only">{description}</span>
      </div>
    </div>
  );
}
