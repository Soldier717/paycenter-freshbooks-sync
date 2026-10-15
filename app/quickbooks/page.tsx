export const metadata = { title: "QuickBooks + Priority Pay Center" };

/** Where Intuit sends people who launch, connect or reconnect the app from their side. */
export default function QuickBooksLanding({ searchParams }: { searchParams: Promise<{ realmId?: string; disconnected?: string }> }) {
  return <Landing searchParams={searchParams} />;
}

async function Landing({ searchParams }: { searchParams: Promise<{ realmId?: string; disconnected?: string }> }) {
  const { disconnected } = await searchParams;
  return (
    <main className="wrap" style={{ maxWidth: 540 }}>
      <div className="connect-hero"><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1 style={{ textAlign: "center" }}>QuickBooks + Priority Pay Center</h1>
      <div className="card">
        {disconnected ? (
          <p>QuickBooks is now disconnected. Invoices will no longer be sent to Priority Pay Center and no further payments will be recorded. To reconnect, ask your Priority Business Solutions contact for a new connect link.</p>
        ) : (
          <>
            <p>This app is set up for you by Priority Business Solutions: every invoice you save in QuickBooks comes with a card or bank-transfer payment request from Priority Pay Center, and payments are recorded back on the invoice automatically.</p>
            <p>To connect or reconnect, use the personal connect link from your Priority Business Solutions contact. There is nothing to configure here.</p>
          </>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}><a href="/privacy">Privacy policy</a> · <a href="/terms">End-user license agreement</a></p>
      </div>
    </main>
  );
}
