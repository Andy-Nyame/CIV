import { PageHeading } from "./page-heading";

type FeaturePlaceholderProps = {
  title: string;
  description: string;
  emptyTitle: string;
};

export function FeaturePlaceholder({
  title,
  description,
  emptyTitle,
}: FeaturePlaceholderProps) {
  return (
    <div>
      <PageHeading title={title} description={description} />
      <section
        className="mt-8 grid min-h-72 place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center"
        aria-labelledby="empty-state-title"
      >
        <div className="max-w-md">
          <div
            className="mx-auto grid size-12 place-items-center rounded-full bg-active text-xl font-bold text-link"
            aria-hidden="true"
          >
            +
          </div>
          <h2 id="empty-state-title" className="mt-5 text-lg font-semibold text-text">
            {emptyTitle}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            This space is ready for the tools and actions planned for a later phase.
          </p>
        </div>
      </section>
    </div>
  );
}
