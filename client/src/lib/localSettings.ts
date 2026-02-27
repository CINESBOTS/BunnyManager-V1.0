const STORAGE_KEY = "bunny_settings";

export interface LocalSettings {
  api_key?: string;
  library_id?: string;
  download_domain?: string;
  account_api_key?: string;
  evo_key?: string;
  evo_server?: string;
  evo_disk?: string;
  evo_encode?: string;
}

export function getLocalSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveLocalSetting(key: keyof LocalSettings, value: string) {
  const current = getLocalSettings();
  current[key] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function deleteLocalSetting(key: keyof LocalSettings) {
  const current = getLocalSettings();
  delete current[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function buildConfigHeader(): Record<string, string> {
  const s = getLocalSettings();
  if (!s.api_key && !s.library_id && !s.account_api_key) return {};
  return { "X-Bunny-Config": btoa(JSON.stringify(s)) };
}
