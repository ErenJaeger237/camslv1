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

      {/* ── Header ── */}
      <header className="border-b border-white/6 bg-navy-950/90 backdrop-blur-xl px-6 py-0 flex items-stretch gap-6 sticky top-0 z-20 h-14 shadow-[0_1px_0_rgba(255,255,255,0.04)]">

        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0 py-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-[0_0_16px_rgba(45,212,191,0.5)]">
            <HandIcon className="w-4 h-4 text-navy-950" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight tracking-tight" style={{ fontFamily: "'Inter', sans-serif" }}>CamSL</h1>
            <p className="text-[9px] text-teal-400/60 uppercase tracking-[0.15em] leading-none">Sign Language AI</p>
          </div>
        </div>

        {/* Nav tabs — each tab has a bottom-border active indicator */}
        <nav className="flex items-stretch gap-0.5 ml-4">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex items-center gap-2 px-4 text-sm font-medium transition-all duration-200 cursor-pointer border-b-2",
                  active
                    ? "text-teal-400 border-teal-400"
                    : "text-slate-500 border-transparent hover:text-slate-200 hover:border-white/20",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{label}</span>

                {/* Active glow dot */}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* User + logout — pushed to the right */}
        <div className="ml-auto flex items-center gap-3 pl-4 border-l border-white/6">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="text-xs font-semibold text-white leading-tight">{username}</span>
            <span className="text-[9px] text-teal-400/50 uppercase tracking-widest">Member</span>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/4 hover:bg-red-500/15 transition-all duration-300 cursor-pointer border border-white/8 hover:border-red-500/40 group"
          >
            <LogoutIcon className="w-3.5 h-3.5 text-slate-500 group-hover:text-red-400 transition-colors" />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
