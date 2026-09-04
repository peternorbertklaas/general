/** Placeholder while a lazily loaded view chunk arrives (ADR-026) – same card grid as the views, no layout jump. */
export function ViewSkeleton() {
  return (
    <div className="stack" data-testid="view-skeleton" aria-busy="true" aria-live="polite">
      <div className="card skeleton" style={{ minHeight: 120 }}>
        <span className="muted small">Ansicht wird geladen …</span>
      </div>
      <div className="card skeleton" style={{ minHeight: 240 }} />
    </div>
  );
}
