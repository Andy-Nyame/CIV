import Link from "next/link";

type CivLogoProps = {
  className?: string;
  href?: string;
  showMotto?: boolean;
};

function LogoContent({ showMotto }: Pick<CivLogoProps, "showMotto">) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className="text-2xl font-extrabold tracking-[-0.06em] text-text"
        aria-hidden="true"
      >
        CI<span className="text-verification">✓</span>
      </span>
      {showMotto ? (
        <span className="text-xs font-semibold tracking-[0.16em] text-muted uppercase">
          Create. Issue. Verify.
        </span>
      ) : null}
    </span>
  );
}

export function CivLogo({ className = "", href, showMotto = false }: CivLogoProps) {
  if (href) {
    return (
      <Link
        href={href}
        className={`inline-flex rounded-md ${className}`.trim()}
        aria-label="CIV — Create. Issue. Verify."
      >
        <LogoContent showMotto={showMotto} />
      </Link>
    );
  }

  return (
    <div
      className={`inline-flex ${className}`.trim()}
      aria-label="CIV — Create. Issue. Verify."
      role="img"
    >
      <LogoContent showMotto={showMotto} />
    </div>
  );
}
