import { appUrl } from "./config";
import { randomSecret } from "./crypto";
import { db } from "./merchants";
import { toDecimal } from "./money";
import { mx, mxCents, mxConfig, MxClient, MxPayment } from "./mx";
import { Merchant, PayCenterApi, PcPayment, ProviderError } from "./types";

/**
 * PBS Pay: our own payment requests and pay page, with MX Merchant taking the card or ACH.
 * Exposes the same interface the sync core uses for Hyfin Pay Center, so nothing above it changes.
 *
 * Money rules:
 * - The customer sees two prices. Cash price = the invoice. Card price = invoice + fee, where the fee
 *   is the merchant's rate applied to the invoice, rounded half-up to the cent, computed ONCE here and
 *   shown to the customer before anything is charged. MX is sent one sale for the card price.
 * - The fee booked to the accounting system is that same figure, stored on the payment record. It is
 *   never derived from the total afterwards.
 */

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

export interface PayRequest {
  id: string;
  merchantId: string;
  externalId: string;
  invoiceNumber: string;
  description: string | null;
  totalCents: number;
  dueDate: string | null;
  customer: { firstName?: string; lastName?: string; email?: string; mobilePhone?: string } | null;
  status: "open" | "paid" | "void";
  notifiedAt: string | null;
}

export interface PayPaymentRow {
  id: string;
  merchantId: string;
  requestId: string | null;
  kind: "payment" | "refund";
  method: "card" | "ach";
  status: string;
  invoiceCents: number;
  feeCents: number;
  totalCents: number;
  mxPaymentId: string;
  mxBatch: string | null;
  origPaymentId: string | null;
  paidOn: string;
  updatedAt: string;
}

const toRequest = (r: any): PayRequest => ({
  id: r.id, merchantId: r.merchant_id, externalId: r.external_id, invoiceNumber: r.invoice_number, description: r.description,
  totalCents: Number(r.total_cents), dueDate: r.due_date, customer: r.customer, status: r.status, notifiedAt: r.notified_at,
});
const toPayment = (r: any): PayPaymentRow => ({
  id: r.id, merchantId: r.merchant_id, requestId: r.request_id, kind: r.kind, method: r.method, status: r.status,
  invoiceCents: Number(r.invoice_cents), feeCents: Number(r.fee_cents), totalCents: Number(r.total_cents),
  mxPaymentId: r.mx_payment_id, mxBatch: r.mx_batch, origPaymentId: r.orig_payment_id, paidOn: r.paid_on, updatedAt: r.updated_at,
});

/** Card fee in cents for an invoice amount: rate in basis points, rounded half-up to the cent. */
export function cardFeeCents(invoiceCents: number, feeRateBps: number): number {
  if (!Number.isInteger(invoiceCents) || invoiceCents < 0) throw new Error(`Invalid invoice cents: ${invoiceCents}`);
  return Math.floor((invoiceCents * feeRateBps + 5000) / 10000);
}

export const payLink = (id: string) => `${appUrl()}/pay/${id}`;

/** MX status words -> the Pay Center-style status the sync core understands. */
export function mapMxStatus(p: MxPayment): string {
  const s = String(p.status ?? "").toLowerCase();
  if (s === "settled") return "settled";
  if (s === "approved" || s === "authonly" || s === "inprogress") return "captured";
  if (s === "declined") return "declined";
  if (s === "voided") return "voided";
  if (s === "chargedback") return "chargebacked";
  if (s === "returned") return "returned";
  return s || "unknown";
}

export async function getRequest(id: string): Promise<PayRequest | null> {
  const r = ok(await db().from("pay_requests").select("*").eq("id", id).maybeSingle());
  return r ? toRequest(r) : null;
}

export async function getPaymentRow(id: string): Promise<PayPaymentRow | null> {
  const r = ok(await db().from("pay_payments").select("*").eq("id", id).maybeSingle());
  return r ? toPayment(r) : null;
}

export async function paymentsForRequest(requestId: string): Promise<PayPaymentRow[]> {
  const r = ok(await db().from("pay_payments").select("*").eq("request_id", requestId).order("paid_on")) ?? [];
  return (r as any[]).map(toPayment);
}

function mxClientFor(m: Merchant): { client: MxClient; merchantId: string } {
  const cfg = mxConfig();
  if (!cfg) throw new ProviderError("MX Merchant keys are not configured (MX_BASE_URL / MX_CONSUMER_KEY / MX_CONSUMER_SECRET)", true);
  if (!m.mxMerchantId) throw new ProviderError(`${m.name}: MX merchant id is not set`, true);
  return { client: mx(cfg), merchantId: m.mxMerchantId };
}

