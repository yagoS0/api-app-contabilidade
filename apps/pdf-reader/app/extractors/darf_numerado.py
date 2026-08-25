"""DARF no FORMULÁRIO NUMERADO antigo — o layout que NÃO tem tabela de composição.

⚠ POR QUE ESTE MÓDULO EXISTE (medido em 20/08/2026, em 3 PDFs reais de produção). O
`composicao.py` lê a tabela "Composição do Documento de Arrecadação", e é ela que dá
principal/multa/juros com CÓDIGO DE RECEITA — o sinal de PROVA que distingue "o documento provou"
de "o contador afirmou" (ver `lerComposicaoDoDocumento`, em `ParcelamentoV2Service`).

O DARF de PARCELAMENTO não-Simples **não tem essa tabela**. Ele vem no formulário numerado:

    04 CÓDIGO DA RECEITA        1124
    07 VALOR DO PRINCIPAL       1.503,09
    08 VALOR DA MULTA           (vazio)
    09 VALOR DOS JUROS ...      64,32
    10 VALOR TOTAL              1.567,41

Consequência medida: esses PDFs saíam com `document_type=DARF`, `valor_total` certo e
`composicao = []`. A parcela ficava sem `TributoParcela` e a baixa dependia da DECLARAÇÃO manual do
contador — com o DARF, que prova os três componentes, aberto ao lado. É o mesmo defeito que o DAS
de PARCSN tinha antes de `das.py` passar a colher a composição, só que com o layout trocado.

─────────────────────────────────────────────────────────────────────────────────────────────────
⚠ POR QUE O PARSER É DE TEXTO, TENDO SIDO DECIDIDO **POR** BBOX
─────────────────────────────────────────────────────────────────────────────────────────────────

A associação rótulo→valor neste formulário é perigosa no texto do pdfplumber, porque a coluna
ESQUERDA (observações) sai intercalada com a coluna DIREITA (os campos numerados). O caso que
obrigou a medição:

    09 VALOR DOS JUROS E / OU
    2-4 64,32                  ← "2-4" é da coluna ESQUERDA; só "64,32" é o valor do campo 09
    ENCARGOS DL - 1.025/69

Antes de escrever regra nenhuma, a geometria foi conferida com `extract_words()`. O que ela mostra
(páginas de 595×842, idêntico nos 3 PDFs):

    · o número do campo é impresso SEMPRE em x0 ≈ 299, e o rótulo em x0 ≈ 318;
    · o VALOR do campo é alinhado à DIREITA, terminando em x1 = 561,00 (x0 ≥ 470);
    · a coluna esquerda inteira termina em x1 ≤ 291 — o "2-4" está em x0 = 35,00;
    · cada campo ocupa uma CAIXA de 25 pt, e o valor cai a ~6 pt do topo do próprio rótulo.

Ou seja: a geometria separa as duas colunas com folga de ~180 pt, e a caixa de 25 pt amarra o valor
ao rótulo sem ambiguidade. **Não é proximidade — é contenção.**

O parser reproduz essa contenção EM TEXTO (janela entre um rótulo numerado e o SEGUINTE), e não em
bbox, por uma razão de arquitetura: todo o serviço trafega `str`, e `extract_from_text` é a costura
que permite exercer roteamento e composição SEM PDF — o projeto proíbe versionar PDF com dado real
de cliente (ver `test_guias.py`). Passar `words` por toda a cadeia trocaria essa costura por uma que
só se testa com PDF real. A equivalência texto ↔ bbox foi CONFERIDA nos 3 documentos, e os três
guardas abaixo cobrem o que a geometria cobria:

    1. JANELA, não vizinhança — o valor tem que cair entre o rótulo e o PRÓXIMO rótulo numerado;
    2. UNICIDADE — mais de um valor monetário dentro de uma janela é AMBIGUIDADE, e ambiguidade
       recusa o documento inteiro. É o que impede um número da coluna esquerda de virar tributo;
    3. ARITMÉTICA — principal + multa + juros TEM que fechar com o campo 10. É a mesma regra de
       `lerComposicaoDoDocumento`, e sem ela nada aqui é prova.

⚠ NADA AQUI É DERIVADO POR SUBTRAÇÃO. O campo 08 vem VAZIO nos três exemplares, e a saída é
multa = 0 — mas o zero não é chute nem buraco preenchido: ele é PROVADO pelo guarda 3, porque
1.503,09 + 0 + 64,32 fecha exatamente com os 1.567,41 que o próprio documento declara no campo 10.
Se houvesse multa não lida, a soma não fecharia e o documento seria recusado. Recusar é o
comportamento certo: a baixa por DECLARAÇÃO manual (F2.6) existe exatamente para esse caso.
"""

