import { requireAdmin } from "@/lib/admin-session";
import { listMerchants } from "@/lib/merchants";

export const dynamic = "force-dynamic";

const statusPill = (s: string) => <span className={`pill ${s === "active" ? "ok" : s === "paused" ? "bad" : "warn"}`}>{s}</span>;

export default async function Merchants() {
  await requireAdmin();
  const merchants = await listMerchants();
  const attention = merchants.reduce((n, m) => n + m.attention, 0);
  return (
    <main>
      <h1>Merchants</h1>
      <p className="sub">
        {merchants.length} merchant{merchants.length === 1 ? "" : "s"}.{" "}
        {attention > 0 ? <b style={{ color: "var(--warn)" }}>{attention} item{attention === 1 ? "" : "s"} need attention.</b> : "Nothing needs attention."}
      </p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Merchant</th><th>Status</th><th>FreshBooks</th><th>Webhooks</th><th>Invoices</th><th>Attention</th></tr></thead>
          <tbody>
            {merchants.length === 0 && <tr><td colSpan={6} className="muted">No merchants yet. <a href="/admin/merchants/new">Add the first one.</a></td></tr>}
            {merchants.map((m) => (
              <tr key={m.id}>
                <td><a href={`/admin/merchants/${m.id}`}><b>{m.name}</b></a><div className="small muted mono">{m.pcSiteId}</div></td>
                <td>{statusPill(m.status)}</td>
                <td>{m.fbConnected ? <span className="pill ok">connected</span> : <span className="pill warn">not connected</span>}</td>
                <td>{m.webhooksRegistered >= 4 ? <span className="pill ok">{m.webhooksRegistered} verified</span> : <span className="pill warn">{m.webhooksRegistered} of 4</span>}</td>
                <td>{m.invoices}</td>
                <td>{m.attention > 0 ? <span className="pill bad">{m.attention}</span> : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
