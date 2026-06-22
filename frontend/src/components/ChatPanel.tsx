import { useRef, useState } from "react";
import { sendChat } from "../lib/api";
import { speak } from "../lib/tts";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";

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
      addChatMessage("assistant", "Sorry, I couldn't reach the server.");
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const insertSigned = () => {
    const text = (sentence + currentWord).trim();
    if (text) setInput((prev) => (prev ? prev + " " + text : text));
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {chatHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 text-sm text-center gap-2">
            <span className="text-4xl">🤖</span>
            <p>Ask anything about sign language, the app, or practice tips.</p>
          </div>
        )}
        {chatHistory.map((msg, i) => (
          <div
            key={i}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-teal-600 text-white rounded-br-sm"
                  : "bg-navy-700 text-slate-100 rounded-bl-sm",
              )}
            >
              <p>{msg.text}</p>
              {msg.role === "assistant" && (
                <button
                  onClick={() => speak(msg.text)}
                  className="text-xs text-slate-400 hover:text-teal-400 mt-1 transition-colors"
                >
                  🔊 Speak
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-navy-700 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <button
          onClick={insertSigned}
          title="Insert signed text"
          className="px-3 py-2 rounded-xl bg-navy-700 hover:bg-navy-600 text-sm transition-colors"
        >
          ✋→
        </button>
        <input
          className="flex-1 bg-navy-800 border border-navy-600 focus:border-teal-500 rounded-xl px-4 py-2 text-sm text-white focus:outline-none"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-navy-950 font-semibold text-sm transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
