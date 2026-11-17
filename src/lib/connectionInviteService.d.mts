export function persistConnectionInvite(input: {
  database: unknown;
  inviteRef: { id: string };
  invitation: Record<string, unknown>;
  firestore: { runTransaction: (...args: any[]) => Promise<string> };
  assertCurrentUser?: () => void;
}): Promise<string>;
