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
  [copy.customerHealth.offline]: 'info',
};

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
  className,
}: {
  word: AnyHealthWord;
  reason?: string | null;
  className?: string;
}) {
  const tone = toneForWord(word);
  return (
    <span
      title={reason || undefined}
      className={cn(
        'tone-pill inline-flex items-center rounded-[999px] px-2 py-0.5 text-micro',
        `tone-${tone}`,
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
