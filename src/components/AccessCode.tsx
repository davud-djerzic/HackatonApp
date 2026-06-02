import { useCallback, useEffect, useState } from "react";
import type { AccessCodeRecord } from "../types";
import { formatCodeDisplay, generateAccessCode, listMyCodes, revokeAccessCode } from "../lib/accessCode";

type AccessCodeProps = {
  demoPatientId?: string;
  onNotify: (message: string) => void;
};

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setLabel("Istekao");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return <span className="code-countdown">{label}</span>;
}

export default function AccessCode({ demoPatientId, onNotify }: AccessCodeProps) {
  const [codes, setCodes] = useState<AccessCodeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [latestCode, setLatestCode] = useState<AccessCodeRecord | null>(null);

  const refresh = useCallback(async () => {
    const list = await listMyCodes(demoPatientId);
    setCodes(list);
    const active = list.find((item) => !item.revokedAt && !item.usedAt && new Date(item.expiresAt) > new Date());
    setLatestCode(active ?? null);
  }, [demoPatientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleGenerate() {
    setLoading(true);
    try {
      const record = await generateAccessCode(demoPatientId);
      setLatestCode(record);
      onNotify("Kod za doktora je generisan.");
      await refresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Generisanje koda nije uspjelo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(codeId: string) {
    try {
      await revokeAccessCode(codeId, demoPatientId);
      onNotify("Kod je ponisten.");
      await refresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Ponistavanje nije uspjelo.");
    }
  }

  return (
    <section className="panel access-code-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">PRISTUP DOKTORU</p>
          <h2>Kod za doktora</h2>
        </div>
      </div>
      <p className="panel-lead">
        Generišite šestoznamenkasti kod i ustno ga predajte ljekaru. Kod vrijedi 24 sata.
        Ljekar otvara <a href="#doktor" className="inline-link">portal za unos koda</a>.
      </p>

      {latestCode && !latestCode.revokedAt && new Date(latestCode.expiresAt) > new Date() && (
        <div className="active-code-card">
          <small>Aktivni kod</small>
          <strong className="access-code-display">{formatCodeDisplay(latestCode.code)}</strong>
          <Countdown expiresAt={latestCode.expiresAt} />
          <button type="button" className="ghost-btn" onClick={() => void handleRevoke(latestCode.id)}>
            Ponisti kod
          </button>
        </div>
      )}

      <button
        type="button"
        className="generate-code-btn"
        disabled={loading}
        onClick={(e) => {
          e.preventDefault();
          void handleGenerate();
        }}
      >
        {loading ? "Generisanje..." : "Generiši kod za doktora"}
      </button>

      <div className="code-history">
        <h3>Historija kodova</h3>
        {codes.length === 0 && <p className="empty-hint">Jos nema generisanih kodova.</p>}
        {codes.map((item) => (
          <article key={item.id} className="code-history-row">
            <div>
              <strong>{formatCodeDisplay(item.code)}</strong>
              <small>
                {new Date(item.createdAt).toLocaleString("bs-BA")}
                {item.revokedAt ? " · Ponisten" : item.usedAt ? ` · Koristio: ${item.usedByDoctorName}` : ""}
              </small>
            </div>
            {!item.revokedAt && new Date(item.expiresAt) > new Date() && (
              <button type="button" className="text-btn" onClick={() => void handleRevoke(item.id)}>Ponisti</button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
