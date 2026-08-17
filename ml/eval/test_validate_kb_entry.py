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


# The checks below all guard against the same real failure mode: a
# repetition-loop decode collapse that still trivially satisfies every
# check above (a non-empty list, a long-enough rationale). Each example
# is drawn from an actual early kb_authoring checkpoint's eval transcript,
# not invented -- these are real degenerate completions that the
# pre-repetition-check validator scored as "valid: True".


def test_repeated_keywords_fail():
    draft = dict(GOOD_DRAFT, keywords=["sailing"] * 8)
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("keywords" in e and "repetitive" in e for e in result.errors)


def test_repeated_skills_fail():
    draft = dict(GOOD_DRAFT, skills=["procedural memory"] * 3 + ["fine motor control"])
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("skills" in e and "repetitive" in e for e in result.errors)


def test_keywords_with_a_couple_genuine_repeats_still_passes():
    # A little natural overlap (e.g. a topic mentioned in two different
    # phrasings) shouldn't be penalized the same as an outright loop --
    # only when duplicates dominate the list.
    draft = dict(GOOD_DRAFT, keywords=["hand-lettering", "hand-lettering", "brush lettering", "calligraphy", "copy"])
    result = validate_kb_entry(draft)
    assert bool(result) is True


def test_echoed_field_label_as_keyword_fails():
    draft = dict(GOOD_DRAFT, keywords=["keywords:"])
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("field label" in e for e in result.errors)


def test_word_repetition_loop_in_rationale_fails():
    # Real completion from checkpoint eval, index [98] (sailing example).
    draft = dict(
        GOOD_DRAFT,
        rationale=(
            "Crafting, and the same time, and the same procedural and adjusting and adjusting and adjusting and "
            "the same procedural and the same procedural memory and the same procedural memory and the same "
            "procedural and the same time, and procedural memory and the same coursework."
        ),
    )
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("decode loop" in e for e in result.errors)


def test_phrase_repetition_loop_in_rationale_fails():
    # Real completion from checkpoint eval, index [100] (speedcubing example).
    draft = dict(
        GOOD_DRAFT,
        rationale=(
            "Crafting, and testing and testing and testing and testing and testing and testing and testing and "
            "testing and testing and testing and testing and testing and testing and testing and measuring, which "
            "mirrors the same coursework."
        ),
    )
    result = validate_kb_entry(draft)
    assert bool(result) is False
    assert any("decode loop" in e for e in result.errors)


def test_genuinely_good_rationale_is_not_penalized_for_normal_word_reuse():
    # Real prose naturally reuses common words ("and", "the") without that
    # being a decode loop -- the good control draft itself should never
    # trip these checks.
    result = validate_kb_entry(GOOD_DRAFT)
    assert bool(result) is True
    assert result.errors == []
