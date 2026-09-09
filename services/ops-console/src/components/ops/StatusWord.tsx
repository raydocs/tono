import { copy } from '@/copy/copy';
import type { HealthWord } from '@/lib/health';
import { cn } from '@/lib/utils';

export type Tone = 'sev' | 'warn' | 'rem' | 'info' | 'ok' | 'unk';

export type CustomerWord = (typeof copy.customerHealth)[keyof typeof copy.customerHealth];
export type AnyHealthWord = HealthWord | CustomerWord;

/**
 * The one table of word → tone, for both axes.
 *
 * Nodes and customers share it because they share the palette and because
 * the healthy word has to look the same on both pages; they do not share a
 * vocabulary, which is why the two lists stay separate in the contract and
 * only meet here.
 */
const WORD_TONE: Record<AnyHealthWord, Tone> = {
  [copy.health.lost]: 'sev',
  [copy.health.blocked]: 'sev',
  [copy.health.degraded]: 'warn',
  [copy.health.ok]: 'ok',
  [copy.health.unmeasured]: 'unk',
  [copy.customerHealth.unreachable]: 'sev',
  [copy.customerHealth.unstable]: 'warn',
  [copy.customerHealth.unreported]: 'unk',
  // Offline was `info`, and a blue pill next to a red one reads as a second
  // severity. A customer who closed their laptop is not a state of the
  // system: it is the absence of one, which is what `unk` is for.
  [copy.customerHealth.offline]: 'unk',
};

/**
 * Which words earn a pill.
 *
 * A pill is a raised, filled shape and the eye counts them before it reads
 * them; on a fleet where most nodes are fine, thirty-seven green capsules
 * spend the page's whole colour budget saying nothing happened. Only the two
 * tones that mean someone has to act — sev and warn — keep it. The rest get a
 * six-pixel dot in the same tone and plain text, which still answers "which
 * word" at a glance without shouting it.
 */
function isAlarm(tone: Tone): boolean {
  return tone === 'sev' || tone === 'warn';
}

export function toneForWord(word: AnyHealthWord): Tone {
  return WORD_TONE[word] ?? 'unk';
}

/**
 * `title` is R7 in one attribute: hover a word and it says what was measured
 * and when. A word with nothing behind it gets no tooltip rather than an
 * empty one.
 */
export function StatusWord({
  word,
  reason,
  size = 'micro',
  className,
}: {
  word: AnyHealthWord;
  reason?: string | null;
  /** `row` is the 15 px/500 tier a card headline sits at; tables stay at 11 px. */
  size?: 'micro' | 'row';
  className?: string;
}) {
  const tone = toneForWord(word);
  const type = size === 'row' ? 'text-row' : 'text-micro';
  if (!isAlarm(tone)) {
    return (
      <span
        title={reason || undefined}
        className={cn('inline-flex items-center gap-1.5', `tone-${tone}`, type, className)}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-[999px]"
          style={{ background: 'hsl(var(--tone-line))' }}
        />
        {word}
      </span>
    );
  }
  return (
    <span
      title={reason || undefined}
      className={cn(
        'tone-pill inline-flex items-center rounded-[999px] px-2 py-0.5',
        `tone-${tone}`,
        type,
        className,
      )}
      style={{
        color: 'hsl(var(--tone-fg))',
        background: 'hsl(var(--tone-bg))',
        border: '1px solid hsl(var(--tone-line) / 0.35)',
      }}
    >
      {word}
    </span>
  );
}
