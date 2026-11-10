"use client";
import { useEffect, useState } from "react";

export function Toast({ payload }: { payload?: string }) {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!payload) return;
    try {
      setMsg(JSON.parse(decodeURIComponent(payload)).m);
    } catch {
      return;
    }
    document.cookie = "flash=; Max-Age=0; path=/";
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [payload]);

  if (!msg) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg bg-stone-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
      <div className="flex items-start justify-between gap-3">
        <span>{msg}</span>
        <button onClick={() => setMsg(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  );
}
