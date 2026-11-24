import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { opsAuthMode } from './auth/auth-mode.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root_missing');

createRoot(root).render(
  <StrictMode>
    {opsAuthMode() === 'clerk' ? (
      <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
        <App />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);
