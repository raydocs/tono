import { useCallback, useState } from 'react';
import {
  Activity, Banknote, ChevronDown, Gauge, Home, Keyboard, Laptop, Menu, Moon, Scroll, Search, Server, Settings, SlidersHorizontal, Sun, Users, Wifi, X,
} from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { cn } from '@/lib/utils';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dot, Kbd, Segmented } from '@proto/ds';
import { FLEET } from '@proto/mock/fleet';
import { INCIDENTS } from '@proto/mock/observe';
import type { Range } from '@proto/mock/series';
import { type DataState, useProto } from '@proto/state';
import { ShortcutHelp, useShortcuts } from './keys';
import { Palette } from './Palette';

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }>; badge?: number; tone?: 'sev' | 'warn'; badgeLabel?: string };

const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ href: '/', label: '概览', icon: Home, badge: INCIDENTS.length, tone: 'sev', badgeLabel: '个进行中的事故' }] },
  {
    group: '运行',
    items: [
      { href: '/observe', label: '连接质量', icon: Activity },
      { href: '/nodes', label: '节点', icon: Server, badge: FLEET.filter((n) => n.status === 'sev' || n.status === 'warn').length, tone: 'warn', badgeLabel: '台有问题' },
      { href: '/residential', label: '家宽出口', icon: Wifi },
    ],
  },
  { group: '客户', items: [{ href: '/customers', label: '客户', icon: Users }, { href: '/clients', label: '客户端', icon: Laptop }, { href: '/finance', label: '财务', icon: Banknote }] },
  { group: '管理', items: [{ href: '/settings', label: '设置', icon: Settings }, { href: '/audit', label: '审计', icon: Scroll }, { href: '/design', label: '设计规范', icon: Gauge }] },
];

const RANGES: { value: Range; label: string }[] = [{ value: '1h', label: '1 小时' }, { value: '24h', label: '24 小时' }, { value: '7d', label: '7 天' }, { value: '30d', label: '30 天' }];

function active(hash: string, href: string) {
  if (href === '/') return hash === '/';
  return hash === href || hash.startsWith(`${href}/`) || hash.startsWith(`${href}?`);
}

/**
 * The same nav at three widths: full labels from 1280 px, an icon rail from
 * 768 px, a slide-over below that. `rail` hides labels only above md so the
 * slide-over always shows them.
 */
