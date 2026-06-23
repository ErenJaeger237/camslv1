import { useAppStore } from "./store/appStore";
import { LoginPage } from "./components/LoginPage";
import { Layout } from "./components/Layout";
import { SignToText } from "./components/SignToText";
import { TextToSign } from "./components/TextToSign";
import { PracticeMode } from "./components/PracticeMode";
import { DatasetPanel } from "./components/DatasetPanel";
import { ChatPanel } from "./components/ChatPanel";

export default function App() {
  const { token, activeTab } = useAppStore();

  if (!token) return <LoginPage />;

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
