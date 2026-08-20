"""Tabela "Composição do Documento de Arrecadação" — parser ÚNICO, compartilhado.

⚠ POR QUE ESTE MÓDULO EXISTE (medido em 20/08/2026). O bloco de composição é gerado pelo MESMO
componente da Receita (SENDA) em documentos de famílias diferentes:

    DARF  — "Documento de Arrecadação de Receitas Federais"
    DAS   — "Documento de Arrecadação do Simples Nacional" (PGDAS-D, PGMEI e **DAS de PARCSN**)

O layout da tabela é o mesmo nos dois; o que muda é a linha de PERÍODO logo abaixo de cada tributo.
O parser vivia dentro de `darf.py` e só era alcançado quando `detect_tipo` devolvia "DARF" — então
a composição de um DAS só era colhida por ACIDENTE (o DAS casava no gatilho genérico
"Composição do Documento de Arrecadação" e era tipado DARF, o que está errado). Separar o parser do
ROTEAMENTO é o que permite tipar o DAS como SIMPLES sem perder a composição.

⚠ O QUE SAI DAQUI É PROVA. Cada item é o que o documento AFIRMA, com o código de receita real. Nada
aqui deriva valor por subtração e nada preenche buraco: se o PDF não trouxer multa/juros, os campos
saem ZERO porque o documento os declarou ausentes — e se o bloco inteiro não existir, a resposta é
lista vazia, não estimativa.

Formato dos períodos observados em documentos REAIS (não inventados):

    DARF trimestral   PA 01/01/2026 3a. Quota Vencimento 30/06/2026
    DARF mensal       PA 01/2024 Vencimento 07/02/2024
    DAS               06/2025
    DAS (ISS)         RIO DE JANEIRO (RJ) - 06/2025
"""

import re
from typing import Any


