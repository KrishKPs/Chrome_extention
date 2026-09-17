/*
 * constants.js — every "magic" string and number in one place.
 *
 * Message types, storage keys, the model name, and size limits live here so a
 * typo becomes an import error instead of a silent bug. This file must NOT
 * contain logic or secrets.
 */

// Messages the side panel sends to the service worker.
export const MSG = {
  ANALYZE: "ANALYZE",
};

// Error codes the service worker can send back. The side panel turns these
// into human sentences (see ERROR_TEXT in sidepanel.js).
export const ERR = {
  MISSING_API_KEY: "MISSING_API_KEY",
  BAD_API_KEY: "BAD_API_KEY",
  RATE_LIMITED: "RATE_LIMITED",
  OVERLOADED: "OVERLOADED",
  NETWORK: "NETWORK",
  API_ERROR: "API_ERROR",
  BAD_RESPONSE: "BAD_RESPONSE",
  REFUSED: "REFUSED",
};

// Keys inside chrome.storage.local.
export const STORAGE = {
  RESUME_TEXT: "RESUME_TEXT",
  RESUME_SAVED_AT: "RESUME_SAVED_AT",
  API_KEY: "API_KEY",
  LAST_RESULT: "LAST_RESULT",
};

// Anthropic API settings. Checked against the current docs (Sept 2026).
// If you change models, this is the only line to edit.
export const API = {
  URL: "https://api.anthropic.com/v1/messages",
  VERSION: "2023-06-01",
  MODEL: "claude-opus-5",
  // Enough room for adaptive thinking plus the small JSON answer.
  MAX_TOKENS: 16000,
  // Opt-in: if the model declines a request, the API retries it on a
  // recommended fallback model instead of just failing.
  FALLBACK_BETA: "server-side-fallback-2026-07-01",
};

// Character budgets (see CLAUDE.md §7.4). Roughly 4 characters ≈ 1 token.
export const LIMITS = {
  MAX_JOB_CHARS: 12000,
  MAX_RESUME_CHARS: 8000,
  // A selection shorter than this is probably an accidental click-drag,
  // so we ignore it and scrape the page instead.
  MIN_SELECTION_CHARS: 200,
  // A scraped block shorter than this is probably not a real job description.
  MIN_JOB_CHARS: 300,
  // Resume PDFs are usually well under 1 MB; refuse anything absurd.
  MAX_PDF_BYTES: 5 * 1024 * 1024,
};
