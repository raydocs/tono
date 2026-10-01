import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { DestinationRowDto } from '@contract';
import { Destinations } from './Destinations';

it('folds days for the same exit without attributing another exit’s traffic to it', () => {
  const base: DestinationRowDto = {
    dayAt: 3, etld1: 'example.com', route: 'cloud', node: 'exit-a',
    connections: 2, bytesUp: 0, bytesDown: 1024, topProcesses: [],
  };
  const html = renderToString(<Destinations state="ready" rows={[
    base,
    { ...base, dayAt: 2, node: 'exit-b', connections: 7, bytesDown: 4096 },
    { ...base, dayAt: 1, connections: 3, bytesDown: 2048 },
  ]} />);
  const body = html.match(/<tbody>(.*?)<\/tbody>/s)![1];
  const rows = [...body.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map((row) => {
    const cells = [...row[1].matchAll(/<td\b[^>]*>(.*?)<\/td>/gs)]
      .map((cell) => cell[1].replace(/<[^>]*>/g, ''));
    return { node: cells[2], connections: cells[3], bytes: cells[4] };
  }).sort((a, b) => a.node.localeCompare(b.node));
  expect(rows).toEqual([
    { node: 'exit-a', connections: '5', bytes: '3.0KB' },
    { node: 'exit-b', connections: '7', bytes: '4.0KB' },
  ]);
});
