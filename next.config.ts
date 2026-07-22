import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Benny's inference weights (src/lib/benny/inference/weights/) and
  // tokenizer (ml/tokenizer/tokenizer.json) are read via plain fs calls at
  // request time, not import/require -- Next's automatic file-tracing
  // usually catches fs.readFileSync usage, but these are large binary
  // assets outside the normal module graph, so this is a safety net per
  // Next's own docs ("some cases... might fail to include required files").
  outputFileTracingIncludes: {
    "/api/pipeline/classify": ["src/lib/benny/inference/weights/**/*", "ml/tokenizer/tokenizer.json"],
    "/api/benny/messages": ["src/lib/benny/inference/weights/**/*", "ml/tokenizer/tokenizer.json"],
  },
};

export default nextConfig;
