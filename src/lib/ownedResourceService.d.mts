import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { ListCategory, Note, ShoppingList } from '../data';

type FirestoreListCreateApi = Pick<typeof import('firebase/firestore'), 'collection' | 'doc' | 'getDoc' | 'getDocs' | 'serverTimestamp' | 'writeBatch'>;
type FirestoreNoteCreateApi = Pick<typeof import('firebase/firestore'), 'doc' | 'getDoc' | 'serverTimestamp' | 'writeBatch'>;
export function createOwnedListInFirestore(args: {
  database: Firestore; user: Pick<User, 'uid'>; list: ShoppingList; id: string; firestore: FirestoreListCreateApi;
  sameListContent: typeof import('./storagePolicy.mjs').sameListContent;
}): Promise<string>;
export function createOwnedNoteInFirestore(args: {
  database: Firestore; user: Pick<User, 'uid'>; note: Note; id: string; firestore: FirestoreNoteCreateApi;
  sameNoteContent: typeof import('./storagePolicy.mjs').sameNoteContent;
}): Promise<string>;

export type ResourceSummaryIssue = {
  kind?: 'list' | 'note'; resourceId?: string; operation: string;
  reason: 'invalid-reference' | 'permission-denied' | 'read-failed' | 'missing-membership' | 'invalid-permission' | 'missing-resource' | 'inactive-resource';
  code?: string;
};
export type ResourceSummaryLoad = {
  summaries: Array<{ id: string; kind: 'list' | 'note'; permission: string; title: string; date?: unknown; category?: ListCategory; ownerUid?: unknown }>;
  issues: ResourceSummaryIssue[];
};
type FirestoreSummaryApi = Pick<typeof import('firebase/firestore'), 'collection' | 'doc' | 'getDoc' | 'getDocs' | 'orderBy' | 'query'>;
export function loadResourceSummariesFromFirestore(args: {
  database: Firestore; uid: string; firestore: FirestoreSummaryApi;
  permissionForSummary: (kind: 'list' | 'note', membership: { permission?: unknown }) => string | null;
}): Promise<ResourceSummaryLoad>;
export function formatResourceSummaryIssues(issues: ResourceSummaryIssue[]): string;
