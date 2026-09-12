export default function AppLoading() {
  return (
    <div
      className="grid min-h-[calc(100dvh-8rem)] place-items-center lg:min-h-[calc(100dvh-5rem)]"
      role="status"
      aria-label="Loading CIV"
    >
      <span
        className="size-8 animate-spin rounded-full border-2 border-border border-t-civ-blue"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
