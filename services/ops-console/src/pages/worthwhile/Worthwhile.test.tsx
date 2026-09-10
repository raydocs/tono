import type { WorthwhileDto } from '@contract';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { Worthwhile } from './Worthwhile';

/**
 * The two states the morning read cannot reach on its own.
 *
 * A week with no picks is one of them: the morning read answers a night with
 * nothing in it with its own quiet sentence and never mounts this block, so
 * the empty branch has no fixture set behind it and is checked here instead.
 * A hub that predates the field is the other.
 */

const week = (picks: WorthwhileDto['picks']): WorthwhileDto => ({
  weekOf: '2026-09-07',
  computedAt: 1_788_895_426,
  picks,
  considered: picks.length,
});

describe('Worthwhile', () => {
  it('says nothing stands out rather than showing an empty heading', () => {
    const html = renderToString(<Worthwhile data={week([])} />);
    expect(html).toContain(copy.worthwhileNone);
    expect(html).toContain(copy.worthwhileTitle);
  });

  it('renders nothing at all when the hub does not send the block yet', () => {
    expect(renderToString(<Worthwhile data={undefined} />)).toBe('');
  });

  it('gives a pick with nothing to claim the words for it', () => {
    const html = renderToString(<Worthwhile data={week([{
      id: 'month_unclosed:month:2026-08:2026-09-07',
      kind: 'month_unclosed',
      subjectType: 'month',
      subjectId: '2026-08',
      subjectLabel: '2026-08',
      metric: { kind: 'days', value: 9 },
      payoff: null,
      confidence: 'high',
      deadlineSec: null,
      evidenceAsOfSec: null,
      action: { page: 'settings', section: 'ledger', subjectId: '2026-08' },
    }])} />);
    expect(html).toContain(copy.worthwhileNoPayoff);
    expect(html).toContain(copy.worthwhileGo);
  });
});
