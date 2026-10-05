// The one page header every top-level page uses: an optional small uppercase
// label, a Newsreader title, a muted one-line subtitle, and an optional action
// on the right (a button). Extracted from ExplorePageFrame so Explore, Collaborate,
// Promote, Invite, About, Contact and the community pages all start the
// same way. Server-safe (no state).

export default function PageHeader({
  label,
  labelColor,
  title,
  subtitle,
  statsLine,
  action,
  className = "mb-8",
}: {
  /** Small uppercase line above the title. */
  label?: React.ReactNode;
  /** Optional color for the label (defaults to the muted secondary). */
  labelColor?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** One extra muted line under the subtitle. */
  statsLine?: string;
  /** Right-side action, usually a primary button. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-col md:flex-row md:items-end md:justify-between gap-6 ${className}`}
    >
      <div className="max-w-3xl">
        {label && (
          <p
            className="font-label-md text-label-md uppercase tracking-wide text-secondary"
            style={labelColor ? { color: labelColor } : undefined}
          >
            {label}
          </p>
        )}
        <h1
          className={`font-title text-[34px] md:text-[44px] leading-[1.1] font-medium text-on-background ${
            label ? "mt-3" : ""
          }`}
        >
          {title}
        </h1>
        {subtitle && <p className="mt-3 font-body-lg text-body-lg text-secondary">{subtitle}</p>}
        {statsLine && <p className="mt-2 text-sm text-secondary/80">{statsLine}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** The page container shared by every top-level page: same width and gutters. */
export function PageShell({
  children,
  narrow = false,
  className = "",
}: {
  children: React.ReactNode;
  /** A readable single column (About, Contact). */
  narrow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`${
        narrow ? "max-w-3xl" : "max-w-container-max"
      } mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-24 ${className}`}
    >
      {children}
    </div>
  );
}
