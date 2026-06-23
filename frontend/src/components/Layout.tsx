import { type ReactNode } from "react";
import { useAppStore, type Tab } from "../store/appStore";
import { cn } from "../lib/utils";
import { HandIcon, MessageIcon, TargetIcon, DatabaseIcon, BotIcon } from "./icons";

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

const TABS: { id: Tab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: "sign2text", label: "Sign → Text", Icon: HandIcon },
  { id: "text2sign", label: "Text → Sign", Icon: MessageIcon },
  { id: "practice",  label: "Practice",    Icon: TargetIcon },
  { id: "dataset",   label: "Dataset",     Icon: DatabaseIcon },
  { id: "chat",      label: "AI Chat",     Icon: BotIcon },
];

export function Layout({ children }: { children: ReactNode }) {
  const { activeTab, setTab, username, logout } = useAppStore();

  return (
    <div className="min-h-screen bg-navy-950 text-white flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-navy-700/60 bg-navy-900/80 backdrop-blur-sm px-6 py-3 flex items-center gap-6 sticky top-0 z-20">
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-900/40">
            <HandIcon className="w-5 h-5 text-navy-950" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight tracking-tight">CamSL Translator</h1>
            <p className="text-[10px] text-teal-400/70 uppercase tracking-widest">Cameroon Sign Language</p>
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="flex gap-1 ml-auto items-center">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer",
                  active
                    ? "bg-teal-500 text-navy-950 shadow-lg shadow-teal-900/40"
                    : "text-slate-400 hover:text-white hover:bg-navy-700",
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">{label}</span>
              </button>
            );
          })}
          {/* User + logout */}
          <div className="ml-3 pl-3 border-l border-navy-700/60 flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-400 hidden sm:inline font-mono">{username}</span>
            <button
              onClick={logout}
              title="Sign out"
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-navy-700 hover:bg-red-900/50 transition-colors cursor-pointer border border-navy-600"
            >
              <LogoutIcon className="w-4 h-4 text-slate-400 hover:text-red-400" />
            </button>
          </div>
        </nav>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>

      <footer className="border-t border-navy-800/50 px-6 py-2 text-[11px] text-slate-600 text-center">
        CamSL Translator · MediaPipe + TF.js + React · Final Year Project
      </footer>
    </div>
  );
}
