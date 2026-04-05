# pdf-reader

Serviço FastAPI interno para extração de texto e campos de guias em PDF (fluxo oficial da API; o parser Flask legado foi descontinuado).

## Requisitos

- Python 3.12+

## Execução local

```bash
cd apps/pdf-reader
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export PORT=8000
# opcional: MAX_UPLOAD_BYTES, OCR_ENABLED, MIN_TEXT_CHARS, PARSER_LOG_RAW_TEXT
uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

- `GET /health` → `{"status":"ok"}`
- `POST /extract` → JSON `{"content_base64":"...","filename":"guia.pdf"}` (opcional)

Este app **não** faz parte dos workspaces npm do monorepo; dependências são apenas Python.

## Docker

Na raiz do repositório (ou com contexto `apps/pdf-reader`):

```bash
docker build -f apps/pdf-reader/Dockerfile -t pdf-reader apps/pdf-reader
docker run -p 8000:8000 -e PORT=8000 pdf-reader
```

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta HTTP (padrão 8000) |
| `MAX_UPLOAD_BYTES` | Tamanho máximo do PDF decodificado (padrão 15 MiB) |
| `OCR_ENABLED` | Se `true` e o texto nativo for muito curto, retorna `TEXT_EXTRACTION_FAILED` (OCR real ainda não implementado) |
| `MIN_TEXT_CHARS` | Limiar de caracteres quando `OCR_ENABLED` |
| `PARSER_LOG_RAW_TEXT` | `1` para logar texto extraído no stdout (padrão `0` em produção se `NODE_ENV=production`) |
