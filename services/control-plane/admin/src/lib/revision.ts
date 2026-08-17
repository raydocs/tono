/**
 * Which revision a publish is allowed to claim it was written against.
 *
 * `expectedRevision` is the server's compare-and-swap: replace the catalog only
 * if it is still the one I looked at. The console read it live off a resource
 * that refreshes on a timer, so the value it sent always agreed with the server
 * by construction and the check could not fire from this page. Someone else
 * publishing r37 while a draft built on r36 sat in the textarea meant the draft
 * went out as r38 and r37 disappeared with no error raised anywhere — the
 * "目录发布错了" entry in the rollback manual, arrived at without a mistake
 * being visible.
 *
 * So: the base is frozen when the draft is created, and a publish may only ever
 * claim that frozen number. When it no longer matches, the server's 409 is the
 * correct answer and the operator merges by hand.
 */
export type PublishGate =
  | { allow: true; expectedRevision: number; drifted: boolean }
  | { allow: false; reason: string };

export function publishGate(base: number | null, current: number | null): PublishGate {
  if (base === null) {
    // Deliberately not 0. Without a base there is nothing to compare against,
    // and a page that does not know what it is replacing has no business
    // replacing it — 0 would have been a guess dressed as an answer.
    return { allow: false, reason: '还不知道这份草稿基于哪个版本——版本号没读到。刷新本页后重新载入再替换。' };
  }
  return { allow: true, expectedRevision: base, drifted: current !== null && current !== base };
}

/**
 * How far behind a client's catalog is, for the activity table.
 *
 * A bare revision number is useless on screen — reading it means remembering
 * which revision is current. What an operator wants after publishing is "did
 * they pick it up", so this reports the gap.
 *
 * `null` is not zero and not "behind". Clients before the fix that made them
 * report this sent a hardcoded nil, so an unreported revision means the client
 * is too old to say — which is worth showing as its own state rather than
 * quietly rendering as up to date or as a lag of unknown size.
 */
export type CatalogLag =
  | { state: 'unreported' }
  | { state: 'current'; revision: number }
  | { state: 'behind'; revision: number; by: number }
  | { state: 'ahead'; revision: number }
  | { state: 'unknown-target'; revision: number };

export function catalogLag(
  clientRevision: number | null | undefined,
  currentRevision: number | null | undefined,
): CatalogLag {
  if (clientRevision === null || clientRevision === undefined) return { state: 'unreported' };
  if (currentRevision === null || currentRevision === undefined) {
    return { state: 'unknown-target', revision: clientRevision };
  }
  if (clientRevision === currentRevision) return { state: 'current', revision: clientRevision };
  // A client ahead of the published revision should not be described as behind
  // by a negative number; it means the catalog was rolled back under it.
  if (clientRevision > currentRevision) return { state: 'ahead', revision: clientRevision };
  return { state: 'behind', revision: clientRevision, by: currentRevision - clientRevision };
}
