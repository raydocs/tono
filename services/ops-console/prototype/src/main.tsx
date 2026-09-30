import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './ds/overlay';
import { ProtoProvider } from './state';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProtoProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ProtoProvider>
  </StrictMode>,
);
