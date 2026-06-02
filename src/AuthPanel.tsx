import { useState } from "react";
import type { FormEvent } from "react";
import {
  confirmPasswordReset,
  confirmPasswordResetSupabase,
  requestPasswordResetCode,
  requestPasswordResetCodeSupabase,
} from "./lib/passwordReset";
import { displayNameFromEmail, isDemoLoginEnabled } from "./lib/demoSession";
import type { DemoUser } from "./lib/demoSession";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type AuthMode = "signIn" | "signUp";
type ResetStep = "email" | "code" | "password";

type AuthPanelProps = {
  onDemoLogin?: (user: DemoUser) => void;
};

function authErrorMessage(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("email rate limit exceeded")) {
    return "Privremeno je dostignut limit email poruka. Pokusajte za nekoliko minuta.";
  }
  if (lower.includes("user already registered")) {
    return "Nalog sa ovom email adresom vec postoji. Otvorite Prijava.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Email ili lozinka nisu ispravni.";
  }
  return message;
}

function AuthPanel({ onDemoLogin }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>("email");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function clearFeedback() {
    setError("");
    setMessage("");
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setResetOpen(false);
    setResetStep("email");
    clearFeedback();
  }

  function openReset() {
    setResetOpen(true);
    setResetStep("email");
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    clearFeedback();
  }

  function closeReset() {
    setResetOpen(false);
    setResetStep("email");
    clearFeedback();
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    clearFeedback();

    if (mode === "signIn" && isDemoLoginEnabled) {
      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail || !trimmedEmail.includes("@")) {
        setError("Unesite ispravnu email adresu (npr. vi@demo.com).");
        setLoading(false);
        return;
      }
      onDemoLogin?.({
        email: trimmedEmail,
        fullName: displayNameFromEmail(trimmedEmail),
      });
      setLoading(false);
      return;
    }

    if (!supabase) {
      setError("Registracija zahtijeva Supabase. Za demo koristite karticu Prijava.");
      setLoading(false);
      return;
    }

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
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: fullName.trim(), role: "patient" } },
      });
      if (authError) {
        setError(authErrorMessage(authError.message));
      } else if (data.session) {
        setMessage("Nalog je kreiran. Dobrodosli u CareTrace.");
      } else {
        setMessage("Nalog je kreiran. Provjerite email za potvrdu, zatim se prijavite.");
      }
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (authError) setError(authErrorMessage(authError.message));
    setLoading(false);
  }

  async function submitResetEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setError("Unesite email adresu.");
      return;
    }
    setLoading(true);
    clearFeedback();
    try {
      const text = await requestPasswordResetCode(email).catch(async () => {
        return requestPasswordResetCodeSupabase(email);
      });
      setMessage(text);
      setResetStep("code");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Slanje koda nije uspjelo.");
    } finally {
      setLoading(false);
    }
  }

  async function submitResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(resetCode.trim())) {
      setError("Unesite 6-cifreni sigurnosni kod iz emaila.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Nova lozinka mora imati najmanje 8 znakova.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("Lozinke se ne podudaraju.");
      return;
    }

    setLoading(true);
    clearFeedback();
    try {
      const text = await confirmPasswordReset(email, resetCode, newPassword).catch(async () => {
        return confirmPasswordResetSupabase(email, resetCode, newPassword);
      });
      setMessage(text);
      closeReset();
      setMode("signIn");
      setPassword("");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Reset lozinke nije uspio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-page">
        <header className="auth-hero">
          <div className="auth-hero-glow" aria-hidden="true" />
          <div className="auth-brand auth-brand-hero auth-brand-hope">
            <strong className="auth-hope-name">HOPE</strong>
            <small>Lični medicinski karton</small>
          </div>
          <h1 className="auth-hero-title">
            {resetOpen ? "Obnovite pristup nalogu" : "Dobrodošli"}
          </h1>
          <p className="auth-hero-text">
            {resetOpen
              ? "Sigurnosni kod stiže na vaš email. Kod vrijedi 15 minuta."
              : "Prijavite se ili registrujte — svi nalazi na jednom sigurnom mjestu."}
          </p>
        </header>

        <section className="auth-card">
          {!resetOpen ? (
            <form className="auth-form" onSubmit={submitAuth}>
              <div className="auth-tabs" role="tablist" aria-label="Vrsta pristupa">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signIn"}
                  className={mode === "signIn" ? "selected" : ""}
                  onClick={() => switchMode("signIn")}
                >
                  Prijava
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signUp"}
                  className={mode === "signUp" ? "selected" : ""}
                  onClick={() => switchMode("signUp")}
                >
                  Registracija
                </button>
              </div>

              {mode === "signUp" && (
                <div className="auth-field">
                  <label htmlFor="full-name">Ime i prezime</label>
                  <input
                    id="full-name"
                    required
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                    placeholder="npr. Emir Hadzic"
                  />
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="email">Email adresa</label>
                <input
                  id="email"
                  required
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="vas@email.com"
                />
              </div>

              <div className="auth-field auth-field-password">
                <label htmlFor="password">Lozinka</label>
                <div className="auth-input-wrap">
                  <input
                    id="password"
                    required={mode === "signUp"}
                    minLength={mode === "signUp" ? 8 : undefined}
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === "signUp" ? "min. 8 znakova" : "Unesite lozinku"}
                  />
                  <button
                    type="button"
                    className="auth-toggle-pw"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Sakrij lozinku" : "Prikazi lozinku"}
                  >
                    {showPassword ? "Sakrij" : "Prikazi"}
                  </button>
                </div>
              </div>

              {mode === "signUp" && (
                <div className="auth-field">
                  <label htmlFor="confirm-password">Potvrdite lozinku</label>
                  <input
                    id="confirm-password"
                    required
                    minLength={8}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="ponovite lozinku"
                  />
                </div>
              )}

              {mode === "signIn" && isDemoLoginEnabled && (
                <p className="auth-demo-note">Demo: prijava radi sa bilo kojim emailom i lozinkom.</p>
              )}

              {mode === "signIn" && !isDemoLoginEnabled && (
                <button type="button" className="auth-link-btn" onClick={openReset}>
                  Zaboravili ste lozinku?
                </button>
              )}

              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="form-message" role="status">{message}</p>}

              <button
                className="auth-submit"
                disabled={loading || (mode === "signUp" && !isSupabaseConfigured)}
              >
                {loading ? "Molimo sacekajte..." : mode === "signIn" ? "Prijavi se" : "Kreiraj nalog"}
              </button>
            </form>
          ) : (
            <form
              className="auth-form"
              onSubmit={resetStep === "email" ? submitResetEmail : submitResetPassword}
            >
              <button type="button" className="auth-back" onClick={closeReset}>
                ← Nazad na prijavu
              </button>

              <div className="auth-field">
                <label htmlFor="reset-email">Email adresa</label>
                <input
                  id="reset-email"
                  required
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={resetStep !== "email"}
                  placeholder="vas@email.com"
                />
              </div>

              {resetStep !== "email" && (
                <>
                  <div className="auth-field">
                    <label htmlFor="reset-code">Sigurnosni kod</label>
                    <input
                      id="reset-code"
                      className="auth-code-input"
                      required
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={resetCode}
                      onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                    />
                    <small className="auth-field-hint">6 cifara iz email poruke</small>
                  </div>

                  <div className="auth-field">
                    <label htmlFor="new-password">Nova lozinka</label>
                    <input
                      id="new-password"
                      required
                      minLength={8}
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="min. 8 znakova"
                    />
                  </div>

                  <div className="auth-field">
                    <label htmlFor="confirm-new-password">Potvrdite lozinku</label>
                    <input
                      id="confirm-new-password"
                      required
                      minLength={8}
                      type="password"
                      autoComplete="new-password"
                      value={confirmNewPassword}
                      onChange={(event) => setConfirmNewPassword(event.target.value)}
                      placeholder="ponovite lozinku"
                    />
                  </div>
                </>
              )}

              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="form-message" role="status">{message}</p>}

              <button className="auth-submit" disabled={loading}>
                {loading
                  ? "Molimo sacekajte..."
                  : resetStep === "email"
                    ? "Posalji sigurnosni kod"
                    : "Postavi novu lozinku"}
              </button>

              {resetStep !== "email" && (
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setResetStep("email");
                    setResetCode("");
                    clearFeedback();
                  }}
                >
                  Posalji novi kod
                </button>
              )}
            </form>
          )}
        </section>

        <footer className="auth-page-footer">
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <button type="button" className="auth-link-btn" onClick={() => { window.location.hash = "#pristupdoktora"; }}>
              Pristup doktora
            </button>
          </div>
          <small>Vasi medicinski podaci su privatni i zasticeni.</small>
        </footer>
      </div>
    </main>
  );
}

export default AuthPanel;
