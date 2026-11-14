// App Settings and the custom domain, as the API's /apps/{id}/settings and
// /apps/{id}/domain show them. Secrets are never in these: the API answers
// only whether one is set (e.g. clientSecretSet).

/** Any subset of the sections GET /settings answers; the API checks it */
export type SettingsPatch = Record<string, Record<string, unknown>>;

export interface AppSettingsView {
  users: Record<string, unknown>;
  socialLogin: Record<string, Record<string, unknown>>;
  email: Record<string, unknown>;
  customPages: Record<string, unknown>;
  push: Record<string, unknown>;
  liveQueries: { classes: string[] };
  api: Record<string, unknown>;
  /** setting -> the Parse Server version it needs, null when the app has it */
  availability: Record<string, string | null>;
}

export interface SettingsUpdate {
  settings: AppSettingsView;
  /** The deployment env changed: the app rolls out again */
  redeploys: boolean;
}

export interface CustomDomain {
  hostName: string | null;
  letsEncrypt: boolean;
  dns: { target: string; records: string[] };
  /** Set by PUT/DELETE: the change rolls the app out again */
  redeploys?: boolean;
}
