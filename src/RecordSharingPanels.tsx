import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { generatePatientShareCode, loadActiveSharedPatients, loadSharedPatientDocuments, logSharedDocumentPreview, redeemPatientShareCode } from "./lib/sharing";
import type { GeneratedShareCode, SharedDocument, SharedPatient } from "./lib/sharing";

export function PatientShareCodePanel() {
  const [code, setCode] = useState<GeneratedShareCode | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function generateCode() {
    setLoading(true);
    setError("");
    try {
      setCode(await generatePatientShareCode());
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Kod nije generisan.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="panel share-code-panel">
    <div><p className="eyebrow">PRIVREMENI PRISTUP DOSIJEU</p><h2>Podijeli nalaze sa doktorom</h2><p>Generisite jednokratni kod i pokazite ga doktoru tokom pregleda. Kod vrijedi 10 minuta.</p></div>
    {code ? <div className="generated-code"><small>JEDNOKRATNI KOD</small><strong>{code.shareCode}</strong><span>Pristup doktora ce trajati 60 minuta nakon unosa.</span><button className="secondary" onClick={() => void generateCode()} disabled={loading}>{loading ? "Generisanje..." : "Generisi novi kod"}</button></div> : <button className="primary" onClick={() => void generateCode()} disabled={loading}>{loading ? "Generisanje..." : "Generisi kod"}</button>}
    {error && <p className="form-error">{error}</p>}
  </section>;
}

export function DoctorSharedRecordsPanel({ onPreview }: { onPreview: (document: SharedDocument) => void }) {
  const [code, setCode] = useState("");
  const [patient, setPatient] = useState<SharedPatient | null>(null);
  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const [category, setCategory] = useState("Svi nalazi");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const visibleDocuments = useMemo(() => documents.filter((document) => category === "Svi nalazi" || document.category === category), [category, documents]);
  const categories = useMemo(() => [...new Set(documents.map((document) => document.category))], [documents]);

  useEffect(() => {
    loadActiveSharedPatients()
      .then(async (activePatients) => {
        const activePatient = activePatients[0];
        if (!activePatient) return;
        setPatient(activePatient);
        setDocuments(await loadSharedPatientDocuments(activePatient.patientId));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Aktivni pristup nije ucitan."));
  }, []);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const activatedPatient = await redeemPatientShareCode(code);
      setPatient(activatedPatient);
      setDocuments(await loadSharedPatientDocuments(activatedPatient.patientId));
      setCode("");
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "Pristup nije aktiviran.");
    } finally {
      setLoading(false);
    }
  }

  async function preview(document: SharedDocument) {
    try {
      await logSharedDocumentPreview(document.id);
      onPreview(document);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview nije dostupan.");
    }
  }

  return <section className="panel shared-records">
    <div className="section-head"><div><p className="eyebrow">PRIVREMENI PRISTUP</p><h2>Otvori dosije pacijenta</h2></div>{patient && <span>60 MIN PRISTUP</span>}</div>
    {!patient ? <form className="redeem-code" onSubmit={redeem}>
      <p>Unesite jednokratni kod koji je pacijent generisao u svojoj aplikaciji.</p>
      <div><input required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="AB12-CD34-EF56" maxLength={14} /><button className="primary" disabled={loading}>{loading ? "Provjera..." : "Otvori dosije"}</button></div>
    </form> : <>
      <div className="shared-patient"><div><small>PACIJENT</small><strong>{patient.patientName}</strong></div><button className="secondary" onClick={() => { setPatient(null); setDocuments([]); }}>Zatvori dosije</button></div>
      <div className="shared-filter"><span>{visibleDocuments.length} nalaza</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Svi nalazi</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className="shared-list">{visibleDocuments.map((document) => <article key={document.id}><div><strong>{document.title}</strong><small>{document.date} | {document.category}</small></div><button className="preview" onClick={() => void preview(document)}>Pregledaj</button></article>)}</div>
    </>}
    {error && <p className="form-error">{error}</p>}
  </section>;
}
