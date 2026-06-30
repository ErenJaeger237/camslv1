import { useRef, useState } from "react";
import { sendChat } from "../lib/api";
import { speak } from "../lib/tts";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";
import { SendIcon, VolumeIcon, HandIcon } from "./icons";

export function ChatPanel() {
  const { chatHistory, addChatMessage, currentWord, sentence } = useAppStore();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMessage = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput("");
    addChatMessage("user", msg);
    setLoading(true);
    try {
      const history = chatHistory.map((h) => ({ role: h.role === "user" ? "user" : "model", text: h.text }));
      const r = await sendChat(msg, history);
      addChatMessage("assistant", r.reply);
    } catch {
      addChatMessage("assistant", "⚠️ AI chat is unavailable right now. Make sure the backend is running with a valid GEMINI_API_KEY environment variable set.");
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const insertSigned = () => {
    const text = (sentence + currentWord).trim();
    if (text) setInput((p) => (p ? p + " " + text : text));
  };

  return (
    <div className="flex flex-col h-full p-6 gap-4 max-w-3xl mx-auto w-full">

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {chatHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4">
            <div className="w-16 h-16 rounded-3xl glass-card flex items-center justify-center">
              <HandIcon className="w-8 h-8 text-teal-500/40" />
            </div>
            <p className="text-sm text-center text-slate-500 max-w-xs leading-relaxed">
              Ask anything about sign language, practice tips, or the app.
              You can also insert your signed text using the button below.
            </p>
          </div>
        )}
        {chatHistory.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg",
                msg.role === "user"
                  ? "bg-gradient-to-br from-teal-600 to-teal-500 text-white rounded-br-sm shadow-[0_4px_16px_rgba(45,212,191,0.25)]"
                  : "glass-card text-slate-100 rounded-bl-sm",
              )}
            >
              <p>{msg.text}</p>
              {msg.role === "assistant" && (
                <button
                  onClick={() => speak(msg.text)}
                  className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-teal-400 mt-2 transition-colors cursor-pointer"
                >
                  <VolumeIcon className="w-3 h-3" /> Read aloud
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="glass-card rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-2 h-2 bg-teal-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="glass-card p-3 flex gap-2 items-center">
        {/* Insert signed text */}
        <button
          onClick={insertSigned}
          title="Insert signed text into chat"
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/6 hover:bg-teal-500/15 border border-white/8 hover:border-teal-500/40 transition-all duration-300 cursor-pointer shrink-0 text-slate-400 hover:text-teal-400"
        >
          <HandIcon className="w-4 h-4" />
        </button>

        <input
          className="flex-1 bg-transparent border-none focus:outline-none text-sm text-white placeholder:text-slate-600"
          placeholder="Ask about sign language…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
        />

        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 transition-all duration-300 cursor-pointer shadow-[0_0_16px_rgba(45,212,191,0.3)] hover:shadow-[0_0_24px_rgba(45,212,191,0.5)] shrink-0 transform hover:-translate-y-0.5"
        >
          <SendIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