/** The platform as the sync core sees it. `siteId` is the merchant's own id. */
export function pbsPay(m: Merchant): PayCenterApi {
  return {
    siteId: m.id,
    async addUpdateInvoice(body) {
      const externalId = String(body.externalId);
      const totals = body.totals as { total: number } | undefined;
      const customer = body.customer as { primaryContact?: PayRequest["customer"] } | undefined;
      const existing = ok(await db().from("pay_requests").select("*").eq("merchant_id", m.id).eq("external_id", externalId).maybeSingle());
      const row = {
        merchant_id: m.id,
        external_id: externalId,
        invoice_number: String(body.invoiceNumber ?? ""),
        description: (body.description as string) ?? null,
        total_cents: Number(totals?.total ?? 0),
        due_date: body.dueDate ? String(body.dueDate).slice(0, 10) : null,
        ...(customer?.primaryContact ? { customer: customer.primaryContact } : {}),
        updated_at: new Date().toISOString(),
      };
      let id: string;
      if (existing) {
        id = existing.id;
        ok(await db().from("pay_requests").update(row).eq("id", id));
      } else {
        id = randomSecret(9); // 18 hex chars in the link
        ok(await db().from("pay_requests").insert({ id, ...row }));
      }
      // Pay Center emails the customer itself; here we do, once, when the sync passed a customer along.
      if (!existing && customer?.primaryContact) {
        const req = await getRequest(id);
        const r = req ? await notifyCustomer(m, req) : { sent: false, reason: "request not found" };
        await db().from("sync_log").insert({ merchant_id: m.id, level: r.sent ? "info" : "error", message: r.sent ? `PBS Pay: payment request emailed to ${customer.primaryContact.email}` : `PBS Pay: payment request NOT emailed (${r.reason})`, detail: { requestId: id, link: payLink(id) } });
      }
      return { _id: id, link: payLink(id) };
    },
    async getPayment(id) {
      const row = await getPaymentRow(id);
      if (!row || row.merchantId !== m.id) throw new ProviderError("Unknown PBS Pay payment", true, 404);
      return toPcPayment(row);
    },
    async listPayments(updatedAfter) {
      let q = db().from("pay_payments").select("*").eq("merchant_id", m.id).order("updated_at").limit(100);
      if (updatedAfter) q = q.gt("updated_at", updatedAfter);
      const rows = (ok(await q) ?? []) as any[];
      const records = rows.map((r) => toPcPayment(toPayment(r)));
      return { records, nextUpdatedAfter: rows.length ? rows[rows.length - 1].updated_at : undefined, recordsReturned: rows.length, limit: 100 };
    },
  };
}

/** Our row in the shape the sync core already reads (what Pay Center's API returns). */
export function toPcPayment(row: PayPaymentRow): PcPayment {
  return {
    _id: row.id,
    site: row.merchantId,
    status: row.status,
    type: row.method === "ach" ? "ach" : "payment_card",
    amount: row.totalCents,
    paidOn: row.paidOn,
    isRefund: row.kind === "refund",
    origPayment: row.origPaymentId ?? undefined,
    allocations: row.requestId ? [{ refType: "Invoice", ref: row.requestId, amount: row.invoiceCents }] : [],
    extraFees: row.feeCents,
  };
}

/** The two prices a customer sees for a request. */
export function prices(req: PayRequest, m: Merchant) {
  const fee = cardFeeCents(req.totalCents, m.feeRateBps);
  return { cashCents: req.totalCents, feeCents: fee, cardCents: req.totalCents + fee, feeRateBps: m.feeRateBps };
}

/** A one-time token so the customer's browser can send card details straight to MX. */
export async function browserToken(m: Merchant): Promise<{ token: string; apiBase: string; mxMerchantId: string }> {
  const { client, merchantId } = mxClientFor(m);
  const t = await client.limitedUseToken(merchantId);
  return { token: t.token, apiBase: `${mxConfig()!.baseUrl}/checkout/v3`, mxMerchantId: merchantId };
}

export interface RecordResult { status: string; paymentId?: string; reason?: string; mxStatus?: string }

/**
 * The browser says MX accepted payment <mxPaymentId> for request <req>. Nothing is trusted from the
 * browser: the payment is re-read from MX and must match the merchant and one of the two prices exactly.
 */
