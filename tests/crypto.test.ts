import { beforeAll, describe, expect, it } from "vitest";
import { open, seal, sign, verify } from "@/lib/crypto";

beforeAll(() => { process.env.DATA_KEY = "a".repeat(64); });

describe("tokens at rest and signed links", () => {
  it("round-trips a token and never stores it in the clear", () => {
    const sealed = seal("pc_live_secret_token");
    expect(sealed).not.toContain("secret");
    expect(open(sealed)).toBe("pc_live_secret_token");
    expect(seal("x")).not.toBe(seal("x")); // fresh iv each time
  });

  it("rejects a tampered ciphertext", () => {
    const sealed = seal("hello");
    const bad = Buffer.from(sealed, "base64");
    bad[bad.length - 1] ^= 1;
    expect(() => open(bad.toString("base64"))).toThrow();
  });

  it("signs an expiring payload and refuses edits or expiry", () => {
    const t = sign({ m: "merchant-1", who: "merchant" }, 60_000);
    expect(verify(t)).toMatchObject({ m: "merchant-1", who: "merchant" });
    const [body, mac] = t.split(".");
    expect(verify(`${body}x.${mac}`)).toBeNull();
    expect(verify(sign({ m: "merchant-1" }, -1))).toBeNull();
  });
});

import { cleanToken } from "@/lib/merchants";
describe("pasted tokens", () => {
  it("removes line-wrap whitespace and smart dashes", () => {
    expect(cleanToken("ey Ja\tbc.\n de–f .g hi")).toBe("eyJabc.de-f.ghi");
  });
});
