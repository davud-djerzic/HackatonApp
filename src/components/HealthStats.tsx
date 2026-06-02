import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ClinicVisit } from "../types";
import type { MedicalDocument } from "../types";

const COLORS = ["#4f77a7", "#38806e", "#a16b28", "#7b5ea7", "#83918e"];

type HealthStatsProps = {
  documents: MedicalDocument[];
  visits: ClinicVisit[];
};

export default function HealthStats({ documents, visits }: HealthStatsProps) {
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    documents.forEach((doc) => map.set(doc.category, (map.get(doc.category) ?? 0) + 1));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [documents]);

  const byDoctor = useMemo(() => {
    const map = new Map<string, number>();
    documents.forEach((doc) => {
      const key = doc.doctor || "Nepoznato";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [documents]);

  const timeline = useMemo(() => {
    return documents
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((doc, index) => ({ datum: doc.date, count: index + 1, naziv: doc.title }));
  }, [documents]);

  return (
    <section className="panel stats-panel">
      <div className="section-head">
        <div><p className="eyebrow">STATISTIKE</p><h2>Pregled dosijea</h2></div>
      </div>

      <div className="chart-grid">
        <article className="chart-card">
          <h3>Dokumenti kroz vrijeme</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="datum" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#236c5d" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card">
          <h3>Po kategoriji</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={70} label>
                {byCategory.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </article>

        <article className="chart-card wide">
          <h3>Nalazi po doktoru / izvoru</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byDoctor}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#236c5d" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>

      <div className="timeline-visits">
        <h3>Posjete klinikama</h3>
        {visits.map((visit) => (
          <div key={visit.id} className="timeline-dot-row">
            <span className="dot" />
            <div>
              <strong>{visit.visitDate}</strong>
              <p>{visit.clinicName} — {visit.doctorName}</p>
            </div>
          </div>
        ))}
        {visits.length === 0 && <p className="empty-hint">Nema posjeta za prikaz.</p>}
      </div>
    </section>
  );
}
