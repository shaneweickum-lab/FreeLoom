# Benny's in-process inference runtime

A pure-TypeScript port of `ml/model/transformer_mlx.py`'s forward pass, so
Benny's entry-drafting (`slmDraft.ts`) and chat (`chat.ts`) features run
directly inside FreeLoom's own Next.js server -- no external Mac + tunnel
process required (that was `ml/serve/inference_server.py`'s job before this
existed; see that directory's README for the history).

This works because MLX (Apple Silicon-only, what the model was actually
*trained* with) is only needed for training and gradient computation --
plain inference is just matrix multiplication over fixed weights, which
runs anywhere Node runs. `ml/serve/export_web_weights.py` bakes each
BitLinear projection's ternary-quantized shadow weight into a fixed dense
matrix (safe since it never changes at inference time) so this runtime
never needs to reimplement BitNet's quantization math at all -- only its
own per-request activation quantization (`math.ts`), which does depend on
live input.

## Files

- `config.ts` -- mirrors `ml/model/config.py`'s `ModelConfig`/`LORA_RANK`/
  `LORA_ALPHA`. Keep in sync if either changes.
- `math.ts` -- the numeric building blocks (linear/matmul, LayerNorm, GELU,
  BitLinear+LoRA composition, causal attention with a KV cache).
- `safetensors.ts` -- a minimal hand-rolled `.safetensors` reader.
- `weights.ts` -- loads and caches `weights/*.safetensors` at module scope
  (a warm serverless instance reuses them across requests).
- `tokenizer.ts` -- loads `ml/tokenizer/tokenizer.json` via
  `@huggingface/tokenizers` (pure JS, zero dependencies -- chosen over
  HuggingFace's native `tokenizers` npm package after that one turned out
  to have broken platform-binary publishing for the versions that matter).
- `model.ts` -- assembles the above into the actual forward pass, the
  greedy decode loop (KV-cached, see `math.ts`'s `LayerCache` docs for why),
  and `draftEntry()`/`chatReply()`, the two functions `slmDraft.ts`/
  `chat.ts` actually call.
- `weights/` -- **not committed by default** (see below). Where
  `export_web_weights.py`'s output lives once bundled.

## Populating `weights/`

This directory needs three files, produced by running
`ml/serve/export_web_weights.py` on the machine with the real trained
checkpoints (the M5 MacBook -- see that script's own docstring):

```
weights/base.safetensors
weights/entry_drafting_lora.safetensors
weights/platform_help_lora.safetensors
```

Copy them here from wherever the export script wrote them
(`ml/serve/web_weights/` by default) and commit them. Until they exist,
`isSlmEntryDraftingEnabled()`/`isSlmChatEnabled()` (`src/lib/flags.ts`) are
both false and every call site behaves exactly as it did before this
feature existed (Stage 4 falls through to Stage 5; Benny replies with its
placeholder).

## Verifying a port change or a retrain

`ml/serve/verify_web_port.py` is a pure-numpy (no MLX) reference
implementation of the same forward pass, reading the exact same exported
weight files -- run it and the TS side (see that script's own docstring for
both invocations) against the same prompt and compare the generated ids.
Worth re-running after any change to either side, or after every retrain.
