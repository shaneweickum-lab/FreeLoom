"""
HTTP inference server for the trained BitNetTransformer base + LoRA
adapters -- what src/lib/pipeline/slmDraft.ts (SLM_ENTRY_DRAFTING_URL) and
src/lib/benny/chat.ts (SLM_CHAT_URL) call out to. MLX only runs on Apple
Silicon and can't execute inside FreeLoom's own Vercel/Node runtime, so
this is a separate process that runs on the M5 MacBook and gets reached
over the network (directly for local testing, or via a tunnel like
Cloudflare Tunnel for FreeLoom's deployed app to reach it -- see
ml/serve/README.md for that setup).

Serves two routes, matching those two TS files' documented request/
response contracts exactly:
    POST /entry-draft  {raw_word_dump, extracted_slots}
                       -> {subject_area, course_title, credit_value, rationale}
    POST /chat         {history, message} -> {reply}

Both routes require a shared secret via `Authorization: Bearer <secret>`,
checked against the SLM_SHARED_SECRET env var. This process is meant to be
reachable from the public internet (that's the whole point of the
tunnel) and nothing else here authenticates callers -- without this, the
URL alone would let anyone who found it run free inference against your
own Mac.

Loads TWO separate model instances at startup (one with the
entry_drafting adapter attached, one with platform_help) rather than
swapping adapter weights in and out of a single instance per request --
simpler, safe under concurrent requests, and the base is small enough
(~13.7M params) that doubling it in memory costs little.

Usage:
    export SLM_SHARED_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    python3 inference_server.py \\
        --base-checkpoint ../checkpoints/base.safetensors \\
        --entry-drafting-adapter ../checkpoints/entry_drafting_adapter.safetensors \\
        --platform-help-adapter ../checkpoints/platform_help_adapter.safetensors

Then, from another terminal on the same Mac:
    curl -H "Authorization: Bearer $SLM_SHARED_SECRET" http://localhost:8000/health
"""

import argparse
import os
import re
import sys
from pathlib import Path

import mlx.core as mx
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG  # noqa: E402
from lora import attach_lora_adapters, load_adapter  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402

TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"

# Mirrors ml/eval/run_eval.py's FIELD_PATTERN/parse_completion exactly --
# same training format, same parsing rules. Keep these in sync if either
# changes.
ENTRY_DRAFT_PATTERN = re.compile(
    r"course_title:\s*(?P<course_title>.*?)\n"
    r"subject_area:\s*(?P<subject_area>.*?)\n"
    r"credit_value:\s*(?P<credit_value>.*?)\n"
    r"rationale:\s*(?P<rationale>.*)",
    re.DOTALL,
)


# Greedy decoding can fall into a stable repetition loop on some prompts --
# confirmed real (not implementation-specific) when
# src/lib/benny/inference/model.ts's KV-cached port and
# ml/serve/verify_web_port.py's from-scratch-every-step numpy reference both
# independently landed on the exact same stuck token. This one deliberate
# divergence from the eval scripts' raw greedy loop (run_eval.py /
# run_eval_platform_help.py, which must stay unchanged for eval numbers to
# stay comparable across retrains) -- keep this in sync with model.ts/
# verify_web_port.py's generate() instead.
MAX_CONSECUTIVE_REPEATS = 3


def generate(model, tokenizer, prompt_ids, max_new_tokens, eos_id):
    """Same greedy-decoding loop as the eval scripts (run_eval.py /
    run_eval_platform_help.py), plus a repetition-loop guard eval doesn't
    have (see MAX_CONSECUTIVE_REPEATS above)."""
    ids = list(prompt_ids)
    last_token = None
    repeat_count = 0
    for _ in range(max_new_tokens):
        window = ids[-model.cfg.max_seq_len:]
        logits = model(mx.array([window]))
        next_id = int(mx.argmax(logits[0, -1]))
        if next_id == last_token:
            repeat_count += 1
            if repeat_count >= MAX_CONSECUTIVE_REPEATS:
                break
        else:
            last_token = next_id
            repeat_count = 1
        ids.append(next_id)
        if eos_id is not None and next_id == eos_id:
            break
    return ids[len(prompt_ids):]


class Models:
    """Holds both loaded model instances plus the shared tokenizer/special
    token ids -- constructed once at startup in main(), read from every
    request handler."""

    def __init__(self, base_checkpoint: str, entry_drafting_adapter: str, platform_help_adapter: str):
        self.tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
        self.bos_id = self.tokenizer.token_to_id("<bos>")
        self.eos_id = self.tokenizer.token_to_id("<eos>")

        self.entry_drafting = self._load(base_checkpoint, entry_drafting_adapter)
        self.platform_help = self._load(base_checkpoint, platform_help_adapter)

    @staticmethod
    def _load(base_checkpoint: str, adapter_path: str) -> BitNetTransformer:
        model = BitNetTransformer(BASE_CONFIG)
        model.load_weights(base_checkpoint)
        attach_lora_adapters(model)
        load_adapter(model, adapter_path)
        model.eval()
        return model


