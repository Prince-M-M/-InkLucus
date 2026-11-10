import nodemailer from "nodemailer";
import { config } from "./config";

export type Mail = { to: string; subject: string; text: string };

/** Last messages sent while SMTP is not configured (used by tests and local development). */
export const devOutbox: Mail[] = [];

export async function sendMail(mail: Mail) {
  const c = config();
  if (!c.SMTP_HOST) {
    if (c.NODE_ENV === "production") console.warn("[mail] SMTP_HOST not set – email NOT sent to", mail.to);
    else console.info(`[mail] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}`);
    devOutbox.push(mail);
    if (devOutbox.length > 50) devOutbox.shift();
    return;
  }
  const transport = nodemailer.createTransport({
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_PORT === 465,
    auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: c.MAIL_FROM, ...mail });
}
