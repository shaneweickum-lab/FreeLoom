# Serving Benny to the deployed app (legacy: standalone HTTP server)

**This is no longer how the deployed app actually reaches Benny.** FreeLoom now runs
inference in-process, inside its own Next.js server -- see
`src/lib/benny/inference/README.md` and `export_web_weights.py` in this directory.
That approach doesn't need a Mac or a tunnel staying up at all.

This file (and `inference_server.py`) is kept as a standalone way to run/test the
model over plain HTTP -- useful for manual debugging, or if the in-process path ever
needs a fallback -- but nothing in `src/` calls out to it anymore.

---

`inference_server.py` is what turns the trained checkpoints in `ml/checkpoints/`
into something reachable over HTTP. MLX only runs on Apple Silicon, so this process
has to run on the M5 MacBook itself -- there's no way around that today (see
`ml/README.md`).

Everything in `src/` that would call this (`src/lib/pipeline/slmDraft.ts`,
`src/lib/benny/chat.ts`) already degrades gracefully when it's not reachable --
missing env vars, a network error, a timeout, all fall back to today's existing
behavior (Stage 5 human review / a placeholder chat reply). Nothing breaks if the
Mac is asleep or the tunnel drops; the feature just goes quiet until it's back.

## 1. Run the server locally

```bash
cd ml
pip install -r requirements.txt   # picks up fastapi/uvicorn if you don't have them yet
cd serve
export SLM_SHARED_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "Save this -- you'll paste it into Vercel's env vars too: $SLM_SHARED_SECRET"
python3 inference_server.py
```

Defaults assume you're running this from `ml/serve/` with checkpoints at
`ml/checkpoints/{base,entry_drafting_adapter,platform_help_adapter}.safetensors` --
override with `--base-checkpoint`/`--entry-drafting-adapter`/`--platform-help-adapter`
if yours live elsewhere.

Leave this running in its own terminal tab. From another tab, confirm it's actually
answering:

```bash
curl -H "Authorization: Bearer $SLM_SHARED_SECRET" http://localhost:8000/health
# {"ok":true}

curl -X POST http://localhost:8000/entry-draft \
  -H "Authorization: Bearer $SLM_SHARED_SECRET" -H "Content-Type: application/json" \
  -d '{"raw_word_dump": "Spent an hour building a birdhouse from scrap wood."}'
```

## 2. Expose it to the internet with Cloudflare Tunnel

You don't need a Cloudflare account or a domain to try this -- a "quick tunnel" gives
you a random, temporary `*.trycloudflare.com` URL in one command:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

It'll print something like `https://random-words-here.trycloudflare.com` -- that's
your public URL for as long as this command keeps running. Good for testing today;
the URL changes every time you restart it, so it's not something to hardcode long-term.

For a stable URL that doesn't change on restart (worth doing once you're past
testing), Cloudflare's docs cover naming a tunnel and routing a subdomain you own to
it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/

Either way: keep the `cloudflared` command running in its own terminal tab alongside
`inference_server.py` -- both need to stay up for the deployed app to reach your Mac.

## 3. Point FreeLoom at it

In Vercel's project settings (Environment Variables), set:

```
SLM_ENTRY_DRAFTING_URL=https://<your-tunnel-url>
SLM_CHAT_URL=https://<your-tunnel-url>
SLM_SHARED_SECRET=<the value you generated in step 1>
```

Both URL vars point at the *same* server -- it serves both `/entry-draft` and
`/chat` routes from one process. Redeploy (or trigger a redeploy) for the new env
vars to take effect.

## 4. Confirm it end-to-end

- Log a word dump on `/log` for something obscure enough that Stage 1-3's keyword
  matching won't recognize it -- if Stage 4 is reachable, you should get a pre-filled
  draft instead of a blank Stage 5 form.
- Open Benny's chat (if `benny_assistant_enabled` and your tier allow it -- see
  `AccountTab.tsx`) and ask something like "can an admin see my kid's data?" --
  you should get a real generated answer instead of the "Benny's still growing"
  placeholder.

If either still shows the old fallback behavior: check the Vercel deployment actually
picked up the new env vars, check the tunnel is still running (`trycloudflare.com`
quick tunnels die if you close that terminal), and check
`inference_server.py`'s own terminal for errors on each request.
