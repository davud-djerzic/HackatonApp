import { useCallback, useEffect, useState } from "react";
import type { AiHealthSummary } from "../types";
import type { ClinicVisit } from "../types";
import type { Diagnosis } from "../types";
import type { MedicalDocument } from "../types";
import type { Medication } from "../types";
import { buildPatientDataPayload, clearAiSummaryCache, fetchAiHealthSummary } from "../lib/ai";

type AISummaryProps = {
  diagnoses: Diagnosis[];
  medications: Medication[];
  visits: ClinicVisit[];
  documents: MedicalDocument[];
};

export default function AISummary({ diagnoses, medications, visits, documents }: AISummaryProps) {
  const [data, setData] = useState<AiHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    if (force) clearAiSummaryCache();
    try {
      const payload = buildPatientDataPayload(diagnoses, medications, visits, documents);
      const summary = await fetchAiHealthSummary(payload);
      setData(summary);
    } finally {
      setLoading(false);
    }
  }, [diagnoses, documents, medications, visits]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="panel ai-panel loading">
        <p className="eyebrow">AI PREGLED</p>
        <div className="skeleton-block" />
        <div className="skeleton-block short" />
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="panel ai-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">AI PREGLED</p>
          <h2>Sažetak zdravstvenog stanja</h2>
        </div>
      </div>
      <p className="ai-summary-text">{data.summary}</p>
      <p className="ai-disclaimer">
        Informativni AI pregled na osnovu službenih zapisa. Ne zamjenjuje dijagnozu ili savjet ljekara.
      </p>
      {data.alerts.length > 0 && <p className="ai-section-label">Upozorenja</p>}
      <div className="ai-grid">
        {data.alerts.map((item) => (
          <article key={item} className="ai-chip alert"><span>⚠</span> {item}</article>
        ))}
      </div>
      {data.trends.length > 0 && <p className="ai-section-label">Trendovi</p>}
      <div className="ai-grid">
        {data.trends.map((item) => (
          <article key={item} className="ai-chip trend"><span>↗</span> {item}</article>
        ))}
      </div>
      {data.suggestions.length > 0 && <p className="ai-section-label">Preporuke</p>}
      <div className="ai-grid">
        {data.suggestions.map((item) => (
          <article key={item} className="ai-chip suggest"><span>✓</span> {item}</article>
        ))}
      </div>
    </section>
  );
}
