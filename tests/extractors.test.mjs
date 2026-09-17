// Self-check for pickBestScrape in src/lib/extractors.js. Run with:
//   node tests/extractors.test.mjs
// (scrapeJobPage itself needs a real browser DOM; it was checked against real
// Greenhouse, Lever, and LinkedIn pages in headless Chrome.)

import assert from "node:assert/strict";
import { pickBestScrape } from "../src/lib/extractors.js";

const found = (source, jobText) => ({ ok: true, data: { source, jobText } });
const pickText = (results) => pickBestScrape(results).data.jobText;
const none = { ok: false, error: "NO_JOB_FOUND" };

// Nothing anywhere, including frames where injection returned nothing.
assert.deepEqual(pickBestScrape([none, null, undefined]), none);
assert.deepEqual(pickBestScrape([]), none);

// A known-site match inside an iframe beats a guess on the outer page.
const iframe = found("site", "short but certain");
assert.equal(pickText([found("generic", "a much longer outer page guess"), iframe]), iframe.data.jobText);

// The user's highlighted text beats everything.
const selection = found("selection", "picked by hand");
assert.equal(pickText([iframe, selection, none]), selection.data.jobText);

// Same kind of match: the longer text wins.
const longer = found("generic", "the longer description text");
assert.equal(pickText([found("generic", "short"), longer]), longer.data.jobText);


console.log("extractors.js self-check passed");
