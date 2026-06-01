import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";

type AuthMode = "signIn" | "signUp";
type Role = "patient" | "doctor";

function authErrorMessage(message: string) {
  if (message.toLowerCase().includes("email rate limit exceeded")) {
    return "Supabase je privremeno blokirao slanje auth emailova. U Supabase Dashboardu iskljucite Confirm email za testiranje bez validacije emaila.";
  }
  if (message.toLowerCase().includes("user already registered")) {
    return "Korisnik sa ovom email adresom vec postoji. Otvorite karticu Prijava.";
  }
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "Email ili lozinka nisu ispravni.";
  }
  return message;
}

function AuthPanel() {
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [role, setRole] = useState<Role>("patient");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    setMessage("");

    if (mode === "signUp") {
      if (password.length < 8) {
        setError("Lozinka mora imati najmanje 8 znakova.");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("Lozinke se ne podudaraju.");
        setLoading(false);
        return;
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim(), role } },
      });
      if (authError) {
        setError(authErrorMessage(authError.message));
      } else if (data.session) {
        setMessage("Nalog je kreiran. Prijavljeni ste u CareTrace.");
      } else {
        setMessage("Nalog je kreiran, ali Supabase jos trazi email potvrdu. Iskljucite Confirm email u Auth postavkama projekta.");
      }
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authErrorMessage(authError.message));
    setLoading(false);
  }

  return <main className="auth-shell">
    <section className="auth-layout">
      <aside className="auth-intro">
        <div className="auth-brand"><b>C</b><strong>CareTrace</strong></div>
        <h1>Medicinska dokumentacija na jednom sigurnom mjestu.</h1>
        <p>Pacijenti cuvaju nalaze, a doktori sigurno dostavljaju dokumente povezanim pacijentima.</p>
        <div><span>1</span><small>Privatna pohrana medicinskih dokumenata</small></div>
        <div><span>2</span><small>Odvojeni pristup za pacijente i doktore</small></div>
        <div><span>3</span><small>Email obavijesti bez slanja osjetljivih PDF priloga</small></div>
      </aside>

      <form className="panel auth-panel" onSubmit={submit}>
        <p className="eyebrow">SIGURAN PRISTUP</p>
        <h2>{mode === "signIn" ? "Prijava u CareTrace" : "Kreirajte CareTrace nalog"}</h2>
        <p>{mode === "signIn" ? "Unesite podatke za pristup svom nalogu." : "Odaberite ulogu i unesite osnovne podatke."}</p>

        <div className="auth-tabs">
          <button type="button" className={mode === "signIn" ? "selected" : ""} onClick={() => switchMode("signIn")}>Prijava</button>
          <button type="button" className={mode === "signUp" ? "selected" : ""} onClick={() => switchMode("signUp")}>Registracija</button>
        </div>

        {mode === "signUp" && <>
          <label>Registrujem se kao</label>
          <div className="role-options">
            <button type="button" className={role === "patient" ? "selected" : ""} onClick={() => setRole("patient")}><b>P</b><span><strong>Pacijent</strong><small>Licni zdravstveni dosije</small></span></button>
            <button type="button" className={role === "doctor" ? "selected" : ""} onClick={() => setRole("doctor")}><b>D</b><span><strong>Doktor</strong><small>Ordinacija i nalazi</small></span></button>
          </div>
          <label htmlFor="full-name">Ime i prezime</label>
          <input id="full-name" required value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
        </>}

        <label htmlFor="email">Email adresa</label>
        <input id="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        <label htmlFor="password">Lozinka</label>
        <input id="password" required minLength={mode === "signUp" ? 8 : undefined} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signIn" ? "current-password" : "new-password"} />
        {mode === "signUp" && <>
          <label htmlFor="confirm-password">Potvrdite lozinku</label>
          <input id="confirm-password" required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        </>}

        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-message">{message}</p>}
        <button className="primary auth-submit" disabled={loading}>{loading ? "Molimo sacekajte..." : mode === "signIn" ? "Prijavi se" : "Kreiraj nalog"}</button>
      </form>
    </section>
  </main>;
}

export default AuthPanel;
