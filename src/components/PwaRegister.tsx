"use client";
import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if ("serviceWorker" in navigator && secure) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
