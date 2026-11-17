export type UpdateManifest = {
  packageId: string;
  version: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  changelog: string[];
  sizeBytes: number;
};
export function isTrustedManifestUrl(value: unknown): boolean;
export function isTrustedApkUrl(value: unknown): boolean;
export function parseUpdateManifest(value: unknown): UpdateManifest;
export function isUpdateDismissed(stored: string | null, versionCode: number, now?: number): boolean;
export function resolveUpdateNotice(value: unknown, currentVersionCode: number, readDismissal: () => Promise<string | null>, now?: number): Promise<{ manifest: UpdateManifest | null; dismissed: boolean }>;
export function matchesApkMetadata(expected: UpdateManifest, actualSize: number, actualSha256: string): boolean;
