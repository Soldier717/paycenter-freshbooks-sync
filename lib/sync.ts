import { createHash } from "node:crypto";
import { easternDate } from "./money";
import { AcctInvoice, Deps, LedgerRow, PcPayment, ProviderError } from "./types";

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

function invoiceBody(inv: AcctInvoice, kind: string, accountId: string): Record<string, unknown> {
  return {
    externalId: `${kind}:${accountId}:${inv.id}`,
    invoiceNumber: String(inv.number),
    description: `Payment for invoice ${inv.number}`,
    totals: { total: inv.totalCents },
    invoiceTermName: null,
    dueDate: String(inv.dueDate).slice(0, 10),
    options: { tippingEnabled: false },
  };
}

/** Accounting invoice -> Pay Center payment request. Safe to call repeatedly. */
export async function syncInvoice(deps: Deps, invoiceId: string): Promise<Result> {
  const { store, acct, pc, settings } = deps;
  const inv = await acct.getInvoice(invoiceId);
  if (String(inv.id) !== String(invoiceId)) throw new Error("Invoice ID mismatch");
  const link = await store.getLinkByAcct(String(invoiceId));

  if (!inv.deleted && inv.currency !== "USD") return { status: "skipped", reason: "Only USD invoices are supported" };
  const body = invoiceBody(inv, acct.kind, acct.accountId);
  if (settings.webhookUrl) body.webhookUrl = settings.webhookUrl;
  const print = fingerprint(body);

  if (link) {
    if (inv.deleted) {
      await store.log("review", "Invoice was deleted or voided after a payment request was created", { invoiceId });
      return { status: "needs_review", reason: "Invoice deleted after it was linked" };
    }
    if (link.fingerprint === print) return { status: "already_linked", payLink: link.payLink };
    if ((await store.countLedgerForInvoice(link.pcInvoiceId)) > 0) {
      await store.log("review", "Invoice changed after payments were received", { invoiceId });
      return { status: "needs_review", reason: "Invoice changed after payments were received" };
    }
    await pc.addUpdateInvoice(body);
    await store.updateLink(link.acctInvoiceId, {
      fingerprint: print,
      totalCents: inv.totalCents,
      invoiceNumber: String(inv.number),
    });
    await store.log("info", "Updated Pay Center invoice after an edit", { invoiceId });
    return { status: "updated", payLink: link.payLink };
  }

  if (inv.deleted) return { status: "skipped", reason: "Invoice is deleted" };
  if (!inv.sendable) return { status: "skipped", reason: `Invoice status is ${inv.status}` };
  const total = inv.totalCents;
  if (total <= 0 || inv.balanceCents !== total)
    return { status: "skipped", reason: "Invoice must be wholly unpaid when first linked" };

  if (settings.notifyMode === "customer" && inv.customerId) {
    const c = await acct.getCustomer(String(inv.customerId));
    if (c.email || c.mobilePhone) {
      body.customer = {
        externalId: `${acct.kind}:${acct.accountId}:${inv.customerId}`,
        primaryContact: { firstName: c.firstName ?? "", lastName: c.lastName ?? "", email: c.email, mobilePhone: c.mobilePhone },
      };
    }
  }

  const res = await pc.addUpdateInvoice(body);
  if (!res._id) throw new Error("Pay Center returned no invoice id");
  await store.insertLink({
    acctInvoiceId: String(invoiceId),
    pcInvoiceId: res._id,
    invoiceNumber: String(inv.number),
    totalCents: total,
    fingerprint: print,
    payLink: res.link ?? null,
  });
  const customer = body.customer as { primaryContact?: { email?: string; mobilePhone?: string } } | undefined;
  await store.log("info", `Linked ${acct.kind === "quickbooks" ? "QuickBooks" : "FreshBooks"} invoice to Pay Center`, {
    invoiceId, pcInvoiceId: res._id,
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
      state: "review", acctPaymentId: null, cents: 0, feeCents: 0, feeTxnId: null, reason,
    });
  await store.log("review", reason, { pcPaymentId: p._id });
  return { status: "needs_review", reason };
}

/** Marks the outcome of an accounting write that failed. Never retried automatically. */
async function failedWrite(deps: Deps, pcPaymentId: string, err: unknown): Promise<Result> {
  const definite = err instanceof ProviderError && err.definite;
  const system = deps.acct.kind === "quickbooks" ? "QuickBooks" : "FreshBooks";
  const reason = definite
    ? `${system} rejected the write (${(err as ProviderError).message})`
    : `${system} write outcome unknown; check ${system} before retrying`;
  await deps.store.updateLedger(pcPaymentId, { state: definite ? "review" : "uncertain", reason });
  await deps.store.log("error", reason, { pcPaymentId });
  return { status: definite ? "needs_review" : "uncertain", reason };
}

