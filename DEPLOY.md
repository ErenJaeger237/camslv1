# Deployment Guide — CamSL Translator v2 (React + FastAPI)

## Architecture

```
Browser (Vercel)          Cloud server (Railway/Render)
──────────────────        ──────────────────────────────
React frontend      ──►   FastAPI backend
MediaPipe (WASM)          SQLite (Leitner data)
TF.js (alphabet)          Gemini API proxy
Web Speech API            Autocomplete
```

## Local Development

### 1 — Activate venv and start the backend

```bash
.\venv\Scripts\Activate.ps1          # Windows
uvicorn backend.main:app --reload --port 8000
```

### 2 — Convert the Keras model to TF.js (once, after training)

```bash
python scripts/convert_model.py
# Output: frontend/public/models/alphabet/model.json + shard files
```

### 3 — Start the React frontend

```bash
cd frontend
npm install          # first time only
npm run dev          # http://localhost:5173
```

### 4 — Environment variables

Create `frontend/.env.local`:
```
VITE_API_URL=        # empty = use Vite proxy to localhost:8000
```

Set in your shell for the backend:
```bash
$env:GEMINI_API_KEY = "your-key-here"
```

---

## Deploy Frontend to Vercel

1. Push this repo to GitHub (already done: ErenJaeger237/camslv1)
2. Go to vercel.com → New Project → Import from GitHub
3. **Root Directory:** `frontend`
4. **Build Command:** `npm run build`
5. **Output Directory:** `dist`
6. **Environment Variables:** Add `VITE_API_URL=https://your-backend.railway.app`
7. Deploy — Vercel handles the COOP/COEP headers via `vercel.json`

---

## Deploy Backend to Railway

1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select `ErenJaeger237/camslv1`
3. **Root Directory:** `/` (project root, not `/backend`)
4. **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. **Environment Variables:**
   - `GEMINI_API_KEY` = your Gemini API key
   - `ALLOWED_ORIGIN` = https://your-project.vercel.app
6. After deploy, copy the Railway URL and set it as `VITE_API_URL` in Vercel

---

## Convert Model (Required Before Frontend Works)

The TF.js model files are gitignored (binary). Run once per training:

```bash
# From project root, with venv activated:
python scripts/convert_model.py
# Then commit the output:
git add frontend/public/models/alphabet/
git commit -m "Add TF.js model"
git push
```

Vercel will auto-redeploy when you push.

---

## One-time Setup Checklist

- [ ] `python src/train.py` — train Keras model
- [ ] `python scripts/convert_model.py` — convert to TF.js
- [ ] `git add frontend/public/models/ && git push` — ship model
- [ ] Railway: set `GEMINI_API_KEY` + `ALLOWED_ORIGIN`
- [ ] Vercel: set `VITE_API_URL`
- [ ] Both services deployed and cross-connected
