import type { AppView } from "../types";

export type NavItem = {
  id: AppView;
  label: string;
  shortLabel: string;
  icon: string;
  hash: string;
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dosije", label: "Moj dosije", shortLabel: "Dosije", icon: "/nav/home.png", hash: "#dosije" },
  { id: "dijagnoze", label: "Dijagnoze", shortLabel: "Dijagnoze", icon: "/nav/heart.png", hash: "#dijagnoze" },
  { id: "terapija", label: "Terapija", shortLabel: "Terapija", icon: "/nav/pill.png", hash: "#terapija" },
  { id: "statistike", label: "Statistike", shortLabel: "Statistike", icon: "/nav/stats.png", hash: "#statistike" },
  { id: "pristup", label: "Pristup doktoru", shortLabel: "Kod", icon: "/nav/qr.png", hash: "#pristup" },
];

export function viewFromHash(hash: string): AppView {
  const item = NAV_ITEMS.find((nav) => nav.hash === hash);
  return item?.id ?? "dosije";
}

export function hashFromView(view: AppView): string {
  return NAV_ITEMS.find((nav) => nav.id === view)?.hash ?? "#dosije";
}
