import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "";

type Mode = "login" | "register" | "forgot" | "reset";

async function apiFetch<T>(path: string, body: Record<string, string>): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail ?? "Request failed");
  return data as T;
}

function Field({
  label, type = "text", value, onChange, placeholder, autoFocus = false, autoComplete,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
  autoFocus?: boolean; autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 uppercase tracking-widest mb-1.5 font-semibold">
        {label}
      </label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        required autoFocus={autoFocus} autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 transition-colors"
      />
    </div>
  );
}

export function LoginPage() {
  const { loginSuccess, registerSuccess } = useAppStore();

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername]         = useState("");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [confirmPw, setConfirmPw]       = useState("");
  const [newPassword, setNewPassword]   = useState("");
  const [confirmNewPw, setConfirmNewPw] = useState("");
  const [resetToken, setResetToken]     = useState("");
  const [error, setError]               = useState("");
  const [success, setSuccess]           = useState("");
  const [loading, setLoading]           = useState(false);

  // Read ?reset_token= from URL on first load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get("reset_token");
    if (tok) {
      setResetToken(tok);
      setMode("reset");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const clearFeedback = () => { setError(""); setSuccess(""); };

  const switchMode = (m: Mode) => {
    setMode(m);
    clearFeedback();
    setPassword(""); setConfirmPw(""); setEmail("");
    setNewPassword(""); setConfirmNewPw("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    // Client-side confirm-password check
    if (mode === "register" && password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    if (mode === "reset" && newPassword !== confirmNewPw) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const res = await apiFetch<{ token: string; username: string; user_id: string }>(
          "/api/auth/login", { username: username.trim(), password }
        );
        loginSuccess(res.token, res.username, res.user_id);

      } else if (mode === "register") {
        const res = await apiFetch<{ token: string; username: string; user_id: string }>(
          "/api/auth/register", { username: username.trim(), password, email: email.trim() }
        );
        registerSuccess(res.token, res.username, res.user_id);

      } else if (mode === "forgot") {
        const res = await apiFetch<{ ok: boolean; message: string }>(
          "/api/auth/forgot-password", { email: email.trim() }
        );
        setSuccess(res.message);

      } else if (mode === "reset") {
        await apiFetch("/api/auth/reset-password", {
          token: resetToken,
          new_password: newPassword,
        });
        setSuccess("Password reset successfully! Please sign in with your new password.");
        setResetToken("");
        setTimeout(() => switchMode("login"), 2000);
      }
    } catch (err) {
      setError(String(err).replace("Error: ", ""));
    } finally {
      setLoading(false);
    }
  };

  const titleMap: Record<Mode, string> = {
    login:    "Sign in",
    register: "Create account",
    forgot:   "Forgot password",
    reset:    "Reset password",
  };

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4">

      {/* Brand */}
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

        {/* Tabs — only for login / register */}
        {(mode === "login" || mode === "register") && (
          <div className="flex border-b border-navy-700/60">
            {(["login", "register"] as const).map((m) => (
              <button key={m} onClick={() => switchMode(m)}
                className={cn(
                  "flex-1 py-3.5 text-sm font-semibold transition-colors cursor-pointer capitalize",
                  mode === m
                    ? "bg-navy-750 text-teal-400 border-b-2 border-teal-500"
                    : "text-slate-400 hover:text-slate-200",
                )}>
                {m === "login" ? "Sign in" : "Register"}
              </button>
            ))}
          </div>
        )}

        {/* Back arrow for forgot / reset */}
        {(mode === "forgot" || mode === "reset") && (
          <div className="px-6 pt-5 pb-0">
            <button onClick={() => switchMode("login")}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-400 transition-colors cursor-pointer">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Back to sign in
            </button>
            <p className="mt-3 text-base font-bold text-white">{titleMap[mode]}</p>
          </div>
        )}

        <form onSubmit={submit} className="p-6 flex flex-col gap-4">

          {/* ── Login ── */}
          {mode === "login" && (
            <>
              <Field label="Username" value={username} onChange={setUsername}
                placeholder="e.g. kofi_asante" autoFocus autoComplete="username" />
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Password</label>
                  <button type="button" onClick={() => switchMode("forgot")}
                    className="text-[11px] text-teal-400 hover:text-teal-300 cursor-pointer transition-colors">
                    Forgot password?
                  </button>
                </div>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoComplete="current-password" placeholder="••••••••"
                  className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 transition-colors" />
              </div>
            </>
          )}

          {/* ── Register ── */}
          {mode === "register" && (
            <>
              <Field label="Username" value={username} onChange={setUsername}
                placeholder="Letters, numbers, underscores" autoFocus autoComplete="username" />
              <Field label="Email" type="email" value={email} onChange={setEmail}
                placeholder="you@example.com — for password recovery" autoComplete="email" />
              <Field label="Password" type="password" value={password} onChange={setPassword}
                placeholder="At least 6 characters" autoComplete="new-password" />
              <Field label="Confirm Password" type="password" value={confirmPw} onChange={setConfirmPw}
                placeholder="Repeat your password" autoComplete="new-password" />
            </>
          )}

          {/* ── Forgot password ── */}
          {mode === "forgot" && (
            <>
              <p className="text-sm text-slate-400 -mt-1">
                Enter your account email and we'll send a reset link to <span className="text-teal-400">jordanebua2@gmail.com</span>.
              </p>
              <Field label="Email" type="email" value={email} onChange={setEmail}
                placeholder="you@example.com" autoFocus autoComplete="email" />
            </>
          )}

          {/* ── Reset password ── */}
          {mode === "reset" && (
            <>
              <p className="text-sm text-slate-400 -mt-1">Enter your new password below.</p>
              <Field label="New Password" type="password" value={newPassword} onChange={setNewPassword}
                placeholder="At least 6 characters" autoFocus autoComplete="new-password" />
              <Field label="Confirm New Password" type="password" value={confirmNewPw} onChange={setConfirmNewPw}
                placeholder="Repeat new password" autoComplete="new-password" />
            </>
          )}

          {/* Error / success */}
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-2.5 text-xs text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-teal-900/30 border border-teal-700/50 rounded-xl px-4 py-2.5 text-xs text-teal-300">
              {success}
            </div>
          )}

          {/* Submit */}
          {!(mode === "forgot" && success) && (
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-navy-950 font-bold text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/40 mt-1">
              {loading
                ? "Please wait…"
                : mode === "login"   ? "Sign in"
                : mode === "register" ? "Create account"
                : mode === "forgot"   ? "Send reset link"
                : "Set new password"}
            </button>
          )}

          {/* Mode switcher (login ↔ register) */}
          {(mode === "login" || mode === "register") && (
            <p className="text-center text-xs text-slate-500">
              {mode === "login" ? "No account yet? " : "Already have an account? "}
              <button type="button" onClick={() => switchMode(mode === "login" ? "register" : "login")}
                className="text-teal-400 hover:text-teal-300 cursor-pointer font-medium transition-colors">
                {mode === "login" ? "Register" : "Sign in"}
              </button>
            </p>
          )}
        </form>
      </div>

      <p className="mt-6 text-xs text-slate-600 text-center max-w-xs">
        Undergraduate final-year project — Cameroon Sign Language desktop translator.
      </p>
    </div>
  );
}
