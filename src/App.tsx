import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import "./App.css";
import "./AuthPanel.css";
import "./AuthState.css";
import AuthPanel from "./AuthPanel";
import { loadMyDocuments, uploadOwnDocument } from "./lib/documents";
import { loadLinkedPatients, sendPatientReport } from "./lib/reports";
import type { LinkedPatient } from "./lib/reports";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Role = "patient" | "doctor";
type Category = "Laboratorija" | "Specijalisticki nalaz" | "Terapija" | "Snimanje" | "Ostalo";
type DocumentSource = "Doktor" | "Licni upload";
type CurrentProfile = { fullName: string; inboxAlias: string | null; role: Role };

type MedicalDocument = {
  id: number | string;
  title: string;
  category: Category;
  doctor: string;
  date: string;
  source: DocumentSource;
  status: "Novi nalaz" | "Arhivirano";
  note: string;
};

const categories: Category[] = [
  "Laboratorija",
  "Specijalisticki nalaz",
  "Terapija",
  "Snimanje",
  "Ostalo",
];

const initialDocuments: MedicalDocument[] = [
  { id: 1, title: "Kontrolni internisticki nalaz", category: "Specijalisticki nalaz", doctor: "Dr. Amila M.", date: "28.05.2026.", source: "Doktor", status: "Novi nalaz", note: "Kontrola krvnog pritiska i prilagodjena terapija." },
  { id: 2, title: "Laboratorijski nalazi - kompletna krvna slika", category: "Laboratorija", doctor: "Poliklinika Medis", date: "16.04.2026.", source: "Doktor", status: "Arhivirano", note: "Automatski zaprimljeno putem povezanog emaila." },
  { id: 3, title: "RTG snimak pluca", category: "Snimanje", doctor: "Licni dokument", date: "02.03.2026.", source: "Licni upload", status: "Arhivirano", note: "Dokument koji je pacijent samostalno dodao." },
  { id: 4, title: "Nalaz kardiologa", category: "Specijalisticki nalaz", doctor: "Dr. Dino K.", date: "11.01.2026.", source: "Doktor", status: "Arhivirano", note: "Kontrolni pregled. Nastaviti propisanu terapiju." },
  { id: 5, title: "Propisana terapija", category: "Terapija", doctor: "Dr. Amila M.", date: "11.01.2026.", source: "Doktor", status: "Arhivirano", note: "Ramipril 5 mg, jednom dnevno." },
];

function today() {
  return new Intl.DateTimeFormat("bs-BA").format(new Date());
}

