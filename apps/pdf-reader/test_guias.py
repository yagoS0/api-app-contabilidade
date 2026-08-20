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

from app.services.extraction_service import extract_from_pdf_bytes, extract_from_text

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


# ─────────────────────────────────────────────────────────────────────────────────────────────
# CHECAGENS QUE RODAM SEM PDF NENHUM
# ─────────────────────────────────────────────────────────────────────────────────────────────
#
# ⚠ POR QUE ELAS EXISTEM AQUI, E NÃO NUM `pytest`: não há pytest neste serviço e o CI
# (`.github/workflows/ci.yml`) não executa Python — um arquivo de teste novo não teria executor.
# Estas checagens rodam junto com o script que o projeto já usa: `python test_guias.py`.
#
# ⚠ E POR QUE SÃO TEXTO, E NÃO PDF: a regra do projeto proíbe versionar PDF com dado real de
# cliente. O texto abaixo é a saída do `pdfplumber` REDIGIDA (CNPJ e razão social trocados); os
# VALORES são os dos documentos reais, porque é neles que a aritmética fecha.

TEXTO_DAS_PARCELAMENTO = """Documento de Arrecadação
do Simples Nacional
CNPJ Razão Social
00.000.000/0001-00 EMPRESA EXEMPLO LTDA
Período de Apuração Data de Vencimento Número do Documento Pagar este documento até
julho/2026 31/07/2026 07.18.26230.3095657-6
31/08/2026
Observações
DAS de PARCSN (Versão: 2.0.0)
Valor Total do Documento
Número do Parcelamento: 2
332,65
Parcela: 7/19
Composição do Documento de Arrecadação
Código Denominação Principal Multa Juros Total
1004 COFINS - SIMPLES NACIONAL 31,64 6,33 4,68 42,65
06/2025
1002 CSLL - SIMPLES NACIONAL 8,64 1,73 1,28 11,65
06/2025
1006 INSS - SIMPLES NACIONAL 107,10 21,42 15,85 144,37
06/2025
1001 IRPJ - SIMPLES NACIONAL 9,87 1,97 1,46 13,30
06/2025
1010 ISS - SIMPLES NACIONAL 82,67 16,53 12,23 111,43
RIO DE JANEIRO (RJ) - 06/2025
1005 PIS - SIMPLES NACIONAL 6,87 1,37 1,01 9,25
06/2025
Totais 246,79 49,35 36,51 332,65
SENDA (Versão:1.5.9) Página: 1/1 18/08/2026 13:41:30
Documento de Arrecadação do Simples Nacional Pague com o PIX
Número: 07.18.26230.3095657-6
Pagar até: 31/08/2026
Valor: 332,65
"""

# DARF de 2 páginas: o cabeçalho da tabela SE REPETE e só a última página traz "Totais".
TEXTO_DARF_DUAS_PAGINAS = """Documento de Arrecadação
de Receitas Federais
CNPJ Razão Social
00.000.000/0001-00 EMPRESA EXEMPLO LTDA
Período de Apuração Data de Vencimento Número do Documento Pagar este documento até
Diversos 07.16.26212.4523244-5
31/07/2026
Observações
web v5.2.2
Valor Total do Documento
44.089,08
Composição do Documento de Arrecadação
Código Denominação Principal Multa Juros Total
2372 CSLL - DEMAIS 10.754,84 1.100,22 343,07 12.198,13
01 CSLL - LUCRO PRESUMIDO OU ARBITRADO - ENTIDADE NÃO
PA 01/01/2026 3a. Quota Vencimento 30/06/2026
2089 IRPJ - LUCRO PRESUMIDO 27.874,56 2.851,56 889,19 31.615,31
01 IRPJ - LUCRO PRESUMIDO
PA 01/01/2026 3a. Quota Vencimento 30/06/2026
SENDA (Versão:5.2.10) Página: 1/2 31/07/2026 15:40:25
Documento de Arrecadação de Receitas Federais Pague com o PIX
Documento de Arrecadação
de Receitas Federais
Composição do Documento de Arrecadação
Código Denominação Principal Multa Juros Total
8109 PIS - FATURAMENTO 267,49 8,15 275,64
02 PIS - FATURAMENTO - PJ EM GERAL
PA 06/2026 Vencimento 24/07/2026
Totais 38.896,89 3.959,93 1.232,26 44.089,08
"""


