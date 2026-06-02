import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppView, ClinicVisit, Diagnosis, MedicalDocument, Medication, PatientProfile } from "../types";
import { DOCUMENT_CATEGORIES, SPECIALIZATIONS } from "../constants/categories";
import { NAV_ITEMS, hashFromView, viewFromHash } from "../constants/navigation";
import AccessCode from "./AccessCode";
import AISummary from "./AISummary";
import HealthProfile from "./HealthProfile";
import HealthStats from "./HealthStats";
import NavIcon from "./NavIcon";
import { createDocumentPreviewUrl, loadMyDocuments } from "../lib/documents";
import { loadClinicVisits, loadDiagnoses, loadMedications } from "../lib/health";
import { isSupabaseConfigured } from "../lib/supabase";
import "../extensions.css";

type PatientDashboardProps = {
  profile: PatientProfile;
  demoPatientId?: string;
  initialDocuments: MedicalDocument[];
  onSignOut: () => void;
};

function SidebarContent({
  view,
  profile,
  onNavigate,
  onSignOut,
}: {
  view: AppView;
  profile: PatientProfile;
  onNavigate: (id: AppView) => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <div className="brand">
        <b>H</b>
        <div>
          <strong>HOPE</strong>
          <small>Lični medicinski karton</small>
        </div>
      </div>
      <p className="sidebar-user">{profile.fullName}</p>
      <nav>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-btn ${view === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon src={item.icon} label={item.label} active={view === item.id} variant="sidebar" />
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="privacy-card">
        <strong>Zvanični dosije</strong>
        <small>Nalaze unosi samo ovlašteni ljekar.</small>
      </div>
      <button type="button" className="sidebar-logout" onClick={onSignOut}>
        Odjavi se
      </button>
    </>
  );
}

function BottomNav({ view, onNavigate }: { view: AppView; onNavigate: (id: AppView) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Glavna navigacija">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`bottom-nav-btn ${view === item.id ? "active" : ""}`}
          onClick={() => onNavigate(item.id)}
          aria-current={view === item.id ? "page" : undefined}
        >
          <NavIcon src={item.icon} label={item.label} active={view === item.id} variant="bottom" />
          <span>{item.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}

export default function PatientDashboard({
  profile,
  demoPatientId,
  initialDocuments,
  onSignOut,
}: PatientDashboardProps) {
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash || "#dosije"));
  const [documents, setDocuments] = useState(initialDocuments);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Svi dokumenti");
  const [specialization, setSpecialization] = useState("Sve specijalizacije");
  const [diagnosisFilter, setDiagnosisFilter] = useState("Sve dijagnoze");
  const [toast, setToast] = useState("");
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [visits, setVisits] = useState<ClinicVisit[]>([]);

  const currentNav = NAV_ITEMS.find((n) => n.id === view)!;

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  function navigate(next: AppView) {
    const hash = hashFromView(next);
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const onHash = () => {
      const next = viewFromHash(window.location.hash || "#dosije");
      setView(next);
    };
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash || window.location.hash === "#") {
      window.location.hash = "#dosije";
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadHealthMeta = useCallback(async () => {
    try {
      const [dx, med, v] = await Promise.all([
        loadDiagnoses(undefined, demoPatientId),
        loadMedications(undefined, demoPatientId),
        loadClinicVisits(undefined, demoPatientId),
      ]);
      setDiagnoses(dx);
      setMedications(med);
      setVisits(v);
    } catch { /* demo */ }
  }, [demoPatientId]);

  useEffect(() => {
    void loadHealthMeta();
  }, [loadHealthMeta]);

  useEffect(() => {
    document.body.classList.toggle("sidebar-open", sidebarOpen);
    return () => document.body.classList.remove("sidebar-open");
  }, [sidebarOpen]);

  useEffect(() => {
    if (demoPatientId || !isSupabaseConfigured) return;
    loadMyDocuments()
      .then((loaded) => setDocuments(loaded.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category as MedicalDocument["category"],
        doctor: d.source === "Doktor" ? "Doktor" : "Klinika",
        date: d.date,
        source: "Doktor",
        status: d.status,
        note: d.note,
        storagePath: d.storagePath,
      }))))
      .catch((e: unknown) => notify(e instanceof Error ? e.message : "Greška učitavanja."));
  }, [demoPatientId, notify]);

  const visibleDocuments = useMemo(() => documents.filter((doc) => {
    if (doc.source === "Licni upload") return false;
    const matchSearch = `${doc.title} ${doc.doctor} ${doc.specialization ?? ""}`.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "Svi dokumenti" || doc.category === category;
    const matchSpec = category !== "Specijalisticki nalaz"
      || specialization === "Sve specijalizacije"
      || doc.specialization === specialization;
    const matchDx = diagnosisFilter === "Sve dijagnoze" || doc.note.includes(diagnosisFilter) || doc.title.includes(diagnosisFilter);
    return matchSearch && matchCat && matchSpec && matchDx;
  }), [category, diagnosisFilter, documents, search, specialization]);

  async function previewDocument(doc: MedicalDocument) {
    if (!doc.storagePath || demoPatientId) {
      notify("Pregled dokumenta trenutno nije dostupan.");
      return;
    }
    try {
      const url = await createDocumentPreviewUrl(doc.storagePath);
      setPreview({ title: doc.title, url });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Pregled nije dostupan.");
    }
  }

  const activeDx = diagnoses.filter((d) => d.status === "aktivan").length;
  const activeMed = medications.filter((m) => m.active).length;
  const officialDocs = documents.filter((d) => d.source === "Doktor").length;

  return (
    <div className={`app-shell has-bottom-nav ${sidebarOpen ? "sidebar-open" : ""}`}>
      <aside className="sidebar sidebar-desktop">
        <SidebarContent view={view} profile={profile} onNavigate={navigate} onSignOut={onSignOut} />
      </aside>

      <div className={`mobile-drawer ${sidebarOpen ? "open" : ""}`} aria-hidden={!sidebarOpen}>
        <div className="mobile-drawer-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden />
        <aside className="sidebar sidebar-mobile">
          <button type="button" className="drawer-close" onClick={() => setSidebarOpen(false)} aria-label="Zatvori meni">
            ×
          </button>
          <SidebarContent view={view} profile={profile} onNavigate={navigate} onSignOut={onSignOut} />
        </aside>
      </div>

      <main className="main-content">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-btn"
            aria-expanded={sidebarOpen}
            aria-label="Otvori navigaciju"
            onClick={() => setSidebarOpen(true)}
          >
            <span /><span /><span />
          </button>
          <div className="topbar-title">
            <span className="mobile-brand">HOPE</span>
            <small>{currentNav.label}</small>
          </div>
          <button type="button" className="topbar-logout" onClick={onSignOut}>
            Odjava
          </button>
        </header>

        <div className="page-view">
          <header className="page-header">
            <p className="eyebrow">{currentNav.label.toUpperCase()}</p>
            <h1>{currentNav.label}</h1>
          </header>

          {view === "dosije" && (
            <div className="page-sections">
              <section className="welcome welcome-polished welcome-compact">
                <p className="welcome-sub">
                  Dobrodošli, <strong>{profile.fullName}</strong>. Pregled službenih nalaza koje je unio vaš ljekar.
                </p>
              </section>

              <section className="stats stats-extended stats-polished">
                <article className="stat-card">
                  <span className="stat-icon green" aria-hidden>📄</span>
                  <div><b>{officialDocs}</b><small>Službenih dokumenata</small></div>
                </article>
                <article className="stat-card">
                  <span className="stat-icon purple" aria-hidden>🩺</span>
                  <div><b>{activeDx}</b><small>Aktivnih dijagnoza</small></div>
                </article>
                <article className="stat-card">
                  <span className="stat-icon red" aria-hidden>💊</span>
                  <div><b>{activeMed}</b><small>Aktivnih lijekova</small></div>
                </article>
              </section>

              <AISummary diagnoses={diagnoses} medications={medications} visits={visits} documents={documents} />

              <div className="readonly-banner">
                Dokumente dodaje isključivo ljekar ili ustanova — samostalan upload nije dozvoljen.
              </div>

              <section className="panel documents">
                <div className="section-head">
                  <div><p className="eyebrow">SLUŽBENA ARHIVA</p><h2>Moji nalazi</h2></div>
                  <span className="count-badge">{visibleDocuments.length} dokumenata</span>
                </div>
                <div className="filters filters-polished">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pretraži po nazivu ili ljekaru..." />
                  <select value={category} onChange={(e) => { setCategory(e.target.value); setSpecialization("Sve specijalizacije"); }}>
                    <option>Svi dokumenti</option>
                    {DOCUMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  {category === "Specijalisticki nalaz" && (
                    <select value={specialization} onChange={(e) => setSpecialization(e.target.value)}>
                      <option>Sve specijalizacije</option>
                      {SPECIALIZATIONS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  )}
                  <select value={diagnosisFilter} onChange={(e) => setDiagnosisFilter(e.target.value)}>
                    <option>Sve dijagnoze</option>
                    {diagnoses.map((d) => <option key={d.id} value={d.title}>{d.title}</option>)}
                  </select>
                </div>
                <div className="document-list">
                  {visibleDocuments.map((doc) => (
                    <article className="document-row document-row-polished" key={doc.id}>
                      <span className={`file-icon ${doc.category === "Laboratorija" ? "lab" : ""}`}>PDF</span>
                      <div className="document-info">
                        <div>
                          <h3>{doc.title}</h3>
                          {doc.status === "Novi nalaz" && <em className="badge-new">NOVO</em>}
                        </div>
                        <p>{doc.doctor} · {doc.date}</p>
                        <div className="doc-tags">
                          <small>{doc.category}</small>
                          {doc.specialization && <small className="spec-tag">{doc.specialization}</small>}
                        </div>
                      </div>
                      <button type="button" className="preview" onClick={() => void previewDocument(doc)}>Pregledaj</button>
                    </article>
                  ))}
                  {visibleDocuments.length === 0 && (
                    <p className="empty-hint empty-center">Nema dokumenata za odabrane filtere.</p>
                  )}
                </div>
              </section>
            </div>
          )}

          {view === "dijagnoze" && (
            <div className="page-sections">
              <HealthProfile demoPatientId={demoPatientId} view="dijagnoze" />
            </div>
          )}

          {view === "terapija" && (
            <div className="page-sections">
              <HealthProfile demoPatientId={demoPatientId} view="terapija" />
            </div>
          )}

          {view === "statistike" && (
            <div className="page-sections">
              <HealthStats documents={documents.filter((d) => d.source === "Doktor")} visits={visits} />
            </div>
          )}

          {view === "pristup" && (
            <div className="page-sections">
              <AccessCode demoPatientId={demoPatientId} onNotify={notify} />
            </div>
          )}

          <footer className="app-footer">HOPE · Lični medicinski karton</footer>
        </div>
      </main>

      <BottomNav view={view} onNavigate={navigate} />

      {toast && <div className="toast toast-above-nav">{toast}</div>}
      {preview && (
        <div className="preview-overlay" role="dialog">
          <section className="preview-panel">
            <header>
              <h2>{preview.title}</h2>
              <button type="button" onClick={() => setPreview(null)}>×</button>
            </header>
            <iframe src={preview.url} title={preview.title} />
          </section>
        </div>
      )}
    </div>
  );
}
