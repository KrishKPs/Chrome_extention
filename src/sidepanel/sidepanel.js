/*
 * sidepanel.js — runs the side panel and coordinates the whole flow.
 *
 *   storage (resume + key) → scrape the tab → service worker (LLM) → render
 *
 * It must NOT call the LLM API itself; that happens only in the service worker.
 * Model output is always inserted with textContent (never innerHTML), so
 * anything odd in the response is displayed as text and never runs as code.
 */

import { ERR, LIMITS, MSG, STORAGE } from "../shared/constants.js";
import { pickBestScrape, scrapeJobPage } from "../lib/extractors.js";

const $ = (id) => document.getElementById(id);

const STATES = ["setup", "ready", "loading", "error", "results"];

const LOADING_MESSAGES = [
  "Reading the posting…",
  "Comparing against your resume…",
  "Weighing required vs. nice-to-have…",
  "Drafting tailoring suggestions…",
];

// Plain-language messages for each error code.
const ERROR_TEXT = {
  [ERR.MISSING_API_KEY]: "No API key saved yet. Add one in Settings.",
  [ERR.BAD_API_KEY]: "Anthropic rejected the API key. Check it in Settings.",
  [ERR.RATE_LIMITED]: "Too many requests right now. Wait a minute and try again.",
  [ERR.OVERLOADED]: "The AI service is busy. Try again in a moment.",
  [ERR.NETWORK]: "Couldn't reach the AI service. Check your internet connection.",
  [ERR.BAD_RESPONSE]: "The AI returned an answer we couldn't read. Try again.",
  [ERR.REFUSED]: "The AI declined to analyze this page. Try selecting just the job description text.",
  [ERR.API_ERROR]: "The AI service returned an error.",
  NO_JOB_FOUND:
    "Couldn't find a job description on this page. Highlight the job description text, then click Analyze again.",
  CANT_READ_PAGE:
    "This page can't be read. Open a job posting (LinkedIn, Indeed, Greenhouse, Lever, or highlight text on any page) and try again.",
};

let loadingTimer = null;
let lastRendered = null; // the result on screen, for "Copy summary"
let currentJob = null; // the job shown in the job card

// Short labels for where the job text came from.
const SOURCE_LABEL = { selection: "Your selection", site: "Auto-detected", generic: "Best guess" };

// ---------- State switching ----------

function showState(name) {
  for (const state of STATES) $(`state-${state}`).hidden = state !== name;
  // The job card sits above loading/error/results, but not setup/ready.
  $("job-card").hidden = !currentJob || name === "setup" || name === "ready";

  clearInterval(loadingTimer);
  if (name === "loading") {
    let i = 0;
    $("loading-text").textContent = LOADING_MESSAGES[0];
    loadingTimer = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      $("loading-text").textContent = LOADING_MESSAGES[i];
    }, 2500);
  }
}

function showError(code, detail) {
  let text = ERROR_TEXT[code] || ERROR_TEXT[ERR.API_ERROR];
  // The API's own message helps for unusual errors (it never contains the key).
  if (code === ERR.API_ERROR && detail) text += ` (${detail})`;
  $("error-text").textContent = text;
  showState("error");
}

// Decides which screen to show based on what's saved.
async function refreshState() {
  const saved = await chrome.storage.local.get([STORAGE.API_KEY, STORAGE.RESUME_TEXT, STORAGE.LAST_RESULT]);
  const hasKey = Boolean(saved[STORAGE.API_KEY]);
  const hasResume = Boolean(saved[STORAGE.RESUME_TEXT]?.trim());

  if (!hasKey || !hasResume) {
    $("setup-key").classList.toggle("done", hasKey);
    $("setup-resume").classList.toggle("done", hasResume);
    showState("setup");
  } else if (saved[STORAGE.LAST_RESULT]) {
    renderJob(saved[STORAGE.LAST_RESULT].job);
    renderResults(saved[STORAGE.LAST_RESULT].result, []);
  } else {
    showState("ready");
  }
}

// ---------- The main flow ----------

async function analyze() {
  const saved = await chrome.storage.local.get([STORAGE.API_KEY, STORAGE.RESUME_TEXT]);
  const resumeText = saved[STORAGE.RESUME_TEXT]?.trim();
  if (!saved[STORAGE.API_KEY] || !resumeText) return refreshState();

  renderJob(null); // don't show the previous job while reading the new one
  showState("loading");

  const scraped = await scrapeActiveTab();
  if (!scraped.ok) return showError(scraped.error);
  const job = scraped.data;
  // Show what we're analyzing right away, above the spinner.
  renderJob(job);

  // Ask the service worker to run the analysis. sendMessage returns a
  // Promise that resolves with whatever the worker passes to sendResponse.
  const response = await chrome.runtime
    .sendMessage({ type: MSG.ANALYZE, payload: { resumeText, job } })
    .catch((error) => ({ ok: false, error: ERR.API_ERROR, detail: error.message }));

  if (!response?.ok) return showError(response?.error, response?.detail);

  renderResults(response.data, buildNotices(job.source, job.jobText, resumeText));
}

// Runs scrapeJobPage in every frame of the current tab and returns the best
// result. (Company career pages often show the posting inside an iframe.)
async function scrapeActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const inject = (allFrames) =>
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames },
        func: scrapeJobPage,
        args: [LIMITS.MIN_SELECTION_CHARS, LIMITS.MIN_JOB_CHARS],
      });
    // If some frame is off-limits and Chrome refuses the whole call,
    // fall back to just the main page.
    const injections = await inject(true).catch(() => inject(false));
    // Each injection's `result` is whatever scrapeJobPage returned in that frame.
    return pickBestScrape(injections.map((injection) => injection.result));
  } catch {
    // Chrome blocks injection into chrome:// pages, the Web Store, PDFs, and
    // sites we have no permission for.
    return { ok: false, error: "CANT_READ_PAGE" };
  }
}

