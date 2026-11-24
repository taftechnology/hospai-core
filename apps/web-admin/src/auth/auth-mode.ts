export type OpsAuthMode = 'dev' | 'clerk' | 'misconfigured';

export type OpsAuthEnv = {
  VITE_USE_DEV_OPERATOR?: string;
  VITE_DEV_OPERATOR_EMAIL?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
};

/**
 * `dev` sends `x-dev-operator` and is honoured by the Worker only when both of its local flags are
 * set; it is never a sign-in path in a deployed build (the Worker ignores the header there).
 */
export function opsAuthMode(env: OpsAuthEnv = import.meta.env): OpsAuthMode {
  if (env.VITE_USE_DEV_OPERATOR === '1') return 'dev';
  if ((env.VITE_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_')) return 'clerk';
  return 'misconfigured';
}

export function devOperatorEmail(env: OpsAuthEnv = import.meta.env): string {
  return env.VITE_DEV_OPERATOR_EMAIL?.trim() || 'dev-operator@example.test';
}
