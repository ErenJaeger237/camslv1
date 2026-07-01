import { useEffect } from "react";
import { useAppStore } from "./store/appStore";
import { SplashScreen } from "./components/SplashScreen";
import { LoginPage } from "./components/LoginPage";
import { ProfileSetup } from "./components/ProfileSetup";
import { OnboardingSlides } from "./components/OnboardingSlides";
import { Layout } from "./components/Layout";
import { SignToText } from "./components/SignToText";
import { TextToSign } from "./components/TextToSign";
import { PracticeMode } from "./components/PracticeMode";
import { DatasetPanel } from "./components/DatasetPanel";
import { ChatPanel } from "./components/ChatPanel";

const BASE = import.meta.env.VITE_API_URL ?? "";

export default function App() {
  const { appPhase, activeTab, token, logout } = useAppStore();

  // On startup, validate the stored token against the backend.
  // If the session is still alive in Supabase → stay logged in.
  // If it expired or is missing → clear localStorage and show login.
  useEffect(() => {
    if (!token) return;
    fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => { if (r.status === 401) logout(); })
      .catch(() => { /* Render spinning up — keep user logged in and retry naturally */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (appPhase === "splash")        return <SplashScreen />;
  if (appPhase === "login")         return <LoginPage />;
  if (appPhase === "profile-setup") return <ProfileSetup />;
  if (appPhase === "onboarding")    return <OnboardingSlides />;

  return (
    <Layout>
      <div className="h-[calc(100vh-8rem)]">
        {activeTab === "sign2text" && <SignToText />}
        {activeTab === "text2sign" && <TextToSign />}
        {activeTab === "practice"  && <PracticeMode />}
        {activeTab === "dataset"   && <DatasetPanel />}
        {activeTab === "chat"      && <ChatPanel />}
      </div>
    </Layout>
  );
}
