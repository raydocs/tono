import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { copy } from '@/copy/copy';
import { CustomerCell } from './customer-cell';
import { customerColumns, ServicesCell } from './columns';
import type { CustomerSummaryDto } from '@contract';
import type { FollowupDto } from '@/lib/api-followups';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  act(() => { createRoot(host).render(node); });
  return host;
}

const identity = (value: string) => value;

it('stacks the address and the WeChat id in one cell, the id on a single quiet line', () => {
  const host = mount(<CustomerCell address="chen.jie@example.com" wechatId="wx_chen_jie" />);
  const address = host.querySelector('div[title]')!;
  expect(address.getAttribute('title')).toBe('chen.jie@example.com');
  expect(address.textContent).toBe('chen.jie@example.com');
  const id = host.querySelector('span[title="wx_chen_jie"]')!;
  expect(id.textContent).toBe('wx_chen_jie');
  for (const name of ['truncate', 'text-micro', 'max-[640px]:hidden']) {
    expect(id.classList.contains(name), name).toBe(true);
  }
});

it('has no second line for a customer without a WeChat id', () => {
  const host = mount(<CustomerCell address="a@example.com" wechatId={null} />);
  expect(host.querySelectorAll('span.text-micro')).toHaveLength(0);
});

it('no longer has a column of its own for the WeChat id', () => {
  const ids = customerColumns(identity, true, null, identity).map((column) => column.id);
  expect(ids).not.toContain('wechat');
  expect(ids).toContain('customer');
});

it('puts the WeChat id in the customer column cell', () => {
  const column = customerColumns(identity, true, null, identity).find((c) => c.id === 'customer')!;
  const row = { email: 'a@example.com', lifecycle: 'active', wechatId: 'wx_a', wechatDuplicate: false } as CustomerSummaryDto;
  const host = mount(<>{column.cell(row)}</>);
  expect(host.textContent).toContain('a@example.com');
  expect(host.textContent).toContain('wx_a');
});

it('shows one service by name, with no count', () => {
  const host = mount(<ServicesCell families={['claude']} />);
  expect(host.textContent).toBe(copy.serviceName.claude);
  expect(host.firstElementChild?.getAttribute('title')).toBe(copy.serviceName.claude);
});

it('shows the first service whole and a count of the rest, the full list on the hover', () => {
  const families = ['claude', 'chatgpt', 'gemini'] as CustomerSummaryDto['services'];
  const host = mount(<ServicesCell families={families} />);
  const parts = [...host.querySelectorAll('span > span')].map((part) => part.textContent);
  expect(parts).toEqual([copy.serviceName.claude, '+2']);
  expect(host.firstElementChild?.getAttribute('title'))
    .toBe(families.map((family) => copy.serviceName[family]).join(' · '));
  expect(host.textContent?.endsWith('·')).toBe(false);
  expect(host.querySelector('span > span')!.classList.contains('truncate')).toBe(false);
});

it('never cuts the follow-up date', () => {
  const followup: FollowupDto = {
    id: 'f-1', subjectType: 'user', subjectId: 'u-1', kind: 'callback', body: 'b',
    dueAt: 1_790_000_000, doneAt: null, createdBy: null, createdAt: 1, updatedAt: 1,
  };
  const column = customerColumns(identity, true, new Map([['u-1', followup]]), null).find((c) => c.id === 'followup')!;
  const host = mount(<>{column.cell({ userId: 'u-1' } as CustomerSummaryDto)}</>);
  const lines = [...host.querySelectorAll('span > span')];
  expect(lines).toHaveLength(2);
  expect(lines[0]!.classList.contains('truncate')).toBe(true);
  expect(lines[1]!.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(lines[1]!.classList.contains('whitespace-nowrap')).toBe(true);
  expect(lines[1]!.classList.contains('truncate')).toBe(false);
});
