import { login } from "../actions";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 400, margin: "40px auto 0" }}>
      <div className="connect-hero" style={{ paddingTop: 0 }}><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1 style={{ textAlign: "center" }}>Admin sign in</h1>
      <p className="sub" style={{ textAlign: "center" }}>Priority staff only. Enter the admin secret.</p>
      {error && <div className="flash bad">That secret didn't match. Try again.</div>}
      <form action={login} className="card">
        <label htmlFor="secret">Admin secret</label>
        <input id="secret" name="secret" type="password" autoComplete="current-password" required />
        <div style={{ marginTop: 14 }}><button className="btn primary" type="submit">Sign in</button></div>
      </form>
    </main>
  );
}
