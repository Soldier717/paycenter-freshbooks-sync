import { AcctFeeInput, AcctInvoice, AcctPaymentInput, Deps, InvoiceLink, LedgerRow, PcPayment, ProviderError, Store, SyncSettings } from "@/lib/types";

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
    getLinkByAcct: async (id) => links.find((l) => l.acctInvoiceId === id) ?? null,
    getLinkByPc: async (id) => links.find((l) => l.pcInvoiceId === id) ?? null,
    insertLink: async (l) => void links.push({ ...l }),
    updateLink: async (id, patch) => void Object.assign(links.find((l) => l.acctInvoiceId === id)!, patch),
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

/**
 * A fake accounting system shaped like FreshBooks' behaviour (invoice 7 for $100.00, sent, unpaid), exposed
 * through the neutral AccountingApi. `invoice` is the live record: tests edit it to simulate changes.
 */
export function world(overrides: Partial<SyncSettings> = {}, acctOverrides: { fees?: boolean } = {}) {
  const mem = memoryStore();
  const invoice: AcctInvoice = {
    id: "7", number: "TEST-7", currency: "USD", totalCents: 10000, balanceCents: 10000, dueDate: "2026-10-30",
    customerId: "55", deleted: false, sendable: true, status: "sent",
  };
  const acctPayments = new Map<string, { cents: number; deleted: boolean; body: AcctPaymentInput }>();
  const fees = new Map<string, { deleted: boolean; body: AcctFeeInput }>();
  const acctCalls = { create: 0, update: 0, del: 0, fee: 0, feeDel: 0 };
  const fail = { create: null as ProviderError | null, fee: null as ProviderError | null };
  let nextId = 99;
  const balance = () => {
    let paid = 0;
    for (const p of acctPayments.values()) if (!p.deleted) paid += p.cents;
    invoice.balanceCents = invoice.totalCents - paid;
  };
  const payments = new Map<string, PcPayment>();
  const pcInvoices: Record<string, unknown>[] = [];

  const deps: Deps = {
    store: mem.store,
    settings: { notifyMode: "link", recordOn: "settled", reversals: "review", bookFees: false, webhookUrl: "https://app.test/hook/s", ...overrides },
    acct: {
      kind: "freshbooks",
      accountId: "acct",
      getInvoice: async () => structuredClone(invoice),
      getCustomer: async () => ({ firstName: "Pat", lastName: "Lee", email: "pat@example.invalid" }),
      createPayment: async (body) => {
        acctCalls.create++;
        if (fail.create) throw fail.create;
        const id = String(nextId++);
        acctPayments.set(id, { cents: body.cents, deleted: false, body });
        balance();
        return { id };
      },
      updatePaymentAmount: async (id, cents) => {
        acctCalls.update++;
        acctPayments.get(id)!.cents = cents;
        balance();
      },
      deletePayment: async (id) => {
        acctCalls.del++;
        acctPayments.get(id)!.deleted = true;
        balance();
      },
      ...(acctOverrides.fees ? {
        createFee: async (body: AcctFeeInput) => {
          acctCalls.fee++;
          if (fail.fee) throw fail.fee;
          const id = `fee${nextId++}`;
          fees.set(id, { deleted: false, body });
          return { id };
        },
        deleteFee: async (id: string) => { acctCalls.feeDel++; fees.get(id)!.deleted = true; },
      } : {}),
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

  return { deps, invoice, acctPayments, acctCalls, fees, fail, payments, pcInvoices, pay, ...mem };
}
