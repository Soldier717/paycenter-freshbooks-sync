import { Deps, FbInvoice, FbPaymentBody, InvoiceLink, LedgerRow, PcPayment, ProviderError, Store, SyncSettings } from "@/lib/types";

export const SITE = "site1";

export function memoryStore() {
  const links: InvoiceLink[] = [];
  const ledger = new Map<string, LedgerRow>();
  const kv = new Map<string, string>();
  const logs: { level: string; message: string }[] = [];
  const store: Store = {
    getTokens: async () => null,
    saveTokens: async () => {},
    getKv: async (k) => kv.get(k) ?? null,
    setKv: async (k, v) => void kv.set(k, v),
    getLinkByFb: async (id) => links.find((l) => l.fbInvoiceId === id) ?? null,
    getLinkByPc: async (id) => links.find((l) => l.pcInvoiceId === id) ?? null,
    insertLink: async (l) => void links.push({ ...l }),
    updateLink: async (id, patch) => void Object.assign(links.find((l) => l.fbInvoiceId === id)!, patch),
    getLedger: async (id) => (ledger.has(id) ? { ...ledger.get(id)! } : null),
    claimLedger: async (row) => (ledger.has(row.pcPaymentId) ? false : (ledger.set(row.pcPaymentId, { ...row }), true)),
    updateLedger: async (id, patch) => void Object.assign(ledger.get(id)!, patch),
    countLedgerForInvoice: async (id) => [...ledger.values()].filter((r) => r.pcInvoiceId === id).length,
    listAttention: async () => [...ledger.values()].filter((r) => ["review", "uncertain", "posting"].includes(r.state)),
    resolveLedger: async (id, note) => void Object.assign(ledger.get(id)!, { state: "resolved", reason: note }),
    saveCallback: async () => {},
    countCallbacks: async () => 0,
    setVerifier: async () => true,
    verifiersFor: async () => [],
    log: async (level, message) => void logs.push({ level, message }),
    recentLog: async () => logs,
  };
  return { store, links, ledger, kv, logs };
}

export function world(overrides: Partial<SyncSettings> = {}) {
  const mem = memoryStore();
  const invoice: FbInvoice = {
    invoiceid: 7, invoice_number: "TEST-7", v3_status: "sent", vis_state: 0, customerid: 55,
    amount: { amount: "100.00", code: "USD" }, outstanding: { amount: "100.00", code: "USD" }, due_date: "2026-10-30",
  };
  const fbPayments = new Map<string, { cents: number; deleted: boolean; body: FbPaymentBody }>();
  const fbCalls = { create: 0, update: 0, del: 0 };
  const fail = { create: null as ProviderError | null };
  let nextId = 99;
  const balance = () => {
    let paid = 0;
    for (const p of fbPayments.values()) if (!p.deleted) paid += p.cents;
    invoice.outstanding.amount = ((10000 - paid) / 100).toFixed(2);
  };
  const payments = new Map<string, PcPayment>();
  const pcInvoices: Record<string, unknown>[] = [];

  const deps: Deps = {
    store: mem.store,
    settings: { notifyMode: "link", recordOn: "settled", reversals: "review", webhookUrl: "https://app.test/hook/s", ...overrides },
    fb: {
      accountId: "acct",
      getInvoice: async () => structuredClone(invoice),
      getClient: async () => ({ fname: "Pat", lname: "Lee", email: "pat@example.invalid" }),
      createPayment: async (body) => {
        fbCalls.create++;
        if (fail.create) throw fail.create;
        const id = String(nextId++);
        fbPayments.set(id, { cents: Math.round(Number(body.amount.amount) * 100), deleted: false, body });
        balance();
        return { id };
      },
      updatePaymentAmount: async (id, amount) => {
        fbCalls.update++;
        fbPayments.get(id)!.cents = Math.round(Number(amount.amount) * 100);
        balance();
      },
      deletePayment: async (id) => {
        fbCalls.del++;
        fbPayments.get(id)!.deleted = true;
        balance();
      },
    },
    pc: {
      siteId: SITE,
      addUpdateInvoice: async (body) => {
        pcInvoices.push(body);
        return { _id: "pc7", link: "https://pay.example.invalid/abc" };
      },
      getPayment: async (id) => structuredClone(payments.get(id)!),
      listPayments: async () => ({ records: [...payments.values()], nextUpdatedAfter: "2026-10-12T00:00:00.000Z", recordsReturned: payments.size, limit: 100 }),
    },
  };

  const pay = (over: Partial<PcPayment> = {}): PcPayment => {
    const p: PcPayment = {
      _id: "pay1", site: SITE, status: "settled", type: "payment_card", amount: 10300, paidOn: "2026-10-12T15:00:00Z",
      isRefund: false, allocations: [{ refType: "Invoice", ref: "pc7", amount: 10000 }], ...over,
    };
    payments.set(p._id, p);
    return p;
  };

  return { deps, invoice, fbPayments, fbCalls, fail, payments, pcInvoices, pay, ...mem };
}
