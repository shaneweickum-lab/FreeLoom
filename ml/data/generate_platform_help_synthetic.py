"""
Generates synthetic training data for the "platform_help" LoRA adapter:
paraphrased variants of real FreeLoom platform Q&A, anchored to a
hand-authored ground-truth answer per question (data/platform_help_seed.json)
so the model learns FreeLoom's actual behavior, not invented platform facts.

Unlike generate_synthetic.py / generate_kb_authoring_synthetic.py, this
generation is per-seed-anchored rather than topic-pool-random: every call is
given the canonical answer up front and instructed to preserve every fact,
varying only the informal phrasing of the parent's question (and lightly
the answer's wording). Platform accuracy matters more here than for the
other two adapters -- inventing a new platform behavior would train Benny
to actively mislead a parent about how FreeLoom actually works, which is a
materially worse failure mode than a slightly-off entry-drafting guess (that
one still goes through Stage 5 human review before it's ever saved; a chat
answer is read directly).

Usage:
    python3 generate_platform_help_synthetic.py --per-seed 30 --out platform_help_synthetic.jsonl
    python3 generate_platform_help_synthetic.py --max-cost 10.00 --per-seed 60  # budget-capped run
"""

import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

import anthropic

# Same claude-sonnet-5 introductory pricing as generate_synthetic.py /
# generate_kb_authoring_synthetic.py, confirmed 2026-07-20.
PRICE_PER_INPUT_TOKEN = 2.00 / 1_000_000
PRICE_PER_OUTPUT_TOKEN = 10.00 / 1_000_000

SEED_PATH = Path(__file__).parent / "platform_help_seed.json"

SYSTEM_PROMPT = """You generate synthetic training examples for a small, specialized model that answers parents' informal questions about how the FreeLoom platform works.

You will be given ONE canonical (question, answer) pair that is ground truth -- accurate to how FreeLoom actually works. Your job:
- Invent a NEW, differently-phrased way a parent might informally ask the SAME underlying question (different wording, tone, level of detail, sometimes more casual or terser -- never a verbatim copy of the canonical question).
- Produce an answer that preserves EVERY fact in the canonical answer exactly -- do not add, remove, soften, or change any factual claim (page names, setting names, toggle names, numbers like day counts or credit fractions, etc. must stay exactly as given). You may reword sentences for natural variety, but never invent a new platform behavior, setting, or location not present in the canonical answer.

Always respond by calling emit_platform_qa exactly once."""

EMIT_TOOL = {
    "name": "emit_platform_qa",
    "description": "Emit one synthetic (paraphrased question -> fact-preserving answer) training example.",
    "input_schema": {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "answer": {"type": "string"},
        },
        "required": ["question", "answer"],
    },
}


def generate_one(client: anthropic.Anthropic, seed: dict, max_retries: int = 4):
    """Returns (example_dict_or_None, input_tokens, output_tokens). Same
    retry/best-effort behavior as the other two generation scripts."""
    user_message = (
        f'Canonical question: "{seed["question"]}"\n'
        f'Canonical answer (ground truth -- every fact here must be preserved exactly): "{seed["answer"]}"\n\n'
        "Generate one new paraphrased (question, answer) pair as instructed."
    )
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-5",
                max_tokens=500,
                system=SYSTEM_PROMPT,
                tools=[EMIT_TOOL],
                tool_choice={"type": "tool", "name": "emit_platform_qa"},
                messages=[{"role": "user", "content": user_message}],
            )
            tool_use = next((b for b in response.content if b.type == "tool_use"), None)
            example = tool_use.input if tool_use else None
            return example, response.usage.input_tokens, response.usage.output_tokens
        except anthropic.RateLimitError:
            time.sleep(2 ** attempt)
        except Exception as exc:  # noqa: BLE001 -- best-effort generation, skip failures
            print(f"  ! generation failed for {seed['question']!r}: {exc}")
            return None, 0, 0
    print(f"  ! rate-limited repeatedly for {seed['question']!r}, skipping")
    return None, 0, 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-seed", type=int, default=30, help="paraphrased variants to attempt per seed question")
    parser.add_argument("--out", type=str, default=str(Path(__file__).parent / "platform_help_synthetic.jsonl"))
    parser.add_argument("--workers", type=int, default=8, help="concurrent generation requests")
    parser.add_argument(
        "--max-cost", type=float, default=None,
        help="stop once real measured spend (from actual API usage, not an estimate) reaches this many dollars",
    )
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise SystemExit("ANTHROPIC_API_KEY is required to generate synthetic data")

    seeds = json.loads(SEED_PATH.read_text())["platform_qa"]
    tasks = [seed for seed in seeds for _ in range(args.per_seed)]

    client = anthropic.Anthropic(api_key=api_key)
    examples = []
    lock = Lock()
    state = {"cost": 0.0, "attempted": 0, "stop": False}
    out_path = Path(args.out)

    def worker(f, seed):
        example, in_tok, out_tok = generate_one(client, seed)
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
                print(f"  {state['attempted']}/{len(tasks)} attempted ({len(examples)} successful{budget_msg})")
            if args.max_cost is not None and state["cost"] >= args.max_cost:
                state["stop"] = True

    with out_path.open("w") as f, ThreadPoolExecutor(max_workers=args.workers) as executor:
        # Submitted in chunks rather than all at once, so the cost cutoff is
        # checked between chunks -- bounds any overshoot to at most one
        # in-flight chunk's worth of calls past the cap.
        i = 0
        while i < len(tasks) and not state["stop"]:
            chunk = tasks[i: i + args.workers]
            futures = [executor.submit(worker, f, seed) for seed in chunk]
            for fut in futures:
                fut.result()
            i += len(chunk)

    print(
        f"Done: {len(examples)}/{state['attempted']} examples written to {out_path} "
        f"(~${state['cost']:.2f} spent, {len(seeds)} seed questions)"
    )


if __name__ == "__main__":
    main()
