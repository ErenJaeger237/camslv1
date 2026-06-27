import { create } from "zustand";

export type Tab = "sign2text" | "text2sign" | "practice" | "dataset" | "chat";
export type AppPhase = "splash" | "login" | "profile-setup" | "onboarding" | "app";
export type SkillLevel = "beginner" | "intermediate" | "advanced";

export interface UserProfile {
  displayName: string;
  skillLevel: SkillLevel;
  goals: string[];
}

interface AppState {
  // ── Phase ────────────────────────────────────────────────────────────────
  appPhase: AppPhase;
  finishSplash: () => void;
  completeProfileSetup: (profile: UserProfile) => void;
  completeOnboarding: () => void;

  // ── Auth ──────────────────────────────────────────────────────────────────
  token: string | null;
  username: string | null;
  userId: string | null;
  profile: UserProfile | null;
  loginSuccess: (token: string, username: string, userId: string) => void;
  registerSuccess: (token: string, username: string, userId: string) => void;
  logout: () => void;

  activeTab: Tab;
  setTab: (t: Tab) => void;

  // Sign → Text
  currentLetter: string;
  confidence: number;
  currentWord: string;
  sentence: string;
  suggestions: string[];
  setSignResult: (letter: string, conf: number, word: string, sentence: string) => void;
  setSuggestions: (s: string[]) => void;

  // Text → Sign
  textToSignInput: string;
  setTextToSignInput: (t: string) => void;

  // Practice
  sessionId: string;
  practiceTarget: string;
  practiceMastery: number;
  practiceHistory: { letter: string; correct: boolean }[];
  setPracticeState: (target: string, mastery: number) => void;
  addPracticeResult: (letter: string, correct: boolean) => void;

  // Chat
  chatHistory: { role: "user" | "assistant"; text: string }[];
  addChatMessage: (role: "user" | "assistant", text: string) => void;
}

function loadAuth() {
  return {
    token: localStorage.getItem("camsl_token"),
    username: localStorage.getItem("camsl_username"),
    userId: localStorage.getItem("camsl_user_id"),
  };
}

function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem("camsl_profile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getSessionId(userId: string | null): string {
  if (userId) return userId;
  const stored = localStorage.getItem("camsl_session_id");
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem("camsl_session_id", id);
  return id;
}

const VALID_TABS: Tab[] = ["sign2text", "text2sign", "practice", "dataset", "chat"];

function getInitialPhase(): AppPhase {
  const token = localStorage.getItem("camsl_token");
  // Fresh visit with no account → show splash then login
  if (!token) return "splash";
  // Returning user — skip splash, restore position
  const done = !!localStorage.getItem("camsl_onboarding_done");
  return done ? "app" : "onboarding";
}

function getInitialTab(): Tab {
  const saved = localStorage.getItem("camsl_active_tab") as Tab | null;
  return saved && VALID_TABS.includes(saved) ? saved : "sign2text";
}

const stored = loadAuth();

export const useAppStore = create<AppState>((set, get) => ({
  appPhase: getInitialPhase(),

  finishSplash: () => {
    const { token } = get();
    if (!token) { set({ appPhase: "login" }); return; }
    const done = !!localStorage.getItem("camsl_onboarding_done");
    if (!done) { set({ appPhase: "onboarding" }); return; }
    set({ appPhase: "app" });
  },

  completeProfileSetup: (profile: UserProfile) => {
    localStorage.setItem("camsl_profile", JSON.stringify(profile));
    set({ profile, appPhase: "onboarding" });
  },

  completeOnboarding: () => {
    localStorage.setItem("camsl_onboarding_done", "1");
    set({ appPhase: "app" });
  },

  // Auth
  token: stored.token,
  username: stored.username,
  userId: stored.userId,
  profile: loadProfile(),

  loginSuccess: (token, username, userId) => {
    localStorage.setItem("camsl_token", token);
    localStorage.setItem("camsl_username", username);
    localStorage.setItem("camsl_user_id", userId);
    const done = !!localStorage.getItem("camsl_onboarding_done");
    set({ token, username, userId, sessionId: userId, appPhase: done ? "app" : "onboarding" });
  },

  registerSuccess: (token, username, userId) => {
    localStorage.setItem("camsl_token", token);
    localStorage.setItem("camsl_username", username);
    localStorage.setItem("camsl_user_id", userId);
    set({ token, username, userId, sessionId: userId, appPhase: "profile-setup" });
  },

  logout: () => {
    localStorage.removeItem("camsl_token");
    localStorage.removeItem("camsl_username");
    localStorage.removeItem("camsl_user_id");
    localStorage.removeItem("camsl_active_tab");
    set({ token: null, username: null, userId: null, activeTab: "sign2text", appPhase: "login" });
  },

  activeTab: getInitialTab(),
  setTab: (t) => {
    localStorage.setItem("camsl_active_tab", t);
    set({ activeTab: t });
  },

  currentLetter: "",
  confidence: 0,
  currentWord: "",
  sentence: "",
  suggestions: [],
  setSignResult: (letter, confidence, currentWord, sentence) =>
    set({ currentLetter: letter, confidence, currentWord, sentence }),
  setSuggestions: (suggestions) => set({ suggestions }),

  textToSignInput: "",
  setTextToSignInput: (textToSignInput) => set({ textToSignInput }),

  sessionId: getSessionId(stored.userId),
  practiceTarget: "",
  practiceMastery: 0,
  practiceHistory: [],
  setPracticeState: (practiceTarget, practiceMastery) =>
    set({ practiceTarget, practiceMastery }),
  addPracticeResult: (letter, correct) =>
    set((s) => ({
      practiceHistory: [...s.practiceHistory.slice(-49), { letter, correct }],
    })),

  chatHistory: [],
  addChatMessage: (role, text) =>
    set((s) => ({
      chatHistory: [...s.chatHistory.slice(-39), { role, text }],
    })),
}));
