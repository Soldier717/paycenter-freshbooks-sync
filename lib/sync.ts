import { createHash } from "node:crypto";
import { easternDate, toCents, toDecimal } from "./money";
import { Deps, FbInvoice, LedgerRow, PcPayment, ProviderError } from "./types";

const REVERSED = new Set(["returned", "voided", "chargebacked"]);
/** Attempts that never took money. Nothing to post, nothing to wait for. */
const DEAD = new Set(["declined", "failed", "error", "expired", "cancelled", "canceled", "rejected"]);
const REFUND_DONE = new Set(["refunded", "refundSettled"]);
const REFUND_STATES = new Set(["refunded", "refundSettled", "refundRequested", "refundFailed"]);

export interface Result { status: string; [k: string]: unknown }

function fingerprint(body: Record<string, unknown>): string {
  const { webhookUrl: _w, customer: _c, ...core } = body;
  const sorted = Object.entries(core).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function invoiceBody(inv: FbInvoice, accountId: string): Record<string, unknown> {
  return {
    externalId: `freshbooks:${accountId}:${inv.invoiceid}`,
    invoiceNumber: String(inv.invoice_number),
    description: `Payment for invoice ${inv.invoice_number}`,
    totals: { total: toCents(inv.amount.amount) },
    invoiceTermName: null,
    dueDate: String(inv.due_date).slice(0, 10),
    options: { tippingEnabled: false },
  };
}

/** FreshBooks invoice -> Pay Center payment request. Safe to call repeatedly. */
export async function syncInvoice(deps: Deps, fbInvoiceId: string): Promise<Result> {
  const { store, fb, pc, settings } = deps;
  const inv = await fb.getInvoice(fbInvoiceId);
  if (String(inv.invoiceid) !== String(fbInvoiceId)) throw new Error("Invoice ID mismatch");
  const link = await store.getLinkByFb(String(fbInvoiceId));

  if (inv.amount.code !== "USD") return { status: "skipped", reason: "Only USD invoices are supported" };
  const body = invoiceBody(inv, fb.accountId);
  if (settings.webhookUrl) body.webhookUrl = settings.webhookUrl;
  const print = fingerprint(body);

  if (link) {
    if (inv.vis_state !== 0) {
      await store.log("review", "Invoice was deleted in FreshBooks after a payment request was created", { fbInvoiceId });
      return { status: "needs_review", reason: "Invoice deleted after it was linked" };
    }
    if (link.fingerprint === print) return { status: "already_linked", payLink: link.payLink };
    if ((await store.countLedgerForInvoice(link.pcInvoiceId)) > 0) {
      await store.log("review", "Invoice changed in FreshBooks after payments were received", { fbInvoiceId });
      return { status: "needs_review", reason: "Invoice changed after payments were received" };
    }
    await pc.addUpdateInvoice(body);
    await store.updateLink(link.fbInvoiceId, {
      fingerprint: print,
      totalCents: toCents(inv.amount.amount),
      invoiceNumber: String(inv.invoice_number),
    });
    await store.log("info", "Updated Pay Center invoice after a FreshBooks edit", { fbInvoiceId });
    return { status: "updated", payLink: link.payLink };
  }

  if (inv.vis_state !== 0) return { status: "skipped", reason: "Invoice is deleted" };
  if (!["sent", "viewed", "overdue"].includes(inv.v3_status))
    return { status: "skipped", reason: `Invoice status is ${inv.v3_status}` };
  const total = toCents(inv.amount.amount);
  if (total <= 0 || toCents(inv.outstanding.amount) !== total)
    return { status: "skipped", reason: "Invoice must be wholly unpaid when first linked" };

  if (settings.notifyMode === "customer" && inv.customerid) {
    const c = await fb.getClient(String(inv.customerid));
    if (c.email || c.mob_phone) {
      body.customer = {
        externalId: `freshbooks:${fb.accountId}:${inv.customerid}`,
        primaryContact: { firstName: c.fname ?? "", lastName: c.lname ?? "", email: c.email, mobilePhone: c.mob_phone },
      };
    }
  }

  const res = await pc.addUpdateInvoice(body);
  if (!res._id) throw new Error("Pay Center returned no invoice id");
  await store.insertLink({
    fbInvoiceId: String(fbInvoiceId),
    pcInvoiceId: res._id,
    invoiceNumber: String(inv.invoice_number),
    totalCents: total,
    fingerprint: print,
    payLink: res.link ?? null,
  });
  const customer = body.customer as { primaryContact?: { email?: string; mobilePhone?: string } } | undefined;
  await store.log("info", "Linked FreshBooks invoice to Pay Center", {
    fbInvoiceId, pcInvoiceId: res._id,
    customerSent: customer ? { email: !!customer.primaryContact?.email, mobile: !!customer.primaryContact?.mobilePhone } : "no (link only)",
  });
  return { status: "linked", pcInvoiceId: res._id, payLink: res.link ?? null };
}

async function hold(deps: Deps, p: PcPayment, reason: string, pcInvoiceId: string | null = null): Promise<Result> {
  const { store } = deps;
  const existing = await store.getLedger(p._id);
  if (existing) await store.updateLedger(p._id, { state: "review", reason });
  else
    await store.claimLedger({
      pcPaymentId: p._id, pcInvoiceId, kind: p.isRefund ? "refund" : "payment",
      state: "review", fbPaymentId: null, cents: 0, reason,
    });
  await store.log("review", reason, { pcPaymentId: p._id });
  return { status: "needs_review", reason };
}

/** Marks the outcome of a FreshBooks write that failed. Never retried automatically. */
async function failedWrite(deps: Deps, pcPaymentId: string, err: unknown): Promise<Result> {
  const definite = err instanceof ProviderError && err.definite;
  const reason = definite
    ? `FreshBooks rejected the write (${(err as ProviderError).message})`
    : "FreshBooks write outcome unknown; check FreshBooks before retrying";
  await deps.store.updateLedger(pcPaymentId, { state: definite ? "review" : "uncertain", reason });
  await deps.store.log("error", reason, { pcPaymentId });
  return { status: definite ? "needs_review" : "uncertain", reason };
}

/** Pay Center payment -> FreshBooks. Always works from the payment as Pay Center reports it now. */
export async function syncPayment(deps: Deps, pcPaymentId: string): Promise<Result> {
  const { store, fb, pc, settings } = deps;
  const p = await pc.getPayment(pcPaymentId);
  if (p._id !== pcPaymentId || p.site !== pc.siteId) throw new Error("Payment identity or site mismatch");
  const row = await store.getLedger(p._id);

  if (p.isRefund) return syncRefund(deps, p, row);

  if (REVERSED.has(p.status)) {
    if (!row) return { status: "ignored", reason: `Payment ${p.status} before it was ever posted` };
    if (row.state === "reversed") return { status: "already_reversed" };
    if (row.state === "resolved") return { status: "resolved", reason: row.reason };
    if (row.state !== "posted" || !row.fbPaymentId) return { status: "needs_review", reason: row.reason };
    if (settings.reversals !== "auto")
      return hold(deps, p, `Payment ${p.status} after it was posted to FreshBooks; reverse it there`);
    try {
      await fb.deletePayment(row.fbPaymentId);
    } catch (err) {
      return failedWrite(deps, p._id, err);
    }
    await store.updateLedger(p._id, { state: "reversed", reason: `Payment ${p.status}` });
    await store.log("info", `Removed FreshBooks payment after it was ${p.status}`, { pcPaymentId });
    return { status: "reversed" };
  }

  // A refund arrives as its own payment record, so the original needs no action here.
  if (REFUND_STATES.has(p.status)) return { status: "ignored", reason: "Handled by the refund record" };

  if (DEAD.has(p.status)) {
    // A declined attempt that was somehow posted earlier is a problem worth a human's eyes.
    if (row && row.state === "posted") return hold(deps, p, `Payment is now ${p.status} but was posted to FreshBooks`);
    return { status: "declined", providerStatus: p.status };
  }

  const ready = p.status === "settled" || (settings.recordOn === "captured" && p.status === "captured");
  if (!ready) return { status: "waiting", providerStatus: p.status };

  if (row) {
    if (row.state === "posted") return { status: "already_posted", fbPaymentId: row.fbPaymentId };
    if (row.state === "resolved") return { status: "resolved", reason: row.reason };
    return { status: row.state === "posting" ? "in_progress" : "needs_review", reason: row.reason };
  }

  if (!["payment_card", "ach"].includes(p.type)) return hold(deps, p, `Unsupported payment type ${p.type}`);
  const allocs = p.allocations ?? [];
  if (allocs.length !== 1 || allocs[0].refType !== "Invoice")
    return hold(deps, p, "Payment is not allocated to exactly one invoice");
  const applied = allocs[0].amount;
  if (!Number.isInteger(applied) || applied <= 0 || applied > p.amount)
    return hold(deps, p, "Invoice allocation is not a valid amount");

  const link = await store.getLinkByPc(allocs[0].ref);
  if (!link) return hold(deps, p, "Payment is for an invoice this service did not create", allocs[0].ref);

  const inv = await fb.getInvoice(link.fbInvoiceId);
  if (inv.vis_state !== 0 || inv.outstanding.code !== "USD")
    return hold(deps, p, "FreshBooks invoice is deleted or not in USD", link.pcInvoiceId);
  if (applied > toCents(inv.outstanding.amount))
    return hold(deps, p, "Payment is more than the FreshBooks balance; another payment may have been recorded", link.pcInvoiceId);

  // Record the intent first, so a crash or a second notification can never post twice.
  const claimed = await store.claimLedger({
    pcPaymentId: p._id, pcInvoiceId: link.pcInvoiceId, kind: "payment",
    state: "posting", fbPaymentId: null, cents: applied, reason: null,
  });
  if (!claimed) return { status: "in_progress" };

  let fbPaymentId: string;
  try {
    const created = await fb.createPayment({
      invoiceid: Number(link.fbInvoiceId),
      amount: { amount: toDecimal(applied), code: "USD" }, // fees and tips are never included
      date: easternDate(p.paidOn),
      type: "Other",
      note: `Pay Center ${p.type === "ach" ? "ACH" : "card"} payment ${p._id}`,
      send_client_notification: false,
    });
    fbPaymentId = created.id;
  } catch (err) {
    return failedWrite(deps, p._id, err);
  }
  await store.updateLedger(p._id, { state: "posted", fbPaymentId });
  await store.log("info", "Posted payment to FreshBooks", { pcPaymentId, fbPaymentId, cents: applied });
  return { status: "posted", fbPaymentId, cents: applied };
}

async function syncRefund(deps: Deps, p: PcPayment, row: LedgerRow | null): Promise<Result> {
  const { store, fb, settings } = deps;
  if (!REFUND_DONE.has(p.status)) return { status: "waiting", providerStatus: p.status };
  if (row) return { status: row.state === "applied" ? "already_applied" : "needs_review", reason: row.reason };

  const orig = p.origPayment ? await store.getLedger(p.origPayment) : null;
  if (!orig) return { status: "ignored", reason: "Refund of a payment that was never posted" };
  if (orig.state !== "posted" || !orig.fbPaymentId)
    return hold(deps, p, "Refund of a payment that is not cleanly posted", orig.pcInvoiceId);
  if (settings.reversals !== "auto")
    return hold(deps, p, "Refund issued after the payment was posted to FreshBooks; adjust it there", orig.pcInvoiceId);

  const allocs = p.allocations ?? [];
  const refunded = allocs.length === 1 ? allocs[0].amount : p.amount;
  if (!Number.isInteger(refunded) || refunded <= 0) return hold(deps, p, "Refund amount is not valid", orig.pcInvoiceId);

  const claimed = await store.claimLedger({
    pcPaymentId: p._id, pcInvoiceId: orig.pcInvoiceId, kind: "refund",
    state: "posting", fbPaymentId: orig.fbPaymentId, cents: refunded, reason: null,
  });
  if (!claimed) return { status: "in_progress" };

  const remaining = orig.cents - refunded;
  try {
    if (remaining <= 0) await fb.deletePayment(orig.fbPaymentId);
    else await fb.updatePaymentAmount(orig.fbPaymentId, { amount: toDecimal(remaining), code: "USD" });
  } catch (err) {
    return failedWrite(deps, p._id, err);
  }
  await store.updateLedger(orig.pcPaymentId, remaining <= 0 ? { state: "reversed", reason: "Fully refunded" } : { cents: remaining });
  await store.updateLedger(p._id, { state: "applied" });
  await store.log("info", "Applied refund to FreshBooks", { pcPaymentId: p._id, refunded, remaining: Math.max(remaining, 0) });
  return { status: "refund_applied", remainingCents: Math.max(remaining, 0) };
}

/** Catches anything a webhook missed. Walks Pay Center payments changed since the last run. */
export async function reconcile(deps: Deps, opts: { full?: boolean } = {}): Promise<Result> {
  const { store, pc } = deps;
  // full = look back as far as Pay Center allows (7 days) and leave the saved position alone.
  let cursor = opts.full ? null : await store.getKv("pc_payments_cursor");
  const counts: Record<string, number> = {};
  const payments: { id: string; providerStatus: string; type: string; result: string }[] = [];
  for (let page = 0; page < 25; page++) {
    const res = await pc.listPayments(cursor);
    for (const rec of res.records ?? []) {
      let status: string;
      try {
        status = (await syncPayment(deps, rec._id)).status;
      } catch (err) {
        status = "error";
        await store.log("error", "Reconcile could not process a payment", { pcPaymentId: rec._id, error: String(err) });
      }
      counts[status] = (counts[status] ?? 0) + 1;
      payments.push({ id: rec._id, providerStatus: rec.status, type: rec.type, result: status });
    }
    if (res.nextUpdatedAfter) {
      cursor = res.nextUpdatedAfter;
      if (!opts.full) await store.setKv("pc_payments_cursor", cursor);
    }
    if (!res.limit || (res.recordsReturned ?? 0) < res.limit) break;
  }
  return { status: "done", counts, payments };
}
