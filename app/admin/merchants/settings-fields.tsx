import { Merchant } from "@/lib/types";

export function SettingsFields({ m, system = "FreshBooks" }: { m?: Merchant; system?: string }) {
  return (
    <div className="grid">
      <div>
        <label htmlFor="notifyMode">Who contacts the customer</label>
        <select id="notifyMode" name="notifyMode" defaultValue={m?.notifyMode ?? "customer"}>
          <option value="customer">Pay Center texts/emails the payment request</option>
          <option value="link">Nobody; only store the pay link</option>
        </select>
      </div>
      <div>
        <label htmlFor="recordOn">Post to {system} when a payment is</label>
        <select id="recordOn" name="recordOn" defaultValue={m?.recordOn ?? "settled"}>
          <option value="settled">Settled (safer for ACH)</option>
          <option value="captured">Approved (shows paid sooner)</option>
        </select>
      </div>
      <div>
        <label htmlFor="reversals">Returns, voids and refunds</label>
        <select id="reversals" name="reversals" defaultValue={m?.reversals ?? "review"}>
          <option value="review">Hold for a person to handle</option>
          <option value="auto">Adjust {system} automatically</option>
        </select>
      </div>
    </div>
  );
}

/** QuickBooks-only rules. `accounts` and `items` come from the connected company; empty until it is connected. */
export function QuickBooksFields({ m, accounts, items, connected }: {
  m?: Merchant;
  connected: boolean;
  accounts: { id: string; name: string; subType: string }[];
  items: { id: string; name: string; incomeAccount: string | null }[];
}) {
  return (
    <div className="grid">
      <div>
        <label htmlFor="qbTrigger">Send a payment request for</label>
        <select id="qbTrigger" name="qbTrigger" defaultValue={m?.qbTrigger ?? "open"}>
          <option value="open">Every open invoice (as soon as it is saved)</option>
          <option value="sent">Only invoices emailed from QuickBooks</option>
        </select>
      </div>
      <div>
        <label htmlFor="qbDepositAccountId">Deposit payments to</label>
        {connected ? (
          <select id="qbDepositAccountId" name="qbDepositAccountId" defaultValue={m?.qbDepositAccountId ?? ""}>
            <option value="">QuickBooks default (Undeposited Funds)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.subType === "UndepositedFunds" ? " (Undeposited Funds)" : ""}</option>)}
          </select>
        ) : <input disabled placeholder="Connect QuickBooks first" />}
      </div>
      <div>
        <label htmlFor="bookFees">Customer card/ACH fee</label>
        <select id="bookFees" name="bookFees" defaultValue={m?.bookFees ? "yes" : "no"}>
          <option value="no">Do not book (bookkeeper records it from the processor statement)</option>
          <option value="yes">Book to its own income account on every payment</option>
        </select>
      </div>
      <div>
        <label htmlFor="qbFeeItemId">Fee item (its income account receives the fees)</label>
        {connected ? (
          <select id="qbFeeItemId" name="qbFeeItemId" defaultValue={m?.qbFeeItemId ?? ""}>
            <option value="">None yet</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.incomeAccount ? ` → ${i.incomeAccount}` : ""}</option>)}
          </select>
        ) : <input disabled placeholder="Connect QuickBooks first" />}
      </div>
    </div>
  );
}
