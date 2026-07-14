/**
 * students.state is collected as a two-letter postal abbreviation (the
 * dashboard form's own placeholder says "e.g. CA, TX, NY"), while
 * state_regulations.state is stored as the full state name — the more
 * readable form for a reference table a parent actually reads. This
 * bridges the two rather than forcing either side into the wrong shape.
 */
export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Resolves a student's stored state (abbreviation, or already a full name) to the full name state_regulations is keyed on. */
export function resolveStateName(rawState: string | null): string | null {
  if (!rawState) return null;
  const trimmed = rawState.trim();
  if (trimmed.length === 2) return US_STATE_NAMES[trimmed.toUpperCase()] ?? null;
  return trimmed;
}
