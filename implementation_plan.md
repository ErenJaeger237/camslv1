# Implementation Plan — CamSL Translator Upgrades

This plan details the implementation of three major updates to the Cameroonian Sign Language Translator project, structured sequentially in the requested order:

1. **Step 2 — CamSL Dataset Builder Retraining & Hot-Reload**
2. **Step 3 — Sign Language Chat Assistant (Gemini API Integration)**
3. **Step 1 — SQLite-based Spaced Repetition (Leitner) Learning System**

---

## Phase 1: CamSL Dataset Builder Retraining (Step 2)

### 1.1 Python Backend Changes (`src/app.py`)
- **State Additions:** Add tracking keys to `self._state`:
  - `"training_status"`: String indicating status (`"idle"`, `"merging"`, `"training"`, `"finished"`, `"error"`).
  - `"training_epoch"`: Current epoch (e.g. `"Epoch 5/50"`).
  - `"training_loss"`: Current loss value.
  - `"training_val_acc"`: Current validation accuracy.
  - `"training_results"`: Dict containing `{ "old_acc": float, "new_acc": float, "delta": float }`.
- **Delete Last Sample:** Implement `delete_last_contribution()` to remove the last appended line from `data/contributions/contributions.csv` (useful for user errors).
- **Background Retraining:** Implement `trigger_retraining()`:
  - Spawn a daemon thread to avoid blocking the main app.
  - Read `data/features.csv` and `data/contributions/contributions.csv`.
  - Merge the two datasets, ensuring unique labels and proper feature shape (63 columns + label).
  - Run a compact retraining cycle:
    - Load the baseline network parameters.
    - Set up a Keras training callback to write current epoch, loss, and validation metrics to `self._state` under lock.
    - Re-evaluate on a test split to compare old vs. new test accuracy.
    - Save the updated model directly to `models/alphabet.keras`.
  - **Hot-Reload:** Call `self._recognizer.load_model()` to reload the new weights into the active `_ml_loop` without application restart.

### 1.2 Frontend Changes (`ui/index.html`)
- **Retraining Panel Block:** Add a card to the `panel-dataset` layout containing:
  - Current status details and active training indicators (a rotating spinner).
  - An epoch/loss progress tracker.
  - A "RETRAIN MODEL" button.
  - A "DELETE LAST SAMPLE" button.
  - A post-training metrics overlay comparing the old validation/test accuracy with the newly achieved accuracy.

---

## Phase 2: Sign Language Chat Assistant (Step 3)

