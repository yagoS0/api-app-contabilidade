"""Número do Documento de Arrecadação — a chave que o PAGTOWEB consulta.

─────────────────────────────────────────────────────────────────────────────────────────────
⚠⚠ ESTE NÚMERO DECIDE DE QUEM É A DÍVIDA CONSULTADA. LEIA ANTES DE AFROUXAR QUALQUER REGRA.
─────────────────────────────────────────────────────────────────────────────────────────────

Ele é a ENTRADA de tudo no PAGTOWEB (`SerproPagtoWebService.confirmarPagamento` monta o payload
`{numeroDocumento}` e o serviço devolve o comprovante daquele documento). Um número ERRADO não dá
erro: devolve o comprovante de OUTRO documento, possivelmente de outro contribuinte. O projeto já
pagou por isso uma vez — `CaptureSerproGuidesService.extractDocumentNumber` carrega o aviso de que
uma varredura frouxa por "numero" gravou o CNPJ do ESCRITÓRIO como número de documento em todas as
guias de DAS.

Por isso a regra aqui é: **ou a leitura é inequívoca, ou não há leitura.** Ausência é uma resposta
legítima — a rota `/guides/:id/buscar-pagamento` já recusa antes de chamar o SERPRO quando o número
falta, e diz o motivo. Número errado, não.

O que torna a leitura inequívoca (as TRÊS condições, todas obrigatórias):

  1. o número aparece MASCARADO, no formato fechado `NN.NN.NNNNN.NNNNNNN-N` (17 dígitos);
  2. TODAS as ocorrências mascaradas do documento concordam entre si — o SENDA imprime o número no
     cabeçalho ("Número do Documento") e de novo no bloco do PIX ("Número:"), então há duas leituras
     independentes em praticamente todo documento;
  3. o número aparece LITERALMENTE dentro do código de barras do próprio documento.

⚠ A CONDIÇÃO 3 É O QUE FECHA A PORTA, e ela foi medida, não suposta. A linha digitável de
arrecadação sai do `pdfplumber` como quatro blocos de 11 dígitos, cada um seguido do seu dígito
verificador:

    85830000003 3  32650328262 9  43071826230 9  30956576080 0
    └─ bloco 1 ─┘DV └─ bloco 2 ─┘DV └─ bloco 3 ─┘DV └─ bloco 4 ─┘DV

Concatenando SÓ os quatro blocos (44 dígitos, sem os DVs), o número do documento aparece inteiro e
contíguo: `...4307182623030956576080...` contém `07182623030956576`. Conferido em **20 de 20**
documentos reais de arrecadação (DAS do PGDAS-D, DAS do PGMEI, DAS de PARCSN, DARF SENDA em uma e
em duas páginas, DARF do formulário numerado e DARF de parcelamento). É uma segunda gravação do
mesmo dado, produzida por outro campo do PDF — se as duas discordam, alguma leitura está errada e
nenhuma delas merece virar consulta paga.

⚠ SE OS DVs FOSSEM INCLUÍDOS NA CONCATENAÇÃO, A CONFERÊNCIA FALHARIA EM 100% DOS CASOS. O DV entre
os blocos 3 e 4 parte o número ao meio. Isso não é detalhe de implementação — é o erro exato que se
comete ao "juntar os números do código de barras", e ele reprova documentos perfeitos.
"""

import re

# Formato fechado. 2+2+5+7+1 = 17 dígitos. Os limites impedem casar dentro de uma sequência maior.
_RE_MASCARADO = re.compile(r"(?<![\d.])\d{2}\.\d{2}\.\d{5}\.\d{7}-\d(?![\d.])")

# Um bloco da linha digitável: 11 dígitos + espaço + o dígito verificador.
# ⚠ O DV é CASADO E DESCARTADO (fora do grupo) — ver a nota do cabeçalho.
_RE_BLOCO_BARRA = re.compile(r"(?<![\d.])(\d{11})\s+\d(?![\d.])")

# Motivos de recusa. Viajam como `warnings` da extração para que a ausência tenha CAUSA, e não
# apareça como "o documento não tinha número" quando o que houve foi uma leitura contraditória.
AVISO_AMBIGUO = "numero_documento_ambiguo"
AVISO_SEM_BARRAS = "numero_documento_sem_codigo_barras"
AVISO_DIVERGE = "numero_documento_diverge_do_codigo_barras"


def _so_digitos(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def digitos_do_codigo_de_barras(text: str) -> str:
    """Os 44 dígitos da linha digitável (os quatro blocos de 11, SEM os verificadores).

    Devolve string vazia quando o documento não traz linha digitável legível. Em documentos com
    mais de uma via, os blocos se repetem — a repetição é inofensiva para a busca por substring.
    """
    return "".join(_RE_BLOCO_BARRA.findall(text or ""))


def extract_numero_documento(text: str) -> tuple[str | None, list[str]]:
    """Lê o número do documento de arrecadação.

    @returns `(numero_com_17_digitos | None, avisos)`.

    ⚠ O RETORNO É SÓ DÍGITOS, e isso não é preferência de formato. Validado em produção
    (27/07/2026, `scripts/probe-pagtoweb.mjs`): com a máscara `07.16.26194.4441233-6` o PAGTOWEB
    responde 500 / `Erro-PAGTOWEB-00099`; só dígitos, responde o comprovante. Era exatamente isso
    que fazia a confirmação de pagamento nunca funcionar.
    """
    t = text or ""
    achados = _RE_MASCARADO.findall(t)
    if not achados:
        # Nem todo PDF é documento de arrecadação. Silêncio, não aviso.
        return None, []

    candidatos = {_so_digitos(a) for a in achados}
    if len(candidatos) != 1:
        # Duas leituras diferentes no MESMO documento: não há como eleger uma sem inventar critério.
        return None, [AVISO_AMBIGUO]

    numero = candidatos.pop()

    barras = digitos_do_codigo_de_barras(t)
    if not barras:
        # Sem a segunda testemunha, a leitura fica com uma fonte só. Para um dado que escolhe QUAL
        # dívida será consultada, uma fonte não basta.
        return None, [AVISO_SEM_BARRAS]
    if numero not in barras:
        return None, [AVISO_DIVERGE]

    return numero, []
