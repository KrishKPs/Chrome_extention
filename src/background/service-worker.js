/*
 * service-worker.js — the extension's background script.
 *
 * It runs outside any web page, so it's the one safe place to use the API key
 * and call the LLM. Chrome can stop it whenever it's idle, so it keeps no state
 * in variables: everything is read from chrome.storage on each request.
 * It must NOT touch page DOM.
 */

import { API, ERR, LIMITS, MSG, STORAGE } from "../shared/constants.js";
import { callLLM } from "../lib/api.js";

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// Message passing: other parts of the extension send us "letters" with
// chrome.runtime.sendMessage, and this listener receives them.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MSG.ANALYZE) return false;

  handleAnalyze(message.payload).then(sendResponse);
  // Returning true tells Chrome "I'll call sendResponse later, asynchronously".
  // Without it, the channel closes before the API call finishes.
  return true;
});

// `job` is what the scraper returned: { jobText, headerText, sourceUrl, source }.
async function handleAnalyze({ resumeText, job }) {
  const { [STORAGE.API_KEY]: apiKey } = await chrome.storage.local.get(STORAGE.API_KEY);
  if (!apiKey) return { ok: false, error: ERR.MISSING_API_KEY };

  const trimmedJob = { ...job, jobText: job.jobText.slice(0, LIMITS.MAX_JOB_CHARS) };
  const response = await callLLM(apiKey, resumeText.slice(0, LIMITS.MAX_RESUME_CHARS), trimmedJob);

  if (response.ok) {
    // Save the job and result so reopening the panel shows them again.
    await chrome.storage.local.set({
      [STORAGE.LAST_RESULT]: { result: response.data, job: trimmedJob, model: API.MODEL, analyzedAt: Date.now() },
    });
  }
  return response;
}
