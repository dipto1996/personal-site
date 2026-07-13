#!/bin/zsh
set -euo pipefail

MODEL_PATH="${JOBSEARCH_LOCAL_MODEL_PATH:-$HOME/.diptopal-job-search/models/Qwen3-4B-Q4_K_M.gguf}"
PORT="${JOBSEARCH_LOCAL_LLM_PORT:-8080}"
LLAMA_SERVER="${LLAMA_SERVER_BIN:-/opt/homebrew/bin/llama-server}"

if [[ ! -f "$MODEL_PATH" ]]; then
  print -u2 "Model not found at $MODEL_PATH"
  exit 1
fi

exec "$LLAMA_SERVER" \
  --model "$MODEL_PATH" \
  --alias qwen3-4b \
  --ctx-size 4096 \
  --n-gpu-layers 99 \
  --parallel 1 \
  --host 127.0.0.1 \
  --port "$PORT" \
  --cache-prompt