function buildNotices(source, jobText, resumeText) {
  const notices = [];
  if (source === "selection") notices.push("Analyzed your highlighted text.");
  if (source === "generic") notices.push("Guessed where the job description is on this page. If the results look off, highlight the description and analyze again.");
  if (jobText.length > LIMITS.MAX_JOB_CHARS) notices.push("The job description was long, so only the first part was analyzed.");
  if (resumeText.length > LIMITS.MAX_RESUME_CHARS) notices.push("Your resume was long, so only the first part was analyzed.");
  return notices;
}

// ---------- Rendering ----------

function renderJob(job) {
  currentJob = job || null;
  $("job-card").hidden = !currentJob;
  if (!currentJob) return;

  $("job-source").textContent = SOURCE_LABEL[job.source] || "";
  $("job-source").hidden = !SOURCE_LABEL[job.source];

  // Only link to real web pages (the URL comes from the page itself).
  const url = URL.parse(job.sourceUrl || "");
  const isWebPage = url?.protocol === "https:" || url?.protocol === "http:";
  $("job-link").hidden = !isWebPage;
  if (isWebPage) {
    $("job-link").href = url.href;
    $("job-link").textContent = `${url.hostname}${url.pathname} ↗`;
  }

  $("job-description").textContent = job.jobText;
  setDescriptionExpanded(false);
  // Short descriptions fit without collapsing.
  $("job-toggle").hidden = job.jobText.length < 400;
  if ($("job-toggle").hidden) $("job-description").classList.remove("collapsed");
}

function setDescriptionExpanded(expanded) {
  $("job-description").classList.toggle("collapsed", !expanded);
  $("job-toggle").setAttribute("aria-expanded", String(expanded));
  $("job-toggle").textContent = expanded ? "Show less" : "Show full description";
}

function renderResults(result, notices) {
  renderGauge(result.score);
  $("verdict").textContent = result.verdict;

  $("notice").hidden = notices.length === 0;
  $("notice").textContent = notices.join(" ");

  fillList("matched-skills", result.matched_skills);
  fillList("missing-skills", result.missing_skills);
  fillChips("matched-keywords", result.matched_keywords);
  fillChips("missing-keywords", result.missing_keywords);
  fillList("strengths", result.strengths);
  fillList("risks", result.risks);
  fillSuggestions(result.tailoring_suggestions);

  lastRendered = result;
  showState("results");
}

function renderGauge(score) {
  // The ring's length is its circumference (2πr). Offsetting the dash by the
  // "unfilled" fraction leaves exactly score% of the ring colored.
  const circumference = 2 * Math.PI * 52;
  const fill = $("gauge-fill");
  fill.style.strokeDasharray = circumference;
  fill.style.strokeDashoffset = circumference * (1 - score / 100);
  fill.style.setProperty("--gauge-color", score >= 75 ? "var(--good)" : score >= 50 ? "var(--amber)" : "var(--bad)");
  $("score-number").textContent = score;
}

function fillList(id, items) {
  $(id).replaceChildren(...items.map((text) => element("li", text)));
}

function fillChips(id, items) {
  $(id).replaceChildren(...items.map((text) => element("span", text, "chip")));
}

function fillSuggestions(suggestions) {
  const rows = suggestions.map(({ action, why }) => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const textSpan = element("span", action);
    textSpan.append(element("span", why, "why"));
    const label = element("label");
    label.append(checkbox, textSpan);
    const li = element("li");
    li.append(label);
    return li;
  });
  $("suggestions").replaceChildren(...rows);
}

function element(tag, text = "", className = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

// ---------- Copy summary ----------

function summaryText(result) {
  const section = (title, items) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  return [
    `Match score: ${result.score}/100 — ${result.verdict}`,
    currentJob?.sourceUrl || "",
    "",
    section("You have", result.matched_skills),
    section("Missing", result.missing_skills),
    section("Keywords to add (if true)", result.missing_keywords),
    section("Suggestions", result.tailoring_suggestions.map((s) => `${s.action} (${s.why})`)),
  ].join("\n").trim();
}

async function copySummary() {
  if (!lastRendered) return;
  const button = $("copy-button");
  try {
    await navigator.clipboard.writeText(summaryText(lastRendered));
    button.textContent = "Copied ✓";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = "Copy summary"), 1500);
}

// ---------- Wiring ----------

const openSettings = () => chrome.runtime.openOptionsPage();
$("settings-button").addEventListener("click", openSettings);
$("open-settings").addEventListener("click", openSettings);
$("analyze-button").addEventListener("click", analyze);
$("reanalyze-button").addEventListener("click", analyze);
$("retry-button").addEventListener("click", analyze);
$("copy-button").addEventListener("click", copySummary);
$("job-toggle").addEventListener("click", () =>
  setDescriptionExpanded($("job-description").classList.contains("collapsed")),
);

// When settings are saved in the options tab, update this panel right away.
chrome.storage.onChanged.addListener((changes) => {
  const setupChanged = STORAGE.API_KEY in changes || STORAGE.RESUME_TEXT in changes;
  const visibleNow = STATES.find((state) => !$(`state-${state}`).hidden);
  if (setupChanged && visibleNow !== "loading") refreshState();
});

refreshState();
