from fastapi import APIRouter

router = APIRouter()

# Curated word list (common English words that can be fingerspelled)
WORD_LIST = [
    "able", "about", "above", "after", "again", "age", "ago", "all", "also",
    "always", "and", "angry", "animal", "another", "any", "apple", "are",
    "ask", "baby", "back", "bad", "ball", "be", "because", "bed", "big",
    "bird", "black", "blue", "book", "boy", "brother", "brown", "but", "buy",
    "call", "camera", "can", "car", "cat", "child", "city", "clean", "cold",
    "color", "come", "cool", "copy", "cost", "country", "create", "cry",
    "dad", "dark", "data", "day", "dead", "deep", "different", "doctor",
    "dog", "door", "down", "dream", "drink", "drive", "during", "each",
    "early", "eat", "else", "end", "enjoy", "even", "event", "every",
    "example", "eye", "face", "fact", "fall", "family", "far", "fast",
    "father", "feel", "few", "file", "find", "first", "food", "for",
    "forget", "free", "friend", "from", "front", "full", "fun", "game",
    "get", "girl", "give", "glad", "go", "good", "great", "green", "group",
    "grow", "hand", "happy", "hard", "have", "he", "head", "hear", "heart",
    "help", "her", "here", "high", "him", "his", "home", "hope", "hospital",
    "hot", "hour", "how", "hurt", "if", "important", "into", "it", "job",
    "just", "keep", "kind", "know", "large", "last", "late", "learn",
    "leave", "left", "less", "let", "life", "light", "like", "listen",
    "little", "live", "long", "look", "love", "make", "man", "many", "me",
    "meet", "money", "more", "most", "mother", "move", "much", "music", "my",
    "name", "need", "new", "next", "nice", "night", "no", "not", "now",
    "off", "often", "old", "on", "open", "or", "our", "out", "over", "own",
    "people", "place", "plan", "play", "please", "point", "police", "put",
    "read", "ready", "real", "red", "remember", "right", "run", "sad",
    "safe", "say", "school", "see", "send", "she", "short", "show", "sick",
    "sign", "simple", "since", "small", "so", "some", "soon", "sorry",
    "speak", "start", "stop", "strong", "study", "take", "talk", "teacher",
    "tell", "thank", "that", "the", "their", "them", "then", "there",
    "they", "thing", "this", "time", "today", "together", "too", "top",
    "try", "turn", "under", "up", "use", "very", "wait", "want", "water",
    "we", "what", "when", "where", "which", "white", "who", "why", "will",
    "with", "work", "world", "write", "year", "yellow", "yes", "yet", "you",
    "young", "your",
]

_TRIE: dict[str, list[str]] = {}
for w in WORD_LIST:
    for i in range(1, len(w) + 1):
        _TRIE.setdefault(w[:i], []).append(w)


@router.get("/autocomplete")
def autocomplete(prefix: str = "", n: int = 4):
    prefix = prefix.lower().strip()
    if not prefix:
        return {"suggestions": []}
    suggestions = _TRIE.get(prefix, [])[:n]
    return {"suggestions": suggestions}
