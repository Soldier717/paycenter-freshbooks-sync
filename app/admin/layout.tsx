import { logout } from "./actions";
import { hasAdminCookie } from "@/lib/guard";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await hasAdminCookie();
  return (
    <div className="wrap">
      <header className="top">
        <a className="brand" href="/admin">PBS Pay Center sync</a>
        {signedIn && (
          <nav className="row">
            <a href="/admin">Merchants</a>
            <a href="/admin/merchants/new">Add merchant</a>
            <form action={logout}><button className="btn" type="submit">Sign out</button></form>
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}
