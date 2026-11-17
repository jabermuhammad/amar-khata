const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeResetEmail(value) {
  return value.trim().toLowerCase();
}

export async function requestPasswordReset(auth, email, sendPasswordResetEmail) {
  const normalizedEmail = normalizeResetEmail(email);
  if (!auth) return { ok: false, reason: 'config' };
  if (!EMAIL_PATTERN.test(normalizedEmail)) return { ok: false, reason: 'invalid-email' };
  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
    return { ok: true };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code.includes('user-not-found')) return { ok: true };
    if (code.includes('invalid-email')) return { ok: false, reason: 'invalid-email' };
    if (code.includes('too-many-requests')) return { ok: false, reason: 'throttled' };
    if (code.includes('network-request-failed')) return { ok: false, reason: 'network' };
    if (code.includes('operation-not-allowed') || code.includes('invalid-api-key') || code.includes('auth/invalid-credential')) return { ok: false, reason: 'config' };
    return { ok: false, reason: 'unknown' };
  }
}
