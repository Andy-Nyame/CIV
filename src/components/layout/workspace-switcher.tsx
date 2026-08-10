export function WorkspaceSwitcher() {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-muted">Workspace</span>
      <select
        aria-label="Current workspace"
        className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-text hover:bg-hover"
        defaultValue="my-workspace"
      >
        <option value="my-workspace">My Workspace</option>
      </select>
    </label>
  );
}
