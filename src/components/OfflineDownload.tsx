"use client";
import { useEffect, useState } from "react";

const CACHE = "offline-books";

/** Saves the chapters a reader can open into the browser cache so they can be read without data. */
export function OfflineDownload({ urls, bookCode }: { urls: string[]; bookCode: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error" | "unsupported">("idle");
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    if (!("caches" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    caches.open(CACHE).then(async (c) => {
      const keys = await c.keys();
      setSaved(keys.filter((k) => new URL(k.url).pathname.startsWith(`/books/${bookCode}/`)).length);
    });
  }, [bookCode, state]);

  async function download() {
    setState("busy");
    setProgress(0);
    try {
      const cache = await caches.open(CACHE);
      const assets = new Set<string>();
      for (let i = 0; i < urls.length; i++) {
        const res = await fetch(urls[i], { credentials: "same-origin" });
        if (!res.ok) continue;
        const html = await res.clone().text();
        for (const m of html.matchAll(/\/_next\/static\/[^"'\s)]+/g)) assets.add(m[0]);
        await cache.put(urls[i], res);
        setProgress(i + 1);
      }
      const statics = await caches.open("static-v1");
      await Promise.all(
        [...assets].map(async (a) => {
          if (await statics.match(a)) return;
          const r = await fetch(a);
          if (r.ok) await statics.put(a, r);
        }),
      );
      setState("done");
    } catch {
      setState("error");
    }
  }

  async function remove() {
    const cache = await caches.open(CACHE);
    for (const k of await cache.keys()) if (new URL(k.url).pathname.startsWith(`/books/${bookCode}/`)) await cache.delete(k);
    setState("idle");
  }

  if (state === "unsupported" || urls.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button onClick={download} disabled={state === "busy"} className="rounded-md border border-stone-300 px-3 py-1.5 disabled:opacity-50 dark:border-stone-700">
        {state === "busy" ? `Saving ${progress}/${urls.length}…` : saved ? "↻ Update offline copy" : `⤓ Save ${urls.length} chapters for offline`}
      </button>
      {saved > 0 && state !== "busy" && <><span className="text-stone-500">{saved} chapters saved on this device</span><button onClick={remove} className="underline">Remove</button></>}
      {state === "error" && <span className="text-red-600">Saving failed. Check your connection.</span>}
    </div>
  );
}
