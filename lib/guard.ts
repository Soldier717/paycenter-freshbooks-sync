import { env } from "./config";
import { safeEqual } from "./freshbooks";

/** Setup routes accept the admin secret as an x-admin-secret header or a ?key= query value. */
export function isAdmin(req: Request): boolean {
  const given = req.headers.get("x-admin-secret") ?? new URL(req.url).searchParams.get("key") ?? "";
  return safeEqual(given, env("ADMIN_SECRET"));
}

export const denied = () => Response.json({ error: "Not authorized" }, { status: 401 });
