import { describe, expect, it } from "vitest";
import { webhookSignature } from "@/lib/freshbooks";
import { easternDate, toCents, toDecimal } from "@/lib/money";
import { reconcile, syncInvoice, syncPayment } from "@/lib/sync";
import { ProviderError } from "@/lib/types";
import { world } from "./helpers";

describe("invoice -> Pay Center", () => {
  it("links a sent invoice once, in cents, without contacting the customer", async () => {
    const w = world();
    expect((await syncInvoice(w.deps, "7")).status).toBe("linked");
    expect((await syncInvoice(w.deps, "7")).status).toBe("already_linked");
    expect(w.pcInvoices).toHaveLength(1);
    expect(w.pcInvoices[0]).toMatchObject({ externalId: "freshbooks:acct:7", totals: { total: 10000 }, webhookUrl: "https://app.test/hook/s" });
    expect(w.pcInvoices[0]).not.toHaveProperty("customer");
    expect(w.links[0].payLink).toBe("https://pay.example.invalid/abc");
  });

  it("sends the customer only in customer mode", async () => {
    const w = world({ notifyMode: "customer" });
    await syncInvoice(w.deps, "7");
    expect(w.pcInvoices[0]).toMatchObject({ customer: { primaryContact: { email: "pat@example.invalid" } } });
  });

  it("skips drafts, partly paid, non-USD and deleted invoices", async () => {
    for (const change of [
      (w: ReturnType<typeof world>) => (w.invoice.v3_status = "draft"),
      (w: ReturnType<typeof world>) => (w.invoice.outstanding.amount = "50.00"),
      (w: ReturnType<typeof world>) => (w.invoice.amount.code = "CAD"),
      (w: ReturnType<typeof world>) => (w.invoice.vis_state = 1),
    ]) {
      const w = world();
      change(w);
      expect((await syncInvoice(w.deps, "7")).status).toBe("skipped");
      expect(w.pcInvoices).toHaveLength(0);
    }
  });

  it("pushes an edit before any payment, and stops for review after one", async () => {
    const w = world();
    await syncInvoice(w.deps, "7");
    w.invoice.due_date = "2026-11-10";
    expect((await syncInvoice(w.deps, "7")).status).toBe("updated");
    expect(w.pcInvoices).toHaveLength(2);
    w.pay();
    await syncPayment(w.deps, "pay1");
    w.invoice.due_date = "2026-12-01";
    expect((await syncInvoice(w.deps, "7")).status).toBe("needs_review");
    expect(w.pcInvoices).toHaveLength(2);
  });

  it("does not loop when our own payment changes the invoice balance", async () => {
    const w = world();
    await syncInvoice(w.deps, "7");
    w.pay();
    await syncPayment(w.deps, "pay1");
    w.invoice.v3_status = "paid";
    expect((await syncInvoice(w.deps, "7")).status).toBe("already_linked");
    expect(w.pcInvoices).toHaveLength(1);
  });
});

