"""
Generates synthetic training data for the "kb_authoring" LoRA adapter: given
a CLUSTER of informal parent word-dumps describing kids doing variations of
the SAME niche activity that isn't already recognized by
src/lib/knowledgeBase.ts, draft ONE new knowledge-base-style entry
generalizing across them.

Deliberate deviation from this project's original plan (see
train/prepare_dataset.py's docstring / ml/README.md as they stood before
this file existed): the original design held that synthetic data for this
adapter would be "guessing at a shape real usage data hasn't validated,"
since kb_authoring's real input is a cluster of accumulated
human_resolutions cases, and to revisit once that volume exists. Real usage
is still very low, so this is an explicit bootstrap decision, not a quiet
reversal of that reasoning -- this train/val split should be retrained on
real human_resolutions clusters once meaningful volume accumulates, the
same way entry_drafting's synthetic corpus is a stand-in, not a permanent
substitute, for real usage data.

Topics are deliberately chosen to NOT match any keyword in
src/lib/knowledgeBase.ts's real KNOWLEDGE_BASE list -- these represent
exactly the kind of niche activity Stage 1's keyword matching would
currently miss and hand to a human, which is kb_authoring's whole reason to
exist.

Usage:
    python3 generate_kb_authoring_synthetic.py --count 500 --out kb_authoring_synthetic.jsonl
    python3 generate_kb_authoring_synthetic.py --max-cost 15.00 --count 2000  # budget-capped run
"""

import argparse
import json
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

import anthropic

# claude-sonnet-5 introductory pricing, confirmed 2026-07-20 (standard rate
# of $3/$15 per Anthropic's pricing page takes effect 2026-09-01 -- update
# these if generating after that date). Same rates as generate_synthetic.py.
PRICE_PER_INPUT_TOKEN = 2.00 / 1_000_000
PRICE_PER_OUTPUT_TOKEN = 10.00 / 1_000_000

# Niche hobby/interest topics deliberately absent from every keyword in
# src/lib/knowledgeBase.ts's real KNOWLEDGE_BASE (confirmed by reading that
# file directly, not guessed) -- these are exactly the kind of activity
# Stage 1's keyword matching would currently miss.
TOPIC_POOL = [
    "geocaching with a GPS app",
    "birdwatching with a field guide and spotting scope",
    "amateur astronomy with a home telescope",
    "metal detecting at parks and beaches",
    "aquascaping a freshwater aquarium",
    "speedcubing (competitive Rubik's cube solving)",
    "flying and racing FPV drones",
    "designing and 3D-printing miniatures",
    "building and launching model rockets",
    "learning knot-tying and rope craft",
    "keeping backyard chickens",
    "family beekeeping",
    "identifying edible plants on foraging walks",
    "amateur (ham) radio as a hobby",
    "collecting and repairing retro game consoles",
    "practicing calligraphy and hand-lettering",
    "building a gaming PC from parts",
    "learning to sail or crew a small boat",
    "trading card game deckbuilding and tournaments",
    "whittling and basic woodcarving",
]

SYSTEM_PROMPT = """You generate synthetic training examples for a small, specialized model that reviews a CLUSTER of several parents' informal descriptions of their kid doing variations of the SAME niche activity -- one FreeLoom's existing knowledge base doesn't recognize yet -- and drafts ONE new reusable knowledge-base entry generalizing across all of them.

Voice and format rules, matching the real examples you'll be shown:
- Each word dump in the cluster should sound like a real, informal, slightly rambling parent note -- not polished. Vary length, tone, phrasing, and the specific details of what the kid actually did across the 3 word dumps, even though they're all the same broad activity.
- keywords: short, lowercase phrases a parent would plausibly type that should trigger a match to this entry (the actual activity name/nickname, not generic words).
- course_title: a specific, real-sounding course name (not generic like "Learning Skills").
- subject_area: one clear, standard subject area.
- skills: 3-4 concrete skills this activity actually builds.
- base_credit_hours: a small conservative number (typically 0.1-0.5).
- rationale: 1-2 honest, specific sentences connecting the ACTUAL activity to the specific educational claim. No generic filler like "this builds valuable skills." A skeptical parent should be able to sanity-check the claim.

Always respond by calling emit_kb_entry exactly once."""

EMIT_TOOL = {
    "name": "emit_kb_entry",
    "description": "Emit one synthetic (cluster of word dumps -> new knowledge-base entry) training example.",
    "input_schema": {
        "type": "object",
        "properties": {
            "word_dumps": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 3},
            "keywords": {"type": "array", "items": {"type": "string"}},
            "course_title": {"type": "string"},
            "subject_area": {"type": "string"},
            "skills": {"type": "array", "items": {"type": "string"}},
            "base_credit_hours": {"type": "number"},
            "rationale": {"type": "string"},
        },
        "required": [
            "word_dumps", "keywords", "course_title", "subject_area", "skills", "base_credit_hours", "rationale",
        ],
    },
}

