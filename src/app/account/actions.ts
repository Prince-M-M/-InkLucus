"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, currentUser, destroySession, revokeSessions } from "@/lib/auth";
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { LIMITS, clearRateLimit, rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { config } from "@/lib/config";
import { MIN_ACCOUNT_AGE, ageOn } from "@/lib/age";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { DomainError } from "@/lib/errors";
import { flash, str, type FormState } from "@/lib/form";

const email = z.string().trim().toLowerCase().email().max(254);
const displayName = z.string().trim().min(2, "Name must be at least 2 characters").max(40);

function parseDob(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d > new Date() || d.getUTCFullYear() < 1900 ? null : d;
}

/** Only allow redirects to our own pages. */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/dashboard";
}

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (!(await rateLimit(`register:${ip}`, LIMITS.register.limit * config().RATE_LIMIT_IP_MULTIPLIER, LIMITS.register.window))) return { error: "Too many sign-ups from your network. Try again later." };
  const e = email.safeParse(str(form, "email"));
  const n = displayName.safeParse(str(form, "displayName"));
  if (!e.success) return { error: "Enter a valid email address." };
  if (!n.success) return { error: n.error.issues[0].message };
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password, e.data);
  if (problem) return { error: problem };
  const dob = parseDob(str(form, "dateOfBirth"));
  if (!dob) return { error: "Enter your date of birth." };
  if (ageOn(dob) < MIN_ACCOUNT_AGE) return { error: `You must be at least ${MIN_ACCOUNT_AGE} to create an account.` };
  if (form.get("terms") !== "on") return { error: "Please accept the terms to continue." };

  if (await db.user.findUnique({ where: { email: e.data } })) return { error: "An account with that email already exists. Try logging in or resetting your password." };
  const user = await db.user.create({
    data: { email: e.data, displayName: n.data, dateOfBirth: dob, passwordHash: await hashPassword(password), wallet: { create: {} } },
  });
  await createSession(user);
  redirect("/dashboard");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const e = email.safeParse(str(form, "email"));
  const password = String(form.get("password") ?? "");
  if (!e.success || !password) return { error: "Invalid email or password." };
  const ip = await clientIp();
  const allowed = (await rateLimit(`login:${e.data}`, LIMITS.login.limit, LIMITS.login.window)) && (await rateLimit(`login-ip:${ip}`, LIMITS.loginIp.limit * config().RATE_LIMIT_IP_MULTIPLIER, LIMITS.loginIp.window));
  if (!allowed) return { error: "Too many attempts. Wait 15 minutes or reset your password." };

  const user = await db.user.findUnique({ where: { email: e.data } });
  // Always run bcrypt so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash.startsWith("$2") ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || user.email.endsWith("@deleted.invalid")) return { error: "Invalid email or password." };
  await clearRateLimit(`login:${e.data}`);
  await createSession(user);
  redirect(safeNext(form.get("next") as string | null));
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function logoutEverywhere() {
  const user = await currentUser();
  if (user) await revokeSessions(user.id);
  await destroySession();
  redirect("/login");
}

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const n = displayName.safeParse(str(form, "displayName"));
  if (!n.success) return { error: n.error.issues[0].message };
  const data: { displayName: string; dateOfBirth?: Date } = { displayName: n.data };
  const dobRaw = str(form, "dateOfBirth");
  if (dobRaw && !user.dateOfBirth) {
    // Date of birth can be set once (it gates age-rated books); changes go through support.
    const dob = parseDob(dobRaw);
    if (!dob) return { error: "Enter a valid date of birth." };
    data.dateOfBirth = dob;
  }
  await db.user.update({ where: { id: user.id }, data });
  if (user.editorProfile) {
    const phone = str(form, "contactPhone").slice(0, 40);
    const contact = email.safeParse(str(form, "contactEmail"));
    await db.editorProfile.update({
      where: { id: user.editorProfile.id },
      data: {
        contactPhone: phone || null,
        ...(contact.success ? { contactEmail: contact.data } : {}),
        genres: form.getAll("genres").map(String).slice(0, 10),
        languages: form.getAll("languages").map(String).slice(0, 10),
      },
    });
  }
  await flash("Profile saved.");
  return { ok: "Profile saved." };
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("password") ?? "");
  if (!(await verifyPassword(current, user.passwordHash))) return { error: "Your current password is wrong." };
  const problem = passwordProblem(next, user.email);
  if (problem) return { error: problem };
  if (next !== String(form.get("confirm") ?? "")) return { error: "The new passwords don't match." };
  const updated = await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await createSession(updated); // stay logged in here; every other device is logged out
  await flash("Password changed. Other devices have been logged out.");
  return { ok: "Password changed." };
}

export async function requestResetAction(_: FormState, form: FormData): Promise<FormState> {
  const e = email.safeParse(str(form, "email"));
  const done = { ok: "If an account exists for that email, we've sent a reset link. It's valid for 1 hour." };
  if (!e.success) return { error: "Enter a valid email address." };
  if (!(await rateLimit(`reset:${e.data}`, LIMITS.reset.limit, LIMITS.reset.window))) return done;
  await requestPasswordReset(e.data);
  return done;
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The passwords don't match." };
  try {
    await resetPassword(str(form, "token"), password);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  await flash("Password updated. Log in with your new password.");
  redirect("/login");
}
