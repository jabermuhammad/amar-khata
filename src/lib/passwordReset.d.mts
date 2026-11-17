import type { Auth } from 'firebase/auth';

export type PasswordResetResult = { ok: true } | { ok: false; reason: 'config' | 'invalid-email' | 'throttled' | 'network' | 'unknown' };
export function normalizeResetEmail(value: string): string;
export function requestPasswordReset(auth: Auth | null, email: string, sendPasswordResetEmail: (auth: Auth, email: string) => Promise<unknown>): Promise<PasswordResetResult>;