### 2.1 Python Backend Changes (`src/app.py`)
- **API Call Integration:** Implement `send_chat_message(message, history)`:
  - Load the Google Gemini API key from `os.environ.get("GEMINI_API_KEY")`.
  - Use `urllib.request` or `requests` to make a POST request to the Gemini API endpoint:
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={API_KEY}`
  - Format the payload with a system instruction helping the model understand it is communicating with a deaf user through Cameroonian Sign Language support (plain, concise English responses, short sentences).
  - Return the text response.

### 2.2 Frontend Changes (`ui/index.html`)
- **Chat Interface Tab:**
  - Add a "Chat" tab to the header strip:
    `<button class="mode-btn" onclick="setMode('chat')">AI Chat</button>`
  - Create the corresponding `<div class="panel hidden" id="panel-chat">` container.
- **Chat Panel Layout:**
  - A scrollable message history list with chat bubbles (User vs. AI).
  - Each AI message bubble includes two small action buttons:
    - `🗣 Speak` (triggers the PowerShell TTS engine).
    - `🖐 Show Signs` (triggers play-back of the response sentence using sign images sequentially).
  - An input box pre-populated by the live Sign-to-Text recognizer staging value, with an option to manually type or edit before clicking "Send".

---

## Phase 3: SQLite-based Spaced Repetition System (Step 1)

### 3.1 Database Schema (`data/learning.db`)
- Set up an SQLite database containing the `leitner_stats` table:
  ```sql
  CREATE TABLE IF NOT EXISTS leitner_stats (
      letter TEXT PRIMARY KEY,
      box INTEGER DEFAULT 1,
      next_review INTEGER DEFAULT 0,
      total_attempts INTEGER DEFAULT 0,
      correct_attempts INTEGER DEFAULT 0
  )
  ```

### 3.2 Python Backend Changes (`src/app.py`)
- **Database Lifecycle:** Initialize the DB and seed all 24 letters in Box 1 upon startup.
- **Leitner Selection Algorithm:**
  - Implement a picker that selects the next letter:
    - Check if any letters have `next_review` <= current timestamp.
    - If yes, choose one randomly from the due pool.
    - If no letters are currently due, fall back to picking from the lowest populated Leitner Box (to keep practicing and graduating items).
- **Result Recording & Scheduling:**
  - Modify `record_practice_result(correct)`:
    - **Correct:** Move the letter up by 1 box (max Box 5). Set `next_review` to `now + delay`:
      - Box 2: 1 hour
      - Box 3: 1 day
      - Box 4: 3 days
      - Box 5: 7 days
    - **Incorrect/Skip:** Reset the letter to Box 1. Set `next_review` to `now`.
    - To avoid instant repetition in the same session, keep a small history of the last 3-5 practiced letters.
- **Overall Mastery Calculation:**
  - Retrieve the current box numbers for all 24 letters.
  - Calculate overall mastery percentage as:
    $$\text{Mastery \%} = \frac{\sum (\text{box\_level} - 1)}{4 \times 24} \times 100$$
    *(where Box 1 is 0% mastery and Box 5 is 100% mastery).*
  - Add `"mastery_pct"` to the dict returned by practice API calls.

### 3.3 Frontend Changes (`ui/index.html`)
  - Add a premium, glowing progress bar under the practice scores showing the calculated `"Overall Mastery"`.

---

## Phase 4: UI De-Chunking & 3D Avatar (Maya) Upgrade

### 4.1 UI "De-Chunking" (Frontend Cleanup)
- **Status: DONE**
- **Changes made in `ui/index.html`:**
  - Removed the bulky `Dashboard` screen entirely.
  - Made the `Sign → Text` translation screen the default landing page for a more immediate, functional feel.
  - Consolidated the sidebar navigation (grouped "Practice Signs" and "AI Guide" under a single "Learn & Practice" header, reducing overall top-level clutter).
  - Softened the visual weight of the UI by reducing `--radius` from `12px` to `8px`, and reducing `--border` opacity to subtle white values (`rgba(255,255,255,0.08)`) instead of heavy blues.

### 4.2 3D AI Avatar Skeletal Upgrade & Animation
- **Status: DONE**
- **Objective:** Maya (the 3D avatar in `ui/index.html`) is currently built from static Three.js primitive shapes (cylinders, boxes) and cannot bend her fingers to sign. We need to upgrade her to use an actual skeletal hand structure.
- **Implementation:**
  - Upgraded Maya's aesthetic to feature vibrant, kid-friendly colors (cyan, coral, purple).
  - Attached a skeletal hand (`avatarHandGroup`) to her right arm using `renderAvatarHandPose`.
  - Upgraded both the Practice Hand (`handGroup`) and Avatar Hand (`avatarHandGroup`) to support **smooth linear interpolation (`lerp`)**. Instead of snapping instantly between signs, the meshes now smoothly animate from one canonical pose to the next in real-time, giving the avatar lifelike fluidity.

### 4.3 Iconography Professionalization
- **Status: DONE**
- **Implementation:**
  - Removed all native text emojis (`🏠`, `▶`, `🎙️`, `🤖`, etc.) which felt like an unpolished AI prototype.
  - Injected the **Lucide** SVG icon library via CDN.
  - Replaced all emojis across the sidebar, UI headers, and chat buttons with clean, uniform SVG paths for a premium, professional interface.
