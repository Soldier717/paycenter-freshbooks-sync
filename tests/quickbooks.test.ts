import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEvents, QbApp, quickBooks, verifyWebhook } from "@/lib/quickbooks";
import { memoryStore } from "./helpers";

const app: QbApp = { env: "sandbox", clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/cb", webhookVerifier: "v" };

/** A fake Intuit API: records requests and answers from a script keyed by method + path. */
function fakeIntuit(answers: Record<string, (body: any, url: URL) => unknown>) {
  const calls: { method: string; path: string; query: Record<string, string>; body: any }[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const key = `${init.method} ${url.pathname.replace(/^\/v3\/company\/realm1/, "")}`;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    const h = answers[key];
    if (!h) return new Response(JSON.stringify({ Fault: { Error: [{ Message: "Object Not Found", code: "610" }] } }), { status: 400 });
    return new Response(JSON.stringify(h(body, url)), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

async function connected() {
  const mem = memoryStore();
  let tokens: any = { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3600_000, refreshExpiresAt: Date.now() + 86400_000 };
  mem.store.getTokens = async () => tokens;
  mem.store.saveTokens = async (t) => { tokens = t; };
  return mem;
}

describe("QuickBooks invoices", () => {
  it("maps an open invoice, every open one or only emailed ones depending on the trigger", async () => {
    const mem = await connected();
    fakeIntuit({
      "GET /invoice/42": () => ({ Invoice: { Id: "42", SyncToken: "0", DocNumber: "1042", DueDate: "2026-11-01", TotalAmt: 33.33, Balance: 33.33, CurrencyRef: { value: "USD" }, CustomerRef: { value: "9" }, EmailStatus: "NotSet" } }),
    });
    const open = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: null, feeItemId: null });
    expect(await open.getInvoice("42")).toMatchObject({ id: "42", number: "1042", totalCents: 3333, balanceCents: 3333, customerId: "9", sendable: true, deleted: false, dueDate: "2026-11-01" });
    const sent = quickBooks(mem.store, app, "realm1", { trigger: "sent", depositAccountId: null, feeItemId: null });
    expect((await sent.getInvoice("42")).sendable).toBe(false);
  });

  it("reports a deleted invoice (Intuit 610) as deleted rather than failing, and a voided one too", async () => {
    const mem = await connected();
    fakeIntuit({ "GET /invoice/7": () => ({ Invoice: { Id: "7", SyncToken: "2", TotalAmt: 0, Balance: 0, PrivateNote: "Voided" } }) });
    const qb = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: null, feeItemId: null });
    expect((await qb.getInvoice("99")).deleted).toBe(true);
    expect(await qb.getInvoice("7")).toMatchObject({ deleted: true, status: "voided" });
  });

  it("refreshes a rejected token once and retries", async () => {
    const mem = await connected();
    let first = true;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      if (String(input).includes("tokens/bearer")) return new Response(JSON.stringify({ access_token: "tok2", refresh_token: "r2", expires_in: 3600, x_refresh_token_expires_in: 8640000 }));
      if (first) { first = false; return new Response("{}", { status: 401 }); }
      expect((init.headers as any).Authorization).toBe("Bearer tok2");
      return new Response(JSON.stringify({ Invoice: { Id: "1", SyncToken: "0", TotalAmt: 5, Balance: 5 } }));
    });
    const qb = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: null, feeItemId: null });
    expect((await qb.getInvoice("1")).totalCents).toBe(500);
    expect((await mem.store.getTokens())!.refreshToken).toBe("r2");
  });
});

describe("QuickBooks payments and fees", () => {
  it("creates a payment linked to the invoice, in the chosen deposit account, with the exact amount", async () => {
    const mem = await connected();
    const calls = fakeIntuit({ "POST /payment": (b) => ({ Payment: { Id: "501", ...b } }) });
    const qb = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: "4", feeItemId: null });
    expect(await qb.createPayment({ invoiceId: "42", customerId: "9", cents: 3333, date: "2026-10-12", method: "card", note: "Pay Center card payment x" })).toEqual({ id: "501" });
    expect(calls[0].body).toEqual({
      TotalAmt: 33.33, TxnDate: "2026-10-12", PrivateNote: "Pay Center card payment x",
      Line: [{ Amount: 33.33, LinkedTxn: [{ TxnId: "42", TxnType: "Invoice" }] }],
      DepositToAccountRef: { value: "4" }, CustomerRef: { value: "9" },
    });
    expect(calls[0].query.minorversion).toBeDefined();
  });

  it("books the fee as a sales receipt on the fee item, deposited with the payment", async () => {
    const mem = await connected();
    const calls = fakeIntuit({ "POST /salesreceipt": (b) => ({ SalesReceipt: { Id: "777", ...b } }) });
    const qb = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: "4", feeItemId: "12" });
    expect(await qb.createFee!({ customerId: "9", cents: 100, date: "2026-10-12", note: "Card fee", invoiceNumber: "1042" })).toEqual({ id: "777" });
    expect(calls[0].body).toMatchObject({
      DocNumber: "FEE-1042", DepositToAccountRef: { value: "4" }, CustomerRef: { value: "9" },
      Line: [{ DetailType: "SalesItemLineDetail", Amount: 1, SalesItemLineDetail: { ItemRef: { value: "12" }, Qty: 1, UnitPrice: 1 } }],
    });
  });

  it("offers no fee booking without a fee item", async () => {
    const mem = await connected();
    const qb = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: null, feeItemId: null });
    expect(qb.createFee).toBeUndefined();
  });

  it("deletes and reduces payments using the current SyncToken", async () => {
    const mem = await connected();
    const calls = fakeIntuit({
      "GET /payment/501": () => ({ Payment: { Id: "501", SyncToken: "3", TotalAmt: 33.33, Line: [{ Amount: 33.33, LinkedTxn: [{ TxnId: "42", TxnType: "Invoice" }] }] } }),
      "POST /payment": (b) => ({ Payment: b }),
    });
    const qb = quickBooks(mem.store, app, "realm1", { trigger: "open", depositAccountId: null, feeItemId: null });
    await qb.deletePayment("501");
    expect(calls[1]).toMatchObject({ query: { operation: "delete" }, body: { Id: "501", SyncToken: "3" } });
    await qb.updatePaymentAmount("501", 1000);
    expect(calls[3].body).toMatchObject({ Id: "501", SyncToken: "3", sparse: true, TotalAmt: 10, Line: [{ Amount: 10, LinkedTxn: [{ TxnId: "42" }] }] });
  });
});

describe("QuickBooks webhooks", () => {
  const body = JSON.stringify({ eventNotifications: [{ realmId: "realm1", dataChangeEvent: { entities: [{ name: "Invoice", id: "42", operation: "Create" }, { name: "Customer", id: "9", operation: "Update" }] } }] });

  it("accepts Intuit's signature and nothing else", () => {
    const sig = createHmac("sha256", "verifier").update(body).digest("base64");
    expect(verifyWebhook(body, sig, "verifier")).toBe(true);
    expect(verifyWebhook(body, sig, "other")).toBe(false);
    expect(verifyWebhook(body + " ", sig, "verifier")).toBe(false);
    expect(verifyWebhook(body, null, "verifier")).toBe(false);
  });

  it("lists the entities in a batch", () => {
    expect(parseEvents(JSON.parse(body))).toEqual([
      { realmId: "realm1", entity: "Invoice", id: "42", operation: "Create" },
      { realmId: "realm1", entity: "Customer", id: "9", operation: "Update" },
    ]);
    expect(parseEvents({})).toEqual([]);
  });
});
