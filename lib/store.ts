import { createClient, SupabaseClient } from "@supabase/supabase-js";
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

export function supabaseStore(url: string, serviceKey: string): Store {
  const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const now = () => new Date().toISOString();

  return {
    async getTokens() {
      const r: any = ok(await db.from("fb_tokens").select("*").eq("id", 1).maybeSingle());
      return r ? { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(r.expires_at).getTime() } : null;
    },
    async saveTokens(t: FbTokens) {
      ok(await db.from("fb_tokens").upsert({
        id: 1, access_token: t.accessToken, refresh_token: t.refreshToken, expires_at: new Date(t.expiresAt).toISOString(),
      }));
    },
    async getKv(key) {
      const r: any = ok(await db.from("sync_state").select("value").eq("key", key).maybeSingle());
      return r?.value ?? null;
    },
    async setKv(key, value) {
      ok(await db.from("sync_state").upsert({ key, value }));
    },
    async getLinkByFb(id) {
      const r = ok(await db.from("invoice_map").select("*").eq("fb_invoice_id", id).maybeSingle());
      return r ? toLink(r) : null;
    },
    async getLinkByPc(id) {
      const r = ok(await db.from("invoice_map").select("*").eq("pc_invoice_id", id).maybeSingle());
      return r ? toLink(r) : null;
    },
    async insertLink(link) {
      ok(await db.from("invoice_map").insert(rename({ ...link }, linkCols)));
    },
    async updateLink(id, patch) {
      ok(await db.from("invoice_map").update({ ...rename({ ...patch }, linkCols), updated_at: now() }).eq("fb_invoice_id", id));
    },
    async getLedger(id) {
      const r = ok(await db.from("payment_ledger").select("*").eq("pc_payment_id", id).maybeSingle());
      return r ? toRow(r) : null;
    },
    async claimLedger(row) {
      const res = await db.from("payment_ledger").insert(rename({ ...row }, rowCols));
      if (res.error?.code === "23505") return false; // already claimed by another request
      ok(res);
      return true;
    },
    async updateLedger(id, patch) {
      ok(await db.from("payment_ledger").update({ ...rename({ ...patch }, rowCols), updated_at: now() }).eq("pc_payment_id", id));
    },
    async countLedgerForInvoice(pcInvoiceId) {
      const res = await db.from("payment_ledger").select("pc_payment_id", { count: "exact", head: true }).eq("pc_invoice_id", pcInvoiceId);
      if (res.error) throw new Error(`Database error: ${res.error.message}`);
      return res.count ?? 0;
    },
    async listAttention() {
      const r = ok(await db.from("payment_ledger").select("*").in("state", ["review", "uncertain", "posting"]).order("updated_at", { ascending: false }));
      return (r ?? []).map(toRow);
    },
    async saveCallback(callbackId, event) {
      ok(await db.from("fb_callbacks").upsert({ callback_id: callbackId, event, verified: false, verifier: null }));
    },
    async setVerifier(callbackId, verifier) {
      const r = ok(await db.from("fb_callbacks").update({ verifier, verified: true }).eq("callback_id", callbackId).eq("verified", false).select("callback_id"));
      return (r ?? []).length > 0;
    },
    async verifiersFor(event) {
      const r: any[] = ok(await db.from("fb_callbacks").select("verifier").eq("event", event).eq("verified", true)) ?? [];
      return r.map((x) => x.verifier).filter(Boolean);
    },
    async log(level, message, detail) {
      const res = await db.from("sync_log").insert({ level, message, detail: detail ?? null });
      if (res.error) console.error("log failed", res.error.message, message);
    },
    async recentLog(limit) {
      return ok(await db.from("sync_log").select("*").order("id", { ascending: false }).limit(limit)) ?? [];
    },
  };
}
