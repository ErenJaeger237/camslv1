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

export default function App() {
  const { appPhase, activeTab } = useAppStore();

  if (appPhase === "splash")        return <SplashScreen />;
  if (appPhase === "login")         return <LoginPage />;
  if (appPhase === "profile-setup") return <ProfileSetup />;
  if (appPhase === "onboarding")    return <OnboardingSlides />;

  return (
    <Layout>
      <div className="flex-1 w-full flex flex-col relative">
        {activeTab === "sign2text" && <SignToText />}
        {activeTab === "text2sign" && <TextToSign />}
        {activeTab === "practice"  && <PracticeMode />}
        {activeTab === "dataset"   && <DatasetPanel />}
        {activeTab === "chat"      && <ChatPanel />}
      </div>
    </Layout>
  );
}
