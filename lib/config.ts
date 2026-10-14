export function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing configuration: ${key}`);
  return v;
}

export function appUrl(): string {
  return env("APP_URL").replace(/\/+$/, "");
}
