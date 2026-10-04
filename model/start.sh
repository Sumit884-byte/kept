#!/bin/sh
set -eu
MODEL_DIR="${MODEL_DIR:-/models}"
MODEL_FILE="${MODEL_FILE:-gemma-3-4b-it-Q4_K_M.gguf}"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
MODEL_URL="${MODEL_URL:-https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf}"
mkdir -p "$MODEL_DIR"
if [ ! -s "$MODEL_PATH" ]; then
  curl -fL --retry 3 -o "$MODEL_PATH.partial" "$MODEL_URL"
  mv "$MODEL_PATH.partial" "$MODEL_PATH"
fi
exec /app/llama-server \
  -m "$MODEL_PATH" \
  --host 0.0.0.0 \
  --port "${PORT:-10000}" \
  -c 4096 \
  -t "${THREADS:-2}" \
  --alias "${MODEL_ALIAS:-gemma-3-4b-it}" \
  --jinja \
  --no-warmup
