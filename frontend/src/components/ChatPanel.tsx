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
      addChatMessage("assistant", "Sorry, I couldn't reach the server. Check your GEMINI_API_KEY.");
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
    <div className="flex flex-col h-full p-4 gap-3 max-w-3xl mx-auto w-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {chatHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
            <div className="w-16 h-16 rounded-3xl bg-navy-800 border border-navy-700 flex items-center justify-center">
              <HandIcon className="w-8 h-8 text-teal-600/50" />
            </div>
            <p className="text-sm text-center text-slate-500 max-w-xs">
              Ask anything about sign language, practice tips, or the app. You can also insert your signed text using the button below.
            </p>
          </div>
        )}
        {chatHistory.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow",
                msg.role === "user"
                  ? "bg-teal-600 text-white rounded-br-md"
                  : "bg-navy-700 text-slate-100 rounded-bl-md border border-navy-600",
              )}
            >
              <p>{msg.text}</p>
              {msg.role === "assistant" && (
                <button
                  onClick={() => speak(msg.text)}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-teal-400 mt-1.5 transition-colors cursor-pointer"
                >
                  <VolumeIcon className="w-3 h-3" /> Speak
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-navy-700 rounded-2xl rounded-bl-md px-4 py-3 border border-navy-600">
              <div className="flex gap-1.5 items-center">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <button
          onClick={insertSigned}
          title="Insert signed text into chat"
          className="w-10 flex items-center justify-center rounded-xl bg-navy-700 hover:bg-navy-600 border border-navy-600 transition-colors cursor-pointer shrink-0"
        >
          <HandIcon className="w-4 h-4" />
        </button>
        <input
          className="flex-1 bg-navy-800 border border-navy-600 focus:border-teal-500 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition-colors"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="w-10 flex items-center justify-center rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:cursor-not-allowed text-navy-950 transition-all duration-200 cursor-pointer shadow-lg shadow-teal-900/30 shrink-0"
        >
          <SendIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
