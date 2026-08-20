"""DARF — Documento de Arrecadação de Receitas Federais (SENDA).

Suporta:
- DARF com 1 tributo único (IRPJ, CSLL, PIS, COFINS, etc.) → promove tipo.
- DARF com 1 tributo em N quotas (ex: CSLL trimestral em 2 quotas com vencimentos diferentes).
- DARF com 2+ tributos distintos (ex: PIS+COFINS no mesmo documento) → tipo=DARF, composição em extracted.

Estrutura típica do PDF (texto extraído pelo pdfplumber):

    CNPJ Razão Social
    55.387.580/0001-03 SINTROPIA TECNOLOGIA LTDA
    Período de Apuração Data de Vencimento Número do Documento
    Abril/2026 25/05/2026 07.16.26135.5332460-9
    ...
    Composição do Documento de Arrecadação
    Código Denominação Principal Multa Juros Total
    2172 COFINS - CONTRIB P/ FIN. SEG. SOCIAL 6.227,73 6.227,73
    01 COFINS - FATURAMENTO/PJ EM GERAL
    PA:04/2026 Vencimento:25/05/2026
    8109 PIS - FATURAMENTO 1.349,34 1.349,34
    02 PIS - FATURAMENTO - PJ EM GERAL
    PA:04/2026 Vencimento:25/05/2026
    Totais 7.577,07 7.577,07
"""

from typing import Any

from app.extractors.composicao import extract_composicao

# Mapeamento de código de receita → tipo do Guide.
# Lista focada nos tributos federais mais comuns para PJ presumido/real.
# Códigos não-listados caem em DARF genérico, mas continuam na composição.
CODE_TO_TIPO = {
    # IRPJ
    "2089": "IRPJ",  # IRPJ Lucro Presumido — entidade
    "2362": "IRPJ",  # IRPJ Lucro Real estimativa
    "2456": "IRPJ",  # IRPJ outras
    "0220": "IRPJ",  # ajuste anual
    # CSLL
    "2372": "CSLL",  # CSLL Lucro Presumido/Arbitrado — entidade
    "2484": "CSLL",  # CSLL Lucro Real estimativa
    "6012": "CSLL",  # CSLL outras
    # PIS/COFINS
    "2172": "COFINS",
    "8109": "PIS",
    # demais → fica em "DARF" genérico
}


# ⚠ O PARSER DA TABELA DE COMPOSIÇÃO MORA EM `composicao.py`, e não aqui, desde 20/08/2026.
# O mesmo bloco SENDA aparece no DARF e no DAS (Simples Nacional, inclusive o DAS de PARCSN);
# mantê-lo dentro deste módulo amarrava a LEITURA da composição ao ROTEAMENTO por tipo, e era
# por isso que o DAS precisava ser tipado "DARF" para ter a composição colhida.


def _decide_tipo(composicao: list[dict[str, Any]]) -> str:
    """Decide o tipo final do Guide com base na composição.

    - 0 itens → DARF genérico (fallback se parse falhar mas detecção pegou DARF)
    - Todos os códigos mapeiam pro MESMO tributo → aquele tributo
    - Códigos diferentes mapeiam pra tributos diferentes → DARF
    """
    if not composicao:
        return "DARF"
    tipos = set()
    for item in composicao:
        codigo = str(item.get("codigo") or "")
        mapped = CODE_TO_TIPO.get(codigo)
        if mapped:
            tipos.add(mapped)
        else:
            tipos.add("DARF")  # código não mapeado → trata como genérico
    if len(tipos) == 1:
        return tipos.pop()
    return "DARF"


def _build_quotas(composicao: list[dict[str, Any]], tipo_unico: bool) -> list[dict[str, Any]]:
    """Quando o DARF é tipo único em N linhas (CSLL em 2 quotas, por exemplo),
    expõe `quotas` com numeração sequencial e valor/vencimento por linha.
    """
    if not tipo_unico or len(composicao) <= 1:
        return []
    return [
        {
            "numero": i + 1,
            "valor": item.get("total"),
            "vencimento": item.get("vencimento"),
        }
        for i, item in enumerate(composicao)
    ]


def refine_darf(fields: dict[str, Any], text: str, text_upper: str) -> dict[str, Any]:
    """Refina um DARF, populando composição, quotas e decidindo o tipo final.

    Setamos `_tipo_override` quando a composição revela que o documento é de um
    tributo específico (IRPJ/CSLL/PIS/COFINS) — o `extraction_service` lê esse
    campo e ajusta `document_type` antes de devolver pro cliente JS.
    """
    composicao = extract_composicao(text)

    tipo_final = _decide_tipo(composicao)

    # Quando o tipo é único e mapeado, decide se há quotas (mesmo código em N linhas).
    tipo_unico = tipo_final in {"IRPJ", "CSLL", "PIS", "COFINS"}
    quotas = _build_quotas(composicao, tipo_unico=tipo_unico)

    fields["composicao"] = composicao
    fields["quotas"] = quotas
    fields["tipo"] = tipo_final

    # Sinaliza ao extraction_service que o tipo deve ser promovido.
    if tipo_final != "DARF":
        fields["_tipo_override"] = tipo_final

    return fields
