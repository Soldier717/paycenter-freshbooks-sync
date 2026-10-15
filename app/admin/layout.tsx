import { logout } from "./actions";
import { hasAdminCookie } from "@/lib/guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await hasAdminCookie();
  return (
    <>
      <header className="top">
        <div className="inner">
          <a className="brand" href="/admin">
            <img src="/brand/pbs-mark.png" alt="" />
            <span className="word">Priority<small>Pay Center · FreshBooks sync</small></span>
          </a>
          {signedIn && (
            <nav>
              <a href="/admin">Merchants</a>
              <a href="/admin/merchants/new">Add merchant</a>
              <form action={logout}><button className="btn" type="submit">Sign out</button></form>
            </nav>
          )}
        </div>
      </header>
      <div className="wrap">{children}</div>
    </>
  );
}
