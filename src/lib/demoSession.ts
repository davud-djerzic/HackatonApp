export type DemoUser = {
  email: string;
  fullName: string;
};

const STORAGE_KEY = "hope_demo_user";

/** Demo prijava — ukljucena osim ako je eksplicitno VITE_DEMO_LOGIN=false */
export const isDemoLoginEnabled = import.meta.env.VITE_DEMO_LOGIN !== "false";

export function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] || "Pacijent";
  return local
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function loadDemoUser(): DemoUser | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoUser;
    if (!parsed.email || !parsed.fullName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDemoUser(user: DemoUser) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearDemoUser() {
  sessionStorage.removeItem(STORAGE_KEY);
}
