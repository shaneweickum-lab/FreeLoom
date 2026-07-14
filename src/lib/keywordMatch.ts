/**
 * Whole-word/phrase keyword matching, shared by every keyword-driven part
 * of the algorithmic pipeline (discoveryMap, knowledgeBase, and Stage 1's
 * heuristic clusters). A bare `text.includes(keyword)` false-positives
 * constantly on short keywords: "pet" matches inside "puppet" and
 * "carpet", "art" matches inside "started" and "cartoon". \b anchors the
 * match to real word boundaries so a keyword only matches itself, not
 * whatever word happens to contain its letters.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesKeyword(text: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(text);
}

export function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => matchesKeyword(text, keyword));
}
