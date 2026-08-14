import { useAuth } from '@clerk/react';
import { useEffect } from 'react';
import { registerClerkTokenGetter } from './clerk-credentials.js';

export function ClerkTokenBridge() {
  const { getToken } = useAuth();
  registerClerkTokenGetter(() => getToken());
  useEffect(() => () => registerClerkTokenGetter(null), []);
  return null;
}