def parse_money_br(s: str) -> float | None:
    """Converte '10.754,85' → 10754.85. Retorna None se inválido."""
    if not s:
        return None
    s = s.strip()
    try:
        return float(s.replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def parse_date_br_to_iso(s: str) -> str | None:
    """Converte 'DD/MM/YYYY' → 'YYYY-MM-DD'. Retorna None se inválido."""
    if not s:
        return None
    m = re.match(r"^\s*(\d{2})/(\d{2})/(\d{4})\s*$", s)
    if not m:
        return None
    dd, mm, yyyy = m.groups()
    return f"{yyyy}-{mm}-{dd}"


# Usa texto original (case-sensitive) para preservar acentos no parse.
_START_PATTERN = re.compile(
    r"Composi[çc][ãa]o\s+do\s+Documento\s+de\s+Arrecada[çc][ãa]o",
    re.IGNORECASE,
)
_END_PATTERN = re.compile(r"^\s*Totais\b|SENDA\s*\(", re.IGNORECASE | re.MULTILINE)


def extract_composicao_blocks(text: str) -> list[str]:
    """Todos os blocos entre 'Composição do Documento de Arrecadação' e 'Totais' (ou 'SENDA').

    ⚠ SÃO **BLOCOS**, NO PLURAL, E ISSO NÃO É ZELO — É DEFEITO MEDIDO (20/08/2026). Documento com
    mais de uma página REPETE o cabeçalho da tabela em cada página, e só a ÚLTIMA traz a linha
    "Totais". Lendo apenas o primeiro bloco, o DARF real da SINTROPIA (07.16.26212.4523244-5,
    R$ 240.671,50, 2 páginas) perdia os dois últimos tributos: a composição somava R$ 216.349,65 e
    ninguém percebia, porque o `valor_total` vem de outro campo do PDF e continuava certo.

    O silêncio é o problema: a composição alimenta a provisão sintética por tributo
    (`GuideToProvisionService`), então o buraco vira provisão a MENOS, sem erro nenhum.
    """
    blocks: list[str] = []
    for start_match in _START_PATTERN.finditer(text):
        after_start = text[start_match.end():]
        end_match = _END_PATTERN.search(after_start)
        block = (after_start[: end_match.start()] if end_match else after_start).strip()
        if block:
            blocks.append(block)
    return blocks


# Regex para extrair as linhas de tributo dentro do bloco de composição.
# Cada tributo aparece como:
#   <CODIGO> <DENOMINAÇÃO> <PRINCIPAL> [<MULTA> <JUROS>] <TOTAL>
# seguido de 0..N linhas de detalhe (subcódigo, período, processo).
_LINE_PATTERN = re.compile(
    r"^\s*(?P<codigo>\d{4})\s+(?P<denominacao>[^\n]+?)\s+"
    r"(?P<valores>[\d.,\s]+)\s*$",
    re.MULTILINE,
)

_VALUE_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")

# "PA 01/01/2026", "PA:04/2026", "PA 01/2024" — com ou sem dois-pontos (os dois existem em produção).
_PA_RE = re.compile(r"\bPA\s*:?\s*(\d{2}/\d{2}/\d{4}|\d{2}/\d{4})", re.IGNORECASE)
# "Vencimento 30/06/2026" ou "Vencimento:25/05/2026".
_VENC_RE = re.compile(r"\bVencimento\s*:?\s*(\d{2}/\d{2}/\d{4})", re.IGNORECASE)
# Linha de período do DAS: "06/2025" sozinha, ou "RIO DE JANEIRO (RJ) - 06/2025" (linha do ISS).
_PERIODO_SOLTO_RE = re.compile(r"^(?:[^\d\n]*?[-–]\s*)?(\d{2}/\d{4})\s*$")


def _ler_periodo(linha: str) -> tuple[str | None, str | None]:
    """Devolve (periodoApuracao, vencimentoISO) lidos de UMA linha de detalhe."""
    periodo = None
    vencimento = None

    pa = _PA_RE.search(linha)
    if pa:
        periodo = pa.group(1)
    else:
        solto = _PERIODO_SOLTO_RE.match(linha.strip())
        if solto:
            periodo = solto.group(1)

    venc = _VENC_RE.search(linha)
    if venc:
        vencimento = parse_date_br_to_iso(venc.group(1))

    return periodo, vencimento


def parse_composicao(block: str) -> list[dict[str, Any]]:
    """Quebra o bloco em linhas de tributo. Cada item retornado:

        { codigo, denominacao, principal, multa, juros, total,
          periodoApuracao, vencimento (ISO YYYY-MM-DD ou None) }

    ⚠ O MESMO CÓDIGO PODE APARECER MAIS DE UMA VEZ, e isso não é duplicata: um DAS de parcelamento
    consolida competências diferentes (1001 de 12/2024 **e** 1001 de 05/2025, medido na parcela 9/41
    da ERISANGELA). Quem persistir isso precisa AGREGAR por código — nunca descartar a segunda linha.
    """
    items: list[dict[str, Any]] = []
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
        # Quando só vem Principal e Total: 2 valores (Multa/Juros ausentes no documento = ZERO).
        # Conferido por aritmética nos PDFs reais: 31,64 + 6,33 + 4,68 = 42,65.
        nums = [parse_money_br(v) or 0 for v in values]
        principal = nums[0]
        total = nums[-1]
        if len(nums) >= 3:
            multa = nums[1]
            juros = nums[2] if len(nums) >= 4 else 0
        else:
            multa = 0
            juros = 0

        # Linhas seguintes (até o próximo tributo) carregam subcódigo, período e vencimento.
        periodo_apuracao = None
        vencimento_iso = None
        j = i + 1
        while j < len(lines):
            next_line = lines[j]
            if _LINE_PATTERN.match(next_line):
                break  # outra linha de tributo
            p, v = _ler_periodo(next_line)
            if p and not periodo_apuracao:
                periodo_apuracao = p
            if v and not vencimento_iso:
                vencimento_iso = v
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


def extract_composicao(text: str) -> list[dict[str, Any]]:
    """Blocos + parse, na ordem do documento. Lista VAZIA quando não há tabela de composição.

    ⚠ NÃO deduplica: o mesmo código pode aparecer legitimamente em competências (ou quotas)
    diferentes. Agregar é decisão de quem persiste, e precisa ser SOMA.
    """
    items: list[dict[str, Any]] = []
    for block in extract_composicao_blocks(text):
        items.extend(parse_composicao(block))
    return items
