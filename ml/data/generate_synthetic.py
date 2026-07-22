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

Runs generation concurrently (--workers) and tracks real spend from each
response's actual usage.input_tokens/output_tokens -- not an estimate --
stopping once --max-cost is reached, so a per-call cost guess being wrong
can't blow through a real budget.

Usage:
    python3 generate_synthetic.py --count 300 --out synthetic_corpus.jsonl
    python3 generate_synthetic.py --max-cost 19.00 --count 20000  # budget-capped run
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

SEED_PATH = Path(__file__).parent / "seed_examples.json"

# claude-sonnet-5 introductory pricing, confirmed 2026-07-20 (standard rate
# of $3/$15 per Anthropic's pricing page takes effect 2026-09-01 -- update
# these if generating after that date).
PRICE_PER_INPUT_TOKEN = 2.00 / 1_000_000
PRICE_PER_OUTPUT_TOKEN = 10.00 / 1_000_000

# Deliberately broad coverage across subject areas -- narrow per-example
# style, but wide topical coverage, so the trained model doesn't only know
# the ~13 activities already hand-authored in knowledgeBase.ts. Kept to
# ~15 topics/subject so a large --count still doesn't repeat any single
# topic too many times (each still gets fresh invented specifics per call).
TOPIC_POOL = [
    ("Language Arts", [
        "reading a fantasy novel series", "writing a short story", "keeping a daily journal",
        "memorizing a poem for fun", "writing fan fiction", "starting a book club with siblings",
        "writing and illustrating a picture book", "doing a public speaking / debate club",
        "annotating a novel for themes", "writing letters to a pen pal", "reading graphic novels",
        "recording a book review video", "learning vocabulary through a word game",
        "writing song lyrics", "reading poetry aloud for fun",
    ]),
    ("Mathematics", [
        "playing a strategy board game", "doing sudoku puzzles", "helping calculate a grocery budget",
        "building a spreadsheet to track allowance", "playing a math app game",
        "measuring ingredients while doubling a recipe", "calculating odds while playing cards",
        "building a scale model and doing the math for proportions", "tracking sports stats and averages",
        "playing a puzzle-based video game", "doing mental math tricks for fun",
        "calculating trip distances and gas costs", "graphing personal data like sleep or screen time",
        "playing dice probability games", "budgeting for a project with a fixed amount of money",
    ]),
    ("Science", [
        "watching ants build a colony in the backyard", "growing crystals from a kit",
        "doing a baking-soda volcano experiment", "identifying birds with a field guide",
        "dissecting a flower to see its parts", "keeping a weather log", "raising butterflies from caterpillars",
        "testing pH of household liquids", "stargazing with a telescope app", "composting and tracking decomposition",
        "growing a vegetable garden", "building a simple electrical circuit", "testing water filtration methods",
        "observing tadpoles turn into frogs", "researching a favorite animal's habitat",
    ]),
    ("Social Studies", [
        "watching a documentary about ancient Egypt", "playing a historical strategy game",
        "visiting a local history museum", "reading about a specific war or revolution",
        "researching family genealogy", "mapping out a historical timeline poster",
        "reading a biography of a historical figure", "visiting a historical reenactment event",
        "studying a country's government structure", "listening to a history podcast",
        "interviewing a grandparent about their childhood", "researching a current event and its background",
        "building a diorama of a historical scene", "learning about a local Indigenous history",
        "comparing government systems across countries",
    ]),
    ("Fine Arts", [
        "drawing anime characters", "learning to use watercolors", "building a diorama",
        "doing digital art in Procreate", "sculpting with air-dry clay", "learning basic photography composition",
        "practicing calligraphy", "making stop-motion animation with clay figures", "painting a mural on cardboard",
        "learning perspective drawing", "making jewelry from beads", "doing a paint-by-numbers project",
        "learning to use a pottery wheel", "designing a comic strip", "practicing charcoal portraits",
    ]),
    ("Music", [
        "practicing guitar", "learning piano from an app", "writing an original song",
        "learning to read sheet music", "putting together a family band", "learning music theory basics",
        "practicing drums", "singing in a community choir", "learning ukulele", "composing a short piece",
        "learning to beatbox", "practicing violin", "producing a beat on a laptop app",
        "learning a new instrument from YouTube tutorials", "transcribing a favorite song by ear",
    ]),
    ("Physical Education", [
        "practicing skateboard tricks", "swim team practice", "learning a new yoga routine",
        "training for a 5k", "practicing archery", "learning rock climbing basics",
        "playing pickup basketball", "practicing gymnastics moves", "learning to surf",
        "doing a home workout program", "practicing martial arts forms", "training for a bike race",
        "learning to juggle", "doing trail hiking regularly", "practicing balance on a slackline",
    ]),
    ("Computer Science", [
        "learning Python from an online course", "building a mod for a video game",
        "making a website for a pretend business", "learning to use a 3D printer",
        "coding a simple game in Scratch", "building a chatbot for fun", "learning HTML/CSS basics",
        "automating a task with a script", "building a simple mobile app prototype",
        "learning to use spreadsheets for data analysis", "setting up a home server or Raspberry Pi",
        "editing videos for a YouTube channel", "learning touch typing", "building a text adventure game",
        "learning basic cybersecurity concepts from a game",
    ]),
    ("Engineering / Design", [
        "building a treehouse", "designing a marble run out of cardboard", "fixing a bike",
        "building with a robotics kit", "designing a board game from scratch",
        "building a birdhouse from scratch", "designing and 3D-printing a small object",
        "building a rube goldberg machine", "repairing a broken household item",
        "building a model bridge and testing its strength", "designing a go-kart", "soldering a small electronics kit",
        "building furniture from a kit", "designing a treehouse blueprint before building it",
        "building a working catapult",
    ]),
    ("Family & Consumer Science", [
        "planning and cooking a full family dinner", "sewing a piece of clothing", "learning to knit",
        "canning vegetables from the garden", "budgeting for a family trip", "baking bread from scratch",
        "learning basic car maintenance", "planning meals for a week on a budget",
        "learning to use a sewing machine", "organizing and running a family yard sale",
        "learning basic first aid", "meal-prepping for the week", "mending clothes",
        "planning a birthday party on a budget", "learning to can homemade jam",
    ]),
    ("Economics / Life Skills", [
        "running a lemonade stand", "reselling items online", "managing a small allowance budget",
        "comparison shopping for a big purchase", "learning about investing with play money",
        "starting a small pet-sitting business", "tracking expenses in a budgeting app",
        "negotiating chores for pay", "learning about taxes through a simulation",
        "running a small craft business at a market", "learning to read a paycheck stub",
        "comparing prices per unit at the grocery store", "setting and tracking a savings goal",
        "learning about credit through a game", "starting a subscription box side business",
    ]),
    ("Geography / World Cultures", [
        "planning an imaginary trip around the world", "learning a new language on an app",
        "cooking a meal from another country", "studying maps and flags for fun",
        "pen-palling with a kid in another country", "researching a country's climate and geography",
        "learning basic phrases in three languages", "studying world capitals for fun",
        "researching global holidays and traditions", "planning a (real or imaginary) budget trip abroad",
        "learning about time zones by planning calls with pen pals", "studying a world religion's traditions",
        "researching a country's biome and wildlife", "learning traditional dances from another culture",
        "cooking through a different country's cuisine each month",
    ]),
    ("Health & Wellness", [
        "learning about nutrition while planning meals", "practicing mindfulness or meditation",
        "learning basic anatomy through a body-systems game", "keeping a sleep and mood journal",
        "learning CPR basics from a kids' course", "researching how vaccines work",
        "practicing breathing exercises for anxiety", "learning about the food pyramid while cooking",
        "tracking fitness goals in a journal", "learning about mental health through age-appropriate media",
    ]),
    ("Entrepreneurship", [
        "starting a small online shop", "designing a logo and branding for a pretend company",
        "writing a simple business plan for a lemonade stand", "learning to make change while selling crafts",
        "pitching a business idea to family like a mini Shark Tank", "researching how a favorite company started",
        "tracking profit and loss for a small venture", "designing packaging for a homemade product",
        "learning about supply and demand through a trading game", "creating a marketing flyer for a family business",
    ]),
    ("Theater & Performance", [
        "writing and performing a short play with siblings", "learning improv games", "memorizing lines for a play",
        "building props and sets for a home production", "practicing stage presence by performing for family",
        "learning stage makeup basics", "writing a puppet show script", "studying a favorite actor's performances",
        "learning basic film acting through short videos", "directing siblings in a short film",
    ]),
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


def generate_one(client: anthropic.Anthropic, subject_area: str, topic: str, few_shot: str, max_retries: int = 4):
    """Returns (example_dict_or_None, input_tokens, output_tokens). Retries
    with backoff on rate limits specifically (a big concurrent batch is
    expected to hit these occasionally) -- any other error is a non-fatal
    skip, matching the original best-effort behavior."""
    user_message = (
        f"{few_shot}\n\n"
        f"Now generate ONE new synthetic example. Target subject_area: \"{subject_area}\". "
        f"The activity should be about: {topic}. "
        f"Write a realistic, informal parent word dump describing a child doing this (invent plausible specific "
        f"details -- what exactly they did, for how long, any specific detail a real parent would mention), then "
        f"draft the matching entry."
    )
    for attempt in range(max_retries):
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
            example = tool_use.input if tool_use else None
            return example, response.usage.input_tokens, response.usage.output_tokens
        except anthropic.RateLimitError:
            time.sleep(2 ** attempt)
        except Exception as exc:  # noqa: BLE001 -- best-effort generation, skip failures
            print(f"  ! generation failed for {subject_area}/{topic}: {exc}")
            return None, 0, 0
    print(f"  ! rate-limited repeatedly for {subject_area}/{topic}, skipping")
    return None, 0, 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300, help="max examples to attempt")
    parser.add_argument("--out", type=str, default=str(Path(__file__).parent / "synthetic_corpus.jsonl"))
    parser.add_argument("--workers", type=int, default=8, help="concurrent generation requests")
    parser.add_argument(
        "--max-cost", type=float, default=None,
        help="stop once real measured spend (from actual API usage, not an estimate) reaches this many dollars",
    )
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is required to generate synthetic data")

    seed = json.loads(SEED_PATH.read_text())
    few_shot = build_few_shot_block(seed)
    client = anthropic.Anthropic(api_key=api_key)

    examples = []
    lock = Lock()
    state = {"cost": 0.0, "attempted": 0, "stop": False}
    out_path = Path(args.out)

    def next_task():
        subject_area, topics = random.choice(TOPIC_POOL)
        return subject_area, random.choice(topics)

    required_keys = EMIT_EXAMPLE_TOOL["input_schema"]["required"]

    def worker(f):
        subject_area, topic = next_task()
        example, in_tok, out_tok = generate_one(client, subject_area, topic, few_shot)
        call_cost = in_tok * PRICE_PER_INPUT_TOKEN + out_tok * PRICE_PER_OUTPUT_TOKEN
        with lock:
            state["attempted"] += 1
            state["cost"] += call_cost
            # tool_choice forcing a tool call doesn't guarantee the model
            # actually populated every field the schema calls "required" --
            # treat an incomplete response as a failed generation rather
            # than persisting a row that'll later crash prepare_dataset.py.
            if example and all(k in example for k in required_keys):
                f.write(json.dumps(example) + "\n")
                f.flush()
                examples.append(example)
            elif example:
                print(f"  ! generation for {subject_area}/{topic} was missing a required field, skipping")
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
        f"Done: {len(examples)}/{state['attempted']} examples written to {out_path} "
        f"(~${state['cost']:.2f} spent)"
    )


if __name__ == "__main__":
    main()
