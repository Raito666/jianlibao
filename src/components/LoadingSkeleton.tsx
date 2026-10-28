export default function LoadingSkeleton() {
  return (
    <div className="loading-skeleton" aria-hidden="true">
      <div className="skeleton-block skeleton-heading" />
      <div className="skeleton-grid">
        <div className="skeleton-block" />
        <div className="skeleton-block" />
        <div className="skeleton-block" />
      </div>
      <div className="skeleton-block skeleton-panel" />
    </div>
  );
}
