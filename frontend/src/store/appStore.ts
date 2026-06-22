import { create } from "zustand";

export type Tab = "sign2text" | "text2sign" | "practice" | "dataset" | "chat";

interface AppState {
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
  practiceHistory: {letter: string; correct: boolean}[];
  setPracticeState: (target: string, mastery: number) => void;
  addPracticeResult: (letter: string, correct: boolean) => void;

  // Chat
  chatHistory: { role: "user" | "assistant"; text: string }[];
  addChatMessage: (role: "user" | "assistant", text: string) => void;
}

function makeSessionId(): string {
  const stored = localStorage.getItem("camsl_session_id");
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem("camsl_session_id", id);
  return id;
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: "sign2text",
  setTab: (t) => set({ activeTab: t }),

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

  sessionId: makeSessionId(),
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