export async function recordMxPayment(m: Merchant, req: PayRequest, mxPaymentId: string): Promise<RecordResult> {
  const { client, merchantId } = mxClientFor(m);
  const p = await client.getPayment(mxPaymentId);
  if (String(p.merchantId ?? merchantId) !== String(merchantId)) return { status: "rejected", reason: "Payment belongs to another merchant" };
  const total = mxCents(p.amount);
  const px = prices(req, m);
  const tender = String(p.tenderType ?? "").toLowerCase();
  const method: "card" | "ach" = tender === "ach" || tender === "check" ? "ach" : "card";
  let invoiceCents: number, feeCents: number;
  if (method === "card" && total === px.cardCents) { invoiceCents = px.cashCents; feeCents = px.feeCents; }
  else if (total === px.cashCents) { invoiceCents = px.cashCents; feeCents = 0; }
  else return { status: "rejected", reason: `MX amount ${toDecimal(total)} matches neither the cash price ${toDecimal(px.cashCents)} nor the card price ${toDecimal(px.cardCents)}` };
  if (p.paymentType && String(p.paymentType).toLowerCase() === "return") return { status: "rejected", reason: "Not a sale" };

  const id = `mx:${p.id}`;
  const status = mapMxStatus(p);
  const now = new Date().toISOString();
  const res = await db().from("pay_payments").upsert({
    id, merchant_id: m.id, request_id: req.id, kind: "payment", method, status,
    invoice_cents: invoiceCents, fee_cents: feeCents, total_cents: total,
    mx_payment_id: String(p.id), mx_batch: p.batch != null ? String(p.batch) : null,
    paid_on: p.created ? new Date(p.created).toISOString() : now, raw: p, updated_at: now,
  });
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  if (status === "captured" || status === "settled") {
    ok(await db().from("pay_requests").update({ status: "paid", updated_at: now }).eq("id", req.id));
  }
  return { status: "recorded", paymentId: id, mxStatus: status };
}

/** Re-reads every payment that is not final from MX. Returns the ids whose status changed. */
export async function refreshStatuses(m: Merchant): Promise<string[]> {
  const { client } = mxClientFor(m);
  const rows = (ok(await db().from("pay_payments").select("*").eq("merchant_id", m.id).in("status", ["captured", "unknown"])) ?? []) as any[];
  const changed: string[] = [];
  for (const r of rows) {
    try {
      const p = await client.getPayment(r.mx_payment_id);
      const status = mapMxStatus(p);
      const batch = p.batch != null ? String(p.batch) : r.mx_batch;
      if (status !== r.status || batch !== r.mx_batch) {
        ok(await db().from("pay_payments").update({ status, mx_batch: batch, raw: p, updated_at: new Date().toISOString() }).eq("id", r.id));
        changed.push(r.id);
      }
    } catch (err) {
      await db().from("sync_log").insert({ merchant_id: m.id, level: "error", message: "Could not refresh an MX payment", detail: { id: r.id, error: String(err) } });
    }
  }
  return changed;
}

/** Sends the payment request to the customer by email, through Resend when configured. */
export async function notifyCustomer(m: Merchant, req: PayRequest): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  const to = req.customer?.email;
  if (!to) return { sent: false, reason: "no customer email" };
  if (!key || !from) return { sent: false, reason: "RESEND_API_KEY / MAIL_FROM not set" };
  const px = prices(req, m);
  const link = payLink(req.id);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;line-height:1.5">
<p>${escapeHtml(m.name)} has sent you a payment request for invoice <b>${escapeHtml(req.invoiceNumber)}</b>.</p>
<table style="border-collapse:collapse;margin:16px 0"><tr><td style="padding:4px 12px 4px 0">Pay by bank transfer (ACH)</td><td style="padding:4px 0"><b>$${toDecimal(px.cashCents)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0">Pay by card</td><td style="padding:4px 0"><b>$${toDecimal(px.cardCents)}</b> <span style="color:#666">(includes a ${(px.feeRateBps / 100).toFixed(2).replace(/\\.?0+$/, "")}% card fee)</span></td></tr></table>
<p><a href="${link}" style="display:inline-block;background:#15130f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Pay now</a></p>
<p style="color:#666;font-size:13px">Or open ${link}${req.dueDate ? `<br>Due ${req.dueDate}` : ""}</p></div>`;
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `payreq-${req.id}-${req.totalCents}` },
      body: JSON.stringify({ from, to, subject: `Payment request from ${m.name}: invoice ${req.invoiceNumber}`, html }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { sent: false, reason: `email provider did not respond: ${String(err)}` };
  }
  if (!res.ok) return { sent: false, reason: `email provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  ok(await db().from("pay_requests").update({ notified_at: new Date().toISOString() }).eq("id", req.id));
  return { sent: true };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
