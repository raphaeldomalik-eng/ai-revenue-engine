import { LoginForm } from "./login-form";

export default function LoginPage() {
  return <main className="auth-shell"><span className="eyebrow">AI REVENUE ENGINE · INTERNAL ACCESS</span><h1>Sign in</h1><p>Passwordless access is limited to users provisioned in Supabase Auth and activated as internal Revenue Members.</p><LoginForm /></main>;
}
