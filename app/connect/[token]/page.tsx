import { merchantByConnectToken } from "@/lib/merchants";

export const dynamic = "force-dynamic";

export default async function Connect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = await merchantByConnectToken(token);
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <h1>Connect FreshBooks</h1>
      {!m ? (
        <div className="card"><p>This link has expired or was already replaced. Please ask Priority Business Solutions for a new one.</p></div>
      ) : (
        <div className="card">
          <p>Priority Business Solutions is setting up online payments for <b>{m.name}</b>.</p>
          <p>Click the button, sign in to FreshBooks with the owner login for this business, and approve access. This lets us see new invoices and record payments against them. We never see your FreshBooks password.</p>
          <p><a className="btn primary" href={`/api/freshbooks/oauth/start?connect=${encodeURIComponent(token)}`}>Connect FreshBooks</a></p>
          <p className="small muted">Questions? Contact Priority Business Solutions.</p>
        </div>
      )}
    </main>
  );
}
