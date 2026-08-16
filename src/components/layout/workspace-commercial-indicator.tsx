export type WorkspaceCommercialIndicatorData = {
  planLabel: string;
  detail: string;
};

export function WorkspaceCommercialIndicator({
  indicator,
}: {
  indicator: WorkspaceCommercialIndicatorData;
}) {
  return (
    <div
      className="border-l-2 border-civ-blue px-3 py-1"
      aria-label={`Workspace plan: ${indicator.planLabel}. ${indicator.detail}.`}
    >
      <p className="text-xs font-bold tracking-wide text-text uppercase">
        {indicator.planLabel}
      </p>
      <p className="mt-0.5 text-xs text-muted">{indicator.detail}</p>
    </div>
  );
}
