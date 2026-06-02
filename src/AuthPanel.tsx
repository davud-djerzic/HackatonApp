import { useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";

type AuthMode = "signIn" | "signUp";
type Role = "patient" | "doctor";

function authErrorMessage(message: string) {
  if (message.toLowerCase().includes("email rate limit exceeded")) {
    return "Supabase temporarily blocked authentication emails. Disable Confirm email in the Supabase Dashboard to test without email verification.";
  }
  if (message.toLowerCase().includes("user already registered")) {
    return "An account with this email address already exists. Open the Sign in tab.";
  }
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "The email address or password is incorrect.";
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
        setError("The password must contain at least 8 characters.");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
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
        setMessage("Your account has been created. You are signed in to HOPE.");
      } else {
        setMessage("Your account has been created, but Supabase still requires email confirmation. Disable Confirm email in the project authentication settings.");
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
        <div className="auth-brand"><b>H</b><strong>HOPE</strong></div>
        <h1>Medical records in one secure place.</h1>
        <p>Patients keep their records organized while doctors securely deliver documents to registered patients.</p>
        <div><span>1</span><small>Private storage for medical documents</small></div>
        <div><span>2</span><small>Separate access for patients and doctors</small></div>
        <div><span>3</span><small>Email notifications without sensitive PDF attachments</small></div>
      </aside>

      <form className="panel auth-panel" onSubmit={submit}>
        <p className="eyebrow">SECURE ACCESS</p>
        <h2>{mode === "signIn" ? "Sign in to HOPE" : "Create a HOPE account"}</h2>
        <p>{mode === "signIn" ? "Enter your details to access your account." : "Choose your role and enter your basic information."}</p>

        <div className="auth-tabs">
          <button type="button" className={mode === "signIn" ? "selected" : ""} onClick={() => switchMode("signIn")}>Sign in</button>
          <button type="button" className={mode === "signUp" ? "selected" : ""} onClick={() => switchMode("signUp")}>Register</button>
        </div>

        {mode === "signUp" && <>
          <label>I am registering as</label>
          <div className="role-options">
            <button type="button" className={role === "patient" ? "selected" : ""} onClick={() => setRole("patient")}><b>P</b><span><strong>Patient</strong><small>Personal health record</small></span></button>
            <button type="button" className={role === "doctor" ? "selected" : ""} onClick={() => setRole("doctor")}><b>D</b><span><strong>Doctor</strong><small>Practice and medical records</small></span></button>
          </div>
          <label htmlFor="full-name">Full name</label>
          <input id="full-name" required value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
        </>}

        <label htmlFor="email">Email address</label>
        <input id="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        <label htmlFor="password">Password</label>
        <input id="password" required minLength={mode === "signUp" ? 8 : undefined} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signIn" ? "current-password" : "new-password"} />
        {mode === "signUp" && <>
          <label htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" required minLength={8} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        </>}

        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-message">{message}</p>}
        <button className="primary auth-submit" disabled={loading}>{loading ? "Please wait..." : mode === "signIn" ? "Sign in" : "Create account"}</button>
      </form>
    </section>
  </main>;
}

export default AuthPanel;