def _checar(nome, condicao, detalhe=""):
    marca = "OK  " if condicao else "FALHA"
    print(f"  [{marca}] {nome}{('  — ' + detalhe) if detalhe and not condicao else ''}")
    return 0 if condicao else 1


def run_regras():
    """Roteamento + composição, sobre texto fixo. Devolve o número de falhas."""
    print(f"\n{'='*70}")
    print("  CHECAGENS DE REGRA (sem PDF)")
    print(f"{'='*70}\n")
    falhas = 0

    # ── DAS de parcelamento ────────────────────────────────────────────────────────────────
    das = extract_from_text(TEXTO_DAS_PARCELAMENTO)
    comp = das["fields"].get("composicao") or []
    soma = round(sum(c["total"] for c in comp), 2)

    # ⚠ A TIPAGEM É METADE DO CONSERTO. O gatilho "Composição do Documento de Arrecadação" é o
    # título da tabela nos DOIS documentos; usá-lo como sinal de DARF tipava TODO DAS como DARF.
    falhas += _checar("DAS de PARCSN é tipado SIMPLES (não DARF)",
                      das["document_type"] == "SIMPLES", das["document_type"])
    falhas += _checar("composição do DAS tem os 6 tributos", len(comp) == 6, str(len(comp)))
    falhas += _checar("Σ dos tributos = total do documento (332,65)", soma == 332.65, str(soma))
    falhas += _checar("multa e juros são LIDOS, não derivados",
                      round(sum(c["multa"] for c in comp), 2) == 49.35
                      and round(sum(c["juros"] for c in comp), 2) == 36.51)
    falhas += _checar("cada tributo carrega o CÓDIGO DE RECEITA (é o que prova a origem)",
                      all(len(c["codigo"]) == 4 for c in comp))
    falhas += _checar("período de apuração do DAS é lido da linha solta (06/2025)",
                      all(c["periodoApuracao"] == "06/2025" for c in comp))

    # ── DARF de 2 páginas ──────────────────────────────────────────────────────────────────
    darf = extract_from_text(TEXTO_DARF_DUAS_PAGINAS)
    compd = darf["fields"].get("composicao") or []
    somad = round(sum(c["total"] for c in compd), 2)
    falhas += _checar("DARF continua tipado DARF", darf["document_type"] == "DARF", darf["document_type"])
    # ⚠ Sem ler TODOS os blocos, a página 2 sumia em silêncio e a composição ficava menor.
    falhas += _checar("DARF de 2 páginas traz os 3 tributos (o 3º está na página 2)",
                      len(compd) == 3, str(len(compd)))
    falhas += _checar("Σ dos tributos do DARF = total do documento (44.089,08)",
                      somad == 44089.08, str(somad))
    falhas += _checar("PA do DARF é lido no formato 'PA 01/01/2026' (sem dois-pontos)",
                      compd and compd[0]["periodoApuracao"] == "01/01/2026")
    falhas += _checar("linha com 3 valores: o do meio é MULTA e os juros ficam ZERO",
                      compd and compd[-1]["multa"] == 8.15 and compd[-1]["juros"] == 0)

    print(f"\n  {'TODAS AS CHECAGENS PASSARAM' if not falhas else str(falhas) + ' FALHA(S)'}\n")
    return falhas


def run():
    base = pathlib.Path(BASE_DIR)
    if not base.exists():
        print(f"[aviso] Diretório de PDFs não encontrado ({base}) — só as checagens de regra rodaram.")
        return

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
    # As checagens de regra rodam SEMPRE — elas não dependem de PDF nenhum e são a única
    # verificação automatizável do roteamento DARF × DAS e do parser de composição.
    falhas = run_regras()
    run()
    sys.exit(1 if falhas else 0)
