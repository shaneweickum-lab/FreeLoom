"""
Output-format validation for the kb_authoring adapter's drafted
knowledge-base entries. Mirrors validate_output.py's validate_draft() but
for this adapter's different output shape -- a full
KnowledgeBaseEntry-style entry (keywords + skills lists, not a single-
activity draft) generalized across a cluster of word dumps, per
data/generate_kb_authoring_synthetic.py's docstring.

Deliberately NO known-subject-area cross-check like validate_output.py's --
kb_authoring's whole job is drafting entries for topics NOT already known,
so flagging a novel subject_area here would penalize exactly the cases this
adapter exists to handle.

Pure Python, no MLX dependency -- runs and is tested in this environment
independent of a trained checkpoint, same as validate_output.py.
"""

from collections import Counter

REQUIRED_FIELDS = ("keywords", "course_title", "subject_area", "skills", "base_credit_hours", "rationale")

MIN_CREDIT_VALUE = 0.05
MAX_CREDIT_VALUE = 1.0

MIN_RATIONALE_LEN = 20
MIN_COURSE_TITLE_LEN = 4

GENERIC_TITLE_PHRASES = {"learning skills", "general studies", "misc activity", "activity"}

# A repetition-loop decode collapse (plain argmax decoding getting stuck
# re-emitting its own highest-probability continuation) trivially
# satisfies every check above: a rationale that's just "and testing and
# testing and testing..." clears MIN_RATIONALE_LEN as easily as real
# content does, and a keywords list of "sailing, sailing, sailing" is
# still a non-empty list. These thresholds are calibrated against real
# degenerate completions from an early kb_authoring checkpoint (repeated
# single words, repeated keyword/skill list entries, an echoed field
# label used as a "keyword") against a genuinely good hand-written draft's
# own much lower natural repetition -- a comfortable margin over that
# baseline, not tuned against a large labeled set, since none exists yet.
MAX_LIST_DUPLICATE_FRACTION = 0.4
MAX_WORD_DOMINANCE_FRACTION = 0.25
MAX_BIGRAM_DOMINANCE_FRACTION = 0.15
MAX_TRIGRAM_DOMINANCE_FRACTION = 0.12


def _list_duplicate_fraction(items: list) -> float:
    """Fraction of `items` that repeat an earlier (case-insensitive,
    whitespace-trimmed) item -- 0.0 for an all-unique list, high for
    something like ["sailing", "sailing", "sailing"]."""
    if not items:
        return 0.0
    counts = Counter(str(item).strip().lower() for item in items)
    duplicates = sum(count - 1 for count in counts.values() if count > 1)
    return duplicates / len(items)


def _ngram_dominance_fraction(text: str, n: int) -> float:
    """The most-repeated n-gram's share of all n-grams in `text`. High for
    a decode loop ("and testing and testing and testing..."), low for
    normal prose, which naturally reuses common words but not whole
    phrases over and over. n=1 is effectively "is one word dominating the
    whole rationale."""
    words = text.lower().split()
    if len(words) < n * 2:
        return 0.0
    ngrams = [" ".join(words[i : i + n]) for i in range(len(words) - n + 1)]
    counts = Counter(ngrams)
    return counts.most_common(1)[0][1] / len(ngrams)


def _looks_like_field_label(item: str) -> bool:
    """A keyword/skill that's actually an echoed field label (e.g. the
    literal string "keywords:") rather than real content -- seen when
    decoding collapses into repeating the prompt's own field names instead
    of generating one. A genuine keyword or skill phrase essentially never
    contains a colon."""
    return ":" in item


class ValidationResult:
    def __init__(self, valid: bool, errors: list[str]):
        self.valid = valid
        self.errors = errors

    def __bool__(self) -> bool:
        return self.valid

    def __repr__(self) -> str:
        status = "valid" if self.valid else "invalid"
        return f"ValidationResult({status}, errors={self.errors})"


def validate_kb_entry(draft: dict) -> ValidationResult:
    """Validates one candidate drafted knowledge-base entry. Returns a
    ValidationResult; a falsy result means this draft shouldn't be handed to
    a human for review as-is."""
    errors = []

    for field in REQUIRED_FIELDS:
        if not draft.get(field):
            errors.append(f"missing or empty required field: {field}")

    if errors:
        return ValidationResult(False, errors)

    if not isinstance(draft["keywords"], list) or len(draft["keywords"]) == 0:
        errors.append(f"keywords must be a non-empty list, got: {draft['keywords']!r}")
    elif _list_duplicate_fraction(draft["keywords"]) > MAX_LIST_DUPLICATE_FRACTION:
        errors.append(f"keywords list is too repetitive to be genuine content: {draft['keywords']!r}")
    elif any(_looks_like_field_label(k) for k in draft["keywords"]):
        errors.append(f"keywords list contains what looks like an echoed field label, not a real keyword: {draft['keywords']!r}")

    if not isinstance(draft["skills"], list) or len(draft["skills"]) == 0:
        errors.append(f"skills must be a non-empty list, got: {draft['skills']!r}")
    elif _list_duplicate_fraction(draft["skills"]) > MAX_LIST_DUPLICATE_FRACTION:
        errors.append(f"skills list is too repetitive to be genuine content: {draft['skills']!r}")
    elif any(_looks_like_field_label(s) for s in draft["skills"]):
        errors.append(f"skills list contains what looks like an echoed field label, not a real skill: {draft['skills']!r}")

    course_title = str(draft["course_title"]).strip()
    if len(course_title) < MIN_COURSE_TITLE_LEN:
        errors.append(f"course_title too short: {course_title!r}")
    if course_title.lower() in GENERIC_TITLE_PHRASES:
        errors.append(f"course_title is generic filler: {course_title!r}")

    rationale = str(draft["rationale"]).strip()
    if len(rationale) < MIN_RATIONALE_LEN:
        errors.append(f"rationale too short/likely generic: {rationale!r}")
    else:
        if _ngram_dominance_fraction(rationale, 1) > MAX_WORD_DOMINANCE_FRACTION:
            errors.append(f"rationale is dominated by one repeated word, likely a decode loop: {rationale!r}")
        if _ngram_dominance_fraction(rationale, 2) > MAX_BIGRAM_DOMINANCE_FRACTION:
            errors.append(f"rationale repeats the same two-word phrase too often, likely a decode loop: {rationale!r}")
        if _ngram_dominance_fraction(rationale, 3) > MAX_TRIGRAM_DOMINANCE_FRACTION:
            errors.append(f"rationale repeats the same three-word phrase too often, likely a decode loop: {rationale!r}")

    try:
        credit = float(draft["base_credit_hours"])
        if not (MIN_CREDIT_VALUE <= credit <= MAX_CREDIT_VALUE):
            errors.append(
                f"base_credit_hours {credit} outside plausible range [{MIN_CREDIT_VALUE}, {MAX_CREDIT_VALUE}]"
            )
    except (TypeError, ValueError):
        errors.append(f"base_credit_hours is not numeric: {draft['base_credit_hours']!r}")

    return ValidationResult(len(errors) == 0, errors)
