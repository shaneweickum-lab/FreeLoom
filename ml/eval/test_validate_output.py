from validate_output import load_known_subject_areas, validate_draft

GOOD_DRAFT = {
    "course_title": "Applied Digital Logic",
    "subject_area": "Computer Science",
    "credit_value": 0.5,
    "rationale": "Building redstone circuits means wiring functional logic gates in-game, "
                 "a hands-on introduction to boolean logic.",
}


def test_valid_draft_passes():
    result = validate_draft(GOOD_DRAFT)
    assert bool(result) is True
    assert result.errors == []


def test_missing_field_fails():
    draft = dict(GOOD_DRAFT)
    del draft["rationale"]
    result = validate_draft(draft)
    assert bool(result) is False
    assert any("rationale" in e for e in result.errors)


def test_empty_field_fails():
    draft = dict(GOOD_DRAFT, course_title="")
    result = validate_draft(draft)
    assert bool(result) is False


def test_credit_value_out_of_range_fails():
    draft = dict(GOOD_DRAFT, credit_value=5.0)
    result = validate_draft(draft)
    assert bool(result) is False
    assert any("credit_value" in e for e in result.errors)


def test_credit_value_non_numeric_fails():
    draft = dict(GOOD_DRAFT, credit_value="a lot")
    result = validate_draft(draft)
    assert bool(result) is False


def test_generic_course_title_fails():
    draft = dict(GOOD_DRAFT, course_title="Learning Skills")
    result = validate_draft(draft)
    assert bool(result) is False
    assert any("generic" in e for e in result.errors)


def test_short_rationale_fails():
    draft = dict(GOOD_DRAFT, rationale="It's good.")
    result = validate_draft(draft)
    assert bool(result) is False


def test_unknown_subject_area_flagged_when_known_set_provided():
    known = {"Computer Science", "Mathematics"}
    draft = dict(GOOD_DRAFT, subject_area="Underwater Basket Weaving")
    result = validate_draft(draft, known_subject_areas=known)
    assert bool(result) is False


def test_known_subject_area_passes_when_known_set_provided():
    known = {"Computer Science", "Mathematics"}
    result = validate_draft(GOOD_DRAFT, known_subject_areas=known)
    assert bool(result) is True


def test_no_known_set_skips_subject_area_check():
    draft = dict(GOOD_DRAFT, subject_area="Anything At All")
    result = validate_draft(draft, known_subject_areas=None)
    assert bool(result) is True


def test_load_known_subject_areas_includes_seed_entries():
    subject_areas = load_known_subject_areas()
    assert "Computer Science" in subject_areas
    assert len(subject_areas) > 5
