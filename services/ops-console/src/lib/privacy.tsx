import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { maskEmail, maskIp, maskMoney } from '@legacy-lib/privacy';
import { copy } from '@/copy/copy';

const KEY = 'tono-ops-privacy';

type PrivacyApi = {
  privacy: boolean;
  setPrivacy: (value: boolean) => void;
  email: (value: string) => string;
  ip: (value: string | null | undefined) => string;
  money: (value: string) => string;
  secret: (value: string | null | undefined) => string;
};

const PrivacyContext = createContext<PrivacyApi>({
  privacy: false,
  setPrivacy: () => undefined,
  email: (value) => value,
  ip: (value) => value || copy.missing,
  money: (value) => value,
  secret: (value) => value || copy.missing,
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
        if (!value) return copy.missing;
        return privacy ? maskIp(value) : value;
      },
      money: (value) => (privacy ? maskMoney(value) : value),
      secret: (value) => {
        if (!value) return copy.missing;
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
