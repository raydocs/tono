import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import type { EgressLookup } from '@/lib/home-egress';
import { EgressCell } from './Egress';

const words = copy.residential.inventory.egress;

const lookup = (patch: Partial<EgressLookup>): EgressLookup => ({
  homeExitId: 'h1',
  ip: '48.45.90.215',
  checkedAt: 1_800_000_000,
  errorStage: null,
  error: null,
  answers: [],
  consensus: { region: 'Texas', city: 'Houston', country: 'US', votes: 5, of: 6, conflict: true },
  ...patch,
});

it('shows the echoed IP with the majority place in the warning tone when the databases disagree', () => {
  const html = renderToString(
    <EgressCell lookup={lookup({})} looking={false} ip={(value) => value ?? ''} onOpen={() => undefined} />,
  );
  expect(html).toContain('48.45.90.215');
  expect(html).toMatch(/tone-warn[^>]*>Houston, Texas · /);
  expect(html).toContain(words.votes(5, 6));
});

it('names the failed tunnel stage instead of an address when the line refused the credential', () => {
  const html = renderToString(
    <EgressCell
      lookup={lookup({ ip: null, errorStage: 'auth', error: 'username or password rejected' })}
      looking={false}
      ip={(value) => value ?? ''}
      onOpen={() => undefined}
    />,
  );
  expect(html).toContain(words.failed(words.stage.auth));
});
