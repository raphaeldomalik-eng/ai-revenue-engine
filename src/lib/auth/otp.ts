export type AuthRedirectEnvironment = {
  siteUrl?: string;
  vercelUrl?: string;
};

function normalizeOrigin(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withProtocol).origin;
}

export function resolveApplicationOrigin(runtimeOrigin: string, environment: AuthRedirectEnvironment = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  vercelUrl: process.env.NEXT_PUBLIC_VERCEL_URL,
}) {
  const configuredOrigin = environment.siteUrl || environment.vercelUrl;
  return configuredOrigin ? normalizeOrigin(configuredOrigin) : normalizeOrigin(runtimeOrigin);
}

export function passwordlessSignInOptions(origin: string) {
  return {
    emailRedirectTo: `${origin}/auth/callback`,
    shouldCreateUser: false,
  };
}
