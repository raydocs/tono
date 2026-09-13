import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'tono-ops-theme';

const ThemeContext = createContext<{
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (value: ThemeChoice) => void;
}>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => undefined,
});

function readStored(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: ThemeChoice): 'light' | 'dark' {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.dataset.theme = resolved;
  document.querySelector<HTMLMetaElement>('#color-scheme')?.setAttribute('content', resolved);
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readStored);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => (
    typeof document === 'undefined'
      ? 'light'
      : document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  ));

  useEffect(() => {
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
    setResolved(apply(theme));
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(apply(theme));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
