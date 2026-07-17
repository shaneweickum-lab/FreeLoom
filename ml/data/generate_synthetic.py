"""
Generates a synthetic training corpus for FreeLoom's entry-drafting SLM,
following the TinyStories approach: a larger model, used once and offline,
generates many examples in a narrow, consistent target style/format --
not a live production dependency, and not a general web corpus.

Seeded from ml/data/seed_examples.json (the real, hand-authored
knowledgeBase.ts entries and Stage 3 fragment style) so the synthetic
corpus matches FreeLoom's actual voice: specific, grounded, no generic
filler, connecting a concrete activity detail to a real educational claim.

Each example pairs a realistic informal parent "word dump" (the actual
input shape entries.raw_word_dump has) with the structured output the
entry-drafting model needs to learn to produce.

Usage: python3 generate_synthetic.py --count 300 --out synthetic_corpus.jsonl
"""

import argparse
import json
import os
import random
import time
from pathlib import Path

import anthropic

SEED_PATH = Path(__file__).parent / "seed_examples.json"

# Deliberately broad coverage across subject areas -- narrow per-example
# style, but wide topical coverage, so the trained model doesn't only know
# the ~13 activities already hand-authored in knowledgeBase.ts.
TOPIC_POOL = [
    ("Language Arts", ["reading a fantasy novel series", "writing a short story", "keeping a daily journal", "memorizing a poem for fun", "writing fan fiction"]),
    ("Mathematics", ["playing a strategy board game", "doing sudoku puzzles", "helping calculate a grocery budget", "building a spreadsheet to track allowance", "playing a math app game"]),
    ("Science", ["watching ants build a colony in the backyard", "growing crystals from a kit", "doing a baking-soda volcano experiment", "identifying birds with a field guide", "dissecting a flower to see its parts"]),
    ("Social Studies", ["watching a documentary about ancient Egypt", "playing a historical strategy game", "visiting a local history museum", "reading about a specific war or revolution", "researching family genealogy"]),
    ("Fine Arts", ["drawing anime characters", "learning to use watercolors", "building a diorama", "doing digital art in Procreate", "sculpting with air-dry clay"]),
    ("Music", ["practicing guitar", "learning piano from an app", "writing an original song", "learning to read sheet music", "putting together a family band"]),
    ("Physical Education", ["practicing skateboard tricks", "swim team practice", "learning a new yoga routine", "training for a 5k", "practicing archery"]),
    ("Computer Science", ["learning Python from an online course", "building a mod for a video game", "making a website for a pretend business", "learning to use a 3D printer", "coding a simple game in Scratch"]),
    ("Engineering / Design", ["building a treehouse", "designing a marble run out of cardboard", "fixing a bike", "building with a robotics kit", "designing a board game from scratch"]),
    ("Family & Consumer Science", ["planning and cooking a full family dinner", "sewing a piece of clothing", "learning to knit", "canning vegetables from the garden", "budgeting for a family trip"]),
    ("Economics / Life Skills", ["running a lemonade stand", "reselling items online", "managing a small allowance budget", "comparison shopping for a big purchase", "learning about investing with play money"]),
    ("Geography / World Cultures", ["planning an imaginary trip around the world", "learning a new language on an app", "cooking a meal from another country", "studying maps and flags for fun", "pen-palling with a kid in another country"]),
]

SYSTEM_PROMPT = """You generate synthetic training examples for a small, specialized model that drafts homeschool transcript entries from a parent's informal description of what their child did.

Voice and format rules, matching the real examples you'll be shown:
- The parent's word dump should sound like a real, informal, slightly rambling note -- not polished. Vary length, tone, and detail level realistically.
- course_title: a specific, real-sounding course name (not generic like "Learning Skills").
- subject_area: one clear, standard subject area.
- credit_value: a small conservative number (typically 0.1-0.5) reflecting a single logged activity, not a full course.
- rationale: 1-2 honest, specific sentences connecting the ACTUAL activity detail to the specific educational claim. No generic filler like "this builds valuable skills." A skeptical parent should be able to sanity-check the claim against the description.

Always respond by calling emit_example exactly once."""

EMIT_EXAMPLE_TOOL = {
    "name": "emit_example",
    "description": "Emit one synthetic (word dump -> drafted entry) training example.",
    "input_schema": {
        "type": "object",
        "properties": {
            "raw_word_dump": {"type": "string"},
            "course_title": {"type": "string"},
            "subject_area": {"type": "string"},
            "credit_value": {"type": "number"},
            "rationale": {"type": "string"},
        },
        "required": ["raw_word_dump", "course_title", "subject_area", "credit_value", "rationale"],
    },
}


def build_few_shot_block(seed: dict) -> str:
    lines = ["Real examples of the target voice (these are hand-authored, already-shipped entries -- match this level of specificity):"]
    for entry in seed["knowledge_base_entries"][:6]:
        lines.append(
            f'- activity: "{entry["activity"]}" -> course_title: "{entry["course_title"]}", '
            f'subject_area: "{entry["subject_area"]}", credit_value: {entry["credit_value"]}, '
            f'rationale: "{entry["rationale"]}"'
        )
    return "\n".join(lines)


def generate_one(client: anthropic.Anthropic, subject_area: str, topic: str, few_shot: str) -> dict | None:
    user_message = (
        f"{few_shot}\n\n"
        f"Now generate ONE new synthetic example. Target subject_area: \"{subject_area}\". "
        f"The activity should be about: {topic}. "
        f"Write a realistic, informal parent word dump describing a child doing this (invent plausible specific "
        f"details -- what exactly they did, for how long, any specific detail a real parent would mention), then "
        f"draft the matching entry."
    )
    try:
        response = client.messages.create(
            model="claude-sonnet-5",
            max_tokens=600,
            system=SYSTEM_PROMPT,
            tools=[EMIT_EXAMPLE_TOOL],
            tool_choice={"type": "tool", "name": "emit_example"},
            messages=[{"role": "user", "content": user_message}],
        )
        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if not tool_use:
            return None
        return tool_use.input
    except Exception as exc:  # noqa: BLE001 -- best-effort generation, skip failures
        print(f"  ! generation failed for {subject_area}/{topic}: {exc}")
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--out", type=str, default=str(Path(__file__).parent / "synthetic_corpus.jsonl"))
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is required to generate synthetic data")

    seed = json.loads(SEED_PATH.read_text())
    few_shot = build_few_shot_block(seed)
    client = anthropic.Anthropic(api_key=api_key)

    tasks = []
    while len(tasks) < args.count:
        subject_area, topics = random.choice(TOPIC_POOL)
        topic = random.choice(topics)
        tasks.append((subject_area, topic))

    examples = []
    out_path = Path(args.out)
    with out_path.open("w") as f:
        for i, (subject_area, topic) in enumerate(tasks):
            example = generate_one(client, subject_area, topic, few_shot)
            if example:
                f.write(json.dumps(example) + "\n")
                f.flush()
                examples.append(example)
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(tasks)} generated ({len(examples)} successful)")
            time.sleep(0.05)

    print(f"Done: {len(examples)}/{len(tasks)} examples written to {out_path}")


if __name__ == "__main__":
    main()
