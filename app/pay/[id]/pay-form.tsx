"use client";

import { useState } from "react";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type Method = "card" | "ach";

/**
 * Card and bank details are posted by the browser straight to MX Merchant with a one-time token.
 * Our server only ever receives MX's payment id, then re-reads the payment from MX.
 */
export function PayForm({ requestId, cardAmount, cashAmount, achEnabled, merchantName }: { requestId: string; cardAmount: number; cashAmount: number; achEnabled: boolean; merchantName: string }) {
  const [method, setMethod] = useState<Method>(achEnabled ? "ach" : "card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; ref: string; method: Method } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    try {
      const tRes = await fetch(`/api/pay/${encodeURIComponent(requestId)}/token`, { method: "POST" });
      const t = await tRes.json();
      if (!tRes.ok) throw new Error(t.error ?? "Could not start the payment");
      const amount = method === "card" ? t.cardAmount : t.cashAmount;
      const body: Record<string, unknown> = {
        merchantId: t.merchantId,
        paymentType: "Sale",
        tenderType: method === "card" ? "Card" : "ACH",
        amount: (amount / 100).toFixed(2),
        invoice: String(t.invoice).slice(0, 16),
        clientReference: String(requestId).slice(0, 17),
        source: "API",
      };
      if (method === "card") {
        const [mm, yy] = v("expiry").replace(/\s/g, "").split("/");
        body.cardAccount = {
          number: v("number").replace(/\s|-/g, ""),
          expiryMonth: (mm ?? "").padStart(2, "0"),
          expiryYear: (yy ?? "").slice(-2),
          cvv: v("cvv"),
          avsZip: v("zip"),
          avsStreet: v("street"),
        };
      } else {
        body.entryClass = "WEB";
        body.bankAccount = {
          routingNumber: v("routing").replace(/\D/g, ""),
          accountNumber: v("account").replace(/\D/g, ""),
          accountType: v("accountType") || "Checking",
          name: v("holder"),
        };
      }
      let mxRes: Response;
      try {
        mxRes = await fetch(`${t.apiBase}/payment?token=${encodeURIComponent(t.token)}&echo=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error("The payment processor could not be reached from your browser. Nothing was charged. Please try again or contact " + merchantName + ".");
      }
      const text = await mxRes.text();
      let p: any = null;
      try { p = JSON.parse(text); } catch { /* below */ }
      if (!mxRes.ok) throw new Error(p?.message ?? p?.errorMessage ?? `The payment was not accepted (${mxRes.status}). Nothing was charged.`);
      const status = String(p?.status ?? "").toLowerCase();
      if (status === "declined") throw new Error("The payment was declined. Please check the details or try another payment method.");
      if (!p?.id) throw new Error("The processor did not return a payment reference. Please contact " + merchantName + " before trying again.");

      const cRes = await fetch(`/api/pay/${encodeURIComponent(requestId)}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mxPaymentId: String(p.id) }),
      });
      const c = await cRes.json().catch(() => ({}));
      if (!cRes.ok && cRes.status !== 409) throw new Error("Your payment went through (reference " + p.id + ") but could not be recorded. Please contact " + merchantName + " with that reference.");
      setDone({ amount, ref: String(p.id), method });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <p><b>Thank you. Your {done.method === "ach" ? "bank transfer" : "card"} payment of {dollars(done.amount)} was accepted.</b></p>
        <p className="small muted">Reference {done.ref}. {done.method === "ach" ? "Bank transfers take a few business days to clear." : "A receipt will follow from the processor if one is configured."}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {achEnabled && (
        <div className="row" role="radiogroup" aria-label="Payment method" style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="method" checked={method === "ach"} onChange={() => setMethod("ach")} /> Bank transfer · {dollars(cashAmount)}</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="method" checked={method === "card"} onChange={() => setMethod("card")} /> Card · {dollars(cardAmount)}</label>
        </div>
      )}
      {method === "card" ? (
        <div className="grid">
          <div style={{ gridColumn: "1 / -1" }}><label htmlFor="number">Card number</label><input id="number" name="number" inputMode="numeric" autoComplete="cc-number" required minLength={13} maxLength={23} /></div>
          <div><label htmlFor="expiry">Expiry (MM/YY)</label><input id="expiry" name="expiry" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" required pattern="\d{2}\s*/\s*\d{2,4}" /></div>
          <div><label htmlFor="cvv">Security code</label><input id="cvv" name="cvv" inputMode="numeric" autoComplete="cc-csc" required minLength={3} maxLength={4} /></div>
          <div><label htmlFor="street">Billing street address</label><input id="street" name="street" autoComplete="billing street-address" required /></div>
          <div><label htmlFor="zip">Billing ZIP</label><input id="zip" name="zip" inputMode="numeric" autoComplete="billing postal-code" required minLength={5} maxLength={10} /></div>
        </div>
      ) : (
        <div className="grid">
          <div style={{ gridColumn: "1 / -1" }}><label htmlFor="holder">Name on the account</label><input id="holder" name="holder" autoComplete="name" required /></div>
          <div><label htmlFor="routing">Routing number</label><input id="routing" name="routing" inputMode="numeric" required minLength={9} maxLength={9} /></div>
          <div><label htmlFor="account">Account number</label><input id="account" name="account" inputMode="numeric" required minLength={4} maxLength={17} /></div>
          <div>
            <label htmlFor="accountType">Account type</label>
            <select id="accountType" name="accountType" defaultValue="Checking"><option>Checking</option><option>Savings</option></select>
          </div>
          <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>By continuing you authorize {merchantName} to debit this account for {dollars(cashAmount)}.</p>
        </div>
      )}
      {error && <div className="flash bad" style={{ marginTop: 12 }}>{error}</div>}
      <div style={{ marginTop: 16 }}>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Processing…" : `Pay ${dollars(method === "card" ? cardAmount : cashAmount)}`}</button>
      </div>
    </form>
  );
}
