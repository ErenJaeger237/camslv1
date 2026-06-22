import { type ReactNode } from "react";
import { useAppStore, type Tab } from "../store/appStore";
import { cn } from "../lib/utils";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "sign2text", label: "Sign → Text", icon: "✋" },
  { id: "text2sign", label: "Text → Sign", icon: "💬" },
  { id: "practice",  label: "Practice",    icon: "🎯" },
  { id: "dataset",   label: "Dataset",     icon: "📦" },
  { id: "chat",      label: "AI Chat",     icon: "🤖" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { activeTab, setTab } = useAppStore();

  return (
    <div className="min-h-screen bg-navy-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-navy-700 bg-navy-900 px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🤟</span>
          <div>
            <h1 className="text-lg font-bold text-teal-400 leading-tight">CamSL Translator</h1>
            <p className="text-xs text-slate-400">Cameroon Sign Language</p>
          </div>
        </div>

        <nav className="flex gap-1 ml-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-teal-500 text-navy-950"
                  : "text-slate-400 hover:text-white hover:bg-navy-700",
              )}
            >
              <span className="mr-1">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>

      <footer className="border-t border-navy-800 px-6 py-2 text-xs text-slate-600 text-center">
        CamSL Translator — Final Year Project · MediaPipe + TF.js · React
      </footer>
    </div>
  );
}
