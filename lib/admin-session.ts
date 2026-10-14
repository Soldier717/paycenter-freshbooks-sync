import { redirect } from "next/navigation";
import { hasAdminCookie } from "./guard";

export async function requireAdmin(): Promise<void> {
  if (!(await hasAdminCookie())) redirect("/admin/login");
}
