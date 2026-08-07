export type CredentialHeaders = Record<string, string>;

export type CredentialProvider = {
  getCredentialHeaders: () => CredentialHeaders | Promise<CredentialHeaders>;
};

export type Transport = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
};

export function createTransport(opts: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  credentials: CredentialProvider;
}): Transport {
  const base = opts.baseUrl.replace(/\/$/, '');
  return {
    async fetch(input: string, init?: RequestInit): Promise<Response> {
      const creds = await opts.credentials.getCredentialHeaders();
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(creds)) {
        headers.set(k, v);
      }
      const url = input.startsWith('http') ? input : `${base}${input.startsWith('/') ? '' : '/'}${input}`;
      return opts.fetchImpl(url, { ...init, headers });
    },
  };
}
