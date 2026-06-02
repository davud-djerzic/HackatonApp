import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClinicVisit, Diagnosis, DiagnosisStatus, DoctorNote, Medication } from "../types";
import type { MedicalDocument } from "../types";
import {
  addDiagnosis,
  addDoctorNote,
  loadClinicVisits,
  loadDiagnoses,
  loadDoctorNotes,
  loadMedications,
} from "../lib/health";
import { loadMyDocuments } from "../lib/documents";
import { seedDemoHealthData } from "../lib/demoStore";
import { buildPatientDataPayload, fetchAiHealthSummary, clearAiSummaryCache } from "../lib/ai";

type Session = {
  visitToken: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  codeId: string;
  expiresAt: string;
  accessCode?: string;
};

type DoctorDashboardProps = {
  session: Session;
  onEnd: () => void;
};

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) return setLabel("00:00:00");
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return <span>{label}</span>;
}

export default function DoctorDashboard({ session, onEnd }: DoctorDashboardProps) {
  const pid = session.patientId;
  const demoId = pid.includes("@") ? pid : undefined;
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [visits, setVisits] = useState<ClinicVisit[]>([]);
  const [notes, setNotes] = useState<DoctorNote[]>([]);
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [noteText, setNoteText] = useState("");
  const [dxTitle, setDxTitle] = useState("");
  const [aiSummary, setAiSummary] = useState<null | { summary: string; alerts: string[]; trends: string[]; suggestions: string[] }>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);

  const refresh = useCallback(async () => {
    if (demoId) seedDemoHealthData(demoId);
    const [dx, med, v, n] = await Promise.all([
      loadDiagnoses(pid, demoId),
      loadMedications(pid, demoId),
      loadClinicVisits(pid, demoId),
      loadDoctorNotes(pid, demoId),
    ]);
    setDiagnoses(dx);
    setMedications(med);
    setVisits(v);
    setNotes(n);
    try {
      const docs = await loadMyDocuments();
      setDocuments(docs.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category as MedicalDocument["category"],
        doctor: d.source === "Doktor" ? "Doktor" : "Licni dokument",
        date: d.date,
        source: d.source,
        status: d.status,
        note: d.note,
        storagePath: d.storagePath,
      })));
    } catch {
      setDocuments([]);
    }
  }, [demoId, pid]);

  useEffect(() => {
    void refresh();
    const onResize = () => setIsMobileView(window.innerWidth < 700);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [refresh]);

  async function addDx(event: FormEvent) {
    event.preventDefault();
    if (!dxTitle.trim()) return;
    await addDiagnosis({
      title: dxTitle.trim(),
      icd10Code: null,
      description: null,
      diagnosedAt: new Date().toISOString().slice(0, 10),
      diagnosedBy: session.doctorName,
      status: "aktivan" as DiagnosisStatus,
      doctorAuthored: true,
    }, pid, demoId);
    setDxTitle("");
    await refresh();
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!noteText.trim()) return;
    await addDoctorNote(noteText.trim(), session.doctorName, pid, demoId);
    setNoteText("");
    await refresh();
  }

  async function generateAiSummary() {
    setAiLoading(true);
    try {
      const payload = buildPatientDataPayload(diagnoses, medications, visits, documents);
      const data = await fetchAiHealthSummary(payload);
      setAiSummary(data as any);
    } catch (e) {
      setAiSummary({ summary: "AI nije dostupan.", alerts: [], trends: [], suggestions: [] });
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="doctor-shell">
      {isMobileView && (
        <div style={{ padding: 12, background: "#fff4e6", borderRadius: 8, marginBottom: 12 }}>
          <strong>Napomena:</strong> Doktorski pregled je optimiziran za desktop. Ako ste na telefonu, zamolite pacijenta da generiše kod i otvorite aplikaciju na računaru.
          <div style={{ marginTop: 8 }}>
            <button type="button" className="chip-btn" onClick={() => { window.location.hash = ""; }}>Nazad na pacijenta</button>
          </div>
        </div>
      )}
      <header className="doctor-topbar">
        <div>
          <p className="eyebrow">PREGLED DOKTORA</p>
          <h1>Dosije: {session.patientName}</h1>
          <small>Pristup istice za: <Countdown expiresAt={session.expiresAt} /></small>
        </div>
        <button type="button" className="profile-logout-btn" onClick={onEnd}>Zavrsi pregled</button>
      </header>

      <div className="doctor-grid-panels">
        <section className="panel">
          <h2>Dijagnoze</h2>
          <ul className="doctor-list">
            {diagnoses.map((dx) => <li key={dx.id}><strong>{dx.title}</strong> — {dx.status}</li>)}
          </ul>
          <form className="inline-form" onSubmit={addDx}>
            <input value={dxTitle} onChange={(e) => setDxTitle(e.target.value)} placeholder="Nova dijagnoza..." />
            <button type="submit" className="chip-btn">Dodaj</button>
          </form>
        </section>

        <section className="panel">
          <h2>Lijekovi</h2>
          <ul className="doctor-list">
            {medications.map((m) => <li key={m.id}>{m.name} {m.active ? "(aktivan)" : ""}</li>)}
          </ul>
        </section>

        <section className="panel">
          <h2>Dokumenti ({documents.length})</h2>
          <ul className="doctor-list">
            {documents.map((d) => <li key={d.id}>{d.title} — {d.date}</li>)}
          </ul>
        </section>

        <section className="panel">
          <h2>Biljeska doktora</h2>
          <form onSubmit={saveNote}>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Unesite biljesku..." rows={4} />
            <button type="submit" className="primary block-btn">Spremi biljesku</button>
          </form>
          {notes.map((n) => (
            <article key={n.id} className="doctor-note">
              <small>{n.doctorName} · {new Date(n.createdAt).toLocaleString("bs-BA")}</small>
              <p>{n.body}</p>
            </article>
          ))}
        </section>

        <section className="panel">
          <h2>AI Sumar</h2>
          <p>Generiši kratak sažetak pacijentovog dosijea i preporuke.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button type="button" className="chip-btn" onClick={generateAiSummary} disabled={aiLoading}>
              {aiLoading ? "Generiranje..." : "Generiši sažetak"}
            </button>
            <button type="button" className="chip-btn" onClick={() => { clearAiSummaryCache(); setAiSummary(null); }}>
              Očisti keš
            </button>
          </div>
          {aiSummary ? (
            <div>
              <h3>Sažetak</h3>
              <p>{aiSummary.summary}</p>
              {aiSummary.alerts?.length ? <div><strong>Upozorenja:</strong><ul>{aiSummary.alerts.map((a, i) => <li key={i}>{a}</li>)}</ul></div> : null}
              {aiSummary.trends?.length ? <div><strong>Trendovi:</strong><ul>{aiSummary.trends.map((t, i) => <li key={i}>{t}</li>)}</ul></div> : null}
              {aiSummary.suggestions?.length ? <div><strong>Preporuke:</strong><ul>{aiSummary.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
