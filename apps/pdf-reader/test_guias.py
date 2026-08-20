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
julho/2026 31/07/2026 07.99.26230.3095657-6
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
85830000003 3 32650328262 9 43079926230 9 30956576080 0 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação do Simples Nacional Pague com o PIX
85830000003 3 32650328262 9 43079926230 9 30956576080 0 Número: 07.99.26230.3095657-6
Pagar até: 31/08/2026
Valor: 332,65
"""

# DARF de 2 páginas: o cabeçalho da tabela SE REPETE e só a última página traz "Totais".
TEXTO_DARF_DUAS_PAGINAS = """Documento de Arrecadação
de Receitas Federais
CNPJ Razão Social
00.000.000/0001-00 EMPRESA EXEMPLO LTDA
Período de Apuração Data de Vencimento Número do Documento Pagar este documento até
Diversos 07.96.26212.4523244-5
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
85860002406 0 71500385262 0 12079626212 7 45232445107 3 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação de Receitas Federais Pague com o PIX
Número: 07.96.26212.4523244-5
"""

# DARF de PARCELAMENTO não-Simples no FORMULÁRIO NUMERADO — o layout que NÃO tem tabela de
# composição. Texto real do pdfplumber (CNPJ e razão social trocados; valores e posições
# preservados, porque é neles que a aritmética fecha e é neles que a armadilha aparece).
#
# ⚠ AS DUAS VIAS ESTÃO AQUI DE PROPÓSITO. O documento é impresso em "1a. via" e "2a. via" na MESMA
# página, então TODO campo aparece duas vezes no texto. Cortar a segunda via daria um teste que não
# exerce a segmentação nem a exigência de que as duas concordem.
#
# ⚠ E A LINHA "2-4 64,32" É A ARMADILHA, não um erro de digitação: o "2-4" é da coluna ESQUERDA
# (observações) e só o "64,32" pertence ao campo 09. Ele está aqui para que a regra seja exercida
# contra o texto que quase a engana.
TEXTO_DARF_PARCELAMENTO_NUMERADO = """1a. via
MINISTÉRIO DA FAZENDA 02 PERÍODO DE APURAÇÃO 30/04/2026
SECRETARIA DA RECEITA FEDERAL DO BRASIL
03 NÚMERO DO CPF OU CNPJ
Documento de Arrecadação de Receitas Federais 00.000.000/0001-00
DARF
04 CÓDIGO DA RECEITA
1124
05 NÚMERO DE REFERÊNCIA
01 NOME / RAZÃO SOCIAL
06 DATA DE VENCIMENTO
EMPRESA EXEMPLO LTDA 31/07/2026
Número do Documento: 07.93.26195.9218090-8 07 VALOR DO PRINCIPAL
1.503,09
Data limite para acolhimento: 31/07/2026
08 VALOR DA MULTA
Observações:
02110001200423659112669
09 VALOR DOS JUROS E / OU
2-4 64,32
ENCARGOS DL - 1.025/69
10 VALOR TOTAL
1.567,41
SENDA (Versão:5.2.9) 14/07/2026 15:01:18 11 AUTENTICAÇÃO BANCÁRIA (Somente nas 1a. e 2a. vias)
85840000015 9 67410385262 1 12079326195 0 92180908750 2
2a. via
MINISTÉRIO DA FAZENDA 02 PERÍODO DE APURAÇÃO 30/04/2026
SECRETARIA DA RECEITA FEDERAL DO BRASIL
03 NÚMERO DO CPF OU CNPJ
Documento de Arrecadação de Receitas Federais 00.000.000/0001-00
DARF
04 CÓDIGO DA RECEITA
1124
05 NÚMERO DE REFERÊNCIA
01 NOME / RAZÃO SOCIAL
06 DATA DE VENCIMENTO
EMPRESA EXEMPLO LTDA 31/07/2026
Número do Documento: 07.93.26195.9218090-8 07 VALOR DO PRINCIPAL
1.503,09
Data limite para acolhimento: 31/07/2026
08 VALOR DA MULTA
Observações:
02110001200423659112669
09 VALOR DOS JUROS E / OU
2-4 64,32
ENCARGOS DL - 1.025/69
10 VALOR TOTAL
1.567,41
SENDA (Versão:5.2.9) 14/07/2026 15:01:18 11 AUTENTICAÇÃO BANCÁRIA (Somente nas 1a. e 2a. vias)
85840000015 9 67410385262 1 12079326195 0 92180908750 2
"""

# O MESMO documento com os juros adulterados nas DUAS vias: 1.503,09 + 0 + 60,00 = 1.563,09, e o
# campo 10 continua dizendo 1.567,41. Nada a corrigir aqui — é o caso em que a resposta certa é
# NÃO LER.
TEXTO_NUMERADO_QUE_NAO_FECHA = TEXTO_DARF_PARCELAMENTO_NUMERADO.replace("2-4 64,32", "2-4 60,00")

# O MESMO documento com um segundo valor monetário vazando da coluna ESQUERDA para dentro da janela
# do campo 09. É exatamente o cenário que a leitura por proximidade erraria em silêncio.
TEXTO_NUMERADO_AMBIGUO = TEXTO_DARF_PARCELAMENTO_NUMERADO.replace(
    "ENCARGOS DL - 1.025/69",
    "ENCARGOS DL - 1.025/69 saldo devedor 1.234,56",
)


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

    # ── Número do documento de arrecadação ─────────────────────────────────────────────────
    #
    # ⚠⚠ É A CHAVE QUE O PAGTOWEB CONSULTA. Número errado não dá erro: devolve o comprovante de
    # OUTRO documento. As checagens abaixo prendem as três condições que tornam a leitura
    # inequívoca — e, sobretudo, prendem as RECUSAS: cada uma delas é um caminho por onde um
    # número errado entraria.
    falhas += _checar("número do DAS sai só com dígitos (17)",
                      das["fields"].get("numero_documento") == "07992623030956576",
                      str(das["fields"].get("numero_documento")))
    falhas += _checar("número do DARF também é lido",
                      darf["fields"].get("numero_documento") == "07962621245232445",
                      str(darf["fields"].get("numero_documento")))

    # ⚠ SEM A SEGUNDA TESTEMUNHA, NÃO SE GRAVA. O documento continua dizendo o número no cabeçalho —
    # e mesmo assim a resposta é ausência, porque uma fonte só não basta para escolher QUAL dívida
    # vai ser consultada. É a recusa mais fácil de "consertar" por engano.
    sem_barras = "\n".join(
        l for l in TEXTO_DAS_PARCELAMENTO.split("\n") if "85830000003" not in l
    )
    r = extract_from_text(sem_barras)
    falhas += _checar("sem código de barras, NÃO grava número",
                      r["fields"].get("numero_documento") is None
                      and "numero_documento_sem_codigo_barras" in r["warnings"],
                      str(r["warnings"]))

    # ⚠ E O CÓDIGO DE BARRAS QUE NÃO CONTÉM O NÚMERO É RECUSA, não aviso: alguma das duas leituras
    # está errada, e não há como saber qual.
    r = extract_from_text(TEXTO_DAS_PARCELAMENTO.replace("43079926230", "43079926231"))
    falhas += _checar("código de barras que não confere ⇒ RECUSA",
                      r["fields"].get("numero_documento") is None
                      and "numero_documento_diverge_do_codigo_barras" in r["warnings"],
                      str(r["warnings"]))

    r = extract_from_text(TEXTO_DAS_PARCELAMENTO.replace(
        "Número: 07.99.26230.3095657-6", "Número: 07.99.26230.3095657-7"))
    falhas += _checar("duas leituras divergentes no mesmo documento ⇒ RECUSA",
                      r["fields"].get("numero_documento") is None
                      and "numero_documento_ambiguo" in r["warnings"],
                      str(r["warnings"]))

    falhas += _checar("documento que não é de arrecadação não gera aviso nenhum",
                      extract_from_text(
                          "Alvará de funcionamento\n" * 20)["fields"].get("numero_documento") is None)

    # ── DARF de parcelamento no FORMULÁRIO NUMERADO ────────────────────────────────────────
    #
    # ⚠ O VÃO QUE ISTO FECHA (medido em 20/08/2026, 3 PDFs reais). Este layout não tem a tabela de
    # composição: ele saía com `valor_total` certo e `composicao = []`, a parcela ficava sem
    # `TributoParcela` e a baixa dependia da DECLARAÇÃO manual do contador — com o DARF, que prova
    # os três componentes, aberto ao lado.
    num = extract_from_text(TEXTO_DARF_PARCELAMENTO_NUMERADO)
    compn = num["fields"].get("composicao") or []
    falhas += _checar("formulário numerado continua tipado DARF",
                      num["document_type"] == "DARF", num["document_type"])
    falhas += _checar("formulário numerado passa a ter composição (1 tributo)",
                      len(compn) == 1, str(len(compn)))
    falhas += _checar("carrega o CÓDIGO DE RECEITA do campo 04 — é o que prova a origem",
                      compn and compn[0]["codigo"] == "1124")
    # ⚠ Os juros vêm da linha "2-4 64,32": o "2-4" é da coluna ESQUERDA. Se algum dia esta checagem
    # falhar com juros == 2 ou == 4, a janela deixou de conter o valor e voltou a ser proximidade.
    falhas += _checar("juros são 64,32 — o '2-4' da coluna esquerda NÃO vira valor",
                      compn and compn[0]["juros"] == 64.32,
                      str(compn[0]["juros"]) if compn else "—")
    falhas += _checar("principal é 1.503,09 e o total é 1.567,41",
                      compn and compn[0]["principal"] == 1503.09 and compn[0]["total"] == 1567.41)
    # ⚠ O campo 08 vem VAZIO. O zero não é chute: ele é o que a aritmética do próprio documento
    # confirma — e é por isso que a checagem seguinte existe.
    falhas += _checar("campo 08 vazio vira multa ZERO (declarada ausente, não derivada)",
                      compn and compn[0]["multa"] == 0)
    falhas += _checar("principal + multa + juros = VALOR TOTAL do campo 10",
                      compn and round(compn[0]["principal"] + compn[0]["multa"]
                                      + compn[0]["juros"], 2) == compn[0]["total"])
    falhas += _checar("Σ da composição = valor_total da guia (é o que `lerComposicaoDoDocumento` confere)",
                      compn and round(sum(c["total"] for c in compn), 2)
                      == num["fields"].get("valor_total"))
    # ⚠ Sem denominação: o formulário numerado NÃO nomeia o tributo, e inventar um rótulo seria
    # afirmar o que o documento não diz.
    falhas += _checar("denominação fica NULA — o documento não nomeia o tributo",
                      compn and compn[0]["denominacao"] is None)

    # ── E os dois casos em que a resposta certa é NÃO LER ──────────────────────────────────
    nfecha = extract_from_text(TEXTO_NUMERADO_QUE_NAO_FECHA)
    falhas += _checar("aritmética que não fecha RECUSA o documento (não corrige, não subtrai)",
                      not (nfecha["fields"].get("composicao") or []),
                      str(nfecha["fields"].get("composicao")))
    amb = extract_from_text(TEXTO_NUMERADO_AMBIGUO)
    falhas += _checar("segundo valor na mesma janela é AMBIGUIDADE e RECUSA o documento",
                      not (amb["fields"].get("composicao") or []),
                      str(amb["fields"].get("composicao")))
    # ⚠ O valor_total NÃO depende da composição e continua saindo nos dois casos recusados: a guia
    # segue registrável, só não prova a decomposição — que é o caminho da declaração manual.
    falhas += _checar("documento recusado mantém o valor_total (só a decomposição falta)",
                      nfecha["fields"].get("valor_total") == 1567.41
                      and amb["fields"].get("valor_total") == 1567.41)

    # ⚠ A TABELA VENCE. O fallback do formulário numerado só pode responder a documento SEM tabela;
    # se ele começar a morder o DAS/DARF com composição, a composição rica (N tributos, denominação,
    # período por linha) seria trocada por uma linha só.
    falhas += _checar("fallback numerado NÃO rouba o DAS com tabela (6 tributos preservados)",
                      len(comp) == 6, str(len(comp)))
    falhas += _checar("fallback numerado NÃO rouba o DARF com tabela (3 tributos preservados)",
                      len(compd) == 3, str(len(compd)))

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
