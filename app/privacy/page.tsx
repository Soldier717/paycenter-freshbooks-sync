export const metadata = { title: "Privacy policy — PBS Pay Center sync" };

const UPDATED = "October 15, 2026";

export default function Privacy() {
  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <div className="connect-hero"><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1>Privacy policy</h1>
      <p className="sub">PBS Pay Center sync · last updated {UPDATED}</p>

      <div className="card">
        <h2>Who we are</h2>
        <p>
          PBS Pay Center sync (the "service") is operated by GLOEBEL ENTERPRISES LLC, doing business as Priority Business
          Solutions ("PBS", "we"), 4814 Vincennes Street, Cape Coral, FL 33904. The service connects a business's accounting
          system (FreshBooks or QuickBooks Online) to Priority Pay Center so that invoices can be paid online and payments are
          recorded back on the invoice.
        </p>

        <h2>What we access</h2>
        <p>When a business connects its accounting system, the service reads and writes only what the sync needs:</p>
        <ul>
          <li><b>Invoices</b>: number, amount, balance, due date, currency, status, and the customer it is addressed to.</li>
          <li><b>Customers</b>: name, email address and mobile number, used only so Priority Pay Center can send that customer the payment request for their invoice.</li>
          <li><b>Payments</b>: the service creates payment records against invoices and, where the business has turned it on, a separate record for the customer fee. It can reduce or remove a payment it created when a payment is returned or refunded.</li>
          <li><b>Company details</b>: the company name and, for QuickBooks, the list of accounts and service items, so the business can choose where payments and fees are recorded.</li>
        </ul>
        <p>We do not read bank accounts, payroll, employees, tax filings, or any records unrelated to invoices and their payments.</p>

        <h2>What we store</h2>
        <ul>
          <li>The access tokens the accounting system issues to the service, encrypted at rest. A business can revoke them at any time from its accounting system (for QuickBooks, from the Intuit account's connected apps).</li>
          <li>The link between each invoice and its Priority Pay Center payment request, and a ledger of each payment the service recorded, with the Pay Center payment id and amount.</li>
          <li>An activity log of what the service did and why, including the Pay Center payment id and the invoice id. The log does not contain card or bank account numbers; the service never sees them.</li>
        </ul>
        <p>Card and bank details are entered by the customer directly with Priority Pay Center (Hyfin) and its payment processor and never pass through this service.</p>

        <h2>How we use it</h2>
        <p>
          Only to run the sync described above for the business that connected its account, and to support that business when
          something needs a person's attention. We do not sell data, use it for advertising, or share it with anyone other than
          the business itself, Priority Pay Center as the payment platform, and the hosting providers that run the service
          (Vercel and Supabase, in the United States).
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Records are kept while the business uses the service and for as long as needed to support its bookkeeping. A business
          can ask PBS to disconnect its account and delete its tokens, invoice links and ledger at any time; revoking access from
          the accounting system stops all further reads and writes immediately.
        </p>

        <h2>Contact</h2>
        <p>Questions about this policy or your data: write to Priority Business Solutions at the address above, or contact your PBS representative.</p>
      </div>
    </main>
  );
}
