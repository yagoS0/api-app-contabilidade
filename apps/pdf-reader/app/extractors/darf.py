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

import re
from typing import Any

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


def _parse_money_br(s: str) -> float | None:
    """Converte '10.754,85' → 10754.85. Retorna None se inválido."""
    if not s:
        return None
    s = s.strip()
    try:
        return float(s.replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def _parse_date_br_to_iso(s: str) -> str | None:
    """Converte 'DD/MM/YYYY' → 'YYYY-MM-DD'. Retorna None se inválido."""
    if not s:
        return None
    m = re.match(r"^\s*(\d{2})/(\d{2})/(\d{4})\s*$", s)
    if not m:
        return None
    dd, mm, yyyy = m.groups()
    return f"{yyyy}-{mm}-{dd}"


def _extract_composicao_block(text: str) -> str | None:
    """Localiza o bloco entre 'Composição do Documento de Arrecadação' e 'Totais' (ou 'SENDA')."""
    # Usa texto original (case-sensitive) para preservar acentos no parse.
    start_pattern = re.compile(
        r"Composi[çc][ãa]o\s+do\s+Documento\s+de\s+Arrecada[çc][ãa]o",
        re.IGNORECASE,
    )
    end_pattern = re.compile(r"^\s*Totais\b|SENDA\s*\(", re.IGNORECASE | re.MULTILINE)

    start_match = start_pattern.search(text)
    if not start_match:
        return None
    after_start = text[start_match.end():]
    end_match = end_pattern.search(after_start)
    block = after_start[: end_match.start()] if end_match else after_start
    return block.strip()


# Regex para extrair as linhas de tributo dentro do bloco de composição.
# Cada tributo aparece como:
#   <CODIGO> <DENOMINAÇÃO> <PRINCIPAL> [<MULTA>] [<JUROS>] <TOTAL>
#   <opcionalmente> <subcódigo>  <subdenominação>
#   PA:<período> Vencimento:<DD/MM/YYYY>
#
# A heurística: localizar primeiras linhas que comecem com 4 dígitos + nome + valores.
_LINE_PATTERN = re.compile(
    r"^\s*(?P<codigo>\d{4})\s+(?P<denominacao>[^\n]+?)\s+"
    r"(?P<valores>[\d.,\s]+)\s*$",
    re.MULTILINE,
)

_VALUE_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
_PA_RE = re.compile(r"PA[:\s]*([^\s]+(?:\s+[^\s]+)*?)(?=\s+Vencimento|$)", re.IGNORECASE)
_VENC_RE = re.compile(r"Vencimento[:\s]*(\d{2}/\d{2}/\d{4})", re.IGNORECASE)


def _parse_composicao(block: str) -> list[dict[str, Any]]:
    """Quebra o bloco em linhas de tributo. Cada item retornado:

        { codigo, denominacao, principal, multa, juros, total,
          periodoApuracao, vencimento (ISO YYYY-MM-DD ou None) }
    """
    items: list[dict[str, Any]] = []
    # Quebra por linhas que começam com 4 dígitos
    lines = block.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        m = _LINE_PATTERN.match(line)
        if not m:
            i += 1
            continue

        codigo = m.group("codigo")
        denominacao = m.group("denominacao").strip()
        values = _VALUE_RE.findall(m.group("valores"))
        if not values:
            i += 1
            continue

        # Layout típico: Principal Multa Juros Total → 4 valores.
        # Quando só vem Principal e Total: 2 valores (Multa/Juros omitidos).
        # Pegamos: total = último; principal = primeiro; multa/juros = meio se houver.
        nums = [_parse_money_br(v) or 0 for v in values]
        principal = nums[0]
        total = nums[-1]
        if len(nums) >= 3:
            multa = nums[1]
            juros = nums[2] if len(nums) >= 4 else 0
        else:
            multa = 0
            juros = 0

        # Procura linhas seguintes (até a próxima linha de tributo) por PA: e Vencimento:
        periodo_apuracao = None
        vencimento_iso = None
        j = i + 1
        while j < len(lines):
            next_line = lines[j]
            if _LINE_PATTERN.match(next_line):
                break  # outra linha de tributo
            if "PA:" in next_line.upper() or "PA :" in next_line.upper():
                pa_m = _PA_RE.search(next_line)
                if pa_m:
                    periodo_apuracao = pa_m.group(1).strip()
                venc_m = _VENC_RE.search(next_line)
                if venc_m:
                    vencimento_iso = _parse_date_br_to_iso(venc_m.group(1))
            j += 1

        items.append({
            "codigo": codigo,
            "denominacao": denominacao,
            "principal": principal,
            "multa": multa,
            "juros": juros,
            "total": total,
            "periodoApuracao": periodo_apuracao,
            "vencimento": vencimento_iso,
        })
        i = j  # pula para a próxima linha de tributo

    return items


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
    block = _extract_composicao_block(text)
    composicao = _parse_composicao(block) if block else []

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
