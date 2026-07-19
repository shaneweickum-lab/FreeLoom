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

export type KeywordMatch = { keyword: string; index: number };

/**
 * Same matching as matchesAnyKeyword, but also reports which keyword hit
 * and where -- the provenance a "why this mapping" reasoning panel needs to
 * quote the exact phrase that triggered a tag, rather than just knowing
 * *that* something matched.
 */
export function findKeywordMatch(text: string, keywords: string[]): KeywordMatch | null {
  for (const keyword of keywords) {
    const match = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").exec(text);
    if (match) return { keyword: match[0], index: match.index };
  }
  return null;
}

/**
 * A short, readable snippet of `text` around a keyword match -- the actual
 * "quoted phrase" surfaced in the reasoning panel. Trims to word
 * boundaries where possible so the snippet doesn't start/end mid-word.
 */
export function extractQuotedPhrase(text: string, match: KeywordMatch, contextChars = 20): string {
  const rawStart = Math.max(0, match.index - contextChars);
  const rawEnd = Math.min(text.length, match.index + match.keyword.length + contextChars);

  const start = rawStart === 0 ? 0 : text.indexOf(" ", rawStart) + 1 || rawStart;
  const lastSpace = text.lastIndexOf(" ", rawEnd);
  const end = rawEnd === text.length ? text.length : lastSpace > match.index ? lastSpace : rawEnd;

  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}
