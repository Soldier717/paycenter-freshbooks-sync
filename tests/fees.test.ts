import { describe, expect, it } from "vitest";
import { feeFor, syncInvoice, syncPayment } from "@/lib/sync";
import { PcPayment, ProviderError } from "@/lib/types";
import { world } from "./helpers";

const p = (over: Partial<PcPayment>): PcPayment => ({
  _id: "x", site: "s", status: "settled", type: "payment_card", amount: 10300, paidOn: "2026-10-12T15:00:00Z",
  allocations: [{ refType: "Invoice", ref: "pc7", amount: 10000 }], ...over,
});

describe("fee figure", () => {
  it("is what the customer paid beyond the invoice, in whole cents, never a percentage", () => {
    expect(feeFor(p({ amount: 10300 }), 10000)).toBe(300);
    expect(feeFor(p({ amount: 3433 }), 3333)).toBe(100); // 3% of 33.33 is 99.99 cents; Pay Center charged 100 and that is what gets booked
    expect(feeFor(p({ amount: 10000 }), 10000)).toBe(0);
  });

  it("uses Pay Center's own fee field when present, and refuses when the parts disagree", () => {
    expect(feeFor(p({ amount: 10300, extraFees: 300 }), 10000)).toBe(300);
    expect(feeFor(p({ amount: 10300, extra_fees: 300 }), 10000)).toBe(300);
    expect(feeFor(p({ amount: 10300, extraFees: 299 }), 10000)).toBeNull();
    expect(feeFor(p({ amount: 10300, tip: 100, extraFees: 200 }), 10000)).toBe(200);
    expect(feeFor(p({ amount: 9900 }), 10000)).toBeNull();
  });
});

describe("fee booking", () => {
  const linked = async (o = {}, fees = true) => {
    const w = world({ bookFees: true, ...o }, { fees });
    await syncInvoice(w.deps, "7");
    return w;
  };

  it("books the fee as its own record after the invoice payment", async () => {
    const w = await linked();
    w.pay();
    expect(await syncPayment(w.deps, "pay1")).toMatchObject({ status: "posted", cents: 10000, feeCents: 300 });
    expect(w.acctCalls).toMatchObject({ create: 1, fee: 1 });
    const fee = [...w.fees.values()][0].body;
    expect(fee).toMatchObject({ cents: 300, date: "2026-10-12", customerId: "55", invoiceNumber: "TEST-7" });
    expect(w.invoice.balanceCents).toBe(0); // the fee never touches the invoice
    expect((await w.store.getLedger("pay1"))!).toMatchObject({ state: "posted", feeCents: 300, feeTxnId: expect.stringMatching(/^fee/) });
  });

  it("books nothing when there was no fee (ACH)", async () => {
    const w = await linked();
    w.pay({ type: "ach", amount: 10000 });
    expect(await syncPayment(w.deps, "pay1")).toMatchObject({ status: "posted", feeCents: 0 });
    expect(w.acctCalls.fee).toBe(0);
  });

  it("holds the whole payment, writing nothing, when Pay Center's figures do not add up", async () => {
    const w = await linked();
    w.pay({ amount: 10300, extraFees: 250 });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");
    expect(w.acctCalls).toMatchObject({ create: 0, fee: 0 });
  });

  it("leaves the payment posted and asks for a person when only the fee write fails", async () => {
    const w = await linked();
    w.fail.fee = new ProviderError("QuickBooks said no", true);
    w.pay();
    const r = await syncPayment(w.deps, "pay1");
    expect(r.status).toBe("needs_review");
    expect(r.acctPaymentId).toBeDefined();
    expect((await w.store.getLedger("pay1"))!).toMatchObject({ state: "review", feeTxnId: null });
    expect(w.invoice.balanceCents).toBe(0);
  });

  it("is off when the merchant has not turned it on, or the system cannot book fees", async () => {
    const a = await linked({ bookFees: false });
    a.pay();
    expect(await syncPayment(a.deps, "pay1")).toMatchObject({ status: "posted", feeCents: 0 });
    expect(a.acctCalls.fee).toBe(0);
    const b = await linked({}, false);
    b.pay();
    expect(await syncPayment(b.deps, "pay1")).toMatchObject({ status: "posted", feeCents: 0 });
  });

  it("removes the fee record with the payment on an automatic reversal", async () => {
    const w = await linked({ reversals: "auto" });
    w.pay();
    await syncPayment(w.deps, "pay1");
    w.pay({ status: "returned" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("reversed");
    expect(w.acctCalls).toMatchObject({ del: 1, feeDel: 1 });
  });
});
