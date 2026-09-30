import { createContext, useContext, useEffect, useState } from 'react';
import type { Range } from '@proto/mock/series';

export type DataState = 'ready' | 'loading' | 'stale' | 'error';

type Proto = {
  range: Range;
  setRange: (r: Range) => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  /** Preview every panel's loading / stale / error treatment at once. */
  dataState: DataState;
  setDataState: (s: DataState) => void;
  /** Whether #707's tables (migration 0093) exist yet. */
  telemetry: boolean;
  setTelemetry: (t: boolean) => void;
};

const Ctx = createContext<Proto | null>(null);

function initial<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(window.location.search).get(key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function ProtoProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<Range>(() => initial('range', ['1h', '24h', '7d', '30d'] as const, '24h'));
  const [dark, setDarkState] = useState(() => document.documentElement.classList.contains('dark'));
  const [dataState, setDataState] = useState<DataState>(() => initial('data', ['ready', 'loading', 'stale', 'error'] as const, 'ready'));
  const [telemetry, setTelemetry] = useState(() => initial('telemetry', ['on', 'off'] as const, 'off') === 'on');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('tono-proto-theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
  }, [dark]);
  return (
    <Ctx.Provider value={{ range, setRange, dark, setDark: setDarkState, dataState, setDataState, telemetry, setTelemetry }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProto(): Proto {
  const v = useContext(Ctx);
  if (!v) throw new Error('ProtoProvider missing');
  return v;
}

/* ---------- hash routing ---------- */

export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash.replace(/^#/, '') || '/');
      document.querySelector('main')?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function go(path: string) {
  window.location.hash = path;
}
