/**
 * Stage 3 (template/fragment generation) — the "deep authoring investment"
 * the spec calls for. Where Stage 1's knowledge-base match already hands
 * back a fully hand-written description (good enough on its own), and a
 * generic keyword-cluster match only gives a subject guess with no real
 * prose to back it up, this is what turns that bare subject guess into an
 * actual composed description + reasoning: pick a matching rule, pull one
 * fragment per rhetorical role the rule calls for, stitch them together.
 *
 * Both composition_rules.condition and fragments.subject_tag support a "*"
 * wildcard so a small, hand-authored set of rules/fragments can cover any
 * subject area, not just the ones with bespoke content yet — exactly the
 * "start with the most common activity types... and expand from there"
 * instruction. Matching and assembly are pure functions (selectComposition)
 * so they're testable without a database; composeFromFragments is the thin
 * Supabase-fetching wrapper around it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any>;

export type CompositionRule = {
  id: string;
  condition: { subject_area?: string; activity_type?: string };
  fragment_sequence: string[];
  notes?: string | null;
};

export type Fragment = {
  id: string;
  subject_tag: string;
  skill_tag: string | null;
  rhetorical_function: string;
  text: string;
};

export type ComposedDraft = {
  courseTitle: string;
  reasoning: string;
};

const WILDCARD = "*";

/** How many of a rule's condition fields are non-wildcard — used to prefer the most specific matching rule. */
function specificity(rule: CompositionRule): number {
  const { subject_area, activity_type } = rule.condition;
  return (subject_area && subject_area !== WILDCARD ? 1 : 0) + (activity_type && activity_type !== WILDCARD ? 1 : 0);
}

function ruleMatches(rule: CompositionRule, subjectArea: string, activityType: string | null): boolean {
  const conditionSubject = rule.condition.subject_area;
  const conditionActivity = rule.condition.activity_type;
  const subjectOk = !conditionSubject || conditionSubject === WILDCARD || conditionSubject === subjectArea;
  const activityOk = !conditionActivity || conditionActivity === WILDCARD || conditionActivity === activityType;
  return subjectOk && activityOk;
}

function findFragment(fragments: Fragment[], subjectArea: string, rhetoricalFunction: string): Fragment | null {
  const exact = fragments.find((f) => f.subject_tag === subjectArea && f.rhetorical_function === rhetoricalFunction);
  if (exact) return exact;
  return fragments.find((f) => f.subject_tag === WILDCARD && f.rhetorical_function === rhetoricalFunction) ?? null;
}

/**
 * Pure matching + assembly, given whatever rules/fragments already exist.
 * Picks the most specific rule that matches, pulls one fragment per role in
 * its fragment_sequence (subject-specific fragment preferred, "*" fragment
 * as fallback), and joins them into a short title plus a composed
 * paragraph. Returns null when no rule matches at all, or when a matching
 * rule calls for a fragment that doesn't exist yet for this subject —
 * an honest gap rather than a partially-assembled, confusing result.
 */
export function selectComposition(
  rules: CompositionRule[],
  fragments: Fragment[],
  input: { subjectArea: string; activityType: string | null }
): ComposedDraft | null {
  const matching = rules
    .filter((rule) => ruleMatches(rule, input.subjectArea, input.activityType))
    .sort((a, b) => specificity(b) - specificity(a));

  const rule = matching[0];
  if (!rule || rule.fragment_sequence.length === 0) return null;

  const selected: Fragment[] = [];
  for (const role of rule.fragment_sequence) {
    const fragment = findFragment(fragments, input.subjectArea, role);
    if (!fragment) return null;
    selected.push(fragment);
  }

  const [opening, ...rest] = selected;
  return {
    courseTitle: `Applied ${input.subjectArea} Studies`,
    reasoning: [opening.text, ...rest.map((f) => f.text)].join(" "),
  };
}

export async function composeFromFragments(
  supabase: Supa,
  input: { subjectArea: string; activityType: string | null }
): Promise<ComposedDraft | null> {
  const [{ data: rules }, { data: fragments }] = await Promise.all([
    supabase.from("composition_rules").select("*"),
    supabase.from("fragments").select("*"),
  ]);
  if (!rules?.length || !fragments?.length) return null;

  return selectComposition(rules as CompositionRule[], fragments as Fragment[], input);
}