describe("payment -> FreshBooks", () => {
  const linked = async (o = {}) => {
    const w = world(o);
    await syncInvoice(w.deps, "7");
    return w;
  };

  it("posts the invoice allocation only, never the fee, and only once", async () => {
    const w = await linked();
    w.pay(); // paid 103.00, 100.00 allocated to the invoice
    expect(await syncPayment(w.deps, "pay1")).toMatchObject({ status: "posted", cents: 10000 });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("already_posted");
    expect(w.fbCalls.create).toBe(1);
    const posted = [...w.fbPayments.values()][0].body;
    expect(posted).toMatchObject({ invoiceid: 7, amount: { amount: "100.00", code: "USD" }, date: "2026-10-12", type: "Other", send_client_notification: false });
    expect(w.invoice.outstanding.amount).toBe("0.00");
  });

  it("waits for ACH to settle", async () => {
    const w = await linked();
    w.pay({ type: "ach", status: "captured" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("waiting");
    expect(w.fbCalls.create).toBe(0);
    w.pay({ type: "ach", status: "settled" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("posted");
  });

  it("can post on capture when configured", async () => {
    const w = await linked({ recordOn: "captured" });
    w.pay({ status: "captured" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("posted");
    w.pay({ status: "settled" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("already_posted");
    expect(w.fbCalls.create).toBe(1);
  });

  it("handles partial payments", async () => {
    const w = await linked();
    w.pay({ amount: 4120, allocations: [{ refType: "Invoice", ref: "pc7", amount: 4000 }] });
    w.pay({ _id: "pay2", amount: 6180, allocations: [{ refType: "Invoice", ref: "pc7", amount: 6000 }] });
    await syncPayment(w.deps, "pay1");
    expect(w.invoice.outstanding.amount).toBe("60.00");
    await syncPayment(w.deps, "pay2");
    expect(w.invoice.outstanding.amount).toBe("0.00");
  });

  it("two notifications at once post one payment", async () => {
    const w = await linked();
    w.pay();
    const results = await Promise.all([syncPayment(w.deps, "pay1"), syncPayment(w.deps, "pay1")]);
    expect(results.map((r) => r.status).sort()).toEqual(["in_progress", "posted"]);
    expect(w.fbCalls.create).toBe(1);
  });

  it("holds overpayments, unknown invoices, multiple allocations and wrong sites", async () => {
    let w = await linked();
    w.invoice.outstanding.amount = "20.00";
    w.pay();
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");

    w = await linked();
    w.pay({ allocations: [{ refType: "Invoice", ref: "other", amount: 10000 }] });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");

    w = await linked();
    w.pay({ allocations: [{ refType: "Invoice", ref: "pc7", amount: 5000 }, { refType: "Invoice", ref: "x", amount: 5000 }] });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");
    expect(w.fbCalls.create).toBe(0);
    expect(await w.deps.store.listAttention()).toHaveLength(1);

    w = await linked();
    w.pay({ site: "someone-else" });
    await expect(syncPayment(w.deps, "pay1")).rejects.toThrow();
  });

  it("never reposts after a timeout, and flags a clear rejection for review", async () => {
    let w = await linked();
    w.pay();
    w.fail.create = new ProviderError("timeout", false);
    expect((await syncPayment(w.deps, "pay1")).status).toBe("uncertain");
    w.fail.create = null;
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");
    expect(w.fbCalls.create).toBe(1);

    w = await linked();
    w.pay();
    w.fail.create = new ProviderError("HTTP 422", true, 422);
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");
    expect(w.ledger.get("pay1")!.state).toBe("review");
  });
});

describe("returns and refunds", () => {
  const posted = async (o = {}) => {
    const w = world(o);
    await syncInvoice(w.deps, "7");
    w.pay({ type: "ach" });
    await syncPayment(w.deps, "pay1");
    return w;
  };

  it("by default, a returned ACH waits for a person and FreshBooks is untouched", async () => {
    const w = await posted();
    w.pay({ type: "ach", status: "returned" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");
    expect(w.fbCalls.del).toBe(0);
    expect(w.ledger.get("pay1")!.state).toBe("review");
  });

  it("in auto mode, a returned ACH reopens the invoice once", async () => {
    const w = await posted({ reversals: "auto" });
    w.pay({ type: "ach", status: "returned" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("reversed");
    expect((await syncPayment(w.deps, "pay1")).status).toBe("already_reversed");
    expect(w.fbCalls.del).toBe(1);
    expect(w.invoice.outstanding.amount).toBe("100.00");
  });

  it("ignores a void of a payment that was never posted", async () => {
    const w = world();
    await syncInvoice(w.deps, "7");
    w.pay({ status: "voided" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("ignored");
  });

  it("refunds wait for review by default", async () => {
    const w = await posted();
    w.pay({ _id: "ref1", isRefund: true, origPayment: "pay1", status: "refunded", amount: 2500, allocations: [{ refType: "Invoice", ref: "pc7", amount: 2500 }] });
    expect((await syncPayment(w.deps, "ref1")).status).toBe("needs_review");
    expect(w.fbCalls.update + w.fbCalls.del).toBe(0);
  });

  it("in auto mode, a partial refund reduces the payment once and a full refund removes it", async () => {
    const w = await posted({ reversals: "auto" });
    w.pay({ _id: "ref1", isRefund: true, origPayment: "pay1", status: "refunded", amount: 2500, allocations: [{ refType: "Invoice", ref: "pc7", amount: 2500 }] });
    expect(await syncPayment(w.deps, "ref1")).toMatchObject({ status: "refund_applied", remainingCents: 7500 });
    expect((await syncPayment(w.deps, "ref1")).status).toBe("already_applied");
    expect(w.fbCalls.update).toBe(1);
    expect(w.invoice.outstanding.amount).toBe("25.00");
    w.pay({ _id: "ref2", isRefund: true, origPayment: "pay1", status: "refundSettled", amount: 7500, allocations: [{ refType: "Invoice", ref: "pc7", amount: 7500 }] });
    expect(await syncPayment(w.deps, "ref2")).toMatchObject({ status: "refund_applied", remainingCents: 0 });
    expect(w.invoice.outstanding.amount).toBe("100.00");
  });

  it("does nothing for the original payment when it is marked refunded", async () => {
    const w = await posted({ reversals: "auto" });
    w.pay({ type: "ach", status: "refunded" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("ignored");
    expect(w.fbCalls.del).toBe(0);
  });
});

describe("reconcile and helpers", () => {
  it("picks up a payment whose webhook never arrived and saves the cursor", async () => {
    const w = world();
    await syncInvoice(w.deps, "7");
    w.pay();
    expect(await reconcile(w.deps)).toMatchObject({ counts: { posted: 1 } });
    expect(await reconcile(w.deps)).toMatchObject({ counts: { already_posted: 1 } });
    expect(w.kv.get("pc_payments_cursor")).toBe("2026-10-12T00:00:00.000Z");
    expect(w.fbCalls.create).toBe(1);
  });

  it("converts money exactly", () => {
    expect(toCents("10.29")).toBe(1029);
    expect(toCents("1150.1")).toBe(115010);
    expect(toDecimal(1029)).toBe("10.29");
    expect(toDecimal(5)).toBe("0.05");
    for (const bad of ["10.001", "NaN", "-5", "1e3"]) expect(() => toCents(bad)).toThrow();
  });

  it("dates a late-evening UTC payment on the Eastern calendar day", () => {
    expect(easternDate("2026-10-13T02:30:00Z")).toBe("2026-10-12");
  });

  it("matches a FreshBooks webhook signature computed with Python", () => {
    const params: [string, string][] = [
      ["name", "invoice.create"], ["object_id", "1234567"], ["account_id", "6BApk"],
      ["business_id", "6543"], ["identity_id", "1234"], ["user_id", "1"],
    ];
    expect(webhookSignature(params, "scADVVi5QuKuj5qTjVkbJNYQe7V7USpGd")).toBe("/S03vyYmI7CekM4YXBHUhs9o5rnMtqGLrW3aA8S9gPc=");
  });
});
