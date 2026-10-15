import { merchantByConnectToken } from "@/lib/merchants";

export const dynamic = "force-dynamic";

export default async function Connect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = await merchantByConnectToken(token);
  return (
    <main className="wrap" style={{ maxWidth: 540 }}>
      <div className="connect-hero"><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1 style={{ textAlign: "center" }}>Connect your FreshBooks</h1>
      <p className="sub" style={{ textAlign: "center" }}>Takes about a minute. You'll sign in on FreshBooks' own site.</p>
      {!m ? (
        <div className="card"><p>This link has expired or was already replaced. Please ask Priority Business Solutions for a new one.</p></div>
      ) : (
        <div className="card">
          <p>Priority Business Solutions is setting up online payments for <b>{m.name}</b>.</p>
          <p>Once connected, every invoice you send from FreshBooks comes with a payment request from Priority Pay Center — card or bank transfer — and payments are recorded back on the invoice automatically.</p>
          <ul className="check">
            <li><span className="dot ok" /><span>Use the <b>owner</b> login for this business.</span></li>
            <li><span className="dot ok" /><span>We only read invoices and record payments. We never see your password.</span></li>
            <li><span className="dot ok" /><span>You can revoke access any time from FreshBooks.</span></li>
          </ul>
          <p style={{ marginTop: 18 }}><a className="btn primary" href={`/api/freshbooks/oauth/start?connect=${encodeURIComponent(token)}`}>Connect FreshBooks</a></p>
          <p className="small muted" style={{ marginBottom: 0 }}>Questions? Reach your Priority Business Solutions contact.</p>
        </div>
      )}
    </main>
  );
}
