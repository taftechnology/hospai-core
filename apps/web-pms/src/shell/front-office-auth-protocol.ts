export function frontOfficeAuthProtocol(opts: {
  useDevActor: boolean;
  devActor: string;
  clerkToken: string | null;
}): string[] | undefined {
  if (opts.useDevActor) return [`hospai.dev-actor.${opts.devActor}`, 'front-office'];
  if (opts.clerkToken) return [`hospai.clerk.${opts.clerkToken}`, 'front-office'];
  return undefined;
}
