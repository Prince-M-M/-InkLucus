import type { AgeRating } from "@prisma/client";

export const MIN_AGE: Record<AgeRating, number> = { ALL: 0, TEEN_13: 13, MATURE_16: 16, ADULT_18: 18 };
export const AGE_LABEL: Record<AgeRating, string> = { ALL: "All ages", TEEN_13: "13+", MATURE_16: "16+", ADULT_18: "18+" };
/** Minimum age to open an account. */
export const MIN_ACCOUNT_AGE = 13;

export function ageOn(dob: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export type AgeCheck = { ok: true } | { ok: false; reason: "LOGIN_REQUIRED" | "DOB_REQUIRED" | "TOO_YOUNG"; minAge: number };

/** 13+ books are open to visitors; 16+ and 18+ books need a signed-in reader with a date of birth. */
export function checkAge(rating: AgeRating, viewer: { dateOfBirth: Date | null } | null, now = new Date()): AgeCheck {
  const minAge = MIN_AGE[rating];
  if (minAge < 16) return { ok: true };
  if (!viewer) return { ok: false, reason: "LOGIN_REQUIRED", minAge };
  if (!viewer.dateOfBirth) return { ok: false, reason: "DOB_REQUIRED", minAge };
  return ageOn(viewer.dateOfBirth, now) >= minAge ? { ok: true } : { ok: false, reason: "TOO_YOUNG", minAge };
}
