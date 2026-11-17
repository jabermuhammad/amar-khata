/** Reject asynchronous auth snapshots after a newer event or explicit transition. */
export function shouldInvalidateAuthScope({ activeUid, eventUid }) {
  return (activeUid ?? null) !== (eventUid ?? null);
}

export function shouldApplyAuthSnapshot({ eventGeneration, currentGeneration, eventUid, currentUid, transitionIntent }) {
  if (!Number.isSafeInteger(eventGeneration) || eventGeneration !== currentGeneration) return false;
  if ((eventUid ?? null) !== (currentUid ?? null)) return false;
  if (transitionIntent === 'guest' || transitionIntent === 'none') return false;
  return true;
}
