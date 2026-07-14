"""
Output-format validation for the entry-drafting adapter's drafts --
docs/slm-strategy.md Section 7's first safeguard: "reject a draft that
doesn't have a valid subject_area, a plausible credit_value, or all
required fields; fall through to Stage 5 same as any other low-confidence
case."

Pure Python, no MLX/model dependency -- this validates the *shape* of a
candidate draft dict, whether it came from a real trained adapter (Mac-only)
or a hand-constructed test case (fully runnable here). The generation side
(run_eval.py) is Mac-only; this file is the part of the eval harness that
doesn't need a checkpoint to exercise.

Note: the app's `subject_area` field is currently an open string (no
enforced enum in src/lib/pipeline), so "valid subject_area" here means
"matches the training corpus's known set" -- a proxy for the real
cross-check against the classical subject-area classifier described in
slm-strategy.md Section 1/7, which doesn't exist yet as of this pass (it's
TS/pipeline work, not part of this ml/ scaffolding). Wire that real
cross-check in once that classifier exists; until then, this is a useful
but weaker sanity check.
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

REQUIRED_FIELDS = ("course_title", "subject_area", "credit_value", "rationale")

MIN_CREDIT_VALUE = 0.05
MAX_CREDIT_VALUE = 1.0

MIN_RATIONALE_LEN = 20
MIN_COURSE_TITLE_LEN = 4

GENERIC_TITLE_PHRASES = {"learning skills", "general studies", "misc activity", "activity"}


def load_known_subject_areas() -> set[str]:
    subject_areas = set()
    seed = json.loads((DATA_DIR / "seed_examples.json").read_text())
    for entry in seed["knowledge_base_entries"]:
        subject_areas.add(entry["subject_area"])
    corpus_path = DATA_DIR / "synthetic_corpus.jsonl"
    if corpus_path.exists():
        with corpus_path.open() as f:
            for line in f:
                line = line.strip()
                if line:
                    subject_areas.add(json.loads(line)["subject_area"])
    return subject_areas


class ValidationResult:
    def __init__(self, valid: bool, errors: list[str]):
        self.valid = valid
        self.errors = errors

    def __bool__(self) -> bool:
        return self.valid

    def __repr__(self) -> str:
        status = "valid" if self.valid else "invalid"
        return f"ValidationResult({status}, errors={self.errors})"


def validate_draft(draft: dict, known_subject_areas: set[str] | None = None) -> ValidationResult:
    """Validates one candidate entry-drafting output. Returns a
    ValidationResult; a falsy result means "fall through to Stage 5" per
    the safeguard this implements."""
    errors = []

    for field in REQUIRED_FIELDS:
        if not draft.get(field):
            errors.append(f"missing or empty required field: {field}")

    if errors:
        return ValidationResult(False, errors)

    course_title = draft["course_title"].strip()
    if len(course_title) < MIN_COURSE_TITLE_LEN:
        errors.append(f"course_title too short: {course_title!r}")
    if course_title.lower() in GENERIC_TITLE_PHRASES:
        errors.append(f"course_title is generic filler: {course_title!r}")

    rationale = draft["rationale"].strip()
    if len(rationale) < MIN_RATIONALE_LEN:
        errors.append(f"rationale too short/likely generic: {rationale!r}")

    try:
        credit_value = float(draft["credit_value"])
        if not (MIN_CREDIT_VALUE <= credit_value <= MAX_CREDIT_VALUE):
            errors.append(f"credit_value {credit_value} outside plausible range "
                           f"[{MIN_CREDIT_VALUE}, {MAX_CREDIT_VALUE}]")
    except (TypeError, ValueError):
        errors.append(f"credit_value is not numeric: {draft['credit_value']!r}")

    if known_subject_areas is not None and draft["subject_area"] not in known_subject_areas:
        errors.append(f"subject_area {draft['subject_area']!r} not in known set "
                       f"(proxy check only -- see module docstring)")

    return ValidationResult(len(errors) == 0, errors)
