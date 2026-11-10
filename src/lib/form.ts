import { revalidatePath } from "next/cache";
import { DomainError } from "./errors";

export type FormState = { error?: string; ok?: string } | undefined;

/** Runs a domain operation, turning DomainErrors into a form message. */
export async function runAction(fn: () => Promise<unknown>, ok: string, revalidate: string = "/"): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(revalidate, "layout");
  return { ok };
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const optStr = (f: FormData, k: string) => str(f, k) || undefined;
export const list = (f: FormData, k: string) => f.getAll(k).map(String).filter(Boolean);

/** "4.99" -> 499. Returns NaN for invalid input. */
export function dollarsToCents(v: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return NaN;
  return Math.round(Number(v) * 100);
}

export function int(f: FormData, k: string): number {
  const v = str(f, k);
  return /^\d+$/.test(v) ? Number(v) : NaN;
}