/**
 * The customer fee on a payment, in cents, exactly as Pay Center reports it. Nothing is computed from a
 * percentage: when Pay Center reports the fee itself that figure is used; otherwise the fee is the whole
 * of what the customer paid beyond the invoice allocation (tipping is off on every request we create).
 * Returns null when the figures Pay Center reports do not add up, so nothing gets booked on a guess.
 */
export function feeFor(p: PcPayment, applied: number): number | null {
  const reported = [p.extraFees, p.extra_fees].find((v) => typeof v === "number") as number | undefined;
  const tip = typeof p.tip === "number" ? p.tip : 0;
  const rest = p.amount - applied - tip;
  if (!Number.isInteger(rest) || rest < 0) return null;
  if (reported !== undefined) return Number.isInteger(reported) && reported === rest ? reported : null;
  return rest;
}

/** Pay Center payment -> accounting system. Always works from the payment as Pay Center reports it now. */
export async function syncPayment(deps: Deps, pcPaymentId: string): Promise<Result> {
  const { store, acct, pc, settings } = deps;
  const p = await pc.getPayment(pcPaymentId);
  if (p._id !== pcPaymentId || p.site !== pc.siteId) throw new Error("Payment identity or site mismatch");
  const row = await store.getLedger(p._id);

  if (p.isRefund) return syncRefund(deps, p, row);

  if (REVERSED.has(p.status)) {
    if (!row) return { status: "ignored", reason: `Payment ${p.status} before it was ever posted` };
    if (row.state === "reversed") return { status: "already_reversed" };
    if (row.state === "resolved") return { status: "resolved", reason: row.reason };
    if (row.state !== "posted" || !row.acctPaymentId) return { status: "needs_review", reason: row.reason };
    if (settings.reversals !== "auto")
      return hold(deps, p, `Payment ${p.status} after it was posted; reverse it in the accounting system`);
    try {
      await acct.deletePayment(row.acctPaymentId);
      if (row.feeTxnId && acct.deleteFee) await acct.deleteFee(row.feeTxnId);
    } catch (err) {
      return failedWrite(deps, p._id, err);
    }
    await store.updateLedger(p._id, { state: "reversed", reason: `Payment ${p.status}` });
    await store.log("info", `Removed the posted payment after it was ${p.status}`, { pcPaymentId, feeRemoved: !!(row.feeTxnId && acct.deleteFee) });
    return { status: "reversed" };
  }

  // A refund arrives as its own payment record, so the original needs no action here.
  if (REFUND_STATES.has(p.status)) return { status: "ignored", reason: "Handled by the refund record" };

  if (DEAD.has(p.status)) {
    // A declined attempt that was somehow posted earlier is a problem worth a human's eyes.
    if (row && row.state === "posted") return hold(deps, p, `Payment is now ${p.status} but was posted to the accounting system`);
    return { status: "declined", providerStatus: p.status };
  }

  const ready = p.status === "settled" || (settings.recordOn === "captured" && p.status === "captured");
  if (!ready) return { status: "waiting", providerStatus: p.status };

  if (row) {
    if (row.state === "posted") return { status: "already_posted", acctPaymentId: row.acctPaymentId };
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

  const inv = await acct.getInvoice(link.acctInvoiceId);
  if (inv.deleted || inv.currency !== "USD")
    return hold(deps, p, "Invoice is deleted or not in USD", link.pcInvoiceId);
  if (applied > inv.balanceCents)
    return hold(deps, p, "Payment is more than the invoice balance; another payment may have been recorded", link.pcInvoiceId);

  // The fee is settled before anything is written, so a payment whose parts do not add up is held whole.
  const wantFee = settings.bookFees && !!acct.createFee;
  const fee = feeFor(p, applied);
  if (wantFee && fee === null)
    return hold(deps, p, "Pay Center's invoice amount and fee do not add up to the amount paid; nothing booked", link.pcInvoiceId);

  // Record the intent first, so a crash or a second notification can never post twice.
  const claimed = await store.claimLedger({
    pcPaymentId: p._id, pcInvoiceId: link.pcInvoiceId, kind: "payment",
    state: "posting", acctPaymentId: null, cents: applied, feeCents: wantFee ? fee ?? 0 : 0, feeTxnId: null, reason: null,
  });
  if (!claimed) return { status: "in_progress" };

  const method = p.type === "ach" ? "ach" : "card";
  const date = easternDate(p.paidOn);
  let acctPaymentId: string;
  try {
    const created = await acct.createPayment({
      invoiceId: link.acctInvoiceId,
      customerId: inv.customerId,
      cents: applied, // fees and tips are never part of the invoice payment
      date,
      method,
      note: `Pay Center ${method === "ach" ? "ACH" : "card"} payment ${p._id}`,
    });
    acctPaymentId = created.id;
  } catch (err) {
    return failedWrite(deps, p._id, err);
  }
  await store.updateLedger(p._id, { state: "posted", acctPaymentId });
  await store.log("info", "Posted payment", {
    pcPaymentId, acctPaymentId, cents: applied, feeCents: fee,
    // What Pay Center reported, so the fee field names can be confirmed from a real payment.
    reported: { fields: Object.keys(p), amount: p.amount, extraFees: p.extraFees ?? p.extra_fees ?? null, tip: p.tip ?? null },
  });

  // The fee is its own record in its own income account. Its failure never un-posts the payment.
  let feeTxnId: string | null = null;
  if (wantFee && fee && fee > 0) {
    try {
      feeTxnId = (await acct.createFee!({
        customerId: inv.customerId, cents: fee, date, invoiceNumber: link.invoiceNumber,
        note: `${method === "ach" ? "ACH" : "Card"} fee on invoice ${link.invoiceNumber}, Pay Center payment ${p._id}`,
      })).id;
      await store.updateLedger(p._id, { feeTxnId });
      await store.log("info", "Booked customer fee", { pcPaymentId, feeTxnId, feeCents: fee });
    } catch (err) {
      const reason = `Payment posted, but the ${fee / 100} fee could not be booked (${(err as Error).message}); add it by hand`;
      await store.updateLedger(p._id, { state: "review", reason });
      await store.log("error", reason, { pcPaymentId });
      return { status: "needs_review", reason, acctPaymentId, cents: applied };
    }
  }
  return { status: "posted", acctPaymentId, cents: applied, feeCents: feeTxnId ? fee : 0, feeTxnId };
}

async function syncRefund(deps: Deps, p: PcPayment, row: LedgerRow | null): Promise<Result> {
  const { store, acct, settings } = deps;
  if (!REFUND_DONE.has(p.status)) return { status: "waiting", providerStatus: p.status };
  if (row) return { status: row.state === "applied" ? "already_applied" : "needs_review", reason: row.reason };

  const orig = p.origPayment ? await store.getLedger(p.origPayment) : null;
  if (!orig) return { status: "ignored", reason: "Refund of a payment that was never posted" };
  if (orig.state !== "posted" || !orig.acctPaymentId)
    return hold(deps, p, "Refund of a payment that is not cleanly posted", orig.pcInvoiceId);
  if (settings.reversals !== "auto")
    return hold(deps, p, "Refund issued after the payment was posted; adjust the accounting system", orig.pcInvoiceId);

  const allocs = p.allocations ?? [];
  const refunded = allocs.length === 1 ? allocs[0].amount : p.amount;
  if (!Number.isInteger(refunded) || refunded <= 0) return hold(deps, p, "Refund amount is not valid", orig.pcInvoiceId);

  const claimed = await store.claimLedger({
    pcPaymentId: p._id, pcInvoiceId: orig.pcInvoiceId, kind: "refund",
    state: "posting", acctPaymentId: orig.acctPaymentId, cents: refunded, feeCents: 0, feeTxnId: null, reason: null,
  });
  if (!claimed) return { status: "in_progress" };

  const remaining = orig.cents - refunded;
  try {
    if (remaining <= 0) await acct.deletePayment(orig.acctPaymentId);
    else await acct.updatePaymentAmount(orig.acctPaymentId, remaining);
  } catch (err) {
    return failedWrite(deps, p._id, err);
  }
  await store.updateLedger(orig.pcPaymentId, remaining <= 0 ? { state: "reversed", reason: "Fully refunded" } : { cents: remaining });
  await store.updateLedger(p._id, { state: "applied" });
  await store.log("info", "Applied refund", {
    pcPaymentId: p._id, refunded, remaining: Math.max(remaining, 0),
    feeNote: orig.feeTxnId ? "The booked fee was left as is; adjust it by hand if Pay Center refunded the fee too" : undefined,
  });
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
