import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProtoProvider } from './state';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProtoProvider>
      <App />
    </ProtoProvider>
  </StrictMode>,
);
