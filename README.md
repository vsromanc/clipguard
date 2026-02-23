# clipguard

Client-side DLP engine that detects and blocks copy-paste data leaks between regulated and unregulated workspaces.

Copy from a work app, try to paste into a personal one -- clipguard fingerprints the content and blocks it if it matches.

No server. No dependencies. Runs entirely in the browser.

![License](https://img.shields.io/badge/license-MIT-blue)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-green)

---

## Demo

```bash
npm install
npm run dev
```

Open the URL shown in the terminal. Copy text from Workspace A, paste into Workspace B.

---

## How it works

When the user copies text from a regulated workspace, clipguard:

1. **Normalizes** the text (lowercase, strip punctuation, collapse whitespace)
2. **Strips stop words** to isolate signal-carrying terms
3. **Fingerprints** the result using SimHash (fuzzy) and 5-word shingles (fragments)
4. **Stores** the fingerprints in a time-limited vault (default: 60 minutes)

When the user pastes into an unregulated workspace, clipguard runs a 4-gate pipeline:

```
paste(text)
  |
  v
[Gate 1: Length]  -- < 50 chars or < 8 words? --> ALLOW
  |
  v
[Gate 2: Stop Words]  -- nothing left after stripping? --> ALLOW
  |
  v
[Gate 3: Entropy]  -- low entropy? raise thresholds (boilerplate protection)
  |
  v
[Gate 4: Fingerprint]  -- compare SimHash + shingles against vault
  |
  +--> fuzzy >= 70% OR fragments >= 35%? --> BLOCK
  +--> otherwise --> ALLOW
```

### Why this approach

| Decision | Rationale |
|---|---|
| **Minimum length gate** | Single words ("Hello") aren't leaks. Short text produces unreliable hashes. Passwords are handled by PII scanners, not fuzzy matching. |
| **Stop word stripping** | "the", "is", "hello" appear everywhere. They add noise, not signal. After stripping, only domain terms like "revenue", "falcon", "142M" remain. |
| **Shannon entropy** | Boilerplate has low entropy and matches everything. When entropy < 2.5, we raise thresholds to 90%/70% so only near-exact copies trigger. |
| **SimHash** | Locality-sensitive hash catches rephrasing (swapped words, reordered sentences). O(n) time, no corpus needed. Alternative (TF-IDF cosine) was rejected as too heavy for client-side. |
| **5-word shingles** | SimHash measures whole-text similarity but misses partial leaks. Shingles catch a paragraph copied from a 50-page doc. 5 words is the sweet spot: 3 triggers too often, 7 misses short passages. |
| **Cluster density** | A single shingle match is coincidence. We require >= 35% overlap of signal-word shingles -- strong evidence of shared source. |
| **60-minute TTL** | Bounds memory and limits the false-positive window. Configurable per policy. |

---

## Configuration

All thresholds are configurable at runtime via the Settings panel in the UI, or by editing `public/config.json`:

```json
{
  "vault_ttl_minutes":    60,
  "fuzzy_threshold":      0.70,
  "fragment_threshold":   0.35,
  "shingle_length":       5,
  "hash_bits":            64,
  "min_chars":            50,
  "min_words":            8,
  "min_entropy":          2.5
}
```

Stop words are loaded from `public/stopwords.json` -- add or remove words to tune for your domain.

---

## Project structure

```
clipguard/
  index.html        UI markup
  style.css         Styles (dark/light mode, extracted from index.html)
  main.js           UI layer (ES module entry point, imports dlp.js + style.css)
  dlp.js            Detection engine (pure logic, no DOM, ES module exports)
  public/
    config.json     Default thresholds (copied to dist/ on build)
    stopwords.json  Stop word list (copied to dist/ on build)
  package.json      Vite dev/build scripts
```

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│ config.json │     │stopwords.json│     │   index.html │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │                   │                   │
       └───────┬───────────┘                   │
               v                               │
         ┌───────────┐                   ┌─────┴─────┐
         │  dlp.js   │◄──────────────────│  main.js  │
         │  (engine) │   import { add,   │   (view)  │
         │           │     check, ... }  │           │
         │           │                   │           │
         └───────────┘                   └───────────┘
```

- **dlp.js** is a pure ES module. Zero DOM references. Can be imported into Node for testing.
- **main.js** owns all DOM access. Fetches config/stopwords on load, wires events, manages modals.
- **config.json** and **stopwords.json** are loaded at runtime via `fetch()`, not hardcoded.

---

## Running locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

---

## License

MIT
