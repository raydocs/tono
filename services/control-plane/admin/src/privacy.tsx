import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { maskEmail, maskIp, maskMoney } from './lib/privacy';

const KEY = 'tono-ops-privacy';

const PrivacyContext = createContext<{
  privacy: boolean;
  setPrivacy: (value: boolean) => void;
  email: (value: string) => string;
  ip: (value: string | null | undefined) => string;
  money: (value: string) => string;
  secret: (value: string | null | undefined) => string;
}>({
  privacy: false,
  setPrivacy: () => undefined,
  email: (value) => value,
  ip: (value) => value || '—',
  money: (value) => value,
  secret: (value) => value || '—',
});

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacy, setPrivacyState] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.privacy = privacy ? 'on' : 'off';
    try { localStorage.setItem(KEY, privacy ? '1' : '0'); } catch { /* private mode */ }
  }, [privacy]);
  return (
    <PrivacyContext.Provider value={{
      privacy,
      setPrivacy: setPrivacyState,
      email: (value) => (privacy ? maskEmail(value) : value),
      ip: (value) => {
        if (!value) return '—';
        return privacy ? maskIp(value) : value;
      },
      money: (value) => (privacy ? maskMoney(value) : value),
      secret: (value) => {
        if (!value) return '—';
        if (!privacy) return value;
        return `${value.slice(0, Math.min(2, value.length))}***`;
      },
    }}
    >
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
