export const metadata = { title: "End-user license agreement — PBS Pay Center sync" };

const UPDATED = "October 15, 2026";

export default function Terms() {
  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <div className="connect-hero"><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1>End-user license agreement</h1>
      <p className="sub">PBS Pay Center sync · last updated {UPDATED}</p>

      <div className="card">
        <h2>The service</h2>
        <p>
          PBS Pay Center sync (the "service") is provided by GLOEBEL ENTERPRISES LLC, doing business as Priority Business
          Solutions ("PBS"), 4814 Vincennes Street, Cape Coral, FL 33904, to businesses that take payments through Priority Pay
          Center. The service connects the business's accounting system (FreshBooks or QuickBooks Online) to Priority Pay Center:
          it creates a payment request for each eligible invoice and records payments back on the invoice.
        </p>

        <h2>Who may use it</h2>
        <p>
          The service is for businesses that have a merchant agreement with PBS and a Priority Pay Center site. By connecting an
          accounting system you confirm that you are authorized to grant access to that company's records on its behalf.
        </p>

        <h2>Your responsibilities</h2>
        <ul>
          <li>Keep your accounting system and Priority Pay Center logins secure, and tell PBS promptly if access should be revoked.</li>
          <li>Review the records the service creates. The service applies fixed rules (described in its documentation and on each merchant's setup page) and holds anything unusual for a person; it does not replace your bookkeeper.</li>
          <li>Record processor costs and reconcile bank deposits in your accounting system; the service records invoice payments and, if enabled, customer fees, but not the processor's own charges.</li>
        </ul>

        <h2>Access to your accounting system</h2>
        <p>
          The service uses the permissions your accounting system grants it only as described in the <a href="/privacy">privacy
          policy</a>. You may revoke that access at any time from the accounting system; the service then stops reading and
          writing immediately.
        </p>

        <h2>Availability and changes</h2>
        <p>
          PBS aims to keep the service running continuously but does not guarantee uninterrupted operation. A daily re-check
          catches payments missed while the service or a provider was unavailable. PBS may update the service and these terms;
          material changes will be communicated to connected businesses.
        </p>

        <h2>Liability</h2>
        <p>
          The service is provided "as is". To the extent permitted by law, PBS is not liable for indirect or consequential loss
          arising from use of the service, including errors in third-party systems (FreshBooks, Intuit, Priority Pay Center, or
          payment processors). Nothing here limits liability that cannot be limited by law.
        </p>

        <h2>Termination</h2>
        <p>Either party may end use of the service at any time. On termination PBS disconnects the accounting system and, on request, deletes the stored tokens, invoice links and ledger.</p>

        <h2>Governing law and contact</h2>
        <p>These terms are governed by the laws of the State of Florida. Questions: write to Priority Business Solutions at the address above, or contact your PBS representative.</p>
      </div>
    </main>
  );
}
