import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-session";
import { storeFor } from "@/lib/deps";
import { db, getMerchant } from "@/lib/merchants";
import { connectUrl } from "@/lib/onboarding";
import { makeConnectLink, recheckPayments, registerMerchantWebhooks, resolveItem, saveMerchant } from "../../actions";
import { SettingsFields } from "../settings-fields";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function MerchantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { msg, err } = await searchParams;
  const m = await getMerchant(id);
  if (!m) notFound();
  const s = storeFor(m);
  const [fbTokens, callbacks, held, invoices, log] = await Promise.all([
    s.getTokens(),
    s.countCallbacks(),
    s.listAttention(),
    db().from("invoice_map").select("*").eq("merchant_id", m.id).order("updated_at", { ascending: false }).limit(25).then((r) => r.data ?? []),
    s.recentLog(30) as Promise<any[]>,
  ]);
  const verified = (await db().from("fb_callbacks").select("callback_id", { count: "exact", head: true }).eq("merchant_id", m.id).eq("verified", true)).count ?? 0;
  const ready = !!m.pcAccessToken && !!fbTokens && verified >= 4;
  const connectLink = m.connectToken && m.connectExpiresAt && m.connectExpiresAt > Date.now() ? connectUrl(m.connectToken) : null;

  return (
    <main>
      <h1>{m.name}</h1>
      <p className="sub">
        <span className={`pill ${m.status === "active" ? "ok" : m.status === "paused" ? "bad" : "warn"}`}>{m.status}</span>{" "}
        <span className="mono muted">{m.pcBaseUrl.includes("stage") ? "demo site" : "live site"} · {m.pcSiteId}</span>
      </p>
      {msg && <div className="flash">{msg}</div>}
      {err && <div className="flash bad">{err}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Setup</h2>
        <ul className="check">
          <li><span className={`dot ${m.pcAccessToken ? "ok" : "warn"}`} /><span>Pay Center token {m.pcAccessToken ? "entered" : "missing — add it in Settings below"}</span></li>
          <li><span className={`dot ${fbTokens ? "ok" : "warn"}`} /><span>FreshBooks {fbTokens ? <>connected (account <code>{m.fbAccountId}</code>)</> : "not connected"}</span></li>
          <li><span className={`dot ${verified >= 4 ? "ok" : callbacks > 0 ? "warn" : ""}`} /><span>Invoice webhooks: {verified} of 4 verified{callbacks > verified ? ` (${callbacks - verified} waiting on FreshBooks)` : ""}</span></li>
          <li><span className={`dot ${m.status === "active" ? "ok" : "warn"}`} /><span>Status {m.status}{ready && m.status !== "active" ? " — everything is in place; set it to active in Settings" : ""}</span></li>
        </ul>
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn" href={`/api/freshbooks/oauth/start?merchant=${m.id}`}>Connect FreshBooks myself</a>
          <form action={makeConnectLink}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Create a connect link for the merchant</button></form>
          {fbTokens && <form action={registerMerchantWebhooks}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Register webhooks</button></form>}
          {ready && <form action={recheckPayments}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Re-check payments (7 days)</button></form>}
        </div>
        {connectLink && (
          <p className="small" style={{ marginTop: 14 }}>
            Send this to the merchant. They sign in to FreshBooks and approve; nothing else is needed from them.<br />
            <code>{connectLink}</code>
          </p>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Pay Center webhook address for this merchant (set automatically on each invoice): <code>/api/paycenter/webhook/{m.pcWebhookSecret.slice(0, 6)}…</code>
        </p>
      </div>

      {held.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--warn)" }}>Needs attention ({held.length})</h2>
          <table>
            <thead><tr><th>Pay Center payment</th><th>State</th><th>Why</th><th>Resolve</th></tr></thead>
            <tbody>
              {held.map((h) => (
                <tr key={h.pcPaymentId}>
                  <td className="mono">{h.pcPaymentId}<div className="muted">{h.kind} · {money(h.cents)}</div></td>
                  <td><span className="pill bad">{h.state}</span></td>
                  <td>{h.reason}</td>
                  <td>
                    <form action={resolveItem} className="row">
                      <input type="hidden" name="id" value={m.id} /><input type="hidden" name="pcPaymentId" value={h.pcPaymentId} />
                      <input name="note" placeholder="What was done in FreshBooks" style={{ maxWidth: 240 }} />
                      <button className="btn" type="submit">Mark resolved</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <form action={saveMerchant}>
          <input type="hidden" name="id" value={m.id} />
          <div className="grid">
            <div><label htmlFor="name">Merchant name</label><input id="name" name="name" defaultValue={m.name} required /></div>
            <div>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={m.status}>
                <option value="setup">Setup (ignore invoices)</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div><label htmlFor="pcBaseUrl">Pay Center API base URL</label><input id="pcBaseUrl" name="pcBaseUrl" defaultValue={m.pcBaseUrl} /></div>
            <div><label htmlFor="pcSiteId">Pay Center site id</label><input id="pcSiteId" name="pcSiteId" defaultValue={m.pcSiteId} className="mono" /></div>
            <div><label htmlFor="pcAccessToken">Pay Center token {m.pcAccessToken ? "(leave blank to keep)" : ""}</label><input id="pcAccessToken" name="pcAccessToken" type="password" autoComplete="off" className="mono" /></div>
            <div><label htmlFor="fbAccountId">FreshBooks account id</label><input id="fbAccountId" name="fbAccountId" defaultValue={m.fbAccountId ?? ""} className="mono" /></div>
          </div>
          <h2>Rules</h2>
          <SettingsFields m={m} />
          <div style={{ marginTop: 18 }}><button className="btn primary" type="submit">Save</button></div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent invoices</h2>
        {invoices.length === 0 ? <p className="muted small">None yet.</p> : (
          <table>
            <thead><tr><th>FreshBooks #</th><th>Total</th><th>Pay link</th><th>Updated</th></tr></thead>
            <tbody>
              {invoices.map((i: any) => (
                <tr key={i.fb_invoice_id}>
                  <td>{i.invoice_number} <span className="muted small">(id {i.fb_invoice_id})</span></td>
                  <td>{money(Number(i.total_cents))}</td>
                  <td>{i.pay_link ? <a href={i.pay_link} target="_blank" rel="noreferrer">open</a> : <span className="muted">sent by Pay Center</span>}</td>
                  <td className="small muted">{when(i.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Activity</h2>
        {log.length === 0 ? <p className="muted small">Nothing yet.</p> : (
          <table>
            <tbody>
              {log.map((l: any) => (
                <tr key={l.id}>
                  <td className="small muted" style={{ whiteSpace: "nowrap" }}>{when(l.at)}</td>
                  <td><span className={`pill ${l.level === "error" ? "bad" : l.level === "review" ? "warn" : ""}`}>{l.level}</span></td>
                  <td>{l.message}{l.detail && <div className="small muted mono">{JSON.stringify(l.detail)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
