// Self-check for src/lib/pdf-text.js. Run with:  node tests/pdf-text.test.mjs
// sample-resume.pdf is a fake one-page resume made from plain text.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractPdfText } from "../src/lib/pdf-text.js";

const bytes = await readFile(new URL("./sample-resume.pdf", import.meta.url));
const text = await extractPdfText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));

for (const expected of ["Jane Doe", "Python, PostgreSQL, Docker, REST APIs", "Built payment services in Python."]) {
  assert.ok(text.includes(expected), `missing "${expected}" in:\n${text}`);
}
assert.ok(text.split("\n").length >= 5, "line breaks were lost");

await assert.rejects(extractPdfText(new TextEncoder().encode("not a pdf").buffer));

console.log("pdf-text.js self-check passed");
