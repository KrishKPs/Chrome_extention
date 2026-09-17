/*
 * api.js — talks to the Anthropic Messages API and checks what comes back.
 *
 * Only the service worker imports this file, so the API key never enters a
 * web page. It must NOT touch the DOM or log the resume or the key.
 *
 * We use plain `fetch` rather than the official SDK because the project has no
 * bundler, and Manifest V3 doesn't allow loading library code
 * from a CDN.
 */

import { API, ERR } from "../shared/constants.js";
import { ANALYSIS_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";

// Public entry point. Always resolves (never throws) to either
//   { ok: true, data: AnalysisResult }  or  { ok: false, error, detail }
// so the caller only needs one code path.
export async function callLLM(apiKey, resumeText, job) {
  const body = buildRequestBody(resumeText, job);

  // if the answer is malformed, try once more before giving up.
  let result;
  for (let attempt = 1; attempt <= 2; attempt++) {
    result = await sendOnce(apiKey, body);
    if (result.error !== ERR.BAD_RESPONSE) return result;
  }
  return result;
}

function buildRequestBody(resumeText, job) {
  return {
    model: API.MODEL,
    max_tokens: API.MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildUserMessage(resumeText, job) },
    ],
    // Constrains the reply to our JSON schema.
    output_config: {
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    // If the model declines, let the API retry on its recommended fallback.
    fallbacks: "default",
  };
}

// One HTTP round trip. `async` functions return a Promise; `await` pauses
// here until the network answers, without freezing the browser.
async function sendOnce(apiKey, body) {
  let response;
  try {
    response = await fetch(API.URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API.VERSION,
        "anthropic-beta": API.FALLBACK_BETA,
        // The API rejects browser-originated requests unless we opt in. That's
        // a guard against websites stealing keys; here the key is the user's
        // own, so opting in is acceptable (see README "Security tradeoff").
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    return { ok: false, error: ERR.NETWORK, detail: networkError.message };
  }

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, error: errorCodeForStatus(response.status), detail: json?.error?.message };
  }
  if (json?.stop_reason === "refusal") {
    return { ok: false, error: ERR.REFUSED, detail: json.stop_details?.explanation };
  }

  const data = parseResponse(json);
  return data
    ? { ok: true, data }
    : { ok: false, error: ERR.BAD_RESPONSE, detail: `stop_reason: ${json?.stop_reason}` };
}

function errorCodeForStatus(status) {
  if (status === 401 || status === 403) return ERR.BAD_API_KEY;
  if (status === 429) return ERR.RATE_LIMITED;
  if (status === 529 || status >= 500) return ERR.OVERLOADED;
  return ERR.API_ERROR;
}

// Pulls the JSON answer out of an API response body. Returns the
// AnalysisResult, or null if anything about it is wrong.
export function parseResponse(json) {
  // `content` can also hold "thinking" or "fallback" blocks; we want the text.
  const textBlock = json?.content?.find((block) => block.type === "text");
  if (!textBlock) return null;

  // Structured outputs shouldn't add ```json fences, but strip them just in case.
  const text = textBlock.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return null;
  }
  return isValidResult(result) ? result : null;
}

const LIST_FIELDS = [
  "matched_skills", "missing_skills", "matched_keywords",
  "missing_keywords", "strengths", "risks", "tailoring_suggestions",
];

function isValidResult(result) {
  return (
    Number.isInteger(result?.score) &&
    result.score >= 0 &&
    result.score <= 100 &&
    typeof result.verdict === "string" &&
    LIST_FIELDS.every((field) => Array.isArray(result[field]))
  );
}
