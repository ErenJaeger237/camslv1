"""
autocomplete.py — Prefix-based word suggestions for the fingerspelling word builder.

After a few letters are committed, the GUI can call suggest(prefix) to get
a ranked list of likely completions. Uses a small curated word list so the
app has no internet or external-corpus dependency at runtime.
"""

# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------
MAX_SUGGESTIONS = 5     # maximum completions returned per call
MIN_PREFIX_LEN  = 2     # don't suggest until the user has signed at least this many letters

# ---------------------------------------------------------------------------
# Word list — common English words prioritised for everyday communication.
# Includes all words referenced in the common-signs vocabulary (§4.5).
# ---------------------------------------------------------------------------
_WORD_LIST = [
    # Greetings / farewells
    "hello", "goodbye", "hi", "hey", "welcome", "good",
    # Politeness
    "please", "thankyou", "thank", "sorry", "excuse", "help",
    # Yes / no
    "yes", "no", "okay", "ok", "sure", "maybe", "never",
    # People & relationships
    "name", "friend", "family", "mother", "father", "sister", "brother",
    "person", "people", "man", "woman", "child", "baby",
    # Basic needs
    "eat", "drink", "water", "food", "hungry", "thirsty", "sleep",
    "bathroom", "toilet", "rest", "home", "house",
    # Health
    "sick", "pain", "hurt", "hospital", "doctor", "medicine", "help",
    "emergency", "call", "ambulance", "nurse",
    # Places
    "school", "work", "market", "church", "road", "street", "city",
    "village", "country", "here", "there",
    # Time
    "today", "tomorrow", "yesterday", "morning", "afternoon", "evening",
    "night", "now", "later", "soon", "always", "never", "when",
    # Descriptors
    "big", "small", "hot", "cold", "fast", "slow", "new", "old",
    "happy", "sad", "angry", "afraid", "beautiful", "bad", "long", "short",
    # Actions
    "go", "come", "stop", "wait", "run", "walk", "see", "hear",
    "understand", "know", "think", "want", "need", "like", "love",
    "open", "close", "give", "take", "buy", "pay", "learn", "teach",
    # Common words
    "what", "where", "who", "why", "how", "much", "many",
    "this", "that", "here", "there", "with", "without",
    "money", "price", "number", "telephone", "phone",
    # Alphabet / learning context
    "letter", "word", "sign", "language", "spell", "repeat",
    "practice", "correct", "wrong", "again",
]

# Deduplicate and sort for deterministic output
_WORDS_SORTED: list[str] = sorted(set(w.upper() for w in _WORD_LIST))


def suggest(prefix: str, max_results: int = MAX_SUGGESTIONS) -> list[str]:
    """
    Return up to `max_results` words that start with `prefix` (case-insensitive).
    Returns an empty list if prefix is shorter than MIN_PREFIX_LEN.

    Parameters
    ----------
    prefix : str
        The letters committed so far (e.g. "HE").
    max_results : int
        Cap on the number of suggestions returned.

    Returns
    -------
    list[str]
        Matching words in alphabetical order, uppercased.
    """
    prefix = prefix.upper().strip()
    if len(prefix) < MIN_PREFIX_LEN:
        return []
    return [w for w in _WORDS_SORTED if w.startswith(prefix)][:max_results]
