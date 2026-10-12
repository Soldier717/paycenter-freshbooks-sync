export type LedgerState = "posting" | "posted" | "uncertain" | "review" | "reversed" | "applied";

export interface InvoiceLink {
  fbInvoiceId: string;
  pcInvoiceId: string;
  invoiceNumber: string;
  totalCents: number;
  fingerprint: string;
  payLink: string | null;
}

export interface LedgerRow {
  pcPaymentId: string;
  pcInvoiceId: string | null;
  kind: "payment" | "refund";
  state: LedgerState;
  fbPaymentId: string | null;
  cents: number;
  reason: string | null;
}

export interface FbTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface Store {
  getTokens(): Promise<FbTokens | null>;
  saveTokens(t: FbTokens): Promise<void>;
  getKv(key: string): Promise<string | null>;
  setKv(key: string, value: string): Promise<void>;

  getLinkByFb(fbInvoiceId: string): Promise<InvoiceLink | null>;
  getLinkByPc(pcInvoiceId: string): Promise<InvoiceLink | null>;
  insertLink(link: InvoiceLink): Promise<void>;
  updateLink(fbInvoiceId: string, patch: Partial<InvoiceLink>): Promise<void>;

  getLedger(pcPaymentId: string): Promise<LedgerRow | null>;
  /** Inserts the row. Returns false if a row for this payment already exists. */
  claimLedger(row: LedgerRow): Promise<boolean>;
  updateLedger(pcPaymentId: string, patch: Partial<LedgerRow>): Promise<void>;
  countLedgerForInvoice(pcInvoiceId: string): Promise<number>;
  listAttention(): Promise<LedgerRow[]>;

  saveCallback(callbackId: string, event: string): Promise<void>;
  /** Stores the verifier only for a callback we registered and have not verified yet. */
  setVerifier(callbackId: string, verifier: string): Promise<boolean>;
  verifiersFor(event: string): Promise<string[]>;

  log(level: "info" | "review" | "error", message: string, detail?: unknown): Promise<void>;
  recentLog(limit: number): Promise<unknown[]>;
}

export interface FbMoney { amount: string; code: string }

export interface FbInvoice {
  id?: number;
  invoiceid: number;
  invoice_number: string;
  v3_status: string;
  vis_state: number;
  amount: FbMoney;
  outstanding: FbMoney;
  due_date: string;
  customerid?: number;
}

export interface FbClientInfo { fname?: string; lname?: string; email?: string; mob_phone?: string }

export interface FbPaymentBody {
  invoiceid: number;
  amount: FbMoney;
  date: string;
  type: string;
  note: string;
  send_client_notification: boolean;
}

export interface FreshBooksApi {
  accountId: string;
  getInvoice(id: string): Promise<FbInvoice>;
  getClient(id: string): Promise<FbClientInfo>;
  createPayment(body: FbPaymentBody): Promise<{ id: string }>;
  updatePaymentAmount(id: string, amount: FbMoney): Promise<void>;
  deletePayment(id: string): Promise<void>;
}

export interface PcAllocation { refType: string; ref: string; amount: number }

export interface PcPayment {
  _id: string;
  site: string;
  status: string;
  type: string;
  amount: number;
  paidOn: string;
  isRefund?: boolean;
  origPayment?: string;
  allocations?: PcAllocation[];
}

export interface PayCenterApi {
  siteId: string;
  addUpdateInvoice(body: Record<string, unknown>): Promise<{ _id?: string; link?: string }>;
  getPayment(id: string): Promise<PcPayment>;
  listPayments(updatedAfter: string | null): Promise<{ records: PcPayment[]; nextUpdatedAfter?: string; recordsReturned?: number; limit?: number }>;
}

export interface SyncSettings {
  notifyMode: "link" | "customer";
  /** settled = wait for settlement before posting to FreshBooks. */
  recordOn: "settled" | "captured";
  /** review = a person handles returns/refunds. auto = FreshBooks is adjusted automatically. */
  reversals: "review" | "auto";
  webhookUrl: string | null;
}

export interface Deps { store: Store; fb: FreshBooksApi; pc: PayCenterApi; settings: SyncSettings }

/** A provider call failed. `definite` means the provider clearly refused, so nothing was written. */
export class ProviderError extends Error {
  constructor(message: string, public definite: boolean, public status?: number) {
    super(message);
  }
}
