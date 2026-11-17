export function shouldApplyAuthSnapshot(input: {
  eventGeneration: number;
  currentGeneration: number;
  eventUid: string | null | undefined;
  currentUid: string | null | undefined;
  transitionIntent?: 'guest' | 'none' | null;
}): boolean;
export function shouldInvalidateAuthScope(input: { activeUid: string | null | undefined; eventUid: string | null | undefined }): boolean;
