/**
 * The cohort bar's mount/unmount and banner-retirement rules.
 *
 * The bar acts on a filtered cohort in one batch and reports the outcome.
 * Its two subtleties live here, pure and unit-tested, because they are the
 * exact spot that once dropped the operator's good news:
 *
 *  1. A fully successful `expiring` renewal bumps every target's `expiresAt`
 *     server-side, so the next `users.reload()` empties `targets`. The bar
 *     must survive that emptiness while a banner is still showing — that is
 *     the one outcome (the count and zero failures) the operator most needs
 *     to read. The partial- and all-failure cases never empty `targets`
 *     (the failures stay `expiring`), so the bar persists there naturally;
 *     only the all-succeed case needed help.
 *
 *  2. A banner left over from a previous batch would contradict a fresh
 *     cohort's head-count, so it is retired the moment targets repopulate a
 *     bar that had drained. The batch's own `N → 0` shrinkage (everyone
 *     renewed) is deliberately not a reset — that shrinkage is the success
 *     the banner exists to report — so only `0 → N` repopulation retires it.
 */

/**
 * Whether the cohort bar should stay mounted. The bar outlives an empty
 * cohort while an outcome banner (ok or error) is still showing; with nothing
 * to report and no one to act on it unmounts as before.
 */
export function cohortBarVisible(
  targetsCount: number,
  ok: string | null,
  error: string | null,
): boolean {
  return targetsCount > 0 || ok != null || error != null;
}

/**
 * Whether the outcome banner is now stale and should be retired. Only a
 * repopulation of the drained bar (`0 → N`) counts: those are different
 * customers than the ones the banner reported. Any churn within a non-empty
 * cohort (the batch's `N → 0` success, a partial `3 → 1`, an all-failure
 * `3 → 3`) is left alone so the operator can still read what just happened.
 */
export function bannerStaleAfterRepopulate(prevCount: number, nextCount: number): boolean {
  return prevCount === 0 && nextCount > 0;
}
