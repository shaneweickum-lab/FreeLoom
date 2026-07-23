"""Throwaway debug script: prints the real MLX model's raw top-5 next-token
logits for a single prompt (no generation loop) -- for comparing directly
against verify_web_port.py's numpy path to find where they diverge."""
import sys
from pathlib import Path

import mlx.core as mx
from tokenizers import Tokenizer

sys.path.insert(0, str(Path(__file__).parent.parent / "model"))
from config import BASE_CONFIG  # noqa: E402
from lora import attach_lora_adapters, load_adapter  # noqa: E402
from transformer_mlx import BitNetTransformer  # noqa: E402

CKPT_DIR = Path(__file__).parent.parent / "checkpoints"
TOKENIZER_PATH = Path(__file__).parent.parent / "tokenizer" / "tokenizer.json"

model = BitNetTransformer(BASE_CONFIG)
model.load_weights(str(CKPT_DIR / "base.safetensors"))
attach_lora_adapters(model)
load_adapter(model, str(CKPT_DIR / "platform_help_adapter.safetensors"))
model.eval()

tokenizer = Tokenizer.from_file(str(TOKENIZER_PATH))
bos_id = tokenizer.token_to_id("<bos>")

prompt = "question: What is FreeLoom?\n"
prompt_ids = [bos_id] + tokenizer.encode(prompt).ids
print("prompt_ids:", prompt_ids)

logits = model(mx.array([prompt_ids]))
last = logits[0, -1]
top5_idx = mx.argsort(last)[-5:][::-1]
print("mlx top5 ids:", top5_idx.tolist())
print("mlx top5 vals:", last[top5_idx].tolist())
