/** api.ts — typed wrappers for all FastAPI backend calls. */

const BASE = import.meta.env.VITE_API_URL ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export const sendChat = (message: string, history: {role:string;text:string}[]) =>
  post<{ reply: string }>("/api/chat", { message, history });

// ── Autocomplete ──────────────────────────────────────────────────────────────
export const getAutocomplete = (prefix: string) =>
  get<{ suggestions: string[] }>("/api/autocomplete", { prefix, n: "4" });

// ── Practice ──────────────────────────────────────────────────────────────────
export const initPractice = (session_id: string) =>
  post<{ letter: string; mastery: number }>("/api/practice/init", { session_id });

export const recordPracticeResult = (
  session_id: string,
  letter: string,
  correct: boolean,
  recent: string[],
) =>
  post<{ next_letter: string; mastery: number }>("/api/practice/result", {
    session_id,
    letter,
    correct,
    recent,
  });

// ── Contributions ─────────────────────────────────────────────────────────────
export const addContribution = (label: string, features: number[]) =>
  post<{ ok: boolean }>("/api/contributions", { label, features });

export const getContributionCounts = () =>
  get<{ counts: Record<string, number>; total: number }>("/api/contributions/counts");

export const deleteLastContribution = () =>
  del<{ ok: boolean; remaining: number }>("/api/contributions/last");

// ── Retrain ───────────────────────────────────────────────────────────────────
export const triggerRetrain = () =>
  post<{ ok: boolean; message: string }>("/api/retrain/trigger", {});

export const getRetrainStatus = () =>
  get<{ state: string; message: string; version: number }>("/api/retrain/status");
