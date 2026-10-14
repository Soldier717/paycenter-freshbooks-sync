import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config";
import { open, randomSecret, seal } from "./crypto";
import { Merchant, MerchantSummary } from "./types";

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!client) client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  return client;
}

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

function toMerchant(r: any): Merchant {
  return {
    id: r.id, name: r.name, status: r.status, fbAccountId: r.fb_account_id,
    pcBaseUrl: r.pc_base_url, pcSiteId: r.pc_site_id,
    pcAccessToken: r.pc_access_token_enc ? open(r.pc_access_token_enc) : null,
    pcWebhookSecret: r.pc_webhook_secret,
    notifyMode: r.notify_mode, recordOn: r.record_on, reversals: r.reversals,
    connectToken: r.connect_token, connectExpiresAt: r.connect_expires_at ? new Date(r.connect_expires_at).getTime() : null,
    createdAt: r.created_at,
  };
}

export interface MerchantInput {
  name: string;
  pcBaseUrl: string;
  pcSiteId: string;
  pcAccessToken?: string | null;
  fbAccountId?: string | null;
  notifyMode: "link" | "customer";
  recordOn: "settled" | "captured";
  reversals: "review" | "auto";
  status?: Merchant["status"];
}

export async function listMerchants(): Promise<MerchantSummary[]> {
  const rows: any[] = ok(await db().from("merchants").select("*").order("created_at")) ?? [];
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [tokens, callbacks, attention, invoices] = await Promise.all([
    ok(await db().from("fb_tokens").select("merchant_id, access_token").in("merchant_id", ids)) as any[],
    ok(await db().from("fb_callbacks").select("merchant_id").in("merchant_id", ids).eq("verified", true)) as any[],
    ok(await db().from("payment_ledger").select("merchant_id").in("merchant_id", ids).in("state", ["review", "uncertain"])) as any[],
    ok(await db().from("invoice_map").select("merchant_id").in("merchant_id", ids)) as any[],
  ]);
  const count = (list: any[], id: string) => list.filter((x) => x.merchant_id === id).length;
  // A token row only counts if it decrypts; rows from before encryption are ignored.
  const usable = (tokens ?? []).filter((t) => { try { open(t.access_token); return true; } catch { return false; } });
  return rows.map((r) => ({
    ...toMerchant(r),
    fbConnected: count(usable, r.id) > 0,
    webhooksRegistered: count(callbacks ?? [], r.id),
    attention: count(attention ?? [], r.id),
    invoices: count(invoices ?? [], r.id),
  }));
}

export async function getMerchant(id: string): Promise<Merchant | null> {
  const r = ok(await db().from("merchants").select("*").eq("id", id).maybeSingle());
  return r ? toMerchant(r) : null;
}

export async function merchantByFbAccount(accountId: string): Promise<Merchant | null> {
  const r = ok(await db().from("merchants").select("*").eq("fb_account_id", accountId).maybeSingle());
  return r ? toMerchant(r) : null;
}

export async function merchantByWebhookSecret(secret: string): Promise<Merchant | null> {
  if (!secret) return null;
  const r = ok(await db().from("merchants").select("*").eq("pc_webhook_secret", secret).maybeSingle());
  return r ? toMerchant(r) : null;
}

export async function merchantByConnectToken(token: string): Promise<Merchant | null> {
  if (!token) return null;
  const r = ok(await db().from("merchants").select("*").eq("connect_token", token).maybeSingle());
  if (!r) return null;
  const m = toMerchant(r);
  if (!m.connectExpiresAt || m.connectExpiresAt < Date.now()) return null;
  return m;
}

/** The merchant that owns a FreshBooks webhook callback id (used for the verification handshake). */
export async function merchantByCallbackId(callbackId: string): Promise<Merchant | null> {
  const cb: any = ok(await db().from("fb_callbacks").select("merchant_id").eq("callback_id", callbackId).maybeSingle());
  return cb ? getMerchant(cb.merchant_id) : null;
}

export async function activeMerchants(): Promise<Merchant[]> {
  const rows: any[] = ok(await db().from("merchants").select("*").eq("status", "active")) ?? [];
  return rows.map(toMerchant);
}

export async function createMerchant(input: MerchantInput): Promise<Merchant> {
  const r = ok(await db().from("merchants").insert({
    name: input.name.trim(),
    status: input.status ?? "setup",
    fb_account_id: input.fbAccountId?.trim() || null,
    pc_base_url: input.pcBaseUrl.trim().replace(/\/+$/, ""),
    pc_site_id: input.pcSiteId.trim(),
    pc_access_token_enc: input.pcAccessToken ? seal(input.pcAccessToken.trim()) : null,
    pc_webhook_secret: randomSecret(),
    notify_mode: input.notifyMode, record_on: input.recordOn, reversals: input.reversals,
  }).select("*").single());
  return toMerchant(r);
}

export async function updateMerchant(id: string, patch: Partial<MerchantInput>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.fbAccountId !== undefined) row.fb_account_id = patch.fbAccountId?.trim() || null;
  if (patch.pcBaseUrl !== undefined) row.pc_base_url = patch.pcBaseUrl.trim().replace(/\/+$/, "");
  if (patch.pcSiteId !== undefined) row.pc_site_id = patch.pcSiteId.trim();
  if (patch.pcAccessToken) row.pc_access_token_enc = seal(patch.pcAccessToken.trim());
  if (patch.notifyMode !== undefined) row.notify_mode = patch.notifyMode;
  if (patch.recordOn !== undefined) row.record_on = patch.recordOn;
  if (patch.reversals !== undefined) row.reversals = patch.reversals;
  ok(await db().from("merchants").update(row).eq("id", id));
}

/** A link the merchant opens to approve FreshBooks access. Valid for 7 days. */
export async function issueConnectToken(id: string): Promise<string> {
  const token = randomSecret(24);
  ok(await db().from("merchants").update({
    connect_token: token, connect_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  }).eq("id", id));
  return token;
}
