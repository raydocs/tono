import { useEffect } from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { Kbd } from '@proto/ds';
import { go } from '@proto/state';

/** `g` then a letter jumps to a page, the way Linear and GitHub do it. */
export const GOTO: Record<string, { path: string; label: string }> = {
  h: { path: '/', label: '概览' },
  q: { path: '/observe', label: '连接质量' },
  n: { path: '/nodes', label: '节点' },
  r: { path: '/residential', label: '家宽出口' },
  c: { path: '/customers', label: '客户' },
  l: { path: '/clients', label: '客户端' },
  f: { path: '/finance', label: '财务' },
  s: { path: '/settings', label: '设置' },
  a: { path: '/audit', label: '审计' },
  d: { path: '/design', label: '设计规范' },
};

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['⌘', 'K'], what: '搜索客户、节点、家宽、版本，或执行操作' },
  { keys: ['/'], what: '聚焦本页的搜索框' },
  { keys: ['J'], what: '表格下一行（选中后也可用 ↓）' },
  { keys: ['K'], what: '表格上一行（选中后也可用 ↑）' },
  { keys: ['Enter'], what: '打开选中的行' },
  { keys: ['Esc'], what: '关闭抽屉或对话框' },
  { keys: ['G', '然后', 'H/Q/N/R/C/L/F/S/A'], what: '跳到 概览 / 连接质量 / 节点 / 家宽 / 客户 / 客户端 / 财务 / 设置 / 审计' },
  { keys: ['?'], what: '显示这张表' },
];

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('main [data-row]')].filter((r) => r.offsetParent !== null);
}

/**
 * One listener for the whole console. Keys never fire while the operator is
 * typing or while an overlay is open; overlays own their keys.
 */
export function useShortcuts({ onPalette, onHelp }: { onPalette: () => void; onHelp: () => void }) {
  useEffect(() => {
    let pendingG = 0;
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onPalette(); return; }
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === '?') { e.preventDefault(); onHelp(); return; }
      if (e.key === '/') {
        const box = document.querySelector<HTMLInputElement>('main [data-search]');
        if (box) { e.preventDefault(); box.focus(); box.select(); }
        return;
      }
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const to = GOTO[e.key.toLowerCase()];
        if (to) { e.preventDefault(); go(to.path); }
        return;
      }
      if (e.key === 'g') { pendingG = Date.now(); return; }
      const active = document.activeElement as HTMLElement | null;
      const onRow = active?.dataset.row !== undefined;
      const down = e.key === 'j' || (onRow && e.key === 'ArrowDown');
      const up = e.key === 'k' || (onRow && e.key === 'ArrowUp');
      if (down || up) {
        const list = rows();
        if (list.length === 0) return;
        e.preventDefault();
        const i = active ? list.indexOf(active) : -1;
        const next = list[i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + (down ? 1 : -1)))];
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' && onRow && target === active) { e.preventDefault(); active.click(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onPalette, onHelp]);
}

/** Props that make a table row reachable and openable from the keyboard. */
export function rowProps(open: () => void, label?: string) {
  return {
    'data-row': '',
    'data-href': '',
    tabIndex: 0,
    'aria-label': label,
    onClick: open,
  } as const;
}

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fade-in fixed inset-0 z-50 bg-black/30" />
        <D.Content aria-describedby={undefined} className="pop-in fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[520px] -translate-x-1/2 rounded-xl border border-line bg-panel p-5" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <div className="mb-3 flex items-center">
            <D.Title className="flex-1 text-base font-semibold">键盘快捷键</D.Title>
            <D.Close aria-label="关闭" className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"><X size={15} /></D.Close>
          </div>
          <table className="w-full text-sm">
            <tbody>{SHORTCUTS.map((s) => (
              <tr key={s.what} className="border-t border-line first:border-t-0">
                <td className="whitespace-nowrap py-2 pr-4 align-top">
                  <span className="inline-flex items-center gap-1">{s.keys.map((k) => (k === '然后' ? <span key={k} className="text-2xs text-faint">然后</span> : <Kbd key={k}>{k}</Kbd>))}</span>
                </td>
                <td className="py-2 text-muted">{s.what}</td>
              </tr>
            ))}</tbody>
          </table>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
