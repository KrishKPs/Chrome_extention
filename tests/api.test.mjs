// Self-check for src/lib/api.js. Run with:  node tests/api.test.mjs
// It swaps in a fake `fetch`, so no API key or network is needed.

import assert from "node:assert/strict";
import { callLLM, parseResponse } from "../src/lib/api.js";

const good = {
  score: 82, verdict: "Strong match.",
  matched_skills: ["Python"], missing_skills: ["Kubernetes"],
  matched_keywords: ["REST"], missing_keywords: ["CI/CD"],
  strengths: ["Shipped APIs"], risks: ["No cloud"],
  tailoring_suggestions: [{ action: "Mention Docker", why: "JD lists containers" }],
};
const apiBody = (text, extra = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
  ...extra,
});

// parseResponse: happy path, fences, bad JSON, bad score, missing arrays.
assert.deepEqual(parseResponse(apiBody(JSON.stringify(good))), good);
assert.deepEqual(parseResponse(apiBody("```json\n" + JSON.stringify(good) + "\n```")), good);
assert.equal(parseResponse(apiBody("{not json")), null);
assert.equal(parseResponse(apiBody(JSON.stringify({ ...good, score: 140 }))), null);
assert.equal(parseResponse(apiBody(JSON.stringify({ ...good, risks: "none" }))), null);
assert.equal(parseResponse({ content: [] }), null);

// callLLM against a scripted fake fetch.
const job = { jobText: "Build APIs in Python.", headerText: "Data Engineer\nAcme · Austin, TX" };
function fakeFetch(...replies) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  };
  return calls;
}

let calls = fakeFetch({ status: 200, body: apiBody(JSON.stringify(good)) });
assert.deepEqual(await callLLM("sk-ant-x", "resume", job), { ok: true, data: good });
assert.equal(calls[0].output_config.format.type, "json_schema");
assert.match(calls[0].messages[0].content, /Page text shown above the description:\nData Engineer\nAcme · Austin, TX\n---\nBuild APIs in Python\./);

// Malformed once, then fine → retried and succeeds.
calls = fakeFetch({ status: 200, body: apiBody("oops") }, { status: 200, body: apiBody(JSON.stringify(good)) });
assert.equal((await callLLM("k", "r", job)).ok, true);
assert.equal(calls.length, 2);

// Malformed twice → BAD_RESPONSE, no third try.
calls = fakeFetch({ status: 200, body: apiBody("oops") }, { status: 200, body: apiBody("oops") });
assert.equal((await callLLM("k", "r", job)).error, "BAD_RESPONSE");
assert.equal(calls.length, 2);

// HTTP and network errors map to codes and aren't retried.
fakeFetch({ status: 401, body: { error: { message: "invalid x-api-key" } } });
assert.equal((await callLLM("k", "r", job)).error, "BAD_API_KEY");
fakeFetch({ status: 429, body: {} });
assert.equal((await callLLM("k", "r", job)).error, "RATE_LIMITED");
fakeFetch({ status: 529, body: {} });
assert.equal((await callLLM("k", "r", job)).error, "OVERLOADED");
fakeFetch(new TypeError("Failed to fetch"));
assert.equal((await callLLM("k", "r", job)).error, "NETWORK");
fakeFetch({ status: 200, body: { stop_reason: "refusal", content: [], stop_details: { explanation: "x" } } });
assert.equal((await callLLM("k", "r", job)).error, "REFUSED");

console.log("api.js self-check passed");
