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

REQUIRED_FIELDS = ("keywords", "course_title", "subject_area", "skills", "base_credit_hours", "rationale")

MIN_CREDIT_VALUE = 0.05
MAX_CREDIT_VALUE = 1.0

MIN_RATIONALE_LEN = 20
MIN_COURSE_TITLE_LEN = 4

GENERIC_TITLE_PHRASES = {"learning skills", "general studies", "misc activity", "activity"}


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
    if not isinstance(draft["skills"], list) or len(draft["skills"]) == 0:
        errors.append(f"skills must be a non-empty list, got: {draft['skills']!r}")

    course_title = str(draft["course_title"]).strip()
    if len(course_title) < MIN_COURSE_TITLE_LEN:
        errors.append(f"course_title too short: {course_title!r}")
    if course_title.lower() in GENERIC_TITLE_PHRASES:
        errors.append(f"course_title is generic filler: {course_title!r}")

    rationale = str(draft["rationale"]).strip()
    if len(rationale) < MIN_RATIONALE_LEN:
        errors.append(f"rationale too short/likely generic: {rationale!r}")

    try:
        credit = float(draft["base_credit_hours"])
        if not (MIN_CREDIT_VALUE <= credit <= MAX_CREDIT_VALUE):
            errors.append(
                f"base_credit_hours {credit} outside plausible range [{MIN_CREDIT_VALUE}, {MAX_CREDIT_VALUE}]"
            )
    except (TypeError, ValueError):
        errors.append(f"base_credit_hours is not numeric: {draft['base_credit_hours']!r}")

    return ValidationResult(len(errors) == 0, errors)
