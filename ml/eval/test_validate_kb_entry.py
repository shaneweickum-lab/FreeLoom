from validate_kb_entry import validate_kb_entry

GOOD_DRAFT = {
    "keywords": ["geocaching", "geocache"],
    "course_title": "Applied Navigation & Orienteering",
    "subject_area": "Geography",
    "skills": ["GPS navigation", "map reading", "problem solving"],
    "base_credit_hours": 0.25,
    "rationale": "Geocaching requires reading coordinates and terrain clues to navigate to a hidden location, "
                 "a hands-on introduction to orienteering and spatial reasoning.",
}


def test_valid_draft_passes():
    result = validate_kb_entry(GOOD_DRAFT)
    assert bool(result) is True
    assert result.errors == []


def test_missing_field_fails():
    draft = dict(GOOD_DRAFT)
    del draft["rationale"]
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("rationale" in e for e in result.errors)


def test_empty_field_fails():
    draft = dict(GOOD_DRAFT, course_title="")
    result = validate_kb_entry(draft)
    assert bool(result) is False


def test_keywords_must_be_nonempty_list():
    draft = dict(GOOD_DRAFT, keywords=[])
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("keywords" in e for e in result.errors)


def test_skills_must_be_nonempty_list():
    draft = dict(GOOD_DRAFT, skills=[])
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("skills" in e for e in result.errors)


def test_credit_value_out_of_range_fails():
    draft = dict(GOOD_DRAFT, base_credit_hours=5.0)
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("base_credit_hours" in e for e in result.errors)


def test_credit_value_non_numeric_fails():
    draft = dict(GOOD_DRAFT, base_credit_hours="a lot")
    result = validate_kb_entry(draft)
    assert bool(result) is False


def test_generic_course_title_fails():
    draft = dict(GOOD_DRAFT, course_title="Learning Skills")
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("generic" in e for e in result.errors)


def test_short_rationale_fails():
    draft = dict(GOOD_DRAFT, rationale="It's good.")
    result = validate_kb_entry(draft)
    assert bool(result) is False


def test_novel_subject_area_is_not_penalized():
    # Deliberately different from validate_output.py's behavior -- kb_authoring
    # drafts entries for topics NOT already known, so there's no known-set
    # cross-check to fail here.
    draft = dict(GOOD_DRAFT, subject_area="Some Brand New Niche Subject")
    result = validate_kb_entry(draft)
    assert bool(result) is True
