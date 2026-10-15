import { systemName } from "@/lib/deps";
import { merchantByConnectToken } from "@/lib/merchants";

export const dynamic = "force-dynamic";

export default async function Connect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = await merchantByConnectToken(token);
  const sys = m ? systemName(m) : "your accounting software";
  const qb = m?.accounting === "quickbooks";
  return (
    <main className="wrap" style={{ maxWidth: 540 }}>
      <div className="connect-hero"><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1 style={{ textAlign: "center" }}>Connect your {sys}</h1>
      <p className="sub" style={{ textAlign: "center" }}>Takes about a minute. You'll sign in on {qb ? "Intuit's" : "FreshBooks'"} own site.</p>
      {!m ? (
        <div className="card"><p>This link has expired or was already replaced. Please ask Priority Business Solutions for a new one.</p></div>
      ) : (
        <div className="card">
          <p>Priority Business Solutions is setting up online payments for <b>{m.name}</b>.</p>
          <p>Once connected, every invoice you {qb ? "create in QuickBooks" : "send from FreshBooks"} comes with a payment request from Priority Pay Center — card or bank transfer — and payments are recorded back on the invoice automatically.</p>
          <ul className="check">
            <li><span className="dot ok" /><span>Use the <b>{qb ? "company admin" : "owner"}</b> login for this business{qb ? ", and pick the right company if you have several" : ""}.</span></li>
            <li><span className="dot ok" /><span>We only read invoices and customers and record payments. We never see your password.</span></li>
            <li><span className="dot ok" /><span>You can revoke access any time from {qb ? "your Intuit account" : "FreshBooks"}.</span></li>
          </ul>
          <p style={{ marginTop: 18 }}><a className="btn primary" href={`/api/${qb ? "quickbooks" : "freshbooks"}/oauth/start?connect=${encodeURIComponent(token)}`}>Connect {sys}</a></p>
          <p className="small muted" style={{ marginBottom: 0 }}>Questions? Reach your Priority Business Solutions contact.</p>
        </div>
      )}
    </main>
  );
}
