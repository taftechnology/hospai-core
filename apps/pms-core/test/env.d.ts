import type { PmsEnv } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends PmsEnv {}
}
