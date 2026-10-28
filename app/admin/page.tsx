import { requireAdmin } from "@/lib/admin-session";
import { listMerchants } from "@/lib/merchants";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { cls: string; label: string }> = {
  active: { cls: "ok", label: "Live" },
  setup: { cls: "warn", label: "In setup" },
  paused: { cls: "", label: "Paused" },
};
const statusPill = (s: string) => <span className={`pill ${STATUS[s]?.cls ?? ""}`}>{STATUS[s]?.label ?? s}</span>;

export default async function Merchants() {
  await requireAdmin();
  const merchants = await listMerchants();
  const attention = merchants.reduce((n, m) => n + m.attention, 0);
  const live = merchants.filter((m) => m.status === "active").length;
  const invoices = merchants.reduce((n, m) => n + m.invoices, 0);
  return (
    <main>
      <h1>Merchants</h1>
      <p className="sub">Every business whose FreshBooks invoices flow through Priority Pay Center.</p>
      <div className="stats">
        <div className="stat"><span>Merchants</span><b>{merchants.length}</b></div>
        <div className="stat"><span>Live</span><b>{live}</b></div>
        <div className="stat"><span>Invoices synced</span><b>{invoices}</b></div>
        <div className={`stat ${attention > 0 ? "hot" : ""}`}><span>Needs attention</span><b>{attention}</b></div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Merchant</th><th>Status</th><th>Accounting</th><th>Webhooks</th><th>Invoices</th><th>Attention</th></tr></thead>
          <tbody>
            {merchants.length === 0 && <tr><td colSpan={6} className="muted">No merchants yet. <a href="/admin/merchants/new">Add the first one.</a></td></tr>}
            {merchants.map((m) => (
              <tr key={m.id}>
                <td>
                  <a href={`/admin/merchants/${m.id}`}><b>{m.name}</b></a>
                  <div className="small muted mono">{m.payments === "pbspay" ? `PBS Pay · MX ${m.mxMerchantId ?? "—"}` : `${m.pcBaseUrl.includes("stage") ? "demo · " : ""}${m.pcSiteId || "no site yet"}`}</div>
                </td>
                <td>{statusPill(m.status)}</td>
                <td>{m.accounting === "quickbooks" ? "QuickBooks" : "FreshBooks"} {m.acctConnected ? <span className="pill ok">Connected</span> : <span className="pill warn">Not connected</span>}</td>
                <td>{m.accounting === "quickbooks" ? <span className="pill">App-level</span> : m.webhooksRegistered >= 4 ? <span className="pill ok">Verified</span> : <span className="pill warn">{m.webhooksRegistered} of 4</span>}</td>
                <td>{m.invoices}</td>
                <td>{m.attention > 0 ? <span className="pill bad">{m.attention} to review</span> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
