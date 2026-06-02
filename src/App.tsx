import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import "./App.css";
import "./AuthPanel.css";
import "./AuthState.css";
import "./DocumentPreview.css";
import "./RecordSharingPanels.css";
import "./SourceReferences.css";
import "./UploadClassification.css";
import AuthPanel from "./AuthPanel";
import { DoctorSharedRecordsPanel, PatientShareCodePanel, PatientSymptomsPanel } from "./RecordSharingPanels";
import { createDocumentPreviewUrl, loadMyDocuments, uploadOwnDocument } from "./lib/documents";
import { sendPatientReport } from "./lib/reports";
import type { SharedDocument } from "./lib/sharing";
import { documentSpecialties } from "./lib/specialties";
import type { DocumentSpecialty } from "./lib/specialties";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Role = "patient" | "doctor";
type Category = "Laboratory" | "Specialist report" | "Therapy" | "Imaging" | "Other";
type DocumentSource = "Doctor" | "Personal upload";
type DoctorWorkspaceTab = "patient-workspace" | "send-report";
type CurrentProfile = { fullName: string; inboxAlias: string | null; role: Role };

type MedicalDocument = {
  id: number | string;
  title: string;
  category: Category;
  specialty: string;
  doctor: string;
  date: string;
  source: DocumentSource;
  status: "New record" | "Archived";
  note: string;
  storagePath?: string;
};

type PreviewDocument = {
  title: string;
  url: string;
};

const categories: Category[] = [
  "Laboratory",
  "Specialist report",
  "Therapy",
  "Imaging",
  "Other",
];

const initialDocuments: MedicalDocument[] = [
  { id: 1, title: "Follow-up internal medicine report", category: "Specialist report", specialty: "General medicine", doctor: "Dr. Amila M.", date: "28/05/2026", source: "Doctor", status: "New record", note: "Blood pressure follow-up and adjusted therapy." },
  { id: 2, title: "Laboratory report - complete blood count", category: "Laboratory", specialty: "Laboratory medicine", doctor: "Medis Clinic", date: "16/04/2026", source: "Doctor", status: "Archived", note: "Automatically received through the connected email workflow." },
  { id: 3, title: "Chest X-ray", category: "Imaging", specialty: "Radiology", doctor: "Personal document", date: "02/03/2026", source: "Personal upload", status: "Archived", note: "Document uploaded by the patient." },
  { id: 4, title: "Cardiology report", category: "Specialist report", specialty: "Cardiology", doctor: "Dr. Dino K.", date: "11/01/2026", source: "Doctor", status: "Archived", note: "Follow-up examination. Continue prescribed therapy." },
  { id: 5, title: "Prescribed therapy", category: "Therapy", specialty: "Cardiology", doctor: "Dr. Amila M.", date: "11/01/2026", source: "Doctor", status: "Archived", note: "Ramipril 5 mg once daily." },
];

function today() {
  return new Intl.DateTimeFormat("en-GB").format(new Date());
}

