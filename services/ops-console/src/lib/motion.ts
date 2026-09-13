/**
 * The one spring on these pages.
 *
 * 260 / 30 is the plan's drawer figure: fast enough that the panel is there
 * before the eye finishes moving, damped enough that it does not bounce —
 * a bounce on a panel somebody opened because a customer cannot connect reads
 * as decoration, and decoration is what this console is trying not to be.
 * Cards reordering under a filter use the same one, so the two motions on a
 * page have the same physics rather than two invented ones.
 */
export const SPRING = { type: 'spring', stiffness: 260, damping: 30 } as const;

/** Entry and hover budgets from the plan: 240 ms in, 160 ms on hover. */
export const ENTER_SECONDS = 0.2;
export const HOVER_SECONDS = 0.16;
