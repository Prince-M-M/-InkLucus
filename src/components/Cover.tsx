export function Cover({ url, title, className = "" }: { url: string | null; title: string; className?: string }) {
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Cover of ${title}`} className="h-full w-full object-cover" />
      ) : (
        <div aria-hidden className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-stone-500">{title}</div>
      )}
    </div>
  );
}
