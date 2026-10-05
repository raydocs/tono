import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { PrivacyProvider } from '@/lib/privacy';
import { ThemeProvider } from '@/lib/theme';
import { migrateLegacyRoute } from '@/lib/legacy-route';
import '@/styles/globals.css';

migrateLegacyRoute();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <PrivacyProvider>
        <App />
      </PrivacyProvider>
    </ThemeProvider>
  </StrictMode>,
);
