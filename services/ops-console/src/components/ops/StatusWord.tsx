import { copy } from '@/copy/copy';
import type { HealthWord } from '@/lib/health';
import { cn } from '@/lib/utils';

export type Tone = 'sev' | 'warn' | 'rem' | 'info' | 'ok' | 'unk';

const WORD_TONE: Record<HealthWord, Tone> = {
  [copy.health.lost]: 'sev',
  [copy.health.blocked]: 'rem',
  [copy.health.degraded]: 'warn',
  [copy.health.ok]: 'ok',
  [copy.health.unmeasured]: 'unk',
};

export function StatusWord({ word, className }: { word: HealthWord; className?: string }) {
  const tone = WORD_TONE[word];
  return (
    <span
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
