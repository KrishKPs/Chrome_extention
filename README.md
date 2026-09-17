# Resume ↔ Job Match

A Chrome extension that scores your resume against the job posting you're
viewing. In one click, a side panel shows the job description, then a 0–100 match score, the skills you
already have, the ones you're missing, and specific edits to tailor your resume.

Built with Manifest V3 and plain JavaScript (no framework, no build step), using
the Anthropic Claude API.

<!-- TODO: add docs/screenshots/results.png once captured -->

## Install (developer mode)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and select this folder.
3. Click the extension's toolbar icon (pin it from the puzzle-piece menu). The side panel opens.
4. Click **Open settings**, paste your [Anthropic API key](https://platform.claude.com/settings/keys), then either click **Upload PDF…** or paste your resume as text. Check the text, then click **Save**.

## Use

1. Open a job posting on LinkedIn, Indeed, Greenhouse, or Lever.
2. Click **Analyze this job** in the side panel.
3. On any other site, or if the automatic detection grabs the wrong text,
   **highlight the job description** first, then click Analyze. Highlighted
   text always takes priority.

## How it works

```
Side panel ──executeScript──▶ Job page       (scrapeJobPage reads the DOM)
     │
     └──sendMessage(ANALYZE)──▶ Service worker ──fetch──▶ Claude API
                                     │  (structured JSON output)
     ◀──────── AnalysisResult ───────┘
```

| File | Responsibility |
|------|----------------|
| `src/sidepanel/` | The UI. Runs the whole flow and renders results. |
| `src/lib/extractors.js` | Finds the job description in every frame of the tab: highlighted text first, then selectors for known sites, then elements named like "description", then the block with the most paragraph text. |
| `src/background/service-worker.js` | The only place that reads the API key and calls the API. |
| `src/lib/api.js` | Builds the request, maps HTTP errors to friendly codes, validates the response, and retries once if the response is malformed. |
| `src/lib/prompt.js` | The system prompt and the JSON schema the model must follow. |
| `src/options/` | Settings page for the API key and resume. |
| `src/lib/pdf-text.js` | Pulls the text out of an uploaded PDF resume, using pdf.js. |
| `src/vendor/pdfjs/` | Mozilla pdf.js 6.3.289 (legacy build, unmodified, Apache-2.0). |
| `src/shared/constants.js` | Message types, storage keys, the model name, and size limits. |

Design decisions worth mentioning:

- **The scraper is injected on demand** (`chrome.scripting.executeScript`), not
  loaded as a permanent content script. It runs only when you click Analyze,
  and it works in tabs that were already open before the extension was
  installed or reloaded.
- **Job-site HTML changes often**, so extraction has three layers and ends with
  a manual option (highlighted text) that always works.
- **Structured outputs** (`output_config.format` with a JSON Schema) constrain
  the model to the exact result shape. The code still validates the result and
  retries once.
- **PDF resumes become text once, at upload time.** Only the text is stored and
  sent, so a PDF costs no more tokens per analysis than pasted text. (Sending
  the PDF itself would also bill Claude for reading the page images.) Scanned
  PDFs contain no text, so for those you paste the text instead.
- **Model output is rendered with `textContent` only**, so a hostile job page
  can't inject HTML into the panel through the model's answer.
- **The prompt separates instructions from scraped text** (system prompt vs.
  tagged user content), which reduces prompt-injection risk from job pages.

## Security tradeoff (please read)

Your resume and API key are stored only in `chrome.storage.local` on your
computer. They are sent only to `api.anthropic.com`, and only when you click
Analyze.

This design has a known limitation. **The API key lives in the browser.**
Anyone with access to this Chrome profile, or to the extension's DevTools, can
read it, and it's sent with every request. The Anthropic API blocks
browser-originated calls unless the client sends the
`anthropic-dangerous-direct-browser-access` header, and this extension sends it
on purpose. That's acceptable for a personal "bring your own key" tool, because
the only key at risk belongs to the user.

**A production version should not work this way.** It would route calls through
a small backend that holds the key, authenticates users, and applies rate
limits. The key would never reach the client.

Permissions are kept narrow. Host access covers only the four job sites and
the Anthropic API. Other sites work only through `activeTab`, which Chrome
grants temporarily when you click the toolbar icon on that tab.

## Development

- After editing code, click the reload icon on the extension's card in `chrome://extensions`.
- Side panel or settings console: right-click inside the page → **Inspect**.
- Service worker console: click the **service worker** link on the extension card.
- Self-checks (no key needed): `node tests/api.test.mjs`, `node tests/extractors.test.mjs`, and `node tests/pdf-text.test.mjs`.
  The PDF test prints some pdf.js warnings about Node lacking canvas support;
  they're harmless because we only read text.

## Cost

Each analysis is one call to `claude-opus-5` (set in `src/shared/constants.js`),
billed to your own API key. Inputs are capped at about 20,000 characters
combined. A rough, unmeasured estimate is 5–15 cents per analysis; the model's
thinking tokens vary from job to job.
