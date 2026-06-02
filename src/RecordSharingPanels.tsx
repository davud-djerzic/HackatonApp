import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { askPatientAi } from "./lib/aiSearch";
import type { AiSearchAnswer, AiSourceReference } from "./lib/aiSearch";
import { requestDifferentialAssessment } from "./lib/differentialAssessment";
import type { DifferentialAssessment } from "./lib/differentialAssessment";
import { generatePatientShareCode, loadActiveSharedPatients, loadSharedPatientDocuments, logSharedDocumentPreview, redeemPatientShareCode } from "./lib/sharing";
import type { GeneratedShareCode, SharedDocument, SharedPatient } from "./lib/sharing";
import { addMySymptom, loadMySymptoms } from "./lib/symptoms";
import type { PatientSymptom } from "./lib/symptoms";

type DoctorRecordTab = "records" | "search" | "assessment";

const consultationQuickSymptoms = ["Fatigue", "Fever", "Nausea", "Chest pain", "Shortness of breath", "Palpitations"];

const urgencyDescriptions = {
  Low: "Benign or chronic pattern",
  Medium: "Diagnostic review within several days",
  High: "Acute: diagnostic review within 24 hours",
  Urgent: "Potentially life-threatening condition",
};

export function PatientSymptomsPanel() {
  const [symptoms, setSymptoms] = useState<PatientSymptom[]>([]);
  const [symptomName, setSymptomName] = useState("");
  const [severity, setSeverity] = useState(5);
  const [startedAt, setStartedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setSymptoms(await loadMySymptoms());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Symptoms could not be loaded.");
    }
  }

  useEffect(() => {
    loadMySymptoms()
      .then(setSymptoms)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Symptoms could not be loaded."));
  }, []);

  async function addSymptom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await addMySymptom({ symptomName, severity, startedAt, notes });
      setSymptomName("");
      setNotes("");
      await refresh();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "The symptom could not be saved.");
    }
  }

  return <section className="panel symptoms-panel">
    <div><p className="eyebrow">SYMPTOMS FOR REVIEW</p><h2>Add a current symptom</h2><p>Symptoms will be available to the doctor only when you grant temporary access with a code.</p></div>
    <form onSubmit={addSymptom}>
      <input required value={symptomName} onChange={(event) => setSymptomName(event.target.value)} placeholder="E.g. fatigue, headache, chest pain" />
      <select value={severity} onChange={(event) => setSeverity(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>Severity {index + 1}/10</option>)}</select>
      <input type="date" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
      <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Short note" />
      <button className="primary">Save symptom</button>
    </form>
    {symptoms.length > 0 && <div className="symptom-list">{symptoms.map((symptom) => <span key={symptom.id}><b>{symptom.symptomName}</b> {symptom.severity}/10</span>)}</div>}
    {error && <p className="form-error">{error}</p>}
  </section>;
}

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
      setError(generateError instanceof Error ? generateError.message : "The share code was not generated.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="panel share-code-panel">
    <div><p className="eyebrow">TEMPORARY RECORD ACCESS</p><h2>Share records with your doctor</h2><p>Generate a one-time code and show it to your doctor during the appointment. The code is valid for 10 minutes.</p></div>
    {code ? <div className="generated-code"><small>ONE-TIME CODE</small><strong>{code.shareCode}</strong><span>The doctor's access will last 60 minutes after redemption.</span><button className="secondary" onClick={() => void generateCode()} disabled={loading}>{loading ? "Generating..." : "Generate a new code"}</button></div> : <button className="primary" onClick={() => void generateCode()} disabled={loading}>{loading ? "Generating..." : "Generate code"}</button>}
    {error && <p className="form-error">{error}</p>}
  </section>;
}

export function DoctorSharedRecordsPanel({ onPreview }: { onPreview: (document: SharedDocument) => void }) {
  const [code, setCode] = useState("");
  const [patient, setPatient] = useState<SharedPatient | null>(null);
  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const [category, setCategory] = useState("All reports");
  const [specialty, setSpecialty] = useState("All specialties");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<AiSearchAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [highlightedDocumentId, setHighlightedDocumentId] = useState<string | null>(null);
  const [assessmentQuestion, setAssessmentQuestion] = useState("");
  const [assessment, setAssessment] = useState<DifferentialAssessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [consultationSymptomDraft, setConsultationSymptomDraft] = useState("");
  const [consultationSymptoms, setConsultationSymptoms] = useState<string[]>([]);
  const [expandedHypotheses, setExpandedHypotheses] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<DoctorRecordTab>("records");

  const visibleDocuments = useMemo(() => documents.filter((document) => (category === "All reports" || document.category === category) && (specialty === "All specialties" || document.specialty === specialty)), [category, documents, specialty]);
  const categories = useMemo(() => [...new Set(documents.map((document) => document.category))], [documents]);
  const specialties = useMemo(() => [...new Set(documents.map((document) => document.specialty))], [documents]);

  useEffect(() => {
    loadActiveSharedPatients()
      .then(async (activePatients) => {
        const activePatient = activePatients[0];
        if (!activePatient) return;
        setPatient(activePatient);
        setDocuments(await loadSharedPatientDocuments(activePatient.patientId));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Active access could not be loaded."));
  }, []);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const activatedPatient = await redeemPatientShareCode(code);
      setPatient(activatedPatient);
      setCode("");
      try {
        setDocuments(await loadSharedPatientDocuments(activatedPatient.patientId));
      } catch (documentsError) {
        setDocuments([]);
        setError(documentsError instanceof Error ? `Access was activated, but reports could not be loaded: ${documentsError.message}` : "Access was activated, but reports could not be loaded.");
      }
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "Access was not activated.");
    } finally {
      setLoading(false);
    }
  }

  async function preview(document: SharedDocument) {
    try {
      await logSharedDocumentPreview(document.id);
      onPreview(document);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview is unavailable.");
    }
  }

  async function openAiSource(source: AiSourceReference) {
    if (!source.document_id) {
      setError("This structured database value is not linked to a source PDF.");
      return;
    }
    const sourceDocument = documents.find((document) => document.id === source.document_id);
    if (!sourceDocument) {
      setError("The referenced PDF is not available in the currently opened record.");
      return;
    }
    setHighlightedDocumentId(source.document_id);
    setActiveTab("records");
    await preview(sourceDocument);
  }

  async function askAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return;
    setAiLoading(true);
    setError("");
    try {
      setAiAnswer(await askPatientAi(patient.patientId, aiQuestion));
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : "AI search is unavailable.";
      setError(message);
      if (message.includes("Temporary record access is not active")) {
        setPatient(null);
        setDocuments([]);
        setAiAnswer(null);
      }
    } finally {
      setAiLoading(false);
    }
  }

  async function assess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient) return;
    setAssessmentLoading(true);
    setError("");
    try {
      const clinicalContext = [
        assessmentQuestion.trim(),
        consultationSymptoms.length > 0 ? `Symptoms reported during consultation: ${consultationSymptoms.join(", ")}.` : "",
      ].filter(Boolean).join("\n");
      const nextAssessment = await requestDifferentialAssessment(patient.patientId, clinicalContext);
      setAssessment(nextAssessment);
      setExpandedHypotheses(nextAssessment.hypotheses[0] ? { [nextAssessment.hypotheses[0].name]: true } : {});
    } catch (assessmentError) {
      setError(assessmentError instanceof Error ? assessmentError.message : "Differential assessment is unavailable.");
    } finally {
      setAssessmentLoading(false);
    }
  }

  function addConsultationSymptom(rawSymptom: string) {
    const symptom = rawSymptom.trim();
    if (!symptom || consultationSymptoms.includes(symptom)) return;
    setConsultationSymptoms((current) => [...current, symptom]);
    setConsultationSymptomDraft("");
  }

  return <section className="panel shared-records">
    <div className="section-head"><div><p className="eyebrow">TEMPORARY ACCESS</p><h2>Open a patient record</h2></div>{patient && <span>60 MIN ACCESS</span>}</div>
    {!patient ? <form className="redeem-code" onSubmit={redeem}>
      <p>Enter the one-time code generated by the patient in their application.</p>
      <div><input required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="AB12-CD34-EF56" maxLength={14} /><button className="primary" disabled={loading}>{loading ? "Checking..." : "Open record"}</button></div>
    </form> : <>
      <div className="shared-patient"><div><small>PATIENT</small><strong>{patient.patientName}</strong></div><button className="secondary" onClick={() => { setPatient(null); setDocuments([]); setAiAnswer(null); setAssessment(null); setConsultationSymptoms([]); setAssessmentQuestion(""); setHighlightedDocumentId(null); setActiveTab("records"); }}>Close record</button></div>
      <div className="doctor-record-tabs">
        <button className={activeTab === "records" ? "selected" : ""} onClick={() => setActiveTab("records")}>Timeline</button>
        <button className={activeTab === "search" ? "selected" : ""} onClick={() => setActiveTab("search")}>Ask AI</button>
        <button className={activeTab === "assessment" ? "selected" : ""} onClick={() => setActiveTab("assessment")}>Differential assessment</button>
      </div>
      {activeTab === "search" && <section className="ai-search">
        <div><small>AI ASSISTANT FOR LABORATORY REPORTS</small><p>Search uses real structured values from the database and applies only to the currently opened patient record.</p></div>
        <form onSubmit={askAi}><input required value={aiQuestion} onChange={(event) => setAiQuestion(event.target.value)} placeholder="E.g. Show the iron trend or list critical parameters" /><button className="primary" disabled={aiLoading}>{aiLoading ? "Analyzing..." : "Ask AI"}</button></form>
        {aiAnswer && <article className="ai-answer">
          <section className="ai-search-summary" aria-label="Search summary">
            <span className="ai-search-summary__label">Search summary</span>
            <p className="ai-search-summary__text">{aiAnswer.text_summary}</p>
          </section>
          {aiAnswer.ai_warning && <p className="ai-notice">{aiAnswer.ai_warning}</p>}
          <section className="answer-section">
            <div className="answer-section-head"><strong>Extracted parameters</strong><span>{aiAnswer.extracted_metrics.length} results</span></div>
            {aiAnswer.extracted_metrics.length ? <div className="metric-table">
              <header><span>Date</span><span>Parameter</span><span>Value</span><span>Status</span></header>
              {aiAnswer.extracted_metrics.map((metric, index) => <div key={`${metric.parameter}-${metric.date}-${index}`}><span>{metric.date}</span><b>{metric.parameter}</b><span>{metric.value} {metric.unit}</span><i className={metric.status}>{metric.status}</i></div>)}
            </div> : <p>No parameters were found.</p>}
          </section>
          <section className="doctor-note"><small>NOTE FOR THE DOCTOR</small><p>{aiAnswer.ai_recommendation}</p></section>
          <section className="source-references">
            <div className="answer-section-head"><strong>Sources from the patient record</strong><span>{aiAnswer.sources?.length ?? 0} references</span></div>
            <p>Each reference below comes from stored database content. Open the PDF to compare the highlighted excerpt with the original report.</p>
            {aiAnswer.sources?.length ? aiAnswer.sources.map((source, index) => <article className="source-reference" key={`${source.document_id ?? "database"}-${source.title}-${index}`}>
              <header><div><small>{source.evidence_type === "pdf_excerpt" ? "INDEXED PDF TEXT" : source.evidence_type === "structured_lab_result" ? "STRUCTURED VALUE FROM PDF" : "DATABASE VALUE WITHOUT LINKED PDF"}</small><strong>{source.title}</strong><span>{new Intl.DateTimeFormat("en-GB").format(new Date(source.date))} | {source.category}</span></div>{source.document_id && <button className="secondary" type="button" onClick={() => void openAiSource(source)}>Open source PDF</button>}</header>
              <blockquote>{source.excerpt}</blockquote>
            </article>) : <p>No linked PDF source was found for this answer.</p>}
          </section>
        </article>}
      </section>}
      {activeTab === "assessment" && <section className="differential-assessment">
        <div><small>DIFFERENTIAL ASSESSMENT FOR THE DOCTOR</small><p>This separate feature uses saved symptoms and reports to build a list of hypotheses for the doctor to confirm or rule out.</p></div>
        <div className="urgency-guide">
          {Object.entries(urgencyDescriptions).map(([urgency, description]) => <span className={`urgency ${urgency}`} key={urgency}><b>{urgency}</b>{description}</span>)}
        </div>
        <section className="consultation-symptoms">
          <div><strong>Symptoms observed during consultation</strong><small>These temporary notes are included in this assessment together with symptoms saved by the patient.</small></div>
          <div className="symptom-entry"><input value={consultationSymptomDraft} onChange={(event) => setConsultationSymptomDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addConsultationSymptom(consultationSymptomDraft); } }} placeholder="Add a symptom and press Enter" /><button className="secondary" type="button" onClick={() => addConsultationSymptom(consultationSymptomDraft)}>Add</button></div>
          <div className="quick-symptoms">{consultationQuickSymptoms.map((symptom) => <button key={symptom} type="button" disabled={consultationSymptoms.includes(symptom)} onClick={() => addConsultationSymptom(symptom)}>+ {symptom}</button>)}</div>
          {consultationSymptoms.length > 0 && <div className="selected-symptoms">{consultationSymptoms.map((symptom) => <span key={symptom}>{symptom}<button type="button" aria-label={`Remove ${symptom}`} onClick={() => setConsultationSymptoms((current) => current.filter((item) => item !== symptom))}>X</button></span>)}</div>}
        </section>
        <form onSubmit={assess}><textarea value={assessmentQuestion} onChange={(event) => setAssessmentQuestion(event.target.value)} placeholder="Optional: describe the acute complaint, duration or a specific assessment focus" /><button className="primary" disabled={assessmentLoading}>{assessmentLoading ? "Assessing..." : "Run assessment"}</button></form>
        {assessment && <article className="assessment-answer">
          <p className="assessment-disclaimer">{assessment.disclaimer}</p>
          <section className="answer-summary"><small>ASSESSMENT SUMMARY</small><p>{assessment.summary}</p></section>
          {assessment.ai_warning && <p className="ai-notice">{assessment.ai_warning}</p>}
          {assessment.red_flags.length > 0 && <section className="red-flags"><strong>Warnings for review</strong><BulletList items={assessment.red_flags} /></section>}
          {assessment.hypotheses.map((hypothesis) => {
            const expanded = Boolean(expandedHypotheses[hypothesis.name]);
            return <div className={`hypothesis score-${hypothesis.match_score >= 70 ? "high" : hypothesis.match_score >= 40 ? "medium" : "low"}`} key={hypothesis.name}>
              <button className="hypothesis-toggle" type="button" onClick={() => setExpandedHypotheses((current) => ({ ...current, [hypothesis.name]: !expanded }))} aria-expanded={expanded}>
                <span><strong>{hypothesis.name}</strong><small>{expanded ? "Hide clinical details" : "Review clinical details"}</small></span>
                <span><b>{hypothesis.match_score}/100 match</b><i className={`urgency-badge ${hypothesis.urgency}`}>{hypothesis.urgency}</i></span>
              </button>
              <div className="match-track"><i style={{ width: `${Math.max(0, Math.min(100, hypothesis.match_score))}%` }} /></div>
              {expanded && <>
                <p className="hypothesis-rationale">{hypothesis.rationale}</p>
                <p className="urgency-explanation"><b>Urgency:</b> {urgencyDescriptions[hypothesis.urgency]}</p>
                <div className="hypothesis-details">
                  {hypothesis.evidence_for.length > 0 && <section><strong>Supporting data</strong><BulletList items={hypothesis.evidence_for} /></section>}
                  {hypothesis.evidence_against_or_missing.length > 0 && <section><strong>Missing or contradictory</strong><BulletList items={hypothesis.evidence_against_or_missing} /></section>}
                  {hypothesis.next_checks.length > 0 && <section><strong>Checks to consider</strong><BulletList items={hypothesis.next_checks} /></section>}
                </div>
                <small>Relative score for comparing hypotheses, not a diagnostic probability.</small>
              </>}
            </div>;
          })}
          {assessment.missing_data.length > 0 && <section className="missing-data"><strong>Missing data</strong><BulletList items={assessment.missing_data} /></section>}
        </article>}
      </section>}
      {activeTab === "records" && <>
        <div className="shared-filter"><span>{visibleDocuments.length} reports</span><div><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All reports</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><select value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option>All specialties</option>{specialties.map((item) => <option key={item}>{item}</option>)}</select></div></div>
        <SharedRecordTimeline documents={visibleDocuments} highlightedDocumentId={highlightedDocumentId} onPreview={preview} />
      </>}
    </>}
    {error && <p className="form-error">{error}</p>}
  </section>;
}

function SharedRecordTimeline({ documents, highlightedDocumentId, onPreview }: { documents: SharedDocument[]; highlightedDocumentId: string | null; onPreview: (document: SharedDocument) => void }) {
  if (documents.length === 0) return <p className="empty-timeline">No reports are available for this patient.</p>;
  return <div className="shared-timeline">{documents.map((document) => <article className={document.id === highlightedDocumentId ? "highlighted-source" : ""} key={document.id}>
    <span className="timeline-marker">PDF</span>
    <div><small>{document.date}</small><strong>{document.title}</strong><em>{document.category} | {document.specialty}</em></div>
    <button className="preview" onClick={() => void onPreview(document)}>Preview</button>
  </article>)}</div>;
}

function BulletList({ items }: { items: string[] }) {
  return <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>;
}
