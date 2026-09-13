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
  wechat: (value: string | null | undefined) => string;
};

/**
 * A WeChat id with its middle taken out.
 *
 * The two ends are what an operator matches against the person they are
 * already talking to; the middle is the part that would let someone reading
 * over their shoulder go and find that person afterwards. An id too short to
 * have a middle keeps one character and nothing else.
 */
function maskWechat(value: string): string {
  if (value.length <= 4) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

const PrivacyContext = createContext<PrivacyApi>({
  privacy: false,
  setPrivacy: () => undefined,
  email: (value) => value,
  ip: (value) => value || copy.missing,
  money: (value) => value,
  secret: (value) => value || copy.missing,
  wechat: (value) => value || copy.missing,
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
      wechat: (value) => {
        if (!value) return copy.missing;
        return privacy ? maskWechat(value) : value;
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
