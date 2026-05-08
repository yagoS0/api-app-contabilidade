#!/usr/bin/env bash
# Inicia o serviço pdf-reader em modo de desenvolvimento
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d ".venv" ]; then
  echo "[pdf-reader] Criando venv..."
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt -q
fi

export PORT="${PORT:-8000}"
export PARSER_LOG_RAW_TEXT="${PARSER_LOG_RAW_TEXT:-0}"

echo "[pdf-reader] Iniciando na porta $PORT..."
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --reload
