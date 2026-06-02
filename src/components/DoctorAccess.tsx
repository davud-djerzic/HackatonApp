import { useState } from "react";
import type { FormEvent } from "react";
import { clearDoctorSession, loadDoctorSession, verifyAccessCode } from "../lib/accessCode";
import DoctorDashboard from "./DoctorDashboard";

export default function DoctorAccess() {
  const [session, setSession] = useState(() => loadDoctorSession());
  const [code, setCode] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (session) {
    return (
      <DoctorDashboard
        session={session}
        onEnd={() => {
          clearDoctorSession();
          setSession(null);
        }}
      />
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await verifyAccessCode(code, doctorName.trim() || "Doktor");
      setSession({ ...result, doctorName: doctorName.trim() || "Doktor" });
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Kod nije validan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell doctor-gate">
      <div className="auth-page">
        <header className="auth-hero">
          <div className="auth-brand auth-brand-hero auth-brand-hope">
            <strong className="auth-hope-name">HOPE</strong>
            <small>Pristup doktora</small>
          </div>
          <h1 className="auth-hero-title">Unesite pristupni kod</h1>
          <p className="auth-hero-text">Pacijent vam daje 6-znamenkasti kod za pregled dosijea.</p>
        </header>
        <section className="auth-card">
          <form className="auth-form" onSubmit={submit}>
            <div className="auth-field">
              <label htmlFor="doctor-name">Ime doktora</label>
              <input
                id="doctor-name"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="Dr. Dino K."
                required
              />
            </div>
            <div className="auth-field">
              <label htmlFor="access-code">Pristupni kod</label>
              <input
                id="access-code"
                className="auth-code-input"
                inputMode="numeric"
                maxLength={7}
                value={code}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits);
                }}
                placeholder="000 000"
                required
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? "Provjera..." : "Otvori dosije pacijenta"}
            </button>
            <a href="#" className="auth-link-btn center-link" onClick={(e) => { e.preventDefault(); window.location.hash = ""; }}>
              ← Nazad na pacijentsku prijavu
            </a>
          </form>
        </section>
      </div>
    </main>
  );
}
