"use client";

// The white card a tile's panel opens in: a title and a close X.

export default function PanelFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#e8e4da] bg-white p-5 sm:p-6 flex flex-col gap-4 shadow-[0_1px_2px_rgba(40,36,28,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-headline-sm text-[18px] leading-7 text-on-background">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
      {children}
    </div>
  );
}
