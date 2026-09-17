/*
 * extractors.js — pulls the job description out of the current web page.
 *
 * The side panel injects `scrapeJobPage` into the tab with
 * chrome.scripting.executeScript. Chrome copies the function's *source code*
 * into the page and runs it there, so the function must be fully
 * self-contained: no imports, and no variables from outside its own body.
 * It must NOT make network calls or see any secrets.
 *
 * Strategy, first match wins:
 *   1. Text the user highlighted ("Analyze selection").
 *   2. A known container selector for the current job site.
 *   3. Any element whose id/class mentions "description".
 *   4. The block with the most paragraph text (a mini "Readability").
 *
 * The side panel runs this in every frame of the tab (career sites often embed
 * Greenhouse/Lever in an iframe) and keeps the best answer via pickBestScrape.
 */

export function scrapeJobPage(minSelectionChars, minJobChars) {
  // Site-specific selectors, keyed by part of the hostname. Job sites change
  // their HTML often, so each has several guesses, tried in order.
  const SITES = {
    "linkedin.com": {
      description: [
        "#job-details", ".jobs-description__content", ".jobs-description-content__text",
        ".jobs-box__html-content", ".jobs-description", ".description__text",
      ],
    },
    "indeed.com": {
      description: ["#jobDescriptionText", ".jobsearch-JobComponent-description"],
    },
    "greenhouse.io": {
      description: [".job__description", "#content", "#app_body"],
    },
    "lever.co": {
      // The wrapper holds the intro, the requirement lists, and the closing.
      description: [".posting-page .section-wrapper:not(.accent-section)", "[data-qa='job-description']"],
    },
  };

  const clean = (text) => (text || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  const isVisible = (el) => el.checkVisibility?.() ?? true;

  // Share of an element's text that sits inside links (menus and job lists are high).
  const linkDensity = (el) => {
    const total = (el.textContent || "").length || 1;
    const inLinks = [...el.querySelectorAll("a")].reduce((sum, a) => sum + (a.textContent || "").length, 0);
    return inLinks / total;
  };

  // Tier 2: first known selector whose text is long enough.
  const siteBlock = () =>
    (site.description || [])
      .map((selector) => document.querySelector(selector))
      .find((el) => el && clean(el.innerText).length >= minJobChars);

  // Tier 3: sites rarely name their description container anything else.
  const descriptionLikeBlock = () => {
    let best = null;
    const candidates = document.body.querySelectorAll(
      "[id*='description' i], [class*='description' i], [data-testid*='description' i], [data-automation*='description' i]",
    );
    for (const el of candidates) {
      if (!isVisible(el) || linkDensity(el) > 0.3) continue;
      if (!best || el.innerText.length > best.innerText.length) best = el;
    }
    return best;
  };

  // Tier 4: every paragraph-like element (80+ chars) gives points to its
  // parent and half to its grandparent. The description's container collects
  // the most points. Lists count as part of the element around them, so a
  // bullet-heavy description still wins as a whole.
  // ponytail: simplified Readability scoring, vendor Mozilla Readability if it misfires often.
  const readableBlock = () => {
    const scores = new Map();
    const addScore = (el, points) => el && scores.set(el, (scores.get(el) || 0) + points);
    for (const el of document.body.querySelectorAll("p, li, pre, td, div, span")) {
      if (el.tagName === "DIV" || el.tagName === "SPAN") {
        // Only count boxes of plain text, not boxes of other blocks.
        if (el.querySelector("p, div, li, table, section")) continue;
        // A wrapper around a long <span> would double-count it and pull the
        // credit one level too high; let the span take the credit instead.
        if ([...el.querySelectorAll("span")].some((span) => span.textContent.trim().length >= 80)) continue;
      }
      const length = (el.textContent || "").trim().length;
      if (length < 80 || !isVisible(el)) continue;
      let parent = el.parentElement;
      if (parent && (parent.tagName === "UL" || parent.tagName === "OL")) parent = parent.parentElement;
      addScore(parent, length);
      addScore(parent?.parentElement, length / 2);
    }
    let best = null;
    let bestScore = 0;
    for (const [el, score] of scores) {
      const adjusted = score * (1 - linkDensity(el));
      if (adjusted > bestScore) [best, bestScore] = [el, adjusted];
    }
    return best;
  };

  // The text shown just above the description (usually the job title,
  // company, and location). Sent to the model as context.
  const textAbove = (descriptionEl) => {
    const start = clean(descriptionEl?.innerText).slice(0, 60);
    let ancestor = descriptionEl?.parentElement;
    for (let depth = 0; start && ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
      const text = clean(ancestor.innerText);
      const before = text.slice(0, Math.max(text.indexOf(start), 0));
      if (before.length >= 40) return before.slice(-600);
    }
    return null;
  };

  const hostKey = Object.keys(SITES).find((key) => window.location.hostname.endsWith(key));
  const site = SITES[hostKey] || {};

  let source = null;
  let jobText = "";
  let descriptionEl = null;
  const selection = window.getSelection();
  const selectedText = clean(selection?.toString());
  if (selectedText.length >= minSelectionChars) {
    [source, jobText] = ["selection", selectedText];
    const common = selection.getRangeAt(0).commonAncestorContainer;
    descriptionEl = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  } else {
    const tiers = [["site", siteBlock], ["generic", descriptionLikeBlock], ["generic", readableBlock]];
    for (const [tierSource, findBlock] of tiers) {
      const el = findBlock();
      const text = clean(el?.innerText);
      if (text.length >= minJobChars) {
        [source, jobText, descriptionEl] = [tierSource, text, el];
        break;
      }
    }
  }

  const data = { headerText: textAbove(descriptionEl), sourceUrl: window.location.href };

  return source ? { ok: true, data: { ...data, jobText, source } } : { ok: false, error: "NO_JOB_FOUND" };
}

// The scraper runs once per frame. Picks the most trustworthy answer:
// a highlighted selection beats a known-site match, which beats a guess;
// among equals, the longer text wins.
const SOURCE_RANK = { selection: 3, site: 2, generic: 1 };

export function pickBestScrape(frameResults) {
  const found = frameResults.filter((result) => result?.ok);
  if (found.length === 0) return { ok: false, error: "NO_JOB_FOUND" };
  return found.reduce((best, next) => {
    const rankDiff = SOURCE_RANK[next.data.source] - SOURCE_RANK[best.data.source];
    if (rankDiff !== 0) return rankDiff > 0 ? next : best;
    return next.data.jobText.length > best.data.jobText.length ? next : best;
  });
}