function App() {
  const [role, setRole] = useState<Role>("patient");
  const [documents, setDocuments] = useState(initialDocuments);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All documents");
  const [specialty, setSpecialty] = useState("All specialties");
  const [toast, setToast] = useState("");
  const [reportTitle, setReportTitle] = useState("Follow-up internal medicine report");
  const [reportCategory, setReportCategory] = useState<Category>("Specialist report");
  const [reportSpecialty, setReportSpecialty] = useState<DocumentSpecialty>("General medicine");
  const [reportNote, setReportNote] = useState("");
  const [reportClinicalSummary, setReportClinicalSummary] = useState("");
  const [reportTherapy, setReportTherapy] = useState("");
  const [reportInstitution, setReportInstitution] = useState("");
  const [sent, setSent] = useState(false);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [patientEmail, setPatientEmail] = useState("");
  const [sendError, setSendError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [hasSession, setHasSession] = useState(!isSupabaseConfigured);
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const [pendingPatientUpload, setPendingPatientUpload] = useState<File | null>(null);
  const [patientUploadCategory, setPatientUploadCategory] = useState<Category>("Other");
  const [patientUploadSpecialty, setPatientUploadSpecialty] = useState<DocumentSpecialty>("General medicine");
  const [isUploadingOwnDocument, setIsUploadingOwnDocument] = useState(false);
  const [doctorWorkspaceTab, setDoctorWorkspaceTab] = useState<DoctorWorkspaceTab>("patient-workspace");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setHasSession(Boolean(session));
      if (event === "SIGNED_OUT" || !session) {
        setProfileError("");
        setCurrentProfile(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !hasSession) return;
    const client = supabase;
    client.auth.getUser().then(async ({ data: { user }, error: userError }) => {
      if (userError || !user) {
        setProfileError("Your session has expired. Sign out and sign in again.");
        return;
      }
      const { data, error } = await client
        .from("profiles")
        .select("full_name, inbox_alias, role")
        .eq("id", user.id)
        .single();
      if (error) {
        setProfileError("Your profile could not be loaded. Run supabase/repair-profiles.sql in the SQL Editor or contact the administrator.");
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
      .then((loadedDocuments) => setDocuments(loadedDocuments.map((document) => ({ ...document, doctor: document.source === "Doctor" ? "Doctor" : "Personal document", category: document.category as Category }))))
      .catch((error: unknown) => notify(error instanceof Error ? error.message : "Documents could not be loaded."));
  }, [hasSession, role]);

  const visibleDocuments = useMemo(() => {
    return documents.filter((document) => {
      const matchesSearch = `${document.title} ${document.doctor} ${document.specialty}`.toLowerCase().includes(search.toLowerCase());
      return matchesSearch && (category === "All documents" || document.category === category) && (specialty === "All specialties" || document.specialty === specialty);
    });
  }, [category, documents, search, specialty]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function addUploadedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingPatientUpload(file);
    event.target.value = "";
  }

  async function confirmPatientUpload() {
    if (!pendingPatientUpload) return;
    setIsUploadingOwnDocument(true);
    if (isSupabaseConfigured) {
      try {
        await uploadOwnDocument(pendingPatientUpload, patientUploadCategory, patientUploadSpecialty);
        const loadedDocuments = await loadMyDocuments();
        setDocuments(loadedDocuments.map((document) => ({ ...document, doctor: document.source === "Doctor" ? "Doctor" : "Personal document", category: document.category as Category })));
        notify("The document was securely added to your record.");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Document upload failed.");
      } finally {
        setIsUploadingOwnDocument(false);
      }
      setPendingPatientUpload(null);
      return;
    }
    setDocuments((current) => [{
      id: Date.now(),
      title: pendingPatientUpload.name.replace(/\.[^/.]+$/, ""),
      category: patientUploadCategory,
      specialty: patientUploadSpecialty,
      doctor: "Personal document",
      date: today(),
      source: "Personal upload",
      status: "New record",
      note: "Document uploaded by the patient to their personal health record.",
    }, ...current]);
    notify("The document was securely added to your record.");
    setPendingPatientUpload(null);
    setIsUploadingOwnDocument(false);
  }

  async function previewDocument(document: MedicalDocument) {
    if (!document.storagePath || !isSupabaseConfigured) {
      notify("Preview is available for documents stored in the Supabase record.");
      return;
    }
    try {
      const signedUrl = await createDocumentPreviewUrl(document.storagePath);
      setPreview({ title: document.title, url: signedUrl });
    } catch (error) {
      notify(error instanceof Error ? error.message : "PDF preview is unavailable.");
    }
  }

  async function previewSharedDocument(document: SharedDocument) {
    try {
      const signedUrl = await createDocumentPreviewUrl(document.storagePath);
      setPreview({ title: document.title, url: signedUrl });
    } catch (error) {
      notify(error instanceof Error ? error.message : "PDF preview is unavailable.");
    }
  }

  if (!authReady) return <main className="auth-shell"><p>Checking your session...</p></main>;
  if (isSupabaseConfigured && !hasSession) return <AuthPanel />;
  if (isSupabaseConfigured && profileError) return <main className="auth-shell"><section className="panel auth-state"><h2>Profile unavailable</h2><p>{profileError}</p><button className="primary" onClick={() => supabase?.auth.signOut()}>Sign out</button></section></main>;
  if (isSupabaseConfigured && !currentProfile) return <main className="auth-shell"><p>Loading profile...</p></main>;

  async function sendReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError("");
    setSent(false);
    if (!patientEmail.trim()) return setSendError("Enter the patient's email address.");
    if (!reportFile) return setSendError("Add a PDF report.");
    setIsSending(true);
    try {
      const structuredNotes = [
        reportInstitution.trim() && `Institution: ${reportInstitution.trim()}`,
        reportClinicalSummary.trim() && `Clinical summary: ${reportClinicalSummary.trim()}`,
        reportTherapy.trim() && `Therapy / next steps: ${reportTherapy.trim()}`,
        reportNote.trim() && `Patient instructions: ${reportNote.trim()}`,
      ].filter(Boolean).join("\n\n");
      const result = await sendPatientReport({ patientEmail: patientEmail.trim(), title: reportTitle, category: reportCategory, specialty: reportSpecialty, notes: structuredNotes, file: reportFile });
      setSent(true);
      if (result.extractedLabResults) {
        notify(`The report has been archived. ${result.extractedLabResults} laboratory values were extracted automatically.`);
      } else if (result.extractionWarning) {
        notify(result.extractionWarning);
      } else {
        notify("The report was securely archived and the email notification was sent.");
      }
      setReportNote("");
      setReportClinicalSummary("");
      setReportTherapy("");
      setReportInstitution("");
      setReportFile(null);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "The report could not be sent.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><b>H</b><div><strong>HOPE</strong><small>Personal health record</small></div></div>
        <nav>
          <a className="active" href="#record"><span>+</span> My record</a>
          <a href="#documents"><span>F</span> Documents</a>
          <a href="#notifications"><span>N</span> Notifications <i>2</i></a>
          <a href="#profile"><span>O</span> My profile</a>
        </nav>
        <div className="privacy-card"><strong>Your data is protected</strong><small>Documents are available only to you and authorized doctors.</small></div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobile-brand">HOPE</div>
          {!isSupabaseConfigured && <div className="role-switch">
            <button className={role === "patient" ? "selected" : ""} onClick={() => setRole("patient")}>Patient</button>
            <button className={role === "doctor" ? "selected" : ""} onClick={() => setRole("doctor")}>Doctor</button>
          </div>}
          <div className="profile"><div><strong>{currentProfile?.fullName || (role === "patient" ? "Patient" : "Doctor")}</strong><small>{role === "patient" ? "Personal record" : "Practice"}</small></div><b>{role === "patient" ? "P" : "D"}</b>{isSupabaseConfigured && <button className="logout" onClick={() => supabase?.auth.signOut()}>Sign out</button>}</div>
        </header>

        {role === "patient" ? (
          <>
            <section className="welcome">
              <div><p className="eyebrow">PERSONAL HEALTH RECORD</p><h1>Welcome{currentProfile?.fullName ? `, ${currentProfile.fullName}` : ""}.</h1><p>All your reports and medical documents in one secure place.</p></div>
              <label className="upload"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={addUploadedFile} /><span>+</span> Add document</label>
            </section>
            <section className="stats">
              <article><span className="stat-icon green">F</span><div><b>{documents.length}</b><small>Total documents</small></div></article>
              <article><span className="stat-icon amber">N</span><div><b>{documents.filter((item) => item.status === "New record").length}</b><small>New reports</small></div></article>
              <article><span className="stat-icon blue">@</span><div><b>Connected</b><small>{currentProfile?.inboxAlias || "Private HOPE inbox"}</small></div></article>
            </section>
            {isSupabaseConfigured && <PatientShareCodePanel />}
            {isSupabaseConfigured && <PatientSymptomsPanel />}
            <section className="panel documents">
              <div className="section-head"><div><p className="eyebrow">MEDICAL ARCHIVE</p><h2>My documents</h2></div><span>{visibleDocuments.length} documents</span></div>
              <div className="filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports, practices or specialties..." /><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All documents</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><select value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option>All specialties</option>{documentSpecialties.map((item) => <option key={item}>{item}</option>)}</select></div>
              <DocumentList documents={visibleDocuments} onPreview={previewDocument} />
            </section>
          </>
        ) : (
          <>
            <section className="doctor-workspace-head">
              <div><p className="eyebrow">DOCTOR PORTAL</p><h1>Clinical workspace</h1><p>Open a patient record for review or send a new PDF report through a separate secure flow.</p></div>
              <div className="doctor-workspace-tabs" role="tablist" aria-label="Doctor workspace">
                <button className={doctorWorkspaceTab === "patient-workspace" ? "selected" : ""} onClick={() => setDoctorWorkspaceTab("patient-workspace")} role="tab" aria-selected={doctorWorkspaceTab === "patient-workspace"}>Patient workspace</button>
                <button className={doctorWorkspaceTab === "send-report" ? "selected" : ""} onClick={() => setDoctorWorkspaceTab("send-report")} role="tab" aria-selected={doctorWorkspaceTab === "send-report"}>Send report</button>
              </div>
            </section>
            {doctorWorkspaceTab === "patient-workspace" && isSupabaseConfigured && <DoctorSharedRecordsPanel onPreview={previewSharedDocument} />}
            {doctorWorkspaceTab === "patient-workspace" && !isSupabaseConfigured && <section className="panel workspace-placeholder"><h2>Patient workspace</h2><p>Configure Supabase to open patient records with a temporary access code.</p></section>}
            {doctorWorkspaceTab === "send-report" && <DoctorView title={reportTitle} setTitle={setReportTitle} category={reportCategory} setCategory={setReportCategory} specialty={reportSpecialty} setSpecialty={setReportSpecialty} note={reportNote} setNote={setReportNote} clinicalSummary={reportClinicalSummary} setClinicalSummary={setReportClinicalSummary} therapy={reportTherapy} setTherapy={setReportTherapy} institution={reportInstitution} setInstitution={setReportInstitution} onSubmit={sendReport} sent={sent} documents={documents} patientEmail={patientEmail} setPatientEmail={setPatientEmail} reportFile={reportFile} setReportFile={setReportFile} sendError={sendError} isSending={isSending} />}
          </>
        )}
        <footer>HOPE health record | Prototype for secure medical document storage</footer>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {preview && <PdfPreview preview={preview} onClose={() => setPreview(null)} />}
      {pendingPatientUpload && <PatientUploadDialog file={pendingPatientUpload} category={patientUploadCategory} setCategory={setPatientUploadCategory} specialty={patientUploadSpecialty} setSpecialty={setPatientUploadSpecialty} loading={isUploadingOwnDocument} onConfirm={() => void confirmPatientUpload()} onClose={() => setPendingPatientUpload(null)} />}
    </div>
  );
}

function PdfPreview({ preview, onClose }: { preview: PreviewDocument; onClose: () => void }) {
  return <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={`Document preview: ${preview.title}`}>
    <section className="preview-panel">
      <header>
        <div><p className="eyebrow">PDF PREVIEW</p><h2>{preview.title}</h2></div>
        <div className="preview-actions">
          <a href={preview.url} target="_blank" rel="noreferrer">Open in a new tab</a>
          <button onClick={onClose} aria-label="Close preview">X</button>
        </div>
      </header>
      <iframe src={preview.url} title={preview.title} />
    </section>
  </div>;
}

function PatientUploadDialog({ file, category, setCategory, specialty, setSpecialty, loading, onConfirm, onClose }: { file: File; category: Category; setCategory: (value: Category) => void; specialty: DocumentSpecialty; setSpecialty: (value: DocumentSpecialty) => void; loading: boolean; onConfirm: () => void; onClose: () => void }) {
  return <div className="upload-dialog-overlay" role="dialog" aria-modal="true" aria-label="Classify document">
    <section className="panel upload-dialog">
      <p className="eyebrow">DOCUMENT CLASSIFICATION</p>
      <h2>Where does this report belong?</h2>
      <p>Choose a document type and medical specialty so your doctor can find it quickly.</p>
      <div className="selected-upload"><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></div>
      <label>Document type</label><select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
      <label>Medical specialty</label><select value={specialty} onChange={(event) => setSpecialty(event.target.value as DocumentSpecialty)}>{documentSpecialties.map((item) => <option key={item}>{item}</option>)}</select>
      <div className="upload-dialog-actions"><button className="secondary" type="button" disabled={loading} onClick={onClose}>Cancel</button><button className="primary" type="button" disabled={loading} onClick={onConfirm}>{loading ? "Uploading..." : "Save document"}</button></div>
    </section>
  </div>;
}

function DocumentList({ documents, onPreview }: { documents: MedicalDocument[]; onPreview: (document: MedicalDocument) => void }) {
  return <div className="document-list">{documents.map((document) => (
    <article className="document-row" key={document.id}>
      <span className={`file-icon ${document.category === "Laboratory" ? "lab" : ""}`}>PDF</span>
      <div className="document-info"><div><h3>{document.title}</h3>{document.status === "New record" && <em>NEW</em>}</div><p>{document.doctor} <i /> {document.date}</p><section className="document-tags"><small>{document.category}</small><small>{document.specialty}</small></section></div>
      <div className="source"><small>{document.source === "Doctor" ? "AUTOMATICALLY RECEIVED" : "PERSONALLY ADDED"}</small><b>{document.source === "Doctor" ? "Via email" : "Your upload"}</b></div>
      <button className="preview" aria-label={`Preview ${document.title}`} onClick={() => void onPreview(document)}>Preview</button>
    </article>
  ))}</div>;
}

type DoctorViewProps = {
  title: string; setTitle: (value: string) => void; category: Category; setCategory: (value: Category) => void;
  specialty: DocumentSpecialty; setSpecialty: (value: DocumentSpecialty) => void;
  note: string; setNote: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  clinicalSummary: string; setClinicalSummary: (value: string) => void; therapy: string; setTherapy: (value: string) => void;
  institution: string; setInstitution: (value: string) => void;
  sent: boolean; documents: MedicalDocument[]; patientEmail: string; setPatientEmail: (value: string) => void;
  reportFile: File | null; setReportFile: (value: File | null) => void; sendError: string; isSending: boolean;
};

function DoctorView({ title, setTitle, category, setCategory, specialty, setSpecialty, note, setNote, clinicalSummary, setClinicalSummary, therapy, setTherapy, institution, setInstitution, onSubmit, sent, documents, patientEmail, setPatientEmail, reportFile, setReportFile, sendError, isSending }: DoctorViewProps) {
  return <>
    <section className="doctor-grid">
      <form className="panel send-form" onSubmit={onSubmit}>
        <div className="section-head"><div><p className="eyebrow">NEW REPORT</p><h2>Report editor</h2></div><span className="secure">SECURE FLOW</span></div>
        <p className="form-intro">Upload the finalized PDF and attach searchable clinical context. The PDF is archived privately; the metadata helps the patient and future review.</p>
        <label>Patient email</label><div className="patient-picker"><b>@</b><input required type="email" value={patientEmail} onChange={(event) => setPatientEmail(event.target.value)} placeholder="patient@example.com" /><i>HOPE account</i></div>
        <label>Report title</label><input required value={title} onChange={(event) => setTitle(event.target.value)} />
        <label>Document type</label><select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
        <label>Medical specialty</label><select value={specialty} onChange={(event) => setSpecialty(event.target.value as DocumentSpecialty)}>{documentSpecialties.map((item) => <option key={item}>{item}</option>)}</select>
        <label>Institution</label><input value={institution} onChange={(event) => setInstitution(event.target.value)} placeholder="Clinic or healthcare institution" />
        <label>Clinical summary</label><textarea value={clinicalSummary} onChange={(event) => setClinicalSummary(event.target.value)} placeholder="Enter the physician's conclusion or a concise clinical summary..." />
        <label>Therapy / next steps</label><textarea value={therapy} onChange={(event) => setTherapy(event.target.value)} placeholder="Recommended therapy, follow-up or additional testing..." />
        <label>Instructions for the patient</label><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional short instructions for the patient..." />
        <label className="attachment"><input type="file" accept="application/pdf,.pdf" onChange={(event) => setReportFile(event.target.files?.[0] || null)} /><span>+</span><strong>{reportFile?.name || "Add PDF report"}</strong><small>The document will be securely archived in the record.</small></label>
        {sendError && <p className="form-error">{sendError}</p>}
        <button className="primary" type="submit" disabled={isSending}>{isSending ? "Sending..." : "Send report to patient"} <span>-&gt;</span></button>
      </form>
      <aside className="doctor-side">
        <section className="panel report-editor-preview">
          <p className="eyebrow">REPORT PREVIEW</p>
          <header><strong>{institution || "HOPE medical practice"}</strong><small>Medical report metadata</small></header>
          <div><small>PATIENT</small><p>{patientEmail || "Patient email has not been entered"}</p></div>
          <div><small>TITLE</small><p>{title || "Untitled report"}</p></div>
          <div><small>TYPE</small><p>{category}</p></div>
          <div><small>SPECIALTY</small><p>{specialty}</p></div>
          <MetadataPreviewSection title="Clinical summary" content={clinicalSummary} />
          <MetadataPreviewSection title="Therapy / next steps" content={therapy} />
          <MetadataPreviewSection title="Patient instructions" content={note} />
          <footer>{reportFile ? `Attached PDF: ${reportFile.name}` : "Attach the finalized PDF before sending."}</footer>
        </section>
        <section className="panel flow"><p className="eyebrow">AUTOMATIC ARCHIVING</p><h2>How does report delivery work?</h2>
          <div><b>1</b><p><strong>The doctor enters an email</strong><small>HOPE finds the registered patient.</small></p></div>
          <div><b>2</b><p><strong>The doctor sends the report</strong><small>The PDF is stored in the patient's private record.</small></p></div>
          <div><b>3</b><p><strong>The patient receives a notification</strong><small>The email does not contain a sensitive medical PDF attachment.</small></p></div>
        </section>
        {sent && <section className="success"><b>Sent</b><p>The report has been added to the patient's record.</p></section>}
        <section className="panel recent"><p className="eyebrow">PATIENT RECORD</p><h2>Recent reports</h2>{documents.slice(0, 3).map((document) => <div key={document.id}><strong>{document.title}</strong><small>{document.date} | {document.category}</small></div>)}</section>
      </aside>
    </section>
  </>;
}

function MetadataPreviewSection({ title, content }: { title: string; content: string }) {
  return <div><small>{title.toUpperCase()}</small><p>{content || "Not entered"}</p></div>;
}

export default App;
