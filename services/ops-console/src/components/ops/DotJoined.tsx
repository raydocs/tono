import { Fragment } from 'react';

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
