import type { ListPermission, NotePermission, ResourceKind } from './collaboration';

export function permissionForResourceSummary(kind: ResourceKind, membership: { permission?: unknown } | null): ListPermission | NotePermission | null;
export function assertFirebaseUidMatches(currentUid: string | null | undefined, uid: string): void;
export function inviteTargetEmailError(actorEmail: string | null | undefined, targetEmail: string): string | null;