import re
from typing import Any

from app.extractors.composicao import parse_date_br_to_iso, parse_money_br

# ⚠ Os rótulos são LITERAIS, não um genérico `^\d{2}\s`. O documento tem números soltos por toda
# parte (o código de barras, o "2-4" da coluna esquerda, o "1.025/69" do decreto-lei) e um matcher
# genérico transformaria qualquer um deles em fronteira de campo.
#
# ⚠ O lookbehind não é zelo: sem ele, "1.234,10 Valor Total" casaria como se o "10" fosse o número
# do campo. O número do campo nunca é a cauda de outro número.
_PRE = r"(?<![\d.,/-])"

_CAMPOS: list[tuple[str, str]] = [
    ("02", _PRE + r"02\s+PER[ÍI]ODO\s+DE\s+APURA[ÇC][ÃA]O"),
    ("03", _PRE + r"03\s+N[ÚU]MERO\s+DO\s+CPF\s+OU\s+CNPJ"),
    ("04", _PRE + r"04\s+C[ÓO]DIGO\s+DA\s+RECEITA"),
    ("05", _PRE + r"05\s+N[ÚU]MERO\s+DE\s+REFER[ÊE]NCIA"),
    ("06", _PRE + r"06\s+DATA\s+DE\s+VENCIMENTO"),
    ("07", _PRE + r"07\s+VALOR\s+DO\s+PRINCIPAL"),
    ("08", _PRE + r"08\s+VALOR\s+DA\s+MULTA"),
    ("09", _PRE + r"09\s+VALOR\s+DOS\s+JUROS"),
    ("10", _PRE + r"10\s+VALOR\s+TOTAL"),
    ("11", _PRE + r"11\s+AUTENTICA[ÇC][ÃA]O\s+BANC[ÁA]RIA"),
]

_ROTULOS_RE = re.compile(
    "|".join(f"(?P<c{num}>{pat})" for num, pat in _CAMPOS),
    re.IGNORECASE,
)

# Mesmo formato monetário do resto do serviço: "1.503,09", "64,32". Sem centavos não é dinheiro
# aqui — é o que mantém "1.025/69" (o decreto-lei) e o código de barras fora da janela.
_VALOR_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
_CODIGO_RE = re.compile(r"(?<!\d)(\d{4})(?!\d)")
_DATA_RE = re.compile(r"(?<!\d)(\d{2}/\d{2}/\d{4})(?!\d)")

# Campos cujo conteúdo é dinheiro. O `08` entra aqui mesmo vindo vazio: é a ausência dele que
# precisa ser distinguida de "não olhei".
_CAMPOS_MONETARIOS = ("07", "08", "09", "10")


def _janelas(text: str) -> list[dict[str, str]]:
    """Fatia o texto em VIAS, cada uma como {número do campo: conteúdo da janela}.

    ⚠ AS VIAS SÃO DUAS, E IGNORAR ISSO DOBRARIA O DOCUMENTO. O formulário numerado é impresso em
    "1a. via" e "2a. via" na MESMA página — todos os campos aparecem duas vezes no texto. Aqui elas
    são separadas (um número de campo que não é maior que o anterior começa uma via nova) para que
    `extract_composicao_numerada` possa EXIGIR que as duas concordem, em vez de ler a primeira e
    torcer.

    ⚠ O campo 01 (NOME / RAZÃO SOCIAL) está fora da lista de propósito: ele é impresso na coluna
    ESQUERDA e sai do pdfplumber DEPOIS do 05, quebrando a ordem crescente que separa as vias.
    """
    marcas: list[tuple[str, int, int]] = []
    for m in _ROTULOS_RE.finditer(text):
        numero = m.lastgroup[1:] if m.lastgroup else None
        if numero:
            marcas.append((numero, m.start(), m.end()))

    vias: list[dict[str, str]] = []
    atual: dict[str, str] = {}
    anterior = None
    for i, (numero, _ini, fim) in enumerate(marcas):
        if anterior is not None and numero <= anterior:
            vias.append(atual)
            atual = {}
        proximo_ini = marcas[i + 1][1] if i + 1 < len(marcas) else len(text)
        atual[numero] = text[fim:proximo_ini]
        anterior = numero
    if atual:
        vias.append(atual)
    return vias


