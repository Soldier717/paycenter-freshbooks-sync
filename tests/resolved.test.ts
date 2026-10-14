import { describe, expect, it } from "vitest";
import { syncInvoice, syncPayment } from "@/lib/sync";
import { world } from "./helpers";

describe("items a person resolved", () => {
  it("stay resolved when Pay Center reports the payment again", async () => {
    const w = world();
    await syncInvoice(w.deps, "7");
    w.pay({ type: "ach" });
    await syncPayment(w.deps, "pay1");
    w.pay({ type: "ach", status: "returned" });
    expect((await syncPayment(w.deps, "pay1")).status).toBe("needs_review");
    await w.deps.store.resolveLedger("pay1", "Reversed in FreshBooks by hand");
    expect((await syncPayment(w.deps, "pay1")).status).toBe("resolved");
    expect(w.fbCalls.del).toBe(0);
  });
});
