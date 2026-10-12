import { Fragment, type ReactNode } from 'react';

/** The separator the console puts between the short parts of one sentence. */
export const DOT_SEPARATOR = ' · ';

/**
 * Short parts of one sentence, joined by a middle dot.
 *
 * Each part is unbreakable, so a narrow line breaks only at a separator:
 * one part is never split across two lines. The separator is plain text
 * between the spans, so the text content is the same as `parts.join(' · ')`.
 */
export function DotJoined({ parts }: { parts: readonly string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        // The parts are a fixed-order sentence, not a reorderable list.
        <Fragment key={index}>
          {index === 0 ? null : DOT_SEPARATOR}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * One segment of a sentence made of interactive parts (the count buttons).
 *
 * `DotJoined` is for plain strings; these are buttons, so the segment wraps
 * whatever it is given. The segment is an atomic box, so a narrow line breaks
 * only between segments, and the dot lives inside the box in front of its
 * segment: it can start a line but never end one.
 */
export function DotSegment({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <span className="mr-2 inline-block whitespace-nowrap">
      {first ? null : <span aria-hidden className="mr-2 text-[var(--muted-foreground)]">·</span>}
      {children}
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
