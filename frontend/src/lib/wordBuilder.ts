/**
 * wordBuilder.ts — port of src/word_builder.py.
 *
 * Commits a letter when the same prediction has been stable for
 * STABILITY_FRAMES consecutive frames at >= CONFIDENCE_THRESHOLD.
 * Requires a "different" prediction between repeats of the same letter.
 * An open-palm / no-detection held for SPACE_FRAMES inserts a space.
 */

export const STABILITY_FRAMES = 15;   // ~0.5 s at 30 fps
export const SPACE_FRAMES = 20;        // ~0.67 s open-palm → space
export const CONFIDENCE_THRESHOLD = 0.80;

export class WordBuilder {
  private _buffer: string[] = [];
  private _lastCommitted = "";
  private _sentence = "";
  private _currentWord = "";
  private _noHandCount = 0;
  private _suggestions: string[] = [];

  /** Feed one frame's prediction. Returns true if something was committed. */
  update(letter: string | null, confidence: number): boolean {
    if (!letter || confidence < CONFIDENCE_THRESHOLD) {
      this._handleNoHand();
      this._buffer = [];
      return false;
    }

    this._noHandCount = 0;

    this._buffer.push(letter);
    if (this._buffer.length > STABILITY_FRAMES) {
      this._buffer.shift();
    }

    if (this._buffer.length < STABILITY_FRAMES) return false;

    // All frames in buffer must agree
    const stable = this._buffer.every((l) => l === letter);
    if (!stable) return false;

    // Same letter must not repeat without a break
    if (letter === this._lastCommitted) return false;

    this._commit(letter);
    return true;
  }

  private _commit(letter: string): void {
    this._lastCommitted = letter;
    this._currentWord += letter;
    this._buffer = [];
  }

  private _handleNoHand(): void {
    this._noHandCount++;
    this._lastCommitted = "";  // allow same letter after a pause
    if (this._noHandCount >= SPACE_FRAMES && this._currentWord) {
      this._sentence += this._currentWord + " ";
      this._currentWord = "";
      this._noHandCount = 0;
    }
  }

  /** Accept an autocomplete suggestion, replacing the current partial word. */
  acceptSuggestion(word: string): void {
    if (!word) return;
    this._sentence += word + " ";
    this._currentWord = "";
    this._lastCommitted = "";
    this._buffer = [];
  }

  backspace(): void {
    if (this._currentWord) {
      this._currentWord = this._currentWord.slice(0, -1);
    } else if (this._sentence.trimEnd()) {
      const words = this._sentence.trimEnd().split(" ");
      words.pop();
      this._sentence = words.length ? words.join(" ") + " " : "";
    }
    this._lastCommitted = "";
  }

  clear(): void {
    this._buffer = [];
    this._lastCommitted = "";
    this._sentence = "";
    this._currentWord = "";
    this._noHandCount = 0;
    this._suggestions = [];
  }

  setSuggestions(words: string[]): void {
    this._suggestions = words;
  }

  get currentWord(): string { return this._currentWord; }
  get sentence(): string { return this._sentence; }
  get fullText(): string { return (this._sentence + this._currentWord).trim(); }
  get suggestions(): string[] { return this._suggestions; }
  get lastCommitted(): string { return this._lastCommitted; }
}