# A handful of the real src/lib/knowledgeBase.ts entries, transcribed
# verbatim (not paraphrased) -- these are already-shipped entries a human
# author wrote, so matching this level of specificity is the actual bar,
# same role as generate_synthetic.py's few-shot block.
FEW_SHOT_ENTRIES = [
    {
        "keywords": ["factorio"],
        "course_title": "Applied Logic & Systems Design",
        "subject_area": "Computer Science / Engineering",
        "skills": ["systems thinking", "resource logistics", "boolean logic", "iterative optimization"],
        "base_credit_hours": 0.5,
        "rationale": "Factorio requires designing interlocking production systems and automating decisions with "
                     "in-game circuit logic, directly paralleling systems design and boolean logic coursework.",
    },
    {
        "keywords": ["chess"],
        "course_title": "Strategic Reasoning & Game Theory",
        "subject_area": "Mathematics / Logic",
        "skills": ["strategic planning", "pattern recognition", "consequence forecasting"],
        "base_credit_hours": 0.25,
        "rationale": "Chess play develops multi-step strategic planning and pattern recognition, foundational to "
                     "game theory and formal logic.",
    },
    {
        "keywords": ["garden", "gardening", "planting"],
        "course_title": "Environmental Science & Botany",
        "subject_area": "Science",
        "skills": ["plant biology", "ecosystem observation", "hypothesis testing"],
        "base_credit_hours": 0.25,
        "rationale": "Hands-on gardening involves observing plant life cycles and testing growing conditions, core "
                     "botany and environmental science skills.",
    },
]


def build_few_shot_block() -> str:
    lines = ["Real already-shipped knowledge-base entries (match this level of specificity):"]
    for e in FEW_SHOT_ENTRIES:
        lines.append(
            f'- keywords: {e["keywords"]}, course_title: "{e["course_title"]}", subject_area: "{e["subject_area"]}", '
            f'skills: {e["skills"]}, base_credit_hours: {e["base_credit_hours"]}, rationale: "{e["rationale"]}"'
        )
    return "\n".join(lines)


def generate_one(client: anthropic.Anthropic, topic: str, few_shot: str, max_retries: int = 4):
    """Returns (example_dict_or_None, input_tokens, output_tokens). Same
    retry/best-effort behavior as generate_synthetic.py's generate_one."""
    user_message = (
        f"{few_shot}\n\n"
        f'Now generate ONE new synthetic cluster. The niche activity is: "{topic}". '
        f"Invent 3 different families/kids doing variations of this (different specific details, phrasing, tone), "
        f"then draft the ONE new knowledge-base entry that would generalize across all 3."
    )
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-5",
                max_tokens=900,
                system=SYSTEM_PROMPT,
                tools=[EMIT_TOOL],
                tool_choice={"type": "tool", "name": "emit_kb_entry"},
                messages=[{"role": "user", "content": user_message}],
            )
            tool_use = next((b for b in response.content if b.type == "tool_use"), None)
            example = tool_use.input if tool_use else None
            return example, response.usage.input_tokens, response.usage.output_tokens
        except anthropic.RateLimitError:
            time.sleep(2 ** attempt)
        except Exception as exc:  # noqa: BLE001 -- best-effort generation, skip failures
            print(f"  ! generation failed for {topic}: {exc}")
            return None, 0, 0
    print(f"  ! rate-limited repeatedly for {topic}, skipping")
    return None, 0, 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300, help="max clusters to attempt")
    parser.add_argument("--out", type=str, default=str(Path(__file__).parent / "kb_authoring_synthetic.jsonl"))
    parser.add_argument("--workers", type=int, default=8, help="concurrent generation requests")
    parser.add_argument(
        "--max-cost", type=float, default=None,
        help="stop once real measured spend (from actual API usage, not an estimate) reaches this many dollars",
    )
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is required to generate synthetic data")

    few_shot = build_few_shot_block()
    client = anthropic.Anthropic(api_key=api_key)

    examples = []
    lock = Lock()
    state = {"cost": 0.0, "attempted": 0, "stop": False}
    out_path = Path(args.out)

    def next_task():
        return random.choice(TOPIC_POOL)

    def worker(f):
        topic = next_task()
        example, in_tok, out_tok = generate_one(client, topic, few_shot)
        call_cost = in_tok * PRICE_PER_INPUT_TOKEN + out_tok * PRICE_PER_OUTPUT_TOKEN
        with lock:
            state["attempted"] += 1
            state["cost"] += call_cost
            if example:
                f.write(json.dumps(example) + "\n")
                f.flush()
                examples.append(example)
            if state["attempted"] % 25 == 0:
                budget_msg = f", ${state['cost']:.2f}" + (f"/${args.max_cost:.2f}" if args.max_cost else "")
                print(f"  {state['attempted']}/{args.count} attempted ({len(examples)} successful{budget_msg})")
            if args.max_cost is not None and state["cost"] >= args.max_cost:
                state["stop"] = True

    with out_path.open("w") as f, ThreadPoolExecutor(max_workers=args.workers) as executor:
        # Submitted in chunks rather than all at once, so the cost/count
        # cutoff is checked between chunks -- bounds any overshoot to at
        # most one in-flight chunk's worth of calls past the cap.
        while state["attempted"] < args.count and not state["stop"]:
            remaining = args.count - state["attempted"]
            chunk = min(args.workers, remaining)
            futures = [executor.submit(worker, f) for _ in range(chunk)]
            for fut in futures:
                fut.result()

    print(
        f"Done: {len(examples)}/{state['attempted']} clusters written to {out_path} "
        f"(~${state['cost']:.2f} spent)"
    )


if __name__ == "__main__":
    main()
