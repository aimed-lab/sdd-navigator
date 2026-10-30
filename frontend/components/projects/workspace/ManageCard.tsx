// One collapsible card of a ColaboFest project's Manage view (a plain <details>, so it
// works without client code): a title row that opens and closes the content. Server-safe.

export default function ManageCard({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-[#e8e4da] bg-white overflow-hidden">
      <summary className="flex items-center justify-between gap-3 px-4 py-3.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden font-title text-[17px] leading-6 text-on-background">
        {title}
        <span className="text-secondary text-[18px] leading-none transition-transform group-open:rotate-180" aria-hidden>
          ⌄
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-[#e8e4da]">{children}</div>
    </details>
  );
}
