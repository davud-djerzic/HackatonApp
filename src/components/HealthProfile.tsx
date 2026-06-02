import { useCallback, useEffect, useState } from "react";
import type { ClinicVisit, Diagnosis, DiagnosisStatus, Medication } from "../types";
import { loadClinicVisits, loadDiagnoses, loadMedications } from "../lib/health";

type HealthProfileProps = {
  demoPatientId?: string;
  view: "dijagnoze" | "terapija";
};

const statusLabels: Record<DiagnosisStatus, string> = {
  aktivan: "Aktivan",
  rijesen: "Riješen",
  "u pracenju": "U praćenju",
};

export default function HealthProfile({ demoPatientId, view }: HealthProfileProps) {
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [visits, setVisits] = useState<ClinicVisit[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dx, med, v] = await Promise.all([
        loadDiagnoses(undefined, demoPatientId),
        loadMedications(undefined, demoPatientId),
        loadClinicVisits(undefined, demoPatientId),
      ]);
      setDiagnoses(dx);
      setMedications(med);
      setVisits(v);
    } finally {
      setLoading(false);
    }
  }, [demoPatientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return <section className="panel"><div className="skeleton-block" /><div className="skeleton-block short" /></section>;
  }

  if (view === "terapija") {
    const active = medications.filter((m) => m.active);
    const inactive = medications.filter((m) => !m.active);
    return (
      <>
        <div className="readonly-banner">
          Terapiju unosi isključivo ovlašteni ljekar. Vi možete samo pregledati propisane lijekove.
        </div>
        <section className="panel">
          <div className="section-head">
            <div><p className="eyebrow">TERAPIJA</p><h2>Aktivni lijekovi</h2></div>
          </div>
          <div className="card-grid">
            {active.map((med) => (
              <article key={med.id} className="health-card active-med">
                {med.doctorAuthored && <em className="doctor-tag">Ljekar</em>}
                <h3>{med.name}</h3>
                <p>{[med.dosage, med.frequency].filter(Boolean).join(" · ") || "—"}</p>
                <small>Propisao: {med.prescribedBy || "—"}</small>
              </article>
            ))}
            {active.length === 0 && <p className="empty-hint">Nema aktivne terapije u dosijeu.</p>}
          </div>
          {inactive.length > 0 && (
            <>
              <h3 className="subsection-title">Završena terapija</h3>
              <div className="card-grid muted-grid">
                {inactive.map((med) => (
                  <article key={med.id} className="health-card">
                    <h3>{med.name}</h3>
                    <small>Završeno {med.endDate || "—"}</small>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="readonly-banner">
        Dijagnoze i posjete unosi isključivo ljekar. Prikaz služi samo za uvid u službene zapise.
      </div>
      <section className="panel">
        <div className="section-head">
          <div><p className="eyebrow">DIJAGNOZE</p><h2>Potvrđene dijagnoze</h2></div>
        </div>
        <div className="list-stack">
          {diagnoses.map((dx) => (
            <article key={dx.id} className="health-row">
              <div>
                <h3>
                  {dx.title}
                  {dx.icd10Code && <span className="icd">{dx.icd10Code}</span>}
                </h3>
                <p>{dx.description || "Bez dodatnog opisa u dosijeu."}</p>
                <small>{dx.diagnosedBy || "Ljekar"} · {dx.diagnosedAt}</small>
              </div>
              <span className={`status-pill status-${dx.status.replace(/\s/g, "-")}`}>
                {statusLabels[dx.status]}
              </span>
            </article>
          ))}
          {diagnoses.length === 0 && <p className="empty-hint">Još nema unesenih dijagnoza od strane ljekara.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div><p className="eyebrow">POSJETE</p><h2>Klinike i pregledi</h2></div>
        </div>
        <div className="timeline">
          {visits.map((visit) => (
            <article key={visit.id} className="timeline-item">
              <b>{visit.visitDate}</b>
              <h3>{visit.clinicName}</h3>
              <p>{visit.doctorName || "Ljekar"} — {visit.reason || "Pregled"}</p>
              {visit.notes && <small>{visit.notes}</small>}
            </article>
          ))}
          {visits.length === 0 && <p className="empty-hint">Nema zabilježenih posjeta.</p>}
        </div>
      </section>
    </>
  );
}
