export type LedgerState = "posting" | "posted" | "uncertain" | "review" | "reversed" | "applied" | "resolved";

export type MerchantStatus = "setup" | "active" | "paused";

/** Which accounting system a merchant invoices from. */
export type AccountingKind = "freshbooks" | "quickbooks";

export interface Merchant {
  id: string;
  name: string;
  status: MerchantStatus;
  accounting: AccountingKind;
  /** FreshBooks account id or QuickBooks realm (company) id. Null until connected. */
  acctAccountId: string | null;
  pcBaseUrl: string;
  pcSiteId: string;
  /** Decrypted. Null until entered. */
  pcAccessToken: string | null;
  pcWebhookSecret: string;
  notifyMode: "link" | "customer";
  recordOn: "settled" | "captured";
  reversals: "review" | "auto";
  /** Book the customer's card/ACH fee to a separate income account (QuickBooks only for now). */
  bookFees: boolean;
  /** QuickBooks only: which invoices get a payment request. */
  qbTrigger: "open" | "sent";
  qbEnv: "production" | "sandbox";
  /** QuickBooks account the payments are deposited to (usually Undeposited Funds). Null = QuickBooks default. */
  qbDepositAccountId: string | null;
  /** QuickBooks service item whose income account receives the fees. Required when bookFees is on. */
  qbFeeItemId: string | null;
  connectToken: string | null;
  connectExpiresAt: number | null;
  createdAt: string;
}

export interface MerchantSummary extends Merchant {
  acctConnected: boolean;
  webhooksRegistered: number;
  attention: number;
  invoices: number;
}

export interface InvoiceLink {
  /** The accounting system's invoice id (FreshBooks invoice id or QuickBooks Invoice Id). */
  acctInvoiceId: string;
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
  /** The payment record created in the accounting system. */
  acctPaymentId: string | null;
  cents: number;
  /** Customer fee booked separately, in cents. 0 when none or not booked. */
  feeCents: number;
  /** The fee record (QuickBooks sales receipt) when one was created. */
  feeTxnId: string | null;
  reason: string | null;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  /** When the refresh token itself stops working (QuickBooks: ~100 days). */
  refreshExpiresAt?: number | null;
}

export interface Store {
  getTokens(): Promise<OAuthTokens | null>;
  saveTokens(t: OAuthTokens): Promise<void>;
  getKv(key: string): Promise<string | null>;
  setKv(key: string, value: string): Promise<void>;

  getLinkByAcct(acctInvoiceId: string): Promise<InvoiceLink | null>;
  getLinkByPc(pcInvoiceId: string): Promise<InvoiceLink | null>;
  /** True when another merchant on the same Pay Center site created this invoice (sites can be shared). */
  linkedElsewhere(pcInvoiceId: string): Promise<boolean>;
  insertLink(link: InvoiceLink): Promise<void>;
  updateLink(acctInvoiceId: string, patch: Partial<InvoiceLink>): Promise<void>;

  getLedger(pcPaymentId: string): Promise<LedgerRow | null>;
  /** Inserts the row. Returns false if a row for this payment already exists. */
  claimLedger(row: LedgerRow): Promise<boolean>;
  updateLedger(pcPaymentId: string, patch: Partial<LedgerRow>): Promise<void>;
  countLedgerForInvoice(pcInvoiceId: string): Promise<number>;
  listAttention(): Promise<LedgerRow[]>;
  resolveLedger(pcPaymentId: string, note: string): Promise<void>;

  saveCallback(callbackId: string, event: string): Promise<void>;
  countCallbacks(): Promise<number>;
  /** Stores the verifier only for a callback we registered and have not verified yet. */
  setVerifier(callbackId: string, verifier: string): Promise<boolean>;
  verifiersFor(event: string): Promise<string[]>;

  log(level: "info" | "review" | "error", message: string, detail?: unknown): Promise<void>;
  recentLog(limit: number): Promise<unknown[]>;
}

/** An invoice as the sync core sees it, whichever system it came from. */
export interface AcctInvoice {
  id: string;
  number: string;
  currency: string;
  totalCents: number;
  balanceCents: number;
  /** YYYY-MM-DD */
  dueDate: string;
  customerId: string | null;
  deleted: boolean;
  /** Far enough along to ask the customer for payment (FreshBooks: sent; QuickBooks: open, or emailed). */
  sendable: boolean;
  /** The system's own status word, for skip messages. */
  status: string;
}

export interface AcctCustomer { firstName?: string; lastName?: string; email?: string; mobilePhone?: string }

export interface AcctPaymentInput {
  invoiceId: string;
  customerId: string | null;
  cents: number;
  /** YYYY-MM-DD */
  date: string;
  method: "card" | "ach";
  note: string;
}

export interface AcctFeeInput {
  customerId: string | null;
  cents: number;
  date: string;
  note: string;
  invoiceNumber: string;
}

export interface AccountingApi {
  kind: AccountingKind;
  accountId: string;
  getInvoice(id: string): Promise<AcctInvoice>;
  getCustomer(id: string): Promise<AcctCustomer>;
  createPayment(input: AcctPaymentInput): Promise<{ id: string }>;
  updatePaymentAmount(id: string, cents: number): Promise<void>;
  deletePayment(id: string): Promise<void>;
  /** Books the customer fee to the merchant's fee income account. Absent when the system or merchant has no fee setup. */
  createFee?: (input: AcctFeeInput) => Promise<{ id: string }>;
  deleteFee?: (id: string) => Promise<void>;
}

export interface PcAllocation { refType: string; ref: string; amount: number }

export interface PcPayment {
  _id: string;
  site: string;
  status: string;
  type: string;
  /** Everything the customer paid, in cents: invoice allocation plus fee (plus tip, if ever enabled). */
  amount: number;
  paidOn: string;
  isRefund?: boolean;
  origPayment?: string;
  allocations?: PcAllocation[];
  /** Customer fee as Pay Center reports it, in cents, when the API includes it. */
  extraFees?: number;
  extra_fees?: number;
  tip?: number;
  [k: string]: unknown;
}

export interface PayCenterApi {
  siteId: string;
  addUpdateInvoice(body: Record<string, unknown>): Promise<{ _id?: string; link?: string }>;
  getPayment(id: string): Promise<PcPayment>;
  listPayments(updatedAfter: string | null): Promise<{ records: PcPayment[]; nextUpdatedAfter?: string; recordsReturned?: number; limit?: number }>;
}

export interface SyncSettings {
  notifyMode: "link" | "customer";
  /** settled = wait for settlement before posting to the accounting system. */
  recordOn: "settled" | "captured";
  /** review = a person handles returns/refunds. auto = the accounting system is adjusted automatically. */
  reversals: "review" | "auto";
  /** Book the customer fee separately (needs a provider that offers createFee). */
  bookFees: boolean;
  webhookUrl: string | null;
}

export interface Deps { store: Store; acct: AccountingApi; pc: PayCenterApi; settings: SyncSettings }

/** A provider call failed. `definite` means the provider clearly refused, so nothing was written. */
export class ProviderError extends Error {
  constructor(message: string, public definite: boolean, public status?: number) {
    super(message);
  }
}
