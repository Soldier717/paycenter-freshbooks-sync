import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./config";
import { safeEqual } from "./freshbooks";

export const ADMIN_COOKIE = "pbs_admin";

/** Value stored in the admin cookie: derived from ADMIN_SECRET, never the secret itself. */
export function adminCookieValue(): string {
  return createHmac("sha256", env("ADMIN_SECRET")).update("admin-session").digest("hex");
}

export function isAdminSecret(given: string | null | undefined): boolean {
  return !!given && safeEqual(given, env("ADMIN_SECRET"));
}

/** JSON routes: x-admin-secret header, ?key=, or the admin cookie. */
export async function isAdmin(req: Request): Promise<boolean> {
  const given = req.headers.get("x-admin-secret") ?? new URL(req.url).searchParams.get("key");
  if (isAdminSecret(given)) return true;
  return hasAdminCookie();
}

export async function hasAdminCookie(): Promise<boolean> {
  const c = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  return !!c && safeEqual(c, adminCookieValue());
}

export const denied = () => Response.json({ error: "Not authorized" }, { status: 401 });
