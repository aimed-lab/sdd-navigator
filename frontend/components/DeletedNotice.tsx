// The "Deleted" line shown on a list page after an item was deleted and the
// user was sent back (the list URL carries ?deleted=1). Server-safe.

export function wasDeleted(sp: Record<string, string | string[] | undefined>): boolean {
  const v = Array.isArray(sp.deleted) ? sp.deleted[0] : sp.deleted;
  return v === "1";
}

export default function DeletedNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p
      role="status"
      className="mb-6 inline-flex items-center gap-2 rounded-lg bg-primary/10 text-primary px-4 py-2 font-label-md text-label-md"
    >
      <span className="material-symbols-outlined text-base">check_circle</span>
      Deleted
    </p>
  );
}
