import { Keyboard, Moon, Sun, Timer } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';
import { Dot } from '@proto/ds';
import { HOME_EXITS, RELEASES } from '@proto/mock/business';
import { CUSTOMERS } from '@proto/mock/customers';
import { FLEET } from '@proto/mock/fleet';
import { INCIDENTS } from '@proto/mock/observe';
import type { Range } from '@proto/mock/series';
import { go, useProto } from '@proto/state';
import { GOTO } from './keys';
import { STATE } from './labels';

const RANGES: { value: Range; label: string }[] = [
  { value: '1h', label: '1 小时' }, { value: '24h', label: '24 小时' }, { value: '7d', label: '7 天' }, { value: '30d', label: '30 天' },
];

/**
 * ⌘K finds any record by what the operator remembers about it — an email, a
 * WeChat id, a node's city, an exit's IP prefix — and runs the few global
 * actions. Records outrank pages once the query is more than a word.
 */
export function Palette({ open, onOpenChange, onHelp }: { open: boolean; onOpenChange: (v: boolean) => void; onHelp: () => void }) {
  const { dark, setDark, setRange } = useProto();
  const run = (fn: () => void) => () => { fn(); onOpenChange(false); };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
      <D.Overlay className="fade-in fixed inset-0 z-50 bg-black/30 dark:bg-black/55" />
      <D.Content className="pop-in fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-panel focus:outline-none" style={{ boxShadow: 'var(--shadow-pop)' }}>
      <D.Title className="sr-only">搜索</D.Title>
      <D.Description className="sr-only">客户、节点、家宽、版本与操作</D.Description>
      <Command className="[&_[cmdk-item][data-selected=true]]:bg-accent-soft [&_[cmdk-item][data-selected=true]]:text-fg [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-input]]:h-12 [&_[cmdk-input]]:outline-none">
      <CommandInput placeholder="邮箱、微信号、节点、城市、IP 段、版本号…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>没有匹配。试试邮箱前缀、城市或版本号。</CommandEmpty>
        <CommandGroup heading="正在发生">
          {INCIDENTS.map((i) => (
            <CommandItem key={i.id} value={`${i.id} ${i.title}`} onSelect={run(() => go(`/?incident=${i.id}`))}>
              <Dot tone={i.severity} /> {i.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="页面">
          {Object.entries(GOTO).map(([key, g]) => (
            <CommandItem key={g.path} value={`页面 ${g.label}`} onSelect={run(() => go(g.path))}>
              {g.label}<CommandShortcut>G {key.toUpperCase()}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="客户">
          {CUSTOMERS.map((c) => (
            <CommandItem key={c.id} value={`${c.email} ${c.wechat ?? ''} ${c.id} ${STATE[c.state].label}`} onSelect={run(() => go(`/customers/${c.id}`))}>
              <Dot tone={STATE[c.state].tone} />
              <span className="truncate">{c.email}</span>
              {c.wechat && <span className="truncate text-xs text-faint">{c.wechat}</span>}
              <CommandShortcut>{STATE[c.state].label}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="节点">
          {FLEET.map((n) => (
            <CommandItem key={n.name} value={`${n.name} ${n.city} ${n.provider} ${n.ipMasked}`} onSelect={run(() => go(`/nodes/${encodeURIComponent(n.name)}`))}>
              <Dot tone={n.status} /> {n.name}<span className="text-xs text-faint">{n.city} · {n.provider}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="家宽出口">
          {HOME_EXITS.map((h) => (
            <CommandItem key={h.id} value={`${h.id} ${h.label} ${h.vendor} ${h.ipPrefix}`} onSelect={run(() => go(`/residential?focus=${h.id}`))}>
              {h.id}<span className="text-xs text-faint">{h.label} · {h.ipPrefix}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="客户端版本">
          {RELEASES.map((r) => (
            <CommandItem key={`${r.platform}${r.version}`} value={`${r.platform} ${r.version} ${r.channel}`} onSelect={run(() => go('/clients'))}>
              {r.platform} {r.version}<CommandShortcut>{r.channel}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="操作">
          <CommandItem value="操作 切换明暗 主题 dark light" onSelect={run(() => setDark(!dark))}>
            {dark ? <Sun size={14} /> : <Moon size={14} />} 切换到{dark ? '浅色' : '深色'}
          </CommandItem>
          {RANGES.map((r) => (
            <CommandItem key={r.value} value={`操作 时间范围 ${r.label} ${r.value}`} onSelect={run(() => setRange(r.value))}>
              <Timer size={14} /> 时间范围：{r.label}
            </CommandItem>
          ))}
          <CommandItem value="操作 键盘快捷键 帮助" onSelect={run(onHelp)}>
            <Keyboard size={14} /> 键盘快捷键<CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
      </D.Content>
      </D.Portal>
    </D.Root>
  );
}
