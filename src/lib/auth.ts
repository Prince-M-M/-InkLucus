import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { config } from "./config";

export { hashPassword, verifyPassword } from "./password";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30;

const secret = () => new TextEncoder().encode(config().SESSION_SECRET);

export async function createSession(user: { id: string; sessionVersion: number }) {
  const token = await new SignJWT({ sub: user.id, v: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: config().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Invalidates every existing session of a user (password change, block, "log out everywhere"). */
export async function revokeSessions(userId: string) {
  return db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

/** Current user, or null for visitors. Cached per request. */
export const currentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    const user = await db.user.findUnique({ where: { id: payload.sub }, include: { authorProfile: true, editorProfile: true } });
    if (!user || user.sessionVersion !== payload.v || user.email.endsWith("@deleted.invalid")) return null;
    return user;
  } catch {
    return null;
  }
});
