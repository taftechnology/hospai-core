/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORG_ID: string;
  readonly VITE_PROPERTY_ID: string;
  readonly VITE_DEV_ACTOR?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_USE_DEV_ACTOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
