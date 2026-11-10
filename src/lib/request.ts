import "server-only";
import { headers } from "next/headers";
import { config } from "./config";

/** Client IP. Only trusts X-Forwarded-For when running behind our own reverse proxy (TRUST_PROXY=true). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  if (config().TRUST_PROXY === "true") {
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    const real = h.get("x-real-ip");
    if (real) return real.trim();
  }
  return "local";
}
