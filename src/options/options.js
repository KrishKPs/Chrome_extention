/*
 * options.js — loads and saves the API key and resume.
 *
 * Everything goes to chrome.storage.local, which lives on this computer only.
 * This file must NOT send anything over the network or log the key/resume.
 */

import { LIMITS, STORAGE } from "../shared/constants.js";
import { extractPdfText } from "../lib/pdf-text.js";

const $ = (id) => document.getElementById(id);

function showCount() {
  const length = $("resume").value.length;
  const over = length > LIMITS.MAX_RESUME_CHARS
    ? ` — only the first ${LIMITS.MAX_RESUME_CHARS.toLocaleString()} are analyzed`
    : "";
  $("resume-count").textContent = `${length.toLocaleString()} characters${over}`;
}

function showSavedAt(timestamp) {
  $("resume-saved").textContent = timestamp ? `Last saved ${new Date(timestamp).toLocaleString()}` : "Not saved yet";
}

function showStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

async function load() {
  const saved = await chrome.storage.local.get([STORAGE.API_KEY, STORAGE.RESUME_TEXT, STORAGE.RESUME_SAVED_AT]);
  $("api-key").value = saved[STORAGE.API_KEY] || "";
  $("resume").value = saved[STORAGE.RESUME_TEXT] || "";
  showCount();
  showSavedAt(saved[STORAGE.RESUME_SAVED_AT]);
}

async function save(event) {
  // Forms reload the page on submit by default; we handle it ourselves.
  event.preventDefault();

  const apiKey = $("api-key").value.trim();
  const resumeText = $("resume").value.trim();

  if (apiKey && !apiKey.startsWith("sk-ant-")) {
    return showStatus("That doesn't look like an Anthropic key (they start with sk-ant-).", true);
  }

  const savedAt = Date.now();
  await chrome.storage.local.set({
    [STORAGE.API_KEY]: apiKey,
    [STORAGE.RESUME_TEXT]: resumeText,
    [STORAGE.RESUME_SAVED_AT]: savedAt,
  });
  showSavedAt(savedAt);
  showStatus(apiKey && resumeText ? "Saved. You're ready to analyze jobs." : "Saved. Add both a key and a resume to start.");
}

// Reads the chosen PDF, puts its text in the textarea, and lets the user
// review it before saving. Only the text is ever stored, never the PDF.
async function importPdf() {
  const file = $("pdf-input").files[0];
  $("pdf-input").value = ""; // so choosing the same file again still fires "change"
  if (!file) return;
  if (file.size > LIMITS.MAX_PDF_BYTES) {
    return showStatus("That PDF is over 5 MB. Resumes are usually much smaller; try exporting it again.", true);
  }

  showStatus("Reading PDF…");
  try {
    const text = await extractPdfText(await file.arrayBuffer());
    if (!text) {
      // Scanned resumes are pictures of text, so there's nothing to extract.
      return showStatus("No text found. The PDF might be a scanned image; paste the text instead.", true);
    }
    $("resume").value = text;
    showCount();
    showStatus(`Extracted text from ${file.name}. Check it below, then click Save.`);
  } catch {
    showStatus("Couldn't read that PDF. Paste the text instead.", true);
  }
}

$("upload-button").addEventListener("click", () => $("pdf-input").click());
$("pdf-input").addEventListener("change", importPdf);
$("settings-form").addEventListener("submit", save);
$("resume").addEventListener("input", showCount);
$("toggle-key").addEventListener("click", () => {
  const input = $("api-key");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  $("toggle-key").textContent = hidden ? "Hide" : "Show";
});

load();
