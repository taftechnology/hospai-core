export type SpaAuthMode = 'engineer' | 'password-gate' | 'clerk' | 'misconfigured';

export type SpaAuthEnv = {
  VITE_USE_DEV_ACTOR?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_DEMO_PASSWORD?: string;
  VITE_DEMO_EMAIL?: string;
};

export function spaAuthMode(env: SpaAuthEnv = import.meta.env): SpaAuthMode {
  if (env.VITE_USE_DEV_ACTOR === '1') {
    return env.VITE_DEMO_PASSWORD ? 'password-gate' : 'engineer';
  }
  const pk = env.VITE_CLERK_PUBLISHABLE_KEY ?? '';
  if (pk.startsWith('pk_')) return 'clerk';
  return 'misconfigured';
}

export function demoGateEmail(env: SpaAuthEnv = import.meta.env): string {
  return env.VITE_DEMO_EMAIL?.trim() || 'demo@hospai.local';
}

export function demoGatePassword(env: SpaAuthEnv = import.meta.env): string {
  return env.VITE_DEMO_PASSWORD ?? '';
}
