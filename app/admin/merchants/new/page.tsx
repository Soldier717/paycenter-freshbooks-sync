import { requireAdmin } from "@/lib/admin-session";
import { addMerchant } from "../../actions";
import { SettingsFields } from "../settings-fields";

export const dynamic = "force-dynamic";

export default async function NewMerchant({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 640 }}>
      <h1>Add merchant</h1>
      <p className="sub">Pay Center details come from the merchant's Pay Center site. FreshBooks is connected in the next step.</p>
      {error && <div className="flash bad">{error}</div>}
      <form action={addMerchant} className="card">
        <label htmlFor="name">Merchant name</label>
        <input id="name" name="name" required placeholder="Diane's Bookkeeping LLC" />
        <h2>Pay Center</h2>
        <label htmlFor="pcBaseUrl">API base URL</label>
        <input id="pcBaseUrl" name="pcBaseUrl" defaultValue="https://api.paycenter.app" />
        <div className="small muted">Use <code>https://stage-api.paycenter.app</code> for a demo site.</div>
        <label htmlFor="pcSiteId">Site id</label>
        <input id="pcSiteId" name="pcSiteId" required className="mono" />
        <label htmlFor="pcAccessToken">Access token</label>
        <input id="pcAccessToken" name="pcAccessToken" type="password" autoComplete="off" className="mono" />
        <div className="small muted">Stored encrypted. Can be added later.</div>
        <h2>FreshBooks</h2>
        <label htmlFor="fbAccountId">Account id (optional)</label>
        <input id="fbAccountId" name="fbAccountId" className="mono" placeholder="Filled in automatically when the merchant connects" />
        <h2>Rules</h2>
        <SettingsFields />
        <div style={{ marginTop: 18 }}><button className="btn primary" type="submit">Create merchant</button></div>
      </form>
    </main>
  );
}
