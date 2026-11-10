/**
 * Creates (or promotes) the first admin account on a fresh server.
 *
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 *
 * You'll be asked for the password (it's never passed on the command line or stored in shell history).
 * In Docker:  docker compose exec app node scripts/create-admin.cjs --email … --name …
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function askHidden(prompt: string): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  let muted = false;
  const out = new Writable({ write: (chunk, _enc, cb) => { if (!muted) process.stdout.write(chunk); cb(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
    muted = true;
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim() || "Admin";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: create-admin --email you@example.com --name "Your Name"');
  const password = await askHidden("Password (min 10 characters): ");
  if (password.length < 10 || Buffer.byteLength(password) > 72) throw new Error("Password must be 10–72 characters");

  const db = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await db.user.findUnique({ where: { email } });
    const user = existing
      ? await db.user.update({ where: { email }, data: { role: "ADMIN", status: "ACTIVE", passwordHash, sessionVersion: { increment: 1 } } })
      : await db.user.create({ data: { email, displayName: name, role: "ADMIN", passwordHash } });
    await db.editorProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, contactEmail: email, genres: [], languages: [] } });
    console.log(`${existing ? "Promoted" : "Created"} admin ${email}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
