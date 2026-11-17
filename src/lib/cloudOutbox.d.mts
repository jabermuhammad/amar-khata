export type CloudChange = { id: string; key: string; uid: string; kind: 'list-item' | 'list-title' | 'note'; resourceId: string; targetId: string; operation: 'create-item' | 'update-item' | 'delete-item' | 'update-title' | 'save-note'; baseRevision: number | null; baseValue?: unknown; value?: unknown; status: 'pending' | 'conflict' | 'blocked'; updatedAt?: string; remoteValue?: Record<string, unknown> | null; remoteRevision?: number; error?: string };
export type NewCloudChange = Omit<CloudChange, 'id' | 'key' | 'status' | 'updatedAt'> & { updatedAt?: string };
export function createCloudSyncStore(storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }): {
  list(uid: string): Promise<CloudChange[]>;
  enqueue(uid: string, change: NewCloudChange): Promise<CloudChange | null>;
  remove(uid: string, id: string): Promise<void>;
  resolve(uid: string, id: string, choice: 'local' | 'remote'): Promise<boolean>;
  retry(uid: string, id: string): Promise<boolean>;
  drain(uid: string, apply: (entry: CloudChange) => Promise<void>): Promise<{ synced: boolean; pending: boolean; entries?: CloudChange[]; error?: unknown }>;
  readCache(uid: string, kind: string, id: string): Promise<unknown | null>;
  writeCache(uid: string, kind: string, id: string, value: unknown): Promise<void>;
  removeCache(uid: string, kind: string, id: string): Promise<void>;
};
