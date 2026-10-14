import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./config";

/** 32-byte key from DATA_KEY (64 hex chars). Used for tokens at rest and signed links. */
function key(): Buffer {
  const hex = env("DATA_KEY");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("DATA_KEY must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function open(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** Signed, expiring token carrying a small payload. Used for OAuth state. */
export function sign(payload: Record<string, string>, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  const mac = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify(token: string): Record<string, string> | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key()).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export const randomSecret = (bytes = 24) => randomBytes(bytes).toString("hex");
