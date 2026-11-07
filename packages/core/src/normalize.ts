import { LIMITS } from './constants.ts';

export type Check = { ok: true } | { ok: false; reason: string };

const USERNAME_CHARSET = /^[a-z0-9_]+$/;

/**
 * Client side, before signing: the signed hash freezes the bytes, so the server never normalises, it only checks
 * (ADR-003, ADR-012).
 */
export function normalizeUsername(raw: string): string {
  return raw.normalize('NFC').toLowerCase();
}

export function normalizeCaption(raw: string): string {
  return raw.normalize('NFC');
}

/** Server side: the username must already be in its normalised form and inside the charset and length limits. */
export function checkUsername(username: string): Check {
  if (username !== normalizeUsername(username)) return { ok: false, reason: 'username is not normalised (NFC, lowercase)' };
  if (!USERNAME_CHARSET.test(username)) return { ok: false, reason: 'username must use only [a-z0-9_]' };
  if (username.length < LIMITS.usernameMinLength || username.length > LIMITS.usernameMaxLength) {
    return { ok: false, reason: `username length must be ${LIMITS.usernameMinLength} to ${LIMITS.usernameMaxLength}` };
  }
  return { ok: true };
}

export function checkCaption(caption: string): Check {
  if (caption !== normalizeCaption(caption)) return { ok: false, reason: 'caption is not NFC-normalised' };
  const codePoints = [...caption].length;
  if (codePoints > LIMITS.captionMaxCodePoints) return { ok: false, reason: `caption has ${codePoints} code points, max ${LIMITS.captionMaxCodePoints}` };
  return { ok: true };
}
