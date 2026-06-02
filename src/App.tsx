import { useEffect, useState } from "react";
import "./App.css";
import "./AuthPanel.css";
import "./AuthState.css";
import AuthPanel from "./AuthPanel";
import DoctorAccess from "./components/DoctorAccess";
import PatientDashboard from "./components/PatientDashboard";
import type { MedicalDocument } from "./types";
import { seedDemoHealthData } from "./lib/demoStore";
import { clearDemoUser, isDemoLoginEnabled, loadDemoUser, saveDemoUser } from "./lib/demoSession";
import type { DemoUser } from "./lib/demoSession";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

const initialDocuments: MedicalDocument[] = [
  {
    id: 1,
    title: "Kontrolni internistički nalaz",
    category: "Specijalisticki nalaz",
    specialization: "Interna medicina",
    doctor: "Dr. Amila M.",
    date: "28.05.2026.",
    source: "Doktor",
    status: "Novi nalaz",
    note: "Kontrola krvnog pritiska.",
  },
  {
    id: 2,
    title: "Laboratorijski nalazi — kompletna krvna slika",
    category: "Laboratorija",
    doctor: "Poliklinika Medis",
    date: "16.04.2026.",
    source: "Doktor",
    status: "Arhivirano",
    note: "Automatski zaprimljeno.",
  },
  {
    id: 3,
    title: "Ultrazvuk dojke",
    category: "Specijalisticki nalaz",
    specialization: "Ginekologija",
    doctor: "Dr. Lejla H.",
    date: "02.03.2026.",
    source: "Doktor",
    status: "Arhivirano",
    note: "Ginekološki pregled.",
  },
  {
    id: 4,
    title: "MR lumbalne kičme",
    category: "Snimanje",
    specialization: "Radiologija",
    doctor: "Centar za radiologiju",
    date: "11.01.2026.",
    source: "Doktor",
    status: "Arhivirano",
    note: "Radiološki nalaz.",
  },
  {
    id: 5,
    title: "EKG i holter",
    category: "Specijalisticki nalaz",
    specialization: "Kardiologija",
    doctor: "Dr. Dino K.",
    date: "11.01.2026.",
    source: "Doktor",
    status: "Arhivirano",
    note: "Kardiološki pregled.",
  },
];

export default function App() {
  const [route, setRoute] = useState(() => {
    const hash = window.location.hash;
    return hash === "#pristupdoktora" ? "doktor" : "app";
  });
  const [demoUser, setDemoUser] = useState<DemoUser | null>(() =>
    isDemoLoginEnabled ? loadDemoUser() : null,
  );
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [hasSession, setHasSession] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<{ fullName: string; inboxAlias: string | null } | null>(null);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      setRoute(hash === "#pristupdoktora" ? "doktor" : "app");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setProfileError("");
      setCurrentProfile(null);
      setHasSession(Boolean(session));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !hasSession || demoUser) return;
    supabase.from("profiles").select("full_name, inbox_alias, role").single().then(({ data, error }) => {
      if (error) {
        setProfileError("Profil nije ucitan.");
        return;
      }
      if (data?.role !== "patient") {
        setProfileError("Samo pacijentski nalog.");
        return;
      }
      setCurrentProfile({ fullName: data.full_name, inboxAlias: data.inbox_alias });
    });
  }, [hasSession, demoUser]);

  function handleDemoLogin(user: DemoUser) {
    seedDemoHealthData(user.email);
    saveDemoUser(user);
    setDemoUser(user);
    setProfileError("");
  }

  async function handleSignOut() {
    if (demoUser) {
      clearDemoUser();
      setDemoUser(null);
      return;
    }
    await supabase?.auth.signOut();
  }

  if (route === "doktor") return <DoctorAccess />;

  const showPatientApp = demoUser
    ? true
    : isSupabaseConfigured
      ? hasSession && !profileError && Boolean(currentProfile)
      : false;

  if (isSupabaseConfigured && !authReady) {
    return <main className="auth-shell"><p className="auth-loading">Provjera prijave...</p></main>;
  }

  if (!showPatientApp) {
    if (isSupabaseConfigured && hasSession && profileError) {
      return (
        <main className="auth-shell">
          <div className="auth-page">
            <section className="auth-card auth-state-card">
              <h2>Greska profila</h2>
              <p>{profileError}</p>
              <button type="button" className="auth-submit" onClick={() => void handleSignOut()}>Nazad</button>
            </section>
          </div>
        </main>
      );
    }
    if (isSupabaseConfigured && hasSession && !currentProfile) {
      return <main className="auth-shell"><p className="auth-loading">Ucitavanje...</p></main>;
    }
    return <AuthPanel onDemoLogin={handleDemoLogin} />;
  }

  const profile = demoUser
    ? {
        fullName: demoUser.fullName,
        inboxAlias: `${demoUser.email.split("@")[0]}@inbox.hope.app`,
        patientId: demoUser.email,
      }
    : {
        fullName: currentProfile!.fullName,
        inboxAlias: currentProfile!.inboxAlias,
        patientId: "",
      };

  return (
    <PatientDashboard
      profile={profile}
      demoPatientId={demoUser?.email}
      initialDocuments={initialDocuments}
      onSignOut={() => void handleSignOut()}
    />
  );
}
