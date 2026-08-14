import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { App } from './App.js';
import { ClerkTokenBridge } from './providers/ClerkTokenBridge.js';
import { spaAuthMode } from './providers/spa-auth-mode.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root_missing');

const tree =
  spaAuthMode() === 'clerk' ? (
    <ClerkProvider>
      <ClerkTokenBridge />
      <App />
    </ClerkProvider>
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{tree}</StrictMode>);
