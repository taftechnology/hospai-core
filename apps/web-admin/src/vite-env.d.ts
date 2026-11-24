/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_USE_DEV_OPERATOR?: string;
  readonly VITE_DEV_OPERATOR_EMAIL?: string;
}
