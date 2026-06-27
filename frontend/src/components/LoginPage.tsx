import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function apiAuth(path: string, body: { username: string; password: string }) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail ?? "Request failed");
  return data as { token: string; username: string; user_id: string };
}

export function LoginPage() {
  const { loginSuccess, registerSuccess } = useAppStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await apiAuth(path, { username: username.trim(), password });
      if (mode === "login") {
        loginSuccess(res.token, res.username, res.user_id);
      } else {
        registerSuccess(res.token, res.username, res.user_id);
      }
    } catch (err) {
      setError(String(err).replace("Error: ", ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4">

      {/* Logo / brand */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center shadow-xl shadow-teal-900/30">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-teal-400 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
            <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Fira Code', monospace" }}>
            CamSL Translator
          </h1>
          <p className="text-sm text-slate-400 mt-1">Cameroon Sign Language Bridge</p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-navy-800 rounded-2xl border border-navy-700/60 shadow-2xl shadow-black/40 overflow-hidden">

        {/* Mode tabs */}
        <div className="flex border-b border-navy-700/60">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className={cn(
                "flex-1 py-3.5 text-sm font-semibold transition-colors cursor-pointer capitalize",
                mode === m
                  ? "bg-navy-750 text-teal-400 border-b-2 border-teal-500"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              placeholder="e.g. kofi_asante"
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "register" ? "At least 6 characters" : "••••••••"}
              className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-2.5 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-navy-950 font-bold text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/40 mt-1"
          >
            {loading
              ? (mode === "login" ? "Signing in…" : "Creating account…")
              : (mode === "login" ? "Sign in" : "Create account")}
          </button>

          <p className="text-center text-xs text-slate-500">
            {mode === "login" ? "No account yet? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              className="text-teal-400 hover:text-teal-300 cursor-pointer font-medium transition-colors"
            >
              {mode === "login" ? "Register" : "Sign in"}
            </button>
          </p>
        </form>
      </div>

      <p className="mt-6 text-xs text-slate-600 text-center max-w-xs">
        Undergraduate final-year project — Cameroon Sign Language desktop translator.
      </p>
    </div>
  );
}
