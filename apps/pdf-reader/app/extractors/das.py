"""DAS — Documento de Arrecadação do Simples Nacional (SENDA).

Cobre as três origens que chegam aqui, todas com o MESMO bloco de composição:

- **PGDAS-D** — o DAS do mês apurado (IRPJ/CSLL/COFINS/PIS/INSS/ISS, códigos 100x/1010);
- **PGMEI**   — o DAS do MEI (códigos 0151/0125);
- **DAS de PARCSN** — a PARCELA de um parcelamento do Simples. Traz `Número do Parcelamento` e
  `Parcela: N/M` nas observações, e a composição vem com **multa e juros preenchidos**.

⚠ POR QUE A COMPOSIÇÃO SÓ CHEGA AQUI AGORA (medido em 20/08/2026). O `refine_simples` lia do PDF
apenas o VALOR TOTAL — a decomposição por tributo existia no documento e era descartada. Consequência
em produção: a parcela 7/19 do PARCSN nº 2 da ALESSANDRO NIGRO (R$ 332,65) chegou ao banco com
`extracted` sem `composicao` e `TributoParcela = 0`, e a baixa da parcela só era possível pela
DECLARAÇÃO manual do contador (F2.6) — com o DAS, que PROVA os três componentes, aberto ao lado.

⚠ O QUE SAI DAQUI É PROVA, NÃO DECLARAÇÃO. Cada item carrega o CÓDIGO DE RECEITA lido do documento
(1001, 1004, 0151…). É esse código — presente aqui, nulo na via declarada — que permite a uma
auditoria distinguir "o documento provou" de "o contador afirmou".
"""

import re
from typing import Any

from app.extractors.composicao import extract_composicao


def refine_simples(fields: dict[str, Any], text: str, text_upper: str) -> dict[str, Any]:
    """DAS / Simples Nacional — total da guia + composição por tributo."""
    # ⚠ O texto ORIGINAL (não o uppercase) é o que vai para o parser da composição: o bloco é
    # localizado por "Composição do Documento de Arrecadação" com acentuação preservada, e a
    # denominação de cada tributo é gravada como o documento a escreve.
    composicao = extract_composicao(text)
    if composicao:
        fields["composicao"] = composicao

    # pdf-parse concatenates table columns without spaces, so use \s* between headers
    match = re.search(
        r"IRPJ\s*CSLL\s*COFINS\s*PIS[/\\]?PASEP\s*INSS[/\\]?CPP\s*ICMS\s*IPI\s*ISS\s*TOTAL\s*([\d.,\s]+)",
        text_upper,
    )
    if match:
        values = re.findall(r"\d{1,3}(?:\.\d{3})*,\d{2}", match.group(1))
        if values:
            try:
                fields["valor_num"] = float(values[-1].replace(".", "").replace(",", "."))
                return fields
            except Exception:
                pass

    # "Principal X Multa Y Juros Z Total W" — DAS payment slip
    match = re.search(
        r"PRINCIPAL\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(?:MULTA|JUROS).*?TOTAL\s+(\d{1,3}(?:\.\d{3})*,\d{2})",
        text_upper,
        re.DOTALL,
    )
    if match:
        try:
            fields["valor_num"] = float(match.group(2).replace(".", "").replace(",", "."))
            return fields
        except Exception:
            pass

    return fields
