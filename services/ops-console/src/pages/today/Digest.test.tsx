import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { Digest } from './Digest';

const noop = () => undefined;
const render = (digest: Parameters<typeof Digest>[0]['digest']) => renderToString(
  <Digest
    digest={digest}
    openCount={0}
    choresToday={0}
    customers={[]}
    incidents={[]}
    onShowOpen={noop}
    onShowResolved={noop}
    onShowChores={noop}
    onRetry={noop}
  />,
);

it('says it is loading while the digest loads, not nothing', () => {
  expect(render({ status: 'loading' })).toContain(copy.loading);
});

it('says why and offers retry when the digest fails, not a blank column', () => {
  const html = render({ status: 'error', message: 'digest down', sessionExpired: false });
  expect(html).toContain('digest down');
  expect(html).toContain(copy.retry);
});
