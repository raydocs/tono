import { Fragment, type ReactNode } from 'react';

/** The separator the console puts between the short parts of one sentence. */
export const DOT_SEPARATOR = ' · ';

/**
 * Short parts of one sentence, joined by a middle dot.
 *
 * Each part is unbreakable. On a desktop the dots stay in the line, each its
 * own span with the same margin on both sides, so the gap is symmetric and
 * the text holds no literal spaces. At 640 px and below the parts become a
 * wrapping flex line with a gap and no dots at all: a dot that ends a line and
 * one that starts the next are both typos in Chinese layout, and a gap says
 * the same thing without a place to put either. The hidden dots are
 * `aria-hidden` and `display: none`, so a narrow screen reads parts, not marks.
 *
 * The parts are strings or whole controls (the count buttons); either way they
 * are boxes this component never splits.
 */
export function DotJoined({ parts }: { parts: readonly ReactNode[] }) {
  return (
    <span className="dot-joined max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-x-3 max-[640px]:gap-y-[2px]">
      {parts.map((part, index) => (
        // The parts are a fixed-order sentence, not a reorderable list.
        <Fragment key={index}>
          {index === 0 ? null : (
            <span aria-hidden className="dot-joined-sep mx-[.35em] text-[var(--muted-foreground)] max-[640px]:hidden">·</span>
          )}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A sentence of clauses ended by a full-width semicolon, with each clause kept
 * whole: the last characters of a clause never sit alone on a line. The
 * semicolon stays at the end of its clause, so the text is unchanged.
 */
export function Clauses({ text }: { text: string }) {
  return (
    <>
      {text.split(/(?<=\uFF1B)/).map((clause, index) => (
        <span key={index} className="inline-block whitespace-nowrap">{clause}</span>
      ))}
    </>
  );
}
