export function PlatformPageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-link">
        CIV Platform Operations
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-text sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted sm:text-base">
        {description}
      </p>
    </header>
  );
}