function App() {
  const [role, setRole] = useState<Role>("patient");
  const [documents, setDocuments] = useState(initialDocuments);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Svi dokumenti");
  const [toast, setToast] = useState("");
  const [reportTitle, setReportTitle] = useState("Kontrolni internisticki nalaz");
  const [reportCategory, setReportCategory] = useState<Category>("Specijalisticki nalaz");
  const [reportNote, setReportNote] = useState("");
  const [sent, setSent] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [patients, setPatients] = useState<LinkedPatient[]>([]);
  const [patientId, setPatientId] = useState("");
  const [sendError, setSendError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [hasSession, setHasSession] = useState(!isSupabaseConfigured);
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(null);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setProfileError("");
      setCurrentProfile(null);
      setHasSession(Boolean(session));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !hasSession) return;
    supabase.from("profiles").select("full_name, inbox_alias, role").single().then(({ data, error }) => {
      if (error) {
        setProfileError("Profil nije ucitan. Pokrenite supabase/schema.sql ili kontaktirajte administratora.");
        return;
      }
      if (data?.role === "doctor" || data?.role === "patient") {
        setRole(data.role);
        setCurrentProfile({ fullName: data.full_name, inboxAlias: data.inbox_alias, role: data.role });
      }
    });
  }, [hasSession]);

  useEffect(() => {
    if (!isSupabaseConfigured || role !== "patient" || !hasSession) return;
    loadMyDocuments()
      .then((loadedDocuments) => setDocuments(loadedDocuments.map((document) => ({ ...document, doctor: document.source === "Doktor" ? "Doktor" : "Licni dokument", category: document.category as Category }))))
      .catch((error: unknown) => notify(error instanceof Error ? error.message : "Dokumenti nisu ucitani."));
  }, [hasSession, role]);

  useEffect(() => {
    if (role !== "doctor") return;
    loadLinkedPatients()
      .then((loadedPatients) => {
        setPatients(loadedPatients);
        setPatientId((current) => current || loadedPatients[0]?.id || "");
        setSendError(loadedPatients.length ? "" : "Nema povezanih pacijenata za prijavljenog doktora.");
      })
      .catch((error: unknown) => setSendError(error instanceof Error ? error.message : "Nije moguce ucitati pacijente."));
  }, [role]);

  const visibleDocuments = useMemo(() => {
    return documents.filter((document) => {
      const matchesSearch = `${document.title} ${document.doctor}`.toLowerCase().includes(search.toLowerCase());
      return matchesSearch && (category === "Svi dokumenti" || document.category === category);
    });
  }, [category, documents, search]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function addUploadedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (isSupabaseConfigured) {
      try {
        await uploadOwnDocument(file);
        const loadedDocuments = await loadMyDocuments();
        setDocuments(loadedDocuments.map((document) => ({ ...document, doctor: document.source === "Doktor" ? "Doktor" : "Licni dokument", category: document.category as Category })));
        notify("Dokument je sigurno dodan u vas dosije.");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Upload dokumenta nije uspio.");
      }
      event.target.value = "";
      return;
    }
    setDocuments((current) => [{
      id: Date.now(),
      title: file.name.replace(/\.[^/.]+$/, ""),
      category: "Ostalo",
      doctor: "Licni dokument",
      date: today(),
      source: "Licni upload",
      status: "Novi nalaz",
      note: "Dokument koji ste samostalno dodali u svoj zdravstveni dosije.",
    }, ...current]);
    notify("Dokument je sigurno dodan u vas dosije.");
    event.target.value = "";
  }

  if (!authReady) return <main className="auth-shell"><p>Provjera prijave...</p></main>;
  if (isSupabaseConfigured && !hasSession) return <AuthPanel />;
  if (isSupabaseConfigured && profileError) return <main className="auth-shell"><section className="panel auth-state"><h2>Profil nije dostupan</h2><p>{profileError}</p><button className="primary" onClick={() => supabase?.auth.signOut()}>Odjavi se</button></section></main>;
  if (isSupabaseConfigured && !currentProfile) return <main className="auth-shell"><p>Ucitavanje profila...</p></main>;

  async function sendReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError("");
    setSent(false);
    if (!patientId) return setSendError("Odaberite pacijenta.");
    if (!reportFile) return setSendError("Dodajte PDF nalaz.");
    setIsSending(true);
    try {
      await sendPatientReport({ patientId, title: reportTitle, category: reportCategory, notes: reportNote, file: reportFile });
      setSent(true);
      notify("Nalaz je sigurno arhiviran i email obavijest je poslana.");
      setReportNote("");
      setReportFile(null);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Slanje nalaza nije uspjelo.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><b>C</b><div><strong>CareTrace</strong><small>Licni zdravstveni dosije</small></div></div>
        <nav>
          <a className="active" href="#dosije"><span>+</span> Moj dosije</a>
          <a href="#dokumenti"><span>F</span> Dokumenti</a>
          <a href="#obavijesti"><span>N</span> Obavijesti <i>2</i></a>
          <a href="#profil"><span>O</span> Moj profil</a>
        </nav>
        <div className="privacy-card"><strong>Vasi podaci su zasticeni</strong><small>Dokumenti su dostupni samo vama i ovlastenim ljekarima.</small></div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobile-brand">CareTrace</div>
          {!isSupabaseConfigured && <div className="role-switch">
            <button className={role === "patient" ? "selected" : ""} onClick={() => setRole("patient")}>Pacijent</button>
            <button className={role === "doctor" ? "selected" : ""} onClick={() => setRole("doctor")}>Doktor</button>
          </div>}
          <div className="profile"><div><strong>{currentProfile?.fullName || (role === "patient" ? "Pacijent" : "Doktor")}</strong><small>{role === "patient" ? "Licni dosije" : "Ordinacija"}</small></div><b>{role === "patient" ? "P" : "D"}</b>{isSupabaseConfigured && <button className="logout" onClick={() => supabase?.auth.signOut()}>Odjava</button>}</div>
        </header>

        {role === "patient" ? (
          <>
            <section className="welcome">
              <div><p className="eyebrow">LICNI ZDRAVSTVENI DOSIJE</p><h1>Dobro dosli{currentProfile?.fullName ? `, ${currentProfile.fullName}` : ""}.</h1><p>Svi vasi nalazi i medicinski dokumenti na jednom sigurnom mjestu.</p></div>
              <label className="upload"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={addUploadedFile} /><span>+</span> Dodaj dokument</label>
            </section>
            <section className="stats">
              <article><span className="stat-icon green">F</span><div><b>{documents.length}</b><small>Ukupno dokumenata</small></div></article>
              <article><span className="stat-icon amber">N</span><div><b>{documents.filter((item) => item.status === "Novi nalaz").length}</b><small>Nova nalaza</small></div></article>
              <article><span className="stat-icon blue">@</span><div><b>Povezan</b><small>{currentProfile?.inboxAlias || "Privatni CareTrace inbox"}</small></div></article>
            </section>
            <section className="panel documents">
              <div className="section-head"><div><p className="eyebrow">MEDICINSKA ARHIVA</p><h2>Moji dokumenti</h2></div><span>{visibleDocuments.length} dokumenata</span></div>
              <div className="filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pretrazi nalaze ili ordinacije..." /><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Svi dokumenti</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
              <DocumentList documents={visibleDocuments} />
            </section>
          </>
        ) : (
          <DoctorView title={reportTitle} setTitle={setReportTitle} category={reportCategory} setCategory={setReportCategory} note={reportNote} setNote={setReportNote} onSubmit={sendReport} sent={sent} documents={documents} patients={patients} patientId={patientId} setPatientId={setPatientId} reportFile={reportFile} setReportFile={setReportFile} sendError={sendError} isSending={isSending} />
        )}
        <footer>CareTrace zdravstveni dosije | Prototip za sigurno cuvanje medicinske dokumentacije</footer>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function DocumentList({ documents }: { documents: MedicalDocument[] }) {
  return <div className="document-list">{documents.map((document) => (
    <article className="document-row" key={document.id}>
      <span className={`file-icon ${document.category === "Laboratorija" ? "lab" : ""}`}>PDF</span>
      <div className="document-info"><div><h3>{document.title}</h3>{document.status === "Novi nalaz" && <em>NOVO</em>}</div><p>{document.doctor} <i /> {document.date}</p><small>{document.category}</small></div>
      <div className="source"><small>{document.source === "Doktor" ? "AUTOMATSKI ZAPRIMLJENO" : "LICNO DODANO"}</small><b>{document.source === "Doktor" ? "Putem emaila" : "Vas upload"}</b></div>
      <button className="more" aria-label="Vise opcija">...</button>
    </article>
  ))}</div>;
}

type DoctorViewProps = {
  title: string; setTitle: (value: string) => void; category: Category; setCategory: (value: Category) => void;
  note: string; setNote: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  sent: boolean; documents: MedicalDocument[]; patients: LinkedPatient[]; patientId: string; setPatientId: (value: string) => void;
  reportFile: File | null; setReportFile: (value: File | null) => void; sendError: string; isSending: boolean;
};

function DoctorView({ title, setTitle, category, setCategory, note, setNote, onSubmit, sent, documents, patients, patientId, setPatientId, reportFile, setReportFile, sendError, isSending }: DoctorViewProps) {
  return <>
    <section className="welcome"><div><p className="eyebrow">ORDINACIJA</p><h1>Slanje nalaza pacijentu</h1><p>Zavrseni nalaz se putem povezanog emaila automatski pohranjuje u pacijentov dosije.</p></div></section>
    <section className="doctor-grid">
      <form className="panel send-form" onSubmit={onSubmit}>
        <div className="section-head"><div><p className="eyebrow">NOVI NALAZ</p><h2>Posalji dokument</h2></div><span className="secure">SIGURAN TOK</span></div>
        <label>Pacijent</label><div className="patient-picker"><b>P</b><select required value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Odaberite povezanog pacijenta</option>{patients.map((patient) => <option value={patient.id} key={patient.id}>{patient.fullName}{patient.inboxAlias ? ` | ${patient.inboxAlias}` : ""}</option>)}</select><i>Povezan</i></div>
        <label>Naziv nalaza</label><input required value={title} onChange={(event) => setTitle(event.target.value)} />
        <label>Vrsta dokumenta</label><select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
        <label>Kratka napomena za pacijenta</label><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Unesite zakljucak ili upute..." />
        <label className="attachment"><input type="file" accept="application/pdf,.pdf" onChange={(event) => setReportFile(event.target.files?.[0] || null)} /><span>+</span><strong>{reportFile?.name || "Dodaj PDF nalaz"}</strong><small>Dokument ce biti sigurno arhiviran u dosijeu.</small></label>
        {sendError && <p className="form-error">{sendError}</p>}
        <button className="primary" type="submit" disabled={isSending}>{isSending ? "Slanje u toku..." : "Posalji nalaz pacijentu"} <span>-&gt;</span></button>
      </form>
      <aside className="doctor-side">
        <section className="panel flow"><p className="eyebrow">AUTOMATSKO ARHIVIRANJE</p><h2>Kako radi povezani inbox?</h2>
          <div><b>1</b><p><strong>Doktor salje nalaz</strong><small>Dokument ide na privatnu adresu pacijenta.</small></p></div>
          <div><b>2</b><p><strong>CareTrace prepoznaje pacijenta</strong><small>Email servis provjerava sigurni token i posiljaoca.</small></p></div>
          <div><b>3</b><p><strong>Nalaz se cuva u dosije</strong><small>Pacijent odmah dobija obavijest u aplikaciji.</small></p></div>
        </section>
        {sent && <section className="success"><b>Poslano</b><p>Nalaz je dodat u dosije pacijenta Emir Hadzic.</p></section>}
        <section className="panel recent"><p className="eyebrow">PACIJENTOV DOSIJE</p><h2>Posljednji nalazi</h2>{documents.slice(0, 3).map((document) => <div key={document.id}><strong>{document.title}</strong><small>{document.date} | {document.category}</small></div>)}</section>
      </aside>
    </section>
  </>;
}

export default App;
