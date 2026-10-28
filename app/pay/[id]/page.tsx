import { notFound } from "next/navigation";
import { getMerchant } from "@/lib/merchants";
import { toDecimal } from "@/lib/money";
import { getRequest, paymentsForRequest, prices } from "@/lib/pbspay";
import { PayForm } from "./pay-form";

export const dynamic = "force-dynamic";

const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await getRequest(id);
  if (!req) notFound();
  const m = await getMerchant(req.merchantId);
  if (!m || m.payments !== "pbspay") notFound();
  const px = prices(req, m);
  const paid = req.status === "paid" ? (await paymentsForRequest(req.id)).filter((p) => p.kind === "payment" && ["captured", "settled"].includes(p.status)) : [];
  const live = m.status === "active";

  return (
    <main className="wrap" style={{ maxWidth: 560 }}>
      <div className="connect-hero"><span className="logo-plate"><img src="/brand/pbs-logo.png" alt="Priority Business Solutions" style={{ display: "block" }} /></span></div>
      <h1 style={{ textAlign: "center" }}>{m.name}</h1>
      <p className="sub" style={{ textAlign: "center" }}>Invoice {req.invoiceNumber}{req.dueDate ? ` · due ${req.dueDate}` : ""}</p>

      {req.status === "void" ? (
        <div className="card"><p>This payment request has been cancelled. Please contact {m.name} if you believe that is a mistake.</p></div>
      ) : req.status === "paid" ? (
        <div className="card">
          <p><b>Paid. Thank you.</b></p>
          {paid.map((p) => (
            <p key={p.id} className="small muted">
              {p.method === "ach" ? "Bank transfer" : "Card"} payment of ${toDecimal(p.totalCents)} on {new Date(p.paidOn).toLocaleDateString("en-US")}
              {p.feeCents ? ` (includes $${toDecimal(p.feeCents)} card fee)` : ""}. Reference {p.mxPaymentId}.
            </p>
          ))}
        </div>
      ) : !live ? (
        <div className="card"><p>Online payment isn't available for this invoice right now. Please contact {m.name}.</p></div>
      ) : (
        <div className="card">
          <table style={{ width: "100%", marginBottom: 16 }}>
            <tbody>
              <tr><td>Invoice total</td><td style={{ textAlign: "right" }}>${toDecimal(req.totalCents)}</td></tr>
              {m.achEnabled && <tr><td><b>Pay by bank transfer (ACH)</b><div className="small muted">No fee</div></td><td style={{ textAlign: "right" }}><b>${toDecimal(px.cashCents)}</b></td></tr>}
              <tr><td><b>Pay by card</b><div className="small muted">Includes a {pct(px.feeRateBps)} card fee of ${toDecimal(px.feeCents)}</div></td><td style={{ textAlign: "right" }}><b>${toDecimal(px.cardCents)}</b></td></tr>
            </tbody>
          </table>
          <PayForm requestId={req.id} cardAmount={px.cardCents} cashAmount={px.cashCents} achEnabled={m.achEnabled} merchantName={m.name} />
          <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>
            Card details go directly to our payment processor over a secure connection; {m.name} and Priority Business Solutions never see your card number.
          </p>
        </div>
      )}
      <p className="small muted" style={{ textAlign: "center" }}>Payments by Priority Business Solutions · <a href="/privacy">Privacy</a></p>
    </main>
  );
}
