"use client";

export function LocalDateTime({
  value,
  dateOnly = false,
}: {
  value: string;
  dateOnly?: boolean;
}) {
  const label = new Intl.DateTimeFormat(
    undefined,
    dateOnly
      ? { dateStyle: "medium" }
      : { dateStyle: "medium", timeStyle: "short" },
  ).format(new Date(value));

  return (
    <time dateTime={value} suppressHydrationWarning>
      {label}
    </time>
  );
}