def _ler_via(via: dict[str, str]) -> dict[str, Any] | None:
    """Lê UMA via. Devolve None quando o documento não prova o que afirma."""
    # Guarda 2 — UNICIDADE. Duas quantias na mesma janela é ambiguidade, e ambiguidade não vira
    # tributo: é aqui que um número vazado da coluna esquerda seria barrado.
    valores: dict[str, float | None] = {}
    for campo in _CAMPOS_MONETARIOS:
        achados = _VALOR_RE.findall(via.get(campo, ""))
        if len(achados) > 1:
            return None
        valores[campo] = parse_money_br(achados[0]) if achados else None

    principal = valores["07"]
    total = valores["10"]
    if principal is None or total is None:
        return None

    # Campo vazio = o documento declarou o componente ausente. O ZERO só sobrevive porque o
    # guarda 3, logo abaixo, o confirma contra o total impresso.
    multa = valores["08"] or 0.0
    juros = valores["09"] or 0.0

    # Guarda 3 — ARITMÉTICA. Mesma regra de `lerComposicaoDoDocumento`: sem fechar, não é prova.
    if round(principal + multa + juros, 2) != round(total, 2):
        return None

    # Sem CÓDIGO DE RECEITA não há prova a oferecer — `lerComposicaoDoDocumento` descarta item sem
    # código porque esse é o formato da DECLARAÇÃO. Devolver o item mudo seria PIOR que devolver
    # nada: ele ocuparia o lugar da declaração sem substituí-la.
    cod = _CODIGO_RE.search(via.get("04", ""))
    if not cod:
        return None

    pa = _DATA_RE.search(via.get("02", ""))
    venc = _DATA_RE.search(via.get("06", ""))

    return {
        "codigo": cod.group(1),
        # ⚠ `None`, e não um rótulo inventado: o formulário numerado NÃO nomeia o tributo. Escrever
        # "PARCELAMENTO" aqui seria afirmar o que o documento não diz.
        "denominacao": None,
        "principal": round(principal, 2),
        "multa": round(multa, 2),
        "juros": round(juros, 2),
        "total": round(total, 2),
        "periodoApuracao": pa.group(1) if pa else None,
        "vencimento": parse_date_br_to_iso(venc.group(1)) if venc else None,
    }


def extract_composicao_numerada(text: str) -> list[dict[str, Any]]:
    """Composição de UM tributo lida do formulário numerado. Lista VAZIA quando não dá para provar.

    O formato de saída é o MESMO de `extract_composicao` (tabela de composição) de propósito: é o
    que permite ligar este layout ao caminho que o DAS já usa, sem contrato novo a jusante.

    ⚠ A LISTA VAZIA É UMA RESPOSTA, e é a resposta certa quando algo não fecha. Quem consome isto
    (`lerComposicaoDoDocumento`) cai na baixa por DECLARAÇÃO — o caminho projetado para a guia que
    não prova a decomposição. Devolver um palpite trocaria um caminho auditável por um número sem
    origem, que é o defeito que a subtração já causou uma vez (ver `linhasProvisao`).
    """
    vias = [v for v in _janelas(text) if "07" in v and "10" in v]
    if not vias:
        return []

    lidas = [_ler_via(v) for v in vias]
    if any(item is None for item in lidas):
        return []

    # ⚠ AS VIAS TÊM QUE CONCORDAR. Sendo 1a. e 2a. via do MESMO documento, divergir significa que a
    # segmentação leu errado — ou que o PDF traz mais de um DARF, e aí não há "o" tributo a devolver.
    primeira = lidas[0]
    if any(item != primeira for item in lidas[1:]):
        return []

    return [primeira]
