import { SyncSettings } from "./types";

export function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing configuration: ${key}`);
  return v;
}

export function appUrl(): string {
  return env("APP_URL").replace(/\/+$/, "");
}

export function settings(): SyncSettings {
  return {
    notifyMode: process.env.PAYCENTER_NOTIFY_MODE === "customer" ? "customer" : "link",
    recordOn: process.env.RECORD_ON === "captured" ? "captured" : "settled",
    reversals: process.env.REVERSALS === "auto" ? "auto" : "review",
    webhookUrl: `${appUrl()}/api/paycenter/webhook/${env("PAYCENTER_WEBHOOK_SECRET")}`,
  };
}