function NavList({ hash, rail, onNavigate }: { hash: string; rail?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="主导航" className="flex-1 overflow-y-auto px-2 pb-4">
      {NAV.map((g) => (
        <div key={g.group ?? 'top'} className="mt-3 first:mt-1">
          {g.group && <div className={cn('px-2 pb-1 text-2xs font-medium text-faint', rail && 'md:max-xl:sr-only')}>{g.group}</div>}
          {g.items.map((item) => {
            const on = active(hash, item.href);
            const Icon = item.icon;
            return (
              <a key={item.href} href={`#${item.href}`} onClick={onNavigate} aria-current={on ? 'page' : undefined} title={rail ? item.label : undefined}
                className={cn('relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors', rail && 'md:max-xl:justify-center md:max-xl:px-0',
                  on ? 'bg-panel font-medium text-fg shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:bg-hover hover:text-fg')}>
                <Icon size={15} />
                <span className={cn('flex-1', rail && 'md:max-xl:sr-only')}>{item.label}</span>
                {item.badge ? (
                  <span className={cn('rounded px-1.5 text-2xs font-semibold num', item.tone === 'sev' ? 'bg-sev-soft text-sev' : 'bg-warn-soft text-warn',
                    rail && 'md:max-xl:absolute md:max-xl:right-0.5 md:max-xl:top-0.5 md:max-xl:px-1 md:max-xl:text-[10px] md:max-xl:leading-3')}>
                    {item.badge}<span className="sr-only">{item.badgeLabel}</span>
                  </span>
                ) : null}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Shell({ hash, crumbs, children }: { hash: string; crumbs: string[]; children: React.ReactNode }) {
  const { range, setRange, dark, setDark, dataState, setDataState, telemetry, setTelemetry } = useProto();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const openPalette = useCallback(() => setPalette((v) => !v), []);
  const openHelp = useCallback(() => setHelp(true), []);
  useShortcuts({ onPalette: openPalette, onHelp: openHelp });

  return (
    <div className="flex h-full">
      <button type="button" onClick={() => document.getElementById('main')?.focus()}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:text-sm">
        跳到正文
      </button>

      <aside className="hidden w-14 shrink-0 flex-col border-r border-line bg-panel-2 md:flex xl:w-56">
        <div className="flex h-12 items-center gap-2 px-4 md:max-xl:justify-center md:max-xl:px-0">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-xs font-bold text-accent-fg" aria-hidden>T</span>
          <span className="text-sm font-semibold md:max-xl:sr-only">Tono 运维</span>
          <span className="ml-auto rounded-sm bg-hover px-1 text-2xs text-muted md:max-xl:hidden">生产</span>
        </div>
        <button type="button" onClick={() => setPalette(true)} aria-label="搜索（⌘K）"
          className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-xs text-muted hover:border-line-strong md:max-xl:mx-2 md:max-xl:justify-center md:max-xl:px-0">
          <Search size={13} /> <span className="md:max-xl:hidden">搜索客户或节点</span>
          <span className="ml-auto md:max-xl:hidden"><Kbd>⌘K</Kbd></span>
        </button>
        <NavList hash={hash} rail />
        <div className="border-t border-line px-4 py-3 text-2xs text-muted md:max-xl:px-0">
          <div className="flex items-center gap-1.5 md:max-xl:justify-center" title="定时任务 2 分钟前跑完"><Dot tone="ok" label="定时任务正常" /> <span className="md:max-xl:hidden">定时任务 2 分钟前跑完</span></div>
          <div className="mt-0.5 md:max-xl:hidden">ray@tono.dev · owner</div>
          <button type="button" onClick={() => setHelp(true)} className="mt-1.5 inline-flex items-center gap-1 hover:text-fg md:max-xl:mx-auto md:max-xl:flex" aria-label="键盘快捷键">
            <Keyboard size={12} /> <span className="md:max-xl:hidden">按 <Kbd>?</Kbd> 看快捷键</span>
          </button>
        </div>
      </aside>

      <D.Root open={menu} onOpenChange={setMenu}>
        <D.Portal>
          <D.Overlay className="fade-in fixed inset-0 z-40 bg-black/30 md:hidden" />
          <D.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-panel-2 md:hidden">
            <div className="flex h-12 items-center gap-2 px-4">
              <D.Title className="flex-1 text-sm font-semibold">Tono 运维</D.Title>
              <D.Close aria-label="关闭菜单" className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"><X size={15} /></D.Close>
            </div>
            <NavList hash={hash} onNavigate={() => setMenu(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 sm:gap-3 sm:px-5">
          <button type="button" aria-label="打开菜单" onClick={() => setMenu(true)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover md:hidden"><Menu size={16} /></button>
          <nav aria-label="位置" className="flex min-w-0 items-center gap-1.5 text-sm">
            {crumbs.map((c, i) => (
              <span key={i} className={cn('truncate', i === crumbs.length - 1 ? 'font-medium' : 'text-muted max-md:hidden')} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                {i > 0 && <span className="mr-1.5 text-faint max-md:hidden" aria-hidden>/</span>}{c}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button type="button" aria-label="搜索" onClick={() => setPalette(true)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover md:hidden"><Search size={15} /></button>
            <div className="max-sm:hidden"><Segmented<Range> label="时间范围" value={range} onChange={setRange} size="xs" options={RANGES} /></div>
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="原型控制" className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-line px-2 text-xs text-muted hover:text-fg">
                <SlidersHorizontal size={12} /> <span className="max-lg:hidden">原型控制</span> <ChevronDown size={12} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs sm:hidden">时间范围</DropdownMenuLabel>
                <DropdownMenuRadioGroup className="sm:hidden" value={range} onValueChange={(v) => setRange(v as Range)}>
                  {RANGES.map((r) => <DropdownMenuRadioItem key={r.value} value={r.value}>{r.label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator className="sm:hidden" />
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
            <button type="button" aria-label={dark ? '切换到浅色' : '切换到深色'} onClick={() => setDark(!dark)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
          <div className="mx-auto max-w-[1360px] px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </main>
      </div>

      <Palette open={palette} onOpenChange={setPalette} onHelp={() => setHelp(true)} />
      <ShortcutHelp open={help} onOpenChange={setHelp} />
    </div>
  );
}
