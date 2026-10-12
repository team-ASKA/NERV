/** Account-scoped caches: UID-namespaced keys, late-write guards, logout clearing. */

export function scopedKey(uid: string, key: string): string {
  return `nerv:${uid}:${key}`;
}

const ACCOUNT_KEYS = [
  'resumeData',
  'resumeText',
  'resumeMeta',
  'sessionCheckpoint',
  'openerCache',
  'tutorDraft',
  'composerDraft',
  'trainingSession',
];

export function clearAccountCaches(uid: string): void {
  try {
    for (const k of ACCOUNT_KEYS) {
      localStorage.removeItem(scopedKey(uid, k));
    }
    // Legacy unscoped keys from the old global cache (P0 cross-account leak):
    // remove them outright so user B can never read user A's leftovers.
    localStorage.removeItem('resumeData');
    localStorage.removeItem('resumeText');
    sessionStorage.clear();
  } catch {
    /* storage unavailable — nothing cached to clear */
  }
}

/** Guard for async writes: only persist if the account is still current. */
export function makeAccountGuard(getCurrentUid: () => string | null | undefined) {
  const captured = getCurrentUid();
  return {
    alive: () => captured != null && getCurrentUid() === captured,
    setLocal: (key: string, value: string) => {
      if (getCurrentUid() !== captured || !captured) return;
      try {
        localStorage.setItem(scopedKey(captured, key), value);
      } catch {
        /* quota/full — ignore */
      }
    },
  };
}
