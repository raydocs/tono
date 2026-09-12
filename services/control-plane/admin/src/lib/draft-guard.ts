/**
 * Whether the editor holds a draft that has not been published.
 *
 * This is the invariant the `beforeunload` guard arms on. It must NOT key on
 * the phase label: a failed publish or reload moves the phase to `'publishing'`
 * / `'conflict'` / `'error'` while the divergent draft still sits in the
 * textarea and the `sessionStorage` stash, and the operator needs the
 * tab-close warning to fire precisely there. A phase-based guard (`'editing-
 * dirty'`) silently disarms at the moment the phase transitions off
 * `'editing-dirty'`, defeating the stash this comparison backs.
 *
 * Both sides initialize to `''`, so on a fresh mount — and in `'viewing'`
 * before "开始编辑" copies the online text in lockstep — `draft === baseText`
 * holds and this returns `false` (no spurious guard fire). On a successful
 * publish the success handler runs `baseText := draft`, so this flips to
 * `false` and the guard releases within the same render cycle, without
 * nagging the operator about text they just shipped.
 */
export function hasUnpublishedDraft(
  yamlDraft: string,
  yamlBaseText: string,
  policyDraft: string,
  policyBaseText: string,
): boolean {
  return yamlDraft !== yamlBaseText || policyDraft !== policyBaseText;
}
