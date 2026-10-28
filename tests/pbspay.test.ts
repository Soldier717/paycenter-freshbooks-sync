import { describe, expect, it } from "vitest";
import { cardFeeCents, mapMxStatus, toPcPayment } from "@/lib/pbspay";
import { mxCents } from "@/lib/mx";
import { feeFor } from "@/lib/sync";

describe("PBS Pay prices", () => {
  it("computes the card fee once, in whole cents, rounded half-up", () => {
    expect(cardFeeCents(10000, 300)).toBe(300);
    expect(cardFeeCents(3333, 300)).toBe(100);  // 99.99 cents -> 100
    expect(cardFeeCents(3316, 300)).toBe(99);   // 99.48 -> 99
    expect(cardFeeCents(3317, 300)).toBe(100);  // 99.51 -> 100
    expect(cardFeeCents(1, 300)).toBe(0);
    expect(cardFeeCents(10000, 0)).toBe(0);
    expect(cardFeeCents(10000, 350)).toBe(350);
  });

  it("reads MX dollar amounts exactly", () => {
    expect(mxCents("103.00")).toBe(10300);
    expect(mxCents(103)).toBe(10300);
    expect(mxCents("0.01")).toBe(1);
    expect(mxCents("-5.5")).toBe(-550);
    expect(() => mxCents("1.005")).toThrow();
  });

  it("maps MX statuses onto the sync core's words", () => {
    expect(mapMxStatus({ id: 1, status: "Approved", amount: 1 })).toBe("captured");
    expect(mapMxStatus({ id: 1, status: "Settled", amount: 1 })).toBe("settled");
    expect(mapMxStatus({ id: 1, status: "Declined", amount: 1 })).toBe("declined");
    expect(mapMxStatus({ id: 1, status: "Voided", amount: 1 })).toBe("voided");
    expect(mapMxStatus({ id: 1, status: "Chargedback", amount: 1 })).toBe("chargebacked");
  });

  it("presents a recorded payment so the fee rule books exactly what the customer was shown", () => {
    const pc = toPcPayment({
      id: "mx:501", merchantId: "m", requestId: "req1", kind: "payment", method: "card", status: "captured",
      invoiceCents: 3333, feeCents: 100, totalCents: 3433, mxPaymentId: "501", mxBatch: null, origPaymentId: null,
      paidOn: "2026-10-28T10:00:00Z", updatedAt: "2026-10-28T10:00:00Z",
    });
    expect(pc).toMatchObject({ _id: "mx:501", type: "payment_card", amount: 3433, extraFees: 100, allocations: [{ refType: "Invoice", ref: "req1", amount: 3333 }] });
    expect(feeFor(pc, 3333)).toBe(100);
    const ach = toPcPayment({ ...({} as any), id: "mx:9", merchantId: "m", requestId: "req1", kind: "payment", method: "ach", status: "captured", invoiceCents: 3333, feeCents: 0, totalCents: 3333, mxPaymentId: "9", mxBatch: null, origPaymentId: null, paidOn: "2026-10-28T10:00:00Z", updatedAt: "" });
    expect(ach.type).toBe("ach");
    expect(feeFor(ach, 3333)).toBe(0);
  });
});
