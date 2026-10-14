import { login } from "../actions";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 380 }}>
      <h1>Sign in</h1>
      <p className="sub">Enter the admin secret from the Vercel project settings.</p>
      {error && <div className="flash bad">That secret is not right.</div>}
      <form action={login} className="card">
        <label htmlFor="secret">Admin secret</label>
        <input id="secret" name="secret" type="password" autoComplete="current-password" required />
        <div style={{ marginTop: 14 }}><button className="btn primary" type="submit">Sign in</button></div>
      </form>
    </main>
  );
}
