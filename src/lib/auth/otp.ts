export function passwordlessSignInOptions(origin: string) {
  return {
    emailRedirectTo: `${origin}/auth/callback`,
    shouldCreateUser: false,
  };
}
