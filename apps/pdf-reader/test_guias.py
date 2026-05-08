#!/usr/bin/env python3
"""Test PDF parser against real guide files.

Usage:
    python test_guias.py [base_dir]

Default base_dir: /mnt/c/Users/yago/OneDrive/Documentos/guias para leitura
"""

import sys
import os
import pathlib

# Ensure app package is importable from this script's directory
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from app.services.extraction_service import extract_from_pdf_bytes

BASE_DIR = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "/mnt/c/Users/yago/OneDrive/Documentos/guias para leitura"
)

# Suppress raw text logging during tests
os.environ["PARSER_LOG_RAW_TEXT"] = "0"


def fmt(v):
    if v is None:
        return "—"
    return str(v)


def run():
    base = pathlib.Path(BASE_DIR)
    if not base.exists():
        print(f"[ERRO] Diretório não encontrado: {base}")
        sys.exit(1)

    pdfs = sorted(base.rglob("*.pdf")) + sorted(base.rglob("*.PDF"))
    if not pdfs:
        print(f"[ERRO] Nenhum PDF encontrado em: {base}")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"  TESTE DO PARSER DE GUIAS — {len(pdfs)} arquivo(s)")
    print(f"{'='*70}\n")

    for pdf_path in pdfs:
        rel = pdf_path.relative_to(base)
        print(f"{'─'*70}")
        print(f"  Arquivo : {rel}")

        try:
            content = pdf_path.read_bytes()
            result = extract_from_pdf_bytes(content, pdf_path.name)
        except Exception as exc:
            print(f"  [EXCEÇÃO] {exc}")
            continue

        if not result["success"]:
            errs = "; ".join(e.get("code", "") for e in result.get("errors", []))
            print(f"  [FALHA]   {errs}")
            continue

        f = result["fields"]
        warns = result.get("warnings", [])

        print(f"  Tipo     : {result['document_type']}")
        print(f"  CNPJ     : {fmt(f.get('cnpj'))}")
        print(f"  Razão    : {fmt(f.get('razao_social'))}")
        print(f"  Comp.    : {fmt(f.get('competencia'))}")
        print(f"  Vencto   : {fmt(f.get('vencimento'))}")
        print(f"  Valor    : {fmt(f.get('valor_total'))}")
        print(f"  Subtipo  : {fmt(f.get('subtipo'))}")
        if warns:
            print(f"  Avisos   : {', '.join(warns)}")

    print(f"\n{'='*70}\n")


if __name__ == "__main__":
    run()
