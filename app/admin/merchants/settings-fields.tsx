import { Merchant } from "@/lib/types";

export function SettingsFields({ m }: { m?: Merchant }) {
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
        <label htmlFor="recordOn">Post to FreshBooks when a payment is</label>
        <select id="recordOn" name="recordOn" defaultValue={m?.recordOn ?? "settled"}>
          <option value="settled">Settled (safer for ACH)</option>
          <option value="captured">Approved (shows paid sooner)</option>
        </select>
      </div>
      <div>
        <label htmlFor="reversals">Returns, voids and refunds</label>
        <select id="reversals" name="reversals" defaultValue={m?.reversals ?? "review"}>
          <option value="review">Hold for a person to handle</option>
          <option value="auto">Adjust FreshBooks automatically</option>
        </select>
      </div>
    </div>
  );
}
