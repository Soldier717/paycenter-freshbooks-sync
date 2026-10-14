import { open, seal } from "./crypto";
import { db } from "./merchants";
import { FbTokens, InvoiceLink, LedgerRow, Store } from "./types";

const toLink = (r: any): InvoiceLink => ({
  fbInvoiceId: String(r.fb_invoice_id), pcInvoiceId: r.pc_invoice_id, invoiceNumber: r.invoice_number ?? "",
  totalCents: Number(r.total_cents), fingerprint: r.fingerprint, payLink: r.pay_link,
});
const toRow = (r: any): LedgerRow => ({
  pcPaymentId: r.pc_payment_id, pcInvoiceId: r.pc_invoice_id, kind: r.kind, state: r.state,
  fbPaymentId: r.fb_payment_id, cents: Number(r.cents), reason: r.reason,
});
const linkCols: Record<string, string> = {
  fbInvoiceId: "fb_invoice_id", pcInvoiceId: "pc_invoice_id", invoiceNumber: "invoice_number",
  totalCents: "total_cents", fingerprint: "fingerprint", payLink: "pay_link",
};
const rowCols: Record<string, string> = {
  pcPaymentId: "pc_payment_id", pcInvoiceId: "pc_invoice_id", kind: "kind", state: "state",
  fbPaymentId: "fb_payment_id", cents: "cents", reason: "reason",
};
const rename = (o: Record<string, unknown>, map: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [map[k], v]));

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

/** All reads and writes are scoped to one merchant. FreshBooks tokens are encrypted at rest. */
export function merchantStore(merchantId: string): Store {
  const m = merchantId;
  const now = () => new Date().toISOString();

  return {
    async getTokens() {
      const r: any = ok(await db().from("fb_tokens").select("*").eq("merchant_id", m).maybeSingle());
      if (!r) return null;
      try {
        return { accessToken: open(r.access_token), refreshToken: open(r.refresh_token), expiresAt: new Date(r.expires_at).getTime() };
      } catch {
        return null; // a row from before tokens were encrypted: treat as not connected
      }
    },
    async saveTokens(t: FbTokens) {
      ok(await db().from("fb_tokens").upsert({
        merchant_id: m, access_token: seal(t.accessToken), refresh_token: seal(t.refreshToken), expires_at: new Date(t.expiresAt).toISOString(),
      }));
    },
    async getKv(key) {
      const r: any = ok(await db().from("sync_state").select("value").eq("merchant_id", m).eq("key", key).maybeSingle());
      return r?.value ?? null;
    },
    async setKv(key, value) {
      ok(await db().from("sync_state").upsert({ merchant_id: m, key, value }));
    },
    async getLinkByFb(id) {
      const r = ok(await db().from("invoice_map").select("*").eq("merchant_id", m).eq("fb_invoice_id", id).maybeSingle());
      return r ? toLink(r) : null;
    },
    async getLinkByPc(id) {
      const r = ok(await db().from("invoice_map").select("*").eq("merchant_id", m).eq("pc_invoice_id", id).maybeSingle());
      return r ? toLink(r) : null;
    },
    async insertLink(link) {
      ok(await db().from("invoice_map").insert({ merchant_id: m, ...rename({ ...link }, linkCols) }));
    },
    async updateLink(id, patch) {
      ok(await db().from("invoice_map").update({ ...rename({ ...patch }, linkCols), updated_at: now() }).eq("merchant_id", m).eq("fb_invoice_id", id));
    },
    async getLedger(id) {
      const r = ok(await db().from("payment_ledger").select("*").eq("merchant_id", m).eq("pc_payment_id", id).maybeSingle());
      return r ? toRow(r) : null;
    },
    async claimLedger(row) {
      const res = await db().from("payment_ledger").insert({ merchant_id: m, ...rename({ ...row }, rowCols) });
      if (res.error?.code === "23505") return false; // already claimed by another request
      ok(res);
      return true;
    },
    async updateLedger(id, patch) {
      ok(await db().from("payment_ledger").update({ ...rename({ ...patch }, rowCols), updated_at: now() }).eq("merchant_id", m).eq("pc_payment_id", id));
    },
    async countLedgerForInvoice(pcInvoiceId) {
      const res = await db().from("payment_ledger").select("pc_payment_id", { count: "exact", head: true }).eq("merchant_id", m).eq("pc_invoice_id", pcInvoiceId);
      if (res.error) throw new Error(`Database error: ${res.error.message}`);
      return res.count ?? 0;
    },
    async listAttention() {
      const r = ok(await db().from("payment_ledger").select("*").eq("merchant_id", m).in("state", ["review", "uncertain", "posting"]).order("updated_at", { ascending: false }));
      return (r ?? []).map(toRow);
    },
    async resolveLedger(id, note) {
      ok(await db().from("payment_ledger").update({ state: "resolved", resolved_note: note, updated_at: now() }).eq("merchant_id", m).eq("pc_payment_id", id));
    },
    async saveCallback(callbackId, event) {
      ok(await db().from("fb_callbacks").upsert({ merchant_id: m, callback_id: callbackId, event, verified: false, verifier: null }));
    },
    async countCallbacks() {
      const res = await db().from("fb_callbacks").select("callback_id", { count: "exact", head: true }).eq("merchant_id", m);
      if (res.error) throw new Error(`Database error: ${res.error.message}`);
      return res.count ?? 0;
    },
    async setVerifier(callbackId, verifier) {
      const r = ok(await db().from("fb_callbacks").update({ verifier, verified: true }).eq("merchant_id", m).eq("callback_id", callbackId).eq("verified", false).select("callback_id"));
      return (r ?? []).length > 0;
    },
    async verifiersFor(event) {
      const r: any[] = ok(await db().from("fb_callbacks").select("verifier").eq("merchant_id", m).eq("event", event).eq("verified", true)) ?? [];
      return r.map((x) => x.verifier).filter(Boolean);
    },
    async log(level, message, detail) {
      const res = await db().from("sync_log").insert({ merchant_id: m, level, message, detail: detail ?? null });
      if (res.error) console.error("log failed", res.error.message, message);
    },
    async recentLog(limit) {
      return ok(await db().from("sync_log").select("*").eq("merchant_id", m).order("id", { ascending: false }).limit(limit)) ?? [];
    },
  };
}
