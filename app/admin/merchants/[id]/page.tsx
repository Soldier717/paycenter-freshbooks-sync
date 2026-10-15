import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-session";
import { pcTokenFor, quickBooksClientFor, storeFor, systemName } from "@/lib/deps";
import { db, getMerchant } from "@/lib/merchants";
import { connectUrl } from "@/lib/onboarding";
import { depositAccounts, incomeAccounts, QbAccount, QbItem, serviceItems } from "@/lib/quickbooks";
import { createFeeItem, makeConnectLink, pushInvoice, recheckPayments, registerMerchantWebhooks, resolveItem, saveMerchant } from "../../actions";
import { QuickBooksFields, SettingsFields } from "../settings-fields";

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
  const sys = systemName(m);
  const qb = m.accounting === "quickbooks";
  const [tokens, callbacks, held, invoices, log] = await Promise.all([
    s.getTokens(),
    s.countCallbacks(),
    s.listAttention(),
    db().from("invoice_map").select("*").eq("merchant_id", m.id).order("updated_at", { ascending: false }).limit(25).then((r) => r.data ?? []),
    s.recentLog(30) as Promise<any[]>,
  ]);
  const verified = qb ? 4 : (await db().from("fb_callbacks").select("callback_id", { count: "exact", head: true }).eq("merchant_id", m.id).eq("verified", true)).count ?? 0;
  const tokenSource = m.pcAccessToken ? "site" : pcTokenFor(m) ? "agency" : null;
  // QuickBooks setup lists, read live from the connected company. A failure here must not hide the page.
  let qbAccounts: QbAccount[] = [], qbIncome: QbAccount[] = [], qbItems: QbItem[] = [], qbError: string | null = null;
  if (qb && tokens && m.acctAccountId) {
    try {
      const c = quickBooksClientFor(m);
      [qbAccounts, qbIncome, qbItems] = await Promise.all([depositAccounts(c), incomeAccounts(c), serviceItems(c)]);
    } catch (err) {
      qbError = String((err as Error).message ?? err);
    }
  }
  const feeReady = !m.bookFees || !!m.qbFeeItemId;
  const ready = !!tokenSource && !!tokens && verified >= 4 && (!qb || feeReady);
  const connectLink = m.connectToken && m.connectExpiresAt && m.connectExpiresAt > Date.now() ? connectUrl(m.connectToken) : null;

  return (
    <main>
      <h1>{m.name}</h1>
      <p className="sub">
        <span className={`pill ${m.status === "active" ? "ok" : m.status === "paused" ? "" : "warn"}`}>{m.status === "active" ? "Live" : m.status === "paused" ? "Paused" : "In setup"}</span>{" "}
        <span className={`pill ${m.pcBaseUrl.includes("stage") ? "" : "gold"}`}>{m.pcBaseUrl.includes("stage") ? "Demo site" : "Production site"}</span>{" "}
        <span className="mono muted small">{m.pcSiteId || "no Pay Center site yet"}</span>
      </p>
      {msg && <div className="flash">{msg}</div>}
      {err && <div className="flash bad">{err}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Setup checklist</h2>
        <ul className="check">
          <li><span className={`dot ${tokenSource ? "ok" : "warn"}`} /><span>Pay Center access {tokenSource === "site" ? "via this site's token" : tokenSource === "agency" ? "via the PBS agency token" : "missing — add a site token in Settings below"}</span></li>
          <li><span className={`dot ${tokens ? "ok" : "warn"}`} /><span>{sys} {tokens ? <>connected ({qb ? "company" : "account"} <code>{m.acctAccountId}</code>{qb && m.qbEnv === "sandbox" ? ", sandbox" : ""}{qb && tokens.refreshExpiresAt ? `, access renews until ${new Date(tokens.refreshExpiresAt).toLocaleDateString("en-US")}` : ""})</> : "not connected"}</span></li>
          {qb ? (
            <>
              <li><span className="dot ok" /><span>Invoice webhooks: set once for the whole app in the Intuit developer portal ({m.qbEnv} keys → <code>/api/quickbooks/webhook</code>, entity Invoice)</span></li>
              <li><span className={`dot ${feeReady ? "ok" : "warn"}`} /><span>{m.bookFees ? (m.qbFeeItemId ? "Customer fees booked to the fee item's income account" : "Fee booking is on but no fee item is chosen — create or pick one below") : "Customer fees not booked (bookkeeper records them from the processor statement)"}</span></li>
            </>
          ) : (
            <li><span className={`dot ${verified >= 4 ? "ok" : callbacks > 0 ? "warn" : ""}`} /><span>Invoice webhooks: {verified} of 4 verified{callbacks > verified ? ` (${callbacks - verified} waiting on FreshBooks)` : ""}</span></li>
          )}
          <li><span className={`dot ${m.status === "active" ? "ok" : "warn"}`} /><span>{m.status === "active" ? "Live — invoices sync automatically" : ready ? "Ready to go live — set Status to Live in Settings" : `Status: ${m.status === "paused" ? "paused" : "in setup"} (invoices are ignored)`}</span></li>
        </ul>
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn" href={`/api/${qb ? "quickbooks" : "freshbooks"}/oauth/start?merchant=${m.id}`}>Connect {sys} (I have the login)</a>
          <form action={makeConnectLink}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Create a link for the merchant</button></form>
          {tokens && !qb && <form action={registerMerchantWebhooks}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Register webhooks</button></form>}
          {ready && <form action={recheckPayments}><input type="hidden" name="id" value={m.id} /><button className="btn" type="submit">Re-check payments (last 7 days)</button></form>}
        </div>
        {ready && (
          <form action={pushInvoice} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={m.id} />
            <input name="invoiceId" placeholder={`${sys} invoice id`} style={{ maxWidth: 220 }} />
            <button className="btn" type="submit">Push invoice to Pay Center</button>
            <span className="small muted">Same as a {sys} webhook; safe to repeat.</span>
          </form>
        )}
        {connectLink && (
          <p className="small" style={{ marginTop: 14 }}>
            Send this to the merchant. They sign in to {sys} and approve; nothing else is needed from them.<br />
            <code>{connectLink}</code>
          </p>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Pay Center webhook address for this merchant (set automatically on each invoice): <code>/api/paycenter/webhook/{m.pcWebhookSecret.slice(0, 6)}…</code>
        </p>
      </div>

      {held.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0, color: "var(--bad)" }}>Needs a person ({held.length})</h2>
          <table>
            <thead><tr><th>Pay Center payment</th><th>State</th><th>Why</th><th>Resolve</th></tr></thead>
            <tbody>
              {held.map((h) => (
                <tr key={h.pcPaymentId}>
                  <td className="mono">{h.pcPaymentId}<div className="muted">{h.kind} · {money(h.cents)}{h.feeCents ? ` + ${money(h.feeCents)} fee` : ""}</div></td>
                  <td><span className="pill bad">{h.state}</span></td>
                  <td>{h.reason}</td>
                  <td>
                    <form action={resolveItem} className="row">
                      <input type="hidden" name="id" value={m.id} /><input type="hidden" name="pcPaymentId" value={h.pcPaymentId} />
                      <input name="note" placeholder={`What was done in ${sys}`} style={{ maxWidth: 240 }} />
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
                <option value="setup">In setup (ignore invoices)</option>
                <option value="active">Live</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div><label htmlFor="pcBaseUrl">Pay Center API base URL</label><input id="pcBaseUrl" name="pcBaseUrl" defaultValue={m.pcBaseUrl} /></div>
            <div><label htmlFor="pcSiteId">Pay Center site id</label><input id="pcSiteId" name="pcSiteId" defaultValue={m.pcSiteId} className="mono" /></div>
            <div><label htmlFor="pcAccessToken">Pay Center site token {m.pcAccessToken ? "(leave blank to keep)" : "(optional when the site is under the PBS agency)"}</label><input id="pcAccessToken" name="pcAccessToken" type="password" autoComplete="off" className="mono" /></div>
            <div><label htmlFor="acctAccountId">{sys} {qb ? "company (realm) id" : "account id"}</label><input id="acctAccountId" name="acctAccountId" defaultValue={m.acctAccountId ?? ""} className="mono" /></div>
          </div>
          <h2>Rules</h2>
          <SettingsFields m={m} system={sys} />
          {qb && (
            <>
              <h2>QuickBooks</h2>
              {qbError && <div className="flash bad">QuickBooks could not be read for the lists below: {qbError}</div>}
              <QuickBooksFields m={m} connected={!!tokens && !qbError} accounts={qbAccounts} items={qbItems} />
            </>
          )}
          <div style={{ marginTop: 18 }}><button className="btn primary" type="submit">Save</button></div>
        </form>
      </div>

      {qb && tokens && !qbError && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Fee item</h2>
          <p className="small muted">
            Each customer fee is booked as a sales receipt on a service item, deposited to the same account as the payment, so the
            bank deposit screen shows the invoice payment and the fee side by side. The fee figure is the one Pay Center reports;
            nothing is calculated from a percentage.
          </p>
          <form action={createFeeItem} className="row">
            <input type="hidden" name="id" value={m.id} />
            <div><label htmlFor="itemName">Item name</label><input id="itemName" name="itemName" defaultValue="Card Processing Fee" /></div>
            <div>
              <label htmlFor="incomeAccountId">Income account</label>
              <select id="incomeAccountId" name="incomeAccountId" defaultValue="">
                <option value="">Create "Card Processing Fee Income"</option>
                {qbIncome.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <button className="btn" type="submit" style={{ alignSelf: "end" }}>Create fee item and turn booking on</button>
          </form>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent invoices</h2>
        {invoices.length === 0 ? <p className="muted small">None yet.</p> : (
          <table>
            <thead><tr><th>{sys} #</th><th>Total</th><th>Pay link</th><th>Updated</th></tr></thead>
            <tbody>
              {invoices.map((i: any) => (
                <tr key={i.fb_invoice_id}>
                  <td>{i.invoice_number} <span className="muted small">(id {i.fb_invoice_id})</span></td>
                  <td>{money(Number(i.total_cents))}</td>
                  <td>{i.pay_link ? <a href={i.pay_link} target="_blank" rel="noreferrer">open</a> : <span className="pill">Sent by Pay Center</span>}</td>
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
