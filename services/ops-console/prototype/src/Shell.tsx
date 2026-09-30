import { useEffect, useState } from 'react';
import {
  Activity, Banknote, ChevronDown, Gauge, Home, Laptop, Moon, Scroll, Search, Server, Settings, SlidersHorizontal, Sun, Users, Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dot, Segmented } from '@proto/ds';
import { CUSTOMERS } from '@proto/mock/customers';
import { FLEET } from '@proto/mock/fleet';
import { INCIDENTS } from '@proto/mock/observe';
import type { Range } from '@proto/mock/series';
import { type DataState, go, useProto } from '@proto/state';

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; badge?: number; tone?: 'sev' | 'warn' };

const openIncidents = INCIDENTS.length;
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ href: '/', label: '概览', icon: Home, badge: openIncidents, tone: 'sev' }] },
  {
    group: '运行',
    items: [
      { href: '/observe', label: '连接质量', icon: Activity },
      { href: '/nodes', label: '节点', icon: Server, badge: FLEET.filter((n) => n.status === 'sev' || n.status === 'warn').length, tone: 'warn' },
      { href: '/residential', label: '家宽出口', icon: Wifi },
    ],
  },
  {
    group: '客户',
    items: [
      { href: '/customers', label: '客户', icon: Users },
      { href: '/clients', label: '客户端', icon: Laptop },
      { href: '/finance', label: '财务', icon: Banknote },
    ],
  },
  {
    group: '管理',
    items: [
      { href: '/settings', label: '设置', icon: Settings },
      { href: '/audit', label: '审计', icon: Scroll },
      { href: '/design', label: '设计规范', icon: Gauge },
    ],
  },
];

function active(hash: string, href: string) {
  if (href === '/') return hash === '/';
  return hash === href || hash.startsWith(`${href}/`) || hash.startsWith(`${href}?`);
}

export function Shell({ hash, crumbs, children }: { hash: string; crumbs: string[]; children: React.ReactNode }) {
  const { range, setRange, dark, setDark, dataState, setDataState, telemetry, setTelemetry } = useProto();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel-2">
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-xs font-bold text-white">T</span>
          <span className="text-sm font-semibold">Tono 运维</span>
          <span className="ml-auto rounded-sm bg-hover px-1 text-2xs text-faint">生产</span>
        </div>
        <button type="button" onClick={() => setPalette(true)} className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-xs text-faint hover:border-line-strong">
          <Search size={13} /> 搜索客户或节点
          <kbd className="ml-auto rounded border border-line px-1 text-2xs">⌘K</kbd>
        </button>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV.map((g) => (
            <div key={g.group ?? 'top'} className="mt-3 first:mt-1">
              {g.group && <div className="px-2 pb-1 text-2xs font-medium text-faint">{g.group}</div>}
              {g.items.map((item) => {
                const on = active(hash, item.href);
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={`#${item.href}`}
                    aria-current={on ? 'page' : undefined}
                    className={cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors', on ? 'bg-panel font-medium text-fg shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:bg-hover hover:text-fg')}
                  >
                    <Icon size={15} />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? <span className={cn('rounded px-1.5 text-2xs font-semibold num', item.tone === 'sev' ? 'bg-sev-soft text-sev' : 'bg-warn-soft text-warn')}>{item.badge}</span> : null}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-2xs text-faint">
          <div className="flex items-center gap-1.5"><Dot tone="ok" /> 定时任务 2 分钟前跑完</div>
          <div className="mt-0.5">ray@tono.dev · owner</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {crumbs.map((c, i) => (
              <span key={i} className={cn('truncate', i === crumbs.length - 1 ? 'font-medium' : 'text-muted')}>
                {i > 0 && <span className="mr-1.5 text-faint">/</span>}{c}
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Segmented<Range> value={range} onChange={setRange} size="xs" options={[
              { value: '1h', label: '1 小时' }, { value: '24h', label: '24 小时' }, { value: '7d', label: '7 天' }, { value: '30d', label: '30 天' },
            ]} />
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-line px-2 text-xs text-muted hover:text-fg">
                <SlidersHorizontal size={12} /> 原型控制 <ChevronDown size={12} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">面板状态预览</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={dataState} onValueChange={(v) => setDataState(v as DataState)}>
                  <DropdownMenuRadioItem value="ready">正常</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="loading">加载中</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="stale">数据陈旧</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="error">接口出错</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">#707 诊断表（迁移 0093）</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={telemetry ? 'on' : 'off'} onValueChange={(v) => setTelemetry(v === 'on')}>
                  <DropdownMenuRadioItem value="off">未上线（显示未接入）</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="on">已上线（显示图表）</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" aria-label="切换明暗" onClick={() => setDark(!dark)} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1360px] px-6 py-6">{children}</div>
        </main>
      </div>

      <CommandDialog open={palette} onOpenChange={setPalette} title="搜索" description="客户、节点、页面">
        <CommandInput placeholder="输入邮箱、微信号、节点名…" />
        <CommandList>
          <CommandEmpty>没有匹配</CommandEmpty>
          <CommandGroup heading="页面">
            {NAV.flatMap((g) => g.items).map((i) => (
              <CommandItem key={i.href} onSelect={() => { go(i.href); setPalette(false); }}>{i.label}</CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="节点">
            {FLEET.map((n) => (
              <CommandItem key={n.name} value={n.name} onSelect={() => { go(`/nodes/${encodeURIComponent(n.name)}`); setPalette(false); }}>{n.name}</CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="客户">
            {CUSTOMERS.map((c) => (
              <CommandItem key={c.id} value={`${c.email} ${c.wechat ?? ''}`} onSelect={() => { go(`/customers/${c.id}`); setPalette(false); }}>
                {c.email}{c.wechat && <span className="ml-2 text-xs text-faint">{c.wechat}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
