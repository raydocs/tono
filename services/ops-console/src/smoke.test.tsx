import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Empty } from '@/components/ops/Empty';
import { StatusWord } from '@/components/ops/StatusWord';
import { copy } from '@/copy/copy';

describe('smoke', () => {
  it('renders empty and a status word', () => {
    const html = renderToString(
      <>
        <Empty />
        <StatusWord word={copy.health.ok} />
      </>,
    );
    expect(html).toContain(copy.emptyMigrated);
    expect(html).toContain(copy.health.ok);
  });
});
