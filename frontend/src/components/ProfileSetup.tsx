import { useState } from "react";
import { useAppStore, type SkillLevel, type UserProfile } from "../store/appStore";
import { cn } from "../lib/utils";

const SKILL_LEVELS: { value: SkillLevel; label: string; desc: string }[] = [
  { value: "beginner",     label: "Beginner",     desc: "Just starting out with sign language" },
  { value: "intermediate", label: "Intermediate", desc: "Know the alphabet, learning more signs" },
  { value: "advanced",     label: "Advanced",     desc: "Comfortable signing, want to refine" },
];

const GOAL_OPTIONS = [
  "Learn the manual alphabet",
  "Practice common signs",
  "Communicate with deaf people",
  "Support a deaf family member",
  "Academic / research",
  "Teach others",
];

export function ProfileSetup() {
  const { username, completeProfileSetup } = useAppStore();
  const [displayName, setDisplayName] = useState(username ?? "");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>("beginner");
  const [goals, setGoals] = useState<string[]>([]);
  const [error, setError] = useState("");

  function toggleGoal(goal: string) {
    setGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) { setError("Please enter a display name."); return; }
    const profile: UserProfile = {
      displayName: displayName.trim(),
      skillLevel,
      goals,
    };
    completeProfileSetup(profile);
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-6 select-none">

      {/* Header */}
      <div className="flex flex-col items-center mb-10">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-xl"
          style={{
            background: "linear-gradient(135deg, #3ddbd9 0%, #1ea8a6 100%)",
            boxShadow: "0 0 30px rgba(61,219,217,0.25)",
          }}
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="#070e1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">Set Up Your Profile</h1>
        <p className="text-sm text-slate-400 text-center max-w-xs">
          Tell us a bit about yourself so we can tailor the experience for you.
        </p>
      </div>

      <form onSubmit={submit} className="w-full max-w-md flex flex-col gap-7">

        {/* Display name */}
        <div>
          <label className="block text-xs text-slate-400 uppercase tracking-widest mb-2 font-semibold">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); setError(""); }}
            placeholder="How should we call you?"
            className="w-full bg-navy-800 border border-navy-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/40 transition-colors"
          />
          {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
        </div>

        {/* Skill level */}
        <div>
          <label className="block text-xs text-slate-400 uppercase tracking-widest mb-3 font-semibold">
            My Sign Language Level
          </label>
          <div className="flex flex-col gap-2">
            {SKILL_LEVELS.map(({ value, label, desc }) => {
              const active = skillLevel === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSkillLevel(value)}
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-xl border text-left transition-all cursor-pointer",
                    active
                      ? "border-teal-500/60 bg-teal-500/10"
                      : "border-navy-700 bg-navy-800 hover:border-navy-600"
                  )}
                >
                  {/* Radio indicator */}
                  <span
                    className="mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: active ? "#3ddbd9" : "#162d44",
                    }}
                  >
                    {active && (
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: "#3ddbd9" }}
                      />
                    )}
                  </span>
                  <span>
                    <span
                      className={cn(
                        "block text-sm font-semibold",
                        active ? "text-teal-400" : "text-slate-200"
                      )}
                    >
                      {label}
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Goals */}
        <div>
          <label className="block text-xs text-slate-400 uppercase tracking-widest mb-3 font-semibold">
            My Goals{" "}
            <span className="text-slate-600 normal-case tracking-normal font-normal">(pick any)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {GOAL_OPTIONS.map((goal) => {
              const selected = goals.includes(goal);
              return (
                <button
                  key={goal}
                  type="button"
                  onClick={() => toggleGoal(goal)}
                  className={cn(
                    "px-3.5 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer",
                    selected
                      ? "border-teal-500/60 bg-teal-500/15 text-teal-300"
                      : "border-navy-700 bg-navy-800 text-slate-400 hover:border-navy-600 hover:text-slate-200"
                  )}
                >
                  {selected ? "✓ " : ""}{goal}
                </button>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="w-full py-3.5 rounded-xl font-bold text-sm text-navy-950 transition-all cursor-pointer shadow-lg mt-1"
          style={{
            background: "linear-gradient(135deg, #3ddbd9, #1ea8a6)",
            boxShadow: "0 0 20px rgba(61,219,217,0.25)",
          }}
        >
          Continue →
        </button>

        <p className="text-center text-xs text-slate-600 -mt-3">
          You can always update this later from the settings.
        </p>
      </form>
    </div>
  );
}
