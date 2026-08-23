# -*- coding: utf-8 -*-
"""
Leitura POSICIONAL do relatório SITFIS — as colunas saem da GEOMETRIA do PDF, não da contagem
de linhas de um texto achatado.

⚠ FASE 0 / PROVA. Este módulo NÃO está ligado a rota nenhuma, NÃO substitui
`apps/api/src/application/fiscal/serpro/parseSitfisRelatorio.js` (que continua intacto e continua
sendo o que a produção mostra) e NÃO chama o SERPRO. Ele existe para ser confrontado com aquele
parser sobre os relatórios já guardados no banco.

⚠ NÃO ENCOSTA em `darf.py` nem em `darf_numerado.py`. Arquivo próprio, ao lado do `pdfplumber`
que já roda em produção neste serviço (0.11.10) — nenhuma dependência nova.

── POR QUE POSIÇÃO E NÃO CONTAGEM DE LINHA ─────────────────────────────────────────────────────

O parser de texto lê o PDF já achatado numa fila de linhas (uma célula por linha) e agrupa os
dados de N em N, sendo N o número de colunas do cabeçalho. Isso obriga a rede de proteção a ser
ARITMÉTICA (`dados % colunas == 0`) e cria uma classe inteira de armadilhas que só existem porque
o achatamento apagou a informação de onde cada palavra estava.

⚠ A PROVA DE QUE REMENDAR O TEXTO NÃO RESOLVE: nos DOIS blocos SIDA do MESMO PDF
(90.777.111/0001-45 — ⚠ CNPJ ANONIMIZADO, mesmo formato e comprimento do real, dígitos fabricados,
como nas fixtures de `parseSitfisRelatorio.test.js`; a observação é de produção, só o identificador
foi trocado, porque arquivo de repositório entra no histórico do git para sempre. NÃO traga o real
de volta), a coluna "Ajuizado em" é VAZIA em todos os registros. No texto achatado essa
célula vazia aparece como linha em branco num bloco e simplesmente não aparece no outro. Não há
regra no texto que diga qual é qual — contar posição vira aposta.

No PDF a mesma informação é trivial e exata: o cabeçalho imprime "Ajuizado em" começando em
x=307.92, e nenhum registro tem palavra alguma naquela faixa. **A célula vazia é um x sem palavra**
— informação, não ausência.

── O QUE A GEOMETRIA MEDIU (24 relatórios reais, 21/08/2026) ───────────────────────────────────

  · A fonte do relatório é **Courier** (monoespaçada), corpos 9, 10 e 12. Um espaço mede
    exatamente **0,6 × corpo** — 5,40 / 6,00 / 7,20 pt. Medido: 2.028 das 2.043 folgas entre
    palavras vizinhas de corpo 9 valem 5,40 pt cravados.
  · Logo, **duas palavras separadas por MAIS de um espaço estão em células diferentes**. Não é
    heurística de "espaço grande": é a largura do avanço da fonte, que o PDF declara.
  · O caso que decide o desenho: no cabeçalho de "Pendência - Débito (SIEF)", a folga entre
    "Cons." e "Situação" é de **7,00 pt** — maior que um espaço (5,40) e menor que dois (10,80).
    Ou seja, "Sdo. Dev. Cons." é UMA coluna e "Situação" é OUTRA, e a régua que separa as duas é
    a largura do espaço, não um limiar inventado.

── AS ARMADILHAS DO PARSER DE TEXTO QUE DEIXAM DE EXISTIR AQUI ─────────────────────────────────

  1. CNPJ colado na 1ª célula do cabeçalho  → aqui o CNPJ é uma LINHA própria, com y próprio.
  2. Cabeçalho da página 2 cortando a tabela → aqui é uma faixa de y fixa no topo da página.
  3. Anotação colada no registro seguinte    → aqui a anotação é uma linha própria, com y próprio.
  4. Célula partida em duas linhas           → aqui a continuação cai na MESMA faixa de x da célula.
  6. Anotação colada no título do bloco      → mesma coisa da 3.
  8. O mesmo cabeçalho com duas grafias      → irrelevante: o nome da coluna vem do PDF, e o que
                                               separa as colunas é o x, não o nome.

A armadilha 5 (receita sem código) também some: ela era um efeito da 3.

── O MODO DE FALHAR É O DE HOJE: LINHAS CRUAS COM AVISO ────────────────────────────────────────

Uma linha de débito lida errado é PIOR que uma linha não lida. Bloco que não fecha nas três provas
sai com `colunas: []`, `registros: []`, as linhas cruas em `naoInterpretado` e o motivo em `aviso`.
Ausência declarada, nunca afirmação falsa.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

import pdfplumber

# ── A FONTE DIZ QUAL É A LARGURA DE UM ESPAÇO ───────────────────────────────────────────────────
# Courier é monoespaçada e o avanço de qualquer glifo (o espaço inclusive) é 0,6 em. Medido nos 24
# relatórios: corpo 9 → 5,40 pt; corpo 10 → 6,00; corpo 12 → 7,20, sem uma exceção.
# ⚠ A tolerância de 15% cobre o arredondamento do PDF, não afrouxa a régua: a menor folga que
# PRECISA separar colunas nos 24 relatórios é 7,00 pt sobre um espaço de 5,40 (razão 1,30).
LARGURA_DO_ESPACO = 0.6
TOLERANCIA_DO_ESPACO = 1.15

# A faixa de y do cabeçalho/rodapé de página. Medido nos 24 relatórios: a mobília de página ocupa
# y de 27,9 a 97,9 em TODA página, e o conteúdo mais alto de qualquer página começa em 125,7.
# ⚠ É descarte POSICIONAL, não por texto: nenhuma palavra é julgada pelo que diz.
TOPO_DA_MOBILIA_DE_PAGINA = 110.0

# Duas palavras na mesma linha impressa têm o mesmo `top`; o relatório usa passo de 13 pt entre
# registros e 9 pt para a continuação de célula, então 2 pt de tolerância não junta linha nenhuma.
TOLERANCIA_DE_LINHA = 2.0

REGUA = re.compile(r"^_{6,}$")

ORGAOS = [
    ("RFB", re.compile(r"Diagn[óo]stico\s+Fiscal\s+na\s+Receita\s+Federal", re.I), "Receita Federal"),
    ("PGFN", re.compile(r"Diagn[óo]stico\s+Fiscal\s+na\s+Procuradoria-?Geral\s+da\s+Fazenda\s+Nacional", re.I),
     "Procuradoria-Geral da Fazenda Nacional"),
]
SEM_PENDENCIA = re.compile(r"N[ãa]o\s+foram\s+detectadas\s+pend[êe]ncias", re.I)

# ── A LISTA FECHADA SÓ RESPONDE "ONDE COMEÇA O CABEÇALHO" ───────────────────────────────────────
#
# ⚠ Ela NÃO nomeia as colunas e NÃO decide onde uma acaba e a outra começa — isso é o x.
# Ela existe porque um bloco pode imprimir DESCRIÇÃO e CABEÇALHO na mesma linha, e nada na
# geometria separa os dois: em "Pendência - Parcelamento (PARCSN/PARCMEI)" a linha traz
# `SIMPLES NACIONAL - EM PARCELAMENTO` em x=12 e `Parcelas em atraso` em x=587. É a MESMA
# autoridade que o parser de texto usa (`COLUNAS_CONHECIDAS`), e é o que faz esta leitura devolver
# aquele bloco exatamente como a produção o devolve hoje.
#
# ⚠ A DIFERENÇA PARA O PARSER DE TEXTO: lá a lista também tem de RECONHECER cada coluna, uma a uma,
# e a varredura PARA no primeiro rótulo desconhecido — é por isso que "Pendência - Inscrição (SIDA)"
# vira uma tabela de 2 colunas ("Inscrição", "Receita") e o resto do cabeçalho ("Inscrito em",
# "Ajuizado em", "Processo", "Tipo de Devedor") desaba para dentro dos dados. Aqui, achado o começo
# do cabeçalho, TODOS os grupos daquela linha são colunas — porque estar na linha do cabeçalho,
# dentro da própria faixa de x, é o que define um rótulo de coluna.
#
# ⚠ MANTER ESPELHADA com `parseSitfisRelatorio.js`. Duas listas que divirjam fariam a mesma
# empresa ser lida de dois jeitos.
COLUNAS_CONHECIDAS = {
    "Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Sdo. Devedor",
    "Vl.Original", "Sdo.Devedor",
    "Multa", "Juros", "Sdo. Dev. Cons.", "Situação",
    "Processo", "Localização",
    "Parcelas em atraso",
    "Inscrição", "Devedor", "Valor", "Tipo", "Data",
}

# ── PROVA 2: TIPO POR COLUNA ────────────────────────────────────────────────────────────────────
# Mesma lista que a TELA usa para alinhar à direita e a mesma que `diag-sitfis-tabelas.mjs` usa
# para medir. Se a tela trata como dinheiro, aqui se exige que o conteúdo seja dinheiro.
COLUNAS_VALOR = {
    "Vl. Original", "Sdo. Devedor", "Vl.Original", "Sdo.Devedor",
    "Multa", "Juros", "Sdo. Dev. Cons.", "Valor",
    "Valor em Atraso", "Valor Suspenso",
}
COLUNAS_DATA = {"Dt. Vcto", "Data"}
RE_MONETARIO = re.compile(r"^-?[\d.]+,\d{2}$")
RE_DATA = re.compile(r"^\d{2}/\d{2}/\d{4}$")


# ════════════════════════════════════════════════════════════════════════════════════════════════
# Geometria: palavras → linhas → grupos (células)
# ════════════════════════════════════════════════════════════════════════════════════════════════

def _limpar(t: str) -> str:
    return re.sub(r"[ \t]+", " ", str(t or "").replace("\xa0", " ")).strip()


def _linhas_da_pagina(pagina) -> list[list[dict]]:
    """Agrupa as palavras da página em linhas impressas, pelo `top`."""
    palavras = pagina.extract_words(extra_attrs=["size"])
    palavras = [p for p in palavras if p["top"] >= TOPO_DA_MOBILIA_DE_PAGINA]
    palavras.sort(key=lambda p: (p["top"], p["x0"]))

    linhas: list[list[dict]] = []
    for p in palavras:
        if linhas and abs(p["top"] - linhas[-1][0]["top"]) <= TOLERANCIA_DE_LINHA:
            linhas[-1].append(p)
        else:
            linhas.append([p])
    for l in linhas:
        l.sort(key=lambda p: p["x0"])
    return linhas


def _mesma_celula(esq: dict, dir_: dict) -> bool:
    """Duas palavras vizinhas pertencem à MESMA célula? A régua é a largura de um espaço."""
    espaco = LARGURA_DO_ESPACO * max(esq.get("size") or 9.0, dir_.get("size") or 9.0)
    return (dir_["x0"] - esq["x1"]) <= espaco * TOLERANCIA_DO_ESPACO


def _grupos(linha: list[dict]) -> list[dict]:
    """Quebra a linha em células, separando onde a folga passa de um espaço."""
    saida: list[dict] = []
    atual: list[dict] = []
    for p in linha:
        if atual and not _mesma_celula(atual[-1], p):
            saida.append(_fechar_grupo(atual))
            atual = []
        atual.append(p)
    if atual:
        saida.append(_fechar_grupo(atual))
    return saida


def _fechar_grupo(palavras: list[dict]) -> dict:
    return {
        "texto": _limpar(" ".join(p["text"] for p in palavras)),
        "x0": palavras[0]["x0"],
        "x1": palavras[-1]["x1"],
        "palavras": palavras,
    }


def _texto_da_linha(linha: list[dict]) -> str:
    return _limpar(" ".join(p["text"] for p in linha))


def _e_regua(p: dict) -> bool:
    return bool(REGUA.match(p["text"]))


# ════════════════════════════════════════════════════════════════════════════════════════════════
# Linhas de RÓTULO:VALOR (é o que o SIEFPAR inteiro é, e é o que a anotação de lançamento é)
# ════════════════════════════════════════════════════════════════════════════════════════════════
#
# ⚠ O RÓTULO É IMPRESSO NO PDF — não é inventado. `Parcelamento:`, `Valor em Atraso:`,
# `Situação:`, `Notificação de lançamento:`, `CNPJ:`: todos terminam em dois-pontos, e é isso que
# os identifica. Onde o rótulo começa se descobre andando para trás enquanto as palavras estiverem
# a um espaço uma da outra — a mesma régua de célula. É assim que
# `Parcelamento: <nº>   Parcelas em Atraso: 4   Valor em Atraso: 2.114,32`
# se separa em três pares, num relatório que não põe separador nenhum entre eles.

def _pares_da_linha(linha: list[dict]) -> list[tuple[str, str]] | None:
    """Lê a linha como pares rótulo/valor. `None` quando não há rótulo nenhum."""
    fins = [i for i, p in enumerate(linha) if p["text"].endswith(":")]
    if not fins:
        return None

    inicios: list[int] = []
    for f in fins:
        i = f
        while i > 0 and _mesma_celula(linha[i - 1], linha[i]):
            i -= 1
        inicios.append(i)

    pares: list[tuple[str, str]] = []
    for k, f in enumerate(fins):
        rotulo = _limpar(" ".join(p["text"] for p in linha[inicios[k]:f + 1])).rstrip(":")
        fim_do_valor = inicios[k + 1] if k + 1 < len(fins) else len(linha)
        valor = _limpar(" ".join(p["text"] for p in linha[f + 1:fim_do_valor]))
        pares.append((rotulo, valor))

    # O que sobra ANTES do primeiro rótulo não é par — volta como órfão, nunca casado por vizinhança.
    orfaos = [_limpar(" ".join(p["text"] for p in linha[:inicios[0]]))] if inicios[0] > 0 else []
    return pares, orfaos  # type: ignore[return-value]


def _e_linha_de_par(linha: list[dict]) -> bool:
    return any(p["text"].endswith(":") for p in linha)


# ════════════════════════════════════════════════════════════════════════════════════════════════
# A tabela por faixa de x
# ════════════════════════════════════════════════════════════════════════════════════════════════

class BlocoRecusado(Exception):
    """O bloco não fecha nas provas. Vira linhas cruas com aviso — nunca tabela torta."""


def _distancia(x0: float, x1: float, faixa: list[float]) -> float:
    if x1 < faixa[0]:
        return faixa[0] - x1
    if x0 > faixa[1]:
        return x0 - faixa[1]
    return 0.0


def _montar_tabela_por_x(linhas_de_grade: list[list[dict]], colunas: list[str],
                         faixas: list[list[float]]) -> tuple[list[dict], list[int]]:
    """
    Distribui as palavras de cada linha nas colunas do cabeçalho.

    ⚠ A LEITURA É DA ESQUERDA PARA A DIREITA, COM PONTEIRO QUE SÓ AVANÇA, e isso não é detalhe:
    a coluna "Receita" imprime tanto `8109-02 - PIS` (x 12→82, começando debaixo do rótulo) quanto
    `SIMPLES NAC.` (x 66→131, que passa do rótulo e chega mais perto do rótulo seguinte). Escolher
    a coluna mais próxima palavra por palavra jogaria `NAC.` em "PA/Exerc.". Lendo em ordem, a
    faixa da coluna corrente já cresceu com `SIMPLES` e `NAC.` fica onde deve.
    ⚠ O ponteiro NUNCA volta: palavra cuja coluna mais próxima já ficou para trás derruba o bloco.
    """
    registros: list[dict] = []
    de_qual_registro: list[int] = []  # para cada linha de grade, o índice do registro que ela alimenta

    for linha in linhas_de_grade:
        c = 0
        celulas: list[list[str]] = [[] for _ in colunas]
        for p in linha:
            while c + 1 < len(colunas) and \
                    _distancia(p["x0"], p["x1"], faixas[c + 1]) < _distancia(p["x0"], p["x1"], faixas[c]):
                c += 1
            # PROVA 1: nenhuma palavra pode pertencer a uma coluna que já passou.
            for anterior in range(c):
                if _distancia(p["x0"], p["x1"], faixas[anterior]) < _distancia(p["x0"], p["x1"], faixas[c]):
                    raise BlocoRecusado(
                        f"palavra {p['text']!r} em x={p['x0']:.1f} cai fora da ordem das colunas")
            celulas[c].append(p["text"])
            faixas[c][0] = min(faixas[c][0], p["x0"])
            faixas[c][1] = max(faixas[c][1], p["x1"])

        preenchidas = [i for i, c_ in enumerate(celulas) if c_]
        if not preenchidas:
            continue

        if 0 in preenchidas or not registros:
            # Palavra na PRIMEIRA coluna abre registro novo.
            registros.append({col: _limpar(" ".join(celulas[i])) for i, col in enumerate(colunas)})
            de_qual_registro.append(len(registros) - 1)
            continue

        # Continuação: a célula transbordou para a linha de baixo, DENTRO da mesma faixa de x.
        # ⚠ Só continua o que já tem começo. Continuação sobre célula vazia seria inventar valor.
        alvo = registros[-1]
        for i in preenchidas:
            if not alvo[colunas[i]]:
                raise BlocoRecusado(
                    f"linha de continuação escreveria na célula vazia {colunas[i]!r}")
            alvo[colunas[i]] = _limpar(alvo[colunas[i]] + " " + " ".join(celulas[i]))
        de_qual_registro.append(len(registros) - 1)

    # PROVA 1 (o corredor): entre duas colunas vizinhas tem de sobrar espaço em branco em TODA a
    # altura do bloco. Se o conteúdo de uma invade o da outra, a divisão não é uma divisão.
    for i in range(len(colunas) - 1):
        if faixas[i][1] >= faixas[i + 1][0]:
            raise BlocoRecusado(
                f"as colunas {colunas[i]!r} e {colunas[i + 1]!r} se sobrepõem em x "
                f"({faixas[i][1]:.1f} ≥ {faixas[i + 1][0]:.1f})")

    return registros, de_qual_registro


def _conferir_tipos(colunas: list[str], registros: list[dict]) -> None:
    """PROVA 2: data em coluna de data, dinheiro em coluna de dinheiro."""
    for r in registros:
        for col in colunas:
            v = _limpar(r.get(col) or "")
            if not v:
                continue  # célula vazia é informação — o x existe e a palavra não. Não é defeito.
            if col in COLUNAS_VALOR and not RE_MONETARIO.match(v):
                raise BlocoRecusado(f"{v!r} não é valor monetário na coluna {col!r}")
            if col in COLUNAS_DATA and not RE_DATA.match(v):
                raise BlocoRecusado(f"{v!r} não é data na coluna {col!r}")
            if col not in COLUNAS_VALOR and col not in COLUNAS_DATA and RE_MONETARIO.match(v):
                raise BlocoRecusado(f"valor monetário {v!r} numa coluna de texto ({col!r})")


# ════════════════════════════════════════════════════════════════════════════════════════════════
# O bloco
# ════════════════════════════════════════════════════════════════════════════════════════════════

def _tabela_de_pares(linhas: list[list[dict]]) -> dict | None:
    """
    A segunda forma de bloco: rótulo e valor, não cabeçalho e dados (é o SIEFPAR).

    ⚠ NÃO INVENTA PAR. Linha sem rótulo nenhum (a modalidade `Parcelamento Simplificado`, que o
    relatório imprime solta) fica FORA da tabela e volta em `naoInterpretado`.
    ⚠ E não vira tabela de pares um bloco em que o texto solto DOMINA: exige-se, no máximo, uma
    linha solta por registro — que é a forma observada do SIEFPAR (uma modalidade por
    parcelamento). Sem isso, o "Parcelamento com Exigibilidade Suspensa (SISPAR)", cujo número da
    conta e cuja descrição não têm rótulo, viraria uma tabela de modalidades sem as contas a que
    elas pertencem.
    """
    todos_pares: list[tuple[str, str]] = []
    orfaos: list[str] = []
    for linha in linhas:
        lido = _pares_da_linha(linha)
        if lido is None:
            orfaos.append(_texto_da_linha(linha))
            continue
        pares, orfaos_da_linha = lido
        todos_pares.extend(pares)
        orfaos.extend(o for o in orfaos_da_linha if o)

    if not todos_pares:
        return None

    registros: list[dict] = []
    for rotulo, valor in todos_pares:
        if not registros or rotulo in registros[-1]:
            registros.append({})
        registros[-1][rotulo] = valor

    colunas = list(registros[0].keys())
    for r in registros:
        if list(r.keys()) != colunas:
            return None  # forma diferente entre registros: derruba o bloco inteiro, como hoje
    if len(orfaos) > len(registros):
        return None

    return {"descricao": [], "colunas": colunas, "registros": registros,
            "anotacoes": [], "anotacoesPorRegistro": [], "naoInterpretado": orfaos}


def _ler_bloco(titulo: str | None, linhas: list[list[dict]]) -> dict:
    cruas = [_texto_da_linha(l) for l in linhas]

    # A linha `CNPJ: <cnpj>` é mobília do bloco — o relatório a repete embaixo de todo título.
    # O parser de texto também a descarta (era a "armadilha 1"); aqui ela é só uma linha própria.
    uteis: list[list[dict]] = []
    for l in linhas:
        lido = _pares_da_linha(l)
        if lido and len(lido[0]) == 1 and lido[0][0][0] == "CNPJ" and not lido[1]:
            continue
        uteis.append(l)

    # ── Onde começa o cabeçalho ──
    descricao: list[str] = []
    idx_cabecalho = None
    colunas: list[str] = []
    faixas: list[list[float]] = []
    for i, l in enumerate(uteis):
        if _e_linha_de_par(l):
            break  # linha de rótulo/valor não é cabeçalho de coluna
        gs = _grupos(l)
        achou = next((k for k, g in enumerate(gs) if g["texto"] in COLUNAS_CONHECIDAS), None)
        if achou is None:
            descricao.extend(g["texto"] for g in gs)
            continue
        descricao.extend(g["texto"] for g in gs[:achou])
        colunas = [g["texto"] for g in gs[achou:]]
        faixas = [[g["x0"], g["x1"]] for g in gs[achou:]]
        idx_cabecalho = i
        break

    if idx_cabecalho is None:
        # Sem cabeçalho: ou é bloco de rótulo/valor, ou é laudo em texto corrido.
        # ⚠ A leitura por pares SÓ é tentada aqui — é isso que garante que nenhum bloco que já
        # virava tabela por cabeçalho possa mudar de leitura.
        pares = _tabela_de_pares(uteis)
        if pares:
            return {"titulo": titulo, **pares}
        descricao = []
        for l in uteis:
            descricao.extend(g["texto"] for g in _grupos(l))
        return {"titulo": titulo, "descricao": descricao, "colunas": [], "registros": [],
                "anotacoes": [], "anotacoesPorRegistro": [], "naoInterpretado": []}

    if len(colunas) != len(set(colunas)):
        return _recusar(titulo, descricao, cruas, "o cabeçalho repete o nome de uma coluna")

    # ── Grade × anotações ──
    grade: list[list[dict]] = []
    anotacoes: list[str] = []
    ordem: list[tuple[str, Any]] = []
    for l in uteis[idx_cabecalho + 1:]:
        if _e_linha_de_par(l):
            lido = _pares_da_linha(l)
            pares, orfaos_da_linha = lido  # type: ignore[misc]
            if orfaos_da_linha and any(orfaos_da_linha):
                return _recusar(titulo, descricao, cruas,
                                "linha de anotação com texto solto antes do rótulo")
            ordem.append(("anotacao", pares))
            continue
        grade.append(l)
        ordem.append(("grade", l))

    try:
        registros, de_qual_registro = _montar_tabela_por_x(grade, colunas, faixas)
        _conferir_tipos(colunas, registros)
    except BlocoRecusado as e:
        return _recusar(titulo, descricao, cruas, str(e))

    # As anotações voltam na ordem impressa (é o que a produção mostra hoje) e, além disso,
    # amarradas ao registro que as precede — que é a informação que o achatamento perdia.
    por_registro: list[dict] = [{} for _ in registros]
    k = 0
    atual = -1
    for tipo, carga in ordem:
        if tipo == "grade":
            atual = de_qual_registro[k] if k < len(de_qual_registro) else atual
            k += 1
            continue
        for rotulo, valor in carga:
            anotacoes.append(valor)
            if 0 <= atual < len(por_registro):
                por_registro[atual][rotulo] = valor

    return {"titulo": titulo, "descricao": descricao, "colunas": colunas, "registros": registros,
            "anotacoes": anotacoes, "anotacoesPorRegistro": por_registro, "naoInterpretado": []}


def _recusar(titulo, descricao, cruas, motivo) -> dict:
    return {"titulo": titulo, "descricao": descricao, "colunas": [], "registros": [],
            "anotacoes": [], "anotacoesPorRegistro": [], "naoInterpretado": cruas,
            "aviso": f"bloco não conferido pela geometria: {motivo}"}


# ════════════════════════════════════════════════════════════════════════════════════════════════
# O relatório
# ════════════════════════════════════════════════════════════════════════════════════════════════

def extrair_sitfis_posicional(pdf_bytes: bytes) -> dict:
    """Lê o PDF do relatório SITFIS pela posição das palavras. Não escreve nada, não chama nada."""
    linhas: list[list[dict]] = []
    with pdfplumber.open(_como_arquivo(pdf_bytes)) as pdf:
        for pagina in pdf.pages:
            linhas.extend(_linhas_da_pagina(pagina))

    secoes: list[dict] = []
    corrente: dict | None = None
    bloco_titulo: str | None = None
    bloco_linhas: list[list[dict]] = []

    def fechar_bloco():
        nonlocal bloco_titulo, bloco_linhas
        if corrente is not None and (bloco_titulo is not None) and bloco_linhas:
            corrente["blocos"].append(_ler_bloco(bloco_titulo, bloco_linhas))
        bloco_titulo, bloco_linhas = None, []

    for l in linhas:
        texto = _texto_da_linha(l)
        marco = next((o for o in ORGAOS if o[1].search(texto)), None)
        if marco:
            fechar_bloco()
            corrente = {"orgao": marco[2], "chave": marco[0], "semPendencia": False, "blocos": []}
            secoes.append(corrente)
            continue
        if corrente is None:
            continue  # cabeçalho do relatório (dados cadastrais, sócios, certidão) — fora do diagnóstico
        if SEM_PENDENCIA.search(texto):
            corrente["semPendencia"] = True
            continue
        # Título de bloco = texto seguido de régua NA MESMA LINHA.
        reguas = [i for i, p in enumerate(l) if _e_regua(p)]
        if reguas:
            fechar_bloco()
            antes = l[:reguas[0]]
            if antes:
                bloco_titulo = _limpar(" ".join(p["text"] for p in antes))
            continue
        if bloco_titulo is not None:
            bloco_linhas.append(l)
    fechar_bloco()

    return {
        "diagnosticos": secoes,
        "leitura": "posicional",
    }


def _como_arquivo(pdf_bytes: bytes):
    import io
    return io.BytesIO(pdf_bytes)


# ── utilitário de confronto (PROVA 3), usado só por script de medição ───────────────────────────

def palavras_do_relatorio(relatorio: dict) -> list[str]:
    """Todas as palavras que a leitura posicional devolve, para confrontar com o texto atual."""
    fora: list[str] = []
    for d in relatorio.get("diagnosticos", []):
        for b in d.get("blocos", []):
            fora.extend(str(b.get("titulo") or "").split())
            for x in b.get("descricao") or []:
                fora.extend(str(x).split())
            for r in b.get("registros") or []:
                for v in r.values():
                    fora.extend(str(v).split())
            for x in b.get("anotacoes") or []:
                fora.extend(str(x).split())
            for x in b.get("naoInterpretado") or []:
                fora.extend(str(x).split())
            fora.extend(b.get("colunas") or [])
    return [_normalizar(w) for w in fora if _normalizar(w)]


def _normalizar(w: str) -> str:
    w = unicodedata.normalize("NFKD", str(w))
    return "".join(c for c in w if not unicodedata.combining(c)).strip().upper()
