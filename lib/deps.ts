import { appUrl, env, settings } from "./config";
import { freshBooks, OAuthApp } from "./freshbooks";
import { payCenter } from "./paycenter";
import { supabaseStore } from "./store";
import { Deps, Store } from "./types";

export function store(): Store {
  return supabaseStore(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

export function oauthApp(): OAuthApp {
  return {
    clientId: env("FRESHBOOKS_CLIENT_ID"),
    clientSecret: env("FRESHBOOKS_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/freshbooks/oauth/callback`,
  };
}

export function deps(): Deps {
  const s = store();
  return {
    store: s,
    fb: freshBooks(s, oauthApp(), env("FRESHBOOKS_ACCOUNT_ID")),
    pc: payCenter(env("PAYCENTER_BASE_URL"), env("PAYCENTER_SITE_ID"), env("PAYCENTER_ACCESS_TOKEN")),
    settings: settings(),
  };
}
