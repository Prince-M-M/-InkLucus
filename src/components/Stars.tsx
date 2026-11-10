export function Stars({ value, size = "text-sm" }: { value: number; size?: string }) {
  const full = Math.round(value);
  return (
    <span className={`${size} text-amber-500`} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {"★".repeat(full)}<span className="text-stone-300 dark:text-stone-700">{"★".repeat(5 - full)}</span>
    </span>
  );
}
