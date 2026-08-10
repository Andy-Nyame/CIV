import type { ReactNode } from "react";

type PageHeadingProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeading({ title, description, action }: PageHeadingProps) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted sm:text-base">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