models: Models | None = None
app = FastAPI(title="Benny inference server")


class EntryDraftRequest(BaseModel):
    raw_word_dump: str
    # Accepted for contract compatibility with slmDraft.ts's request shape,
    # but not actually used in the prompt below -- the training data this
    # adapter was fine-tuned on (prepare_dataset.py's
    # build_entry_drafting_arrays) only ever embeds raw_word_dump, never
    # extracted_slots. Using it here would train/serve on a prompt shape
    # this adapter never actually saw.
    extracted_slots: dict | None = None


class EntryDraftResponse(BaseModel):
    subject_area: str
    course_title: str
    credit_value: float
    rationale: str


class ChatTurn(BaseModel):
    role: str
    body: str


class ChatRequest(BaseModel):
    history: list[ChatTurn] = []
    message: str


class ChatResponse(BaseModel):
    reply: str


def require_shared_secret(authorization: str | None) -> None:
    expected = os.environ.get("SLM_SHARED_SECRET")
    if not expected:
        raise HTTPException(status_code=500, detail="SLM_SHARED_SECRET is not configured on this server")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")


@app.get("/health")
def health():
    return {"ok": True}


# async def (not def) on both routes below deliberately -- FastAPI runs plain
# `def` handlers on a worker-thread pool, but MLX's array/stream context is
# thread-local, and it's only guaranteed set up on the thread models were
# loaded on (main, in main() below). A worker thread that's never touched MLX
# raises "There is no Stream(cpu, 1) in current thread" the first time it
# tries. `async def` keeps every request on that same main/event-loop thread.
@app.post("/entry-draft", response_model=EntryDraftResponse)
async def entry_draft(req: EntryDraftRequest, authorization: str | None = Header(default=None)):
    require_shared_secret(authorization)
    assert models is not None

    prompt_text = f"activity: {req.raw_word_dump}\n"
    prompt_ids = [models.bos_id] + models.tokenizer.encode(prompt_text).ids
    generated_ids = generate(models.entry_drafting, models.tokenizer, prompt_ids, 120, models.eos_id)
    completion_text = models.tokenizer.decode(generated_ids)

    match = ENTRY_DRAFT_PATTERN.search(completion_text)
    if not match:
        raise HTTPException(status_code=422, detail="model output did not match the expected format")
    fields = {k: v.strip() for k, v in match.groupdict().items()}
    try:
        credit_value = float(fields["credit_value"])
    except ValueError:
        raise HTTPException(status_code=422, detail="model output's credit_value was not a number")

    return EntryDraftResponse(
        subject_area=fields["subject_area"],
        course_title=fields["course_title"],
        credit_value=credit_value,
        rationale=fields["rationale"],
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, authorization: str | None = Header(default=None)):
    require_shared_secret(authorization)
    assert models is not None

    # platform_help was fine-tuned on single-turn (question -> answer) pairs
    # only -- prepare_dataset.py's build_platform_help_arrays has no
    # multi-turn conversation format in its training data. `history` is
    # accepted here for API-contract compatibility with
    # src/lib/benny/chat.ts, but not actually used in the prompt yet --
    # revisit once/if a real multi-turn fine-tune exists.
    prompt_text = f"question: {req.message}\n"
    prompt_ids = [models.bos_id] + models.tokenizer.encode(prompt_text).ids
    generated_ids = generate(models.platform_help, models.tokenizer, prompt_ids, 200, models.eos_id)
    completion_text = models.tokenizer.decode(generated_ids).strip()

    reply = completion_text
    if reply.lower().startswith("answer:"):
        reply = reply[len("answer:"):].strip()

    return ChatResponse(reply=reply or "I'm not sure how to answer that one yet.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-checkpoint", type=str, default="../checkpoints/base.safetensors")
    parser.add_argument("--entry-drafting-adapter", type=str,
                         default="../checkpoints/entry_drafting_adapter.safetensors")
    parser.add_argument("--platform-help-adapter", type=str,
                         default="../checkpoints/platform_help_adapter.safetensors")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if not os.environ.get("SLM_SHARED_SECRET"):
        raise SystemExit(
            "SLM_SHARED_SECRET is not set -- export a random string before starting this server, e.g.:\n"
            "  export SLM_SHARED_SECRET=$(python3 -c \"import secrets; print(secrets.token_hex(32))\")"
        )

    global models
    print("Loading base model + both adapters (this takes a moment)...")
    models = Models(args.base_checkpoint, args.entry_drafting_adapter, args.platform_help_adapter)
    print(f"Ready. Serving on http://{args.host}:{args.port}")

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
