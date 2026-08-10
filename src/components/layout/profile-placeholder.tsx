export function ProfilePlaceholder() {
  return (
    <button
      type="button"
      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-hover"
      aria-label="Profile menu placeholder"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full bg-civ-navy text-sm font-bold text-white"
        aria-hidden="true"
      >
        U
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text">Profile</span>
        <span className="block truncate text-xs text-muted">Account placeholder</span>
      </span>
    </button>
  );
}
