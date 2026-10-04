// Editorial section heading: serif title, optional muted one-line subtitle.
// No colored bar; brand green is for actions only.

export default function SectionHeading({
  title,
  subtitle,
  className = "mb-6",
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="font-title text-[28px] leading-tight font-medium text-on-background">
        {title}
      </h2>
      {subtitle && <p className="mt-1 font-body-md text-body-md text-secondary">{subtitle}</p>}
    </div>
  );
}
