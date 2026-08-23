# -*- coding: utf-8 -*-
"""
A PROVA da leitura posicional do SITFIS: antes × depois, bloco a bloco, sobre os relatórios REAIS.

    # 1) tirar os PDFs do banco (só leitura, ZERO chamada ao SERPRO — o PDF está no rawPayload):
    railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/exportar-sitfis-prova.mjs --destino=<pasta FORA do repo>'

    # 2) confrontar as duas leituras:
    python apps/pdf-reader/prova_sitfis_posicional.py <a mesma pasta>

⚠ SÓ LEITURA. Não grava nada, não chama nada, não liga nada em produção.
⚠ A pasta tem de ficar FORA do repositório: os PDFs trazem CNPJ, sócios e débitos reais.

── O CRITÉRIO DE ACEITE, DECIDIDO PELO DONO ANTES DE RODAR ─────────────────────────────────────
Todo bloco que HOJE sai como tabela certa tem de sair IDÊNTICO (título, descrição, colunas,
registros, anotações, linhas cruas). Um só diferente e a abordagem volta para a mesa.

── AS TRÊS PROVAS DE FIDELIDADE ────────────────────────────────────────────────────────────────
 1. cada palavra cai dentro da faixa x de UMA coluna do cabeçalho — está DENTRO do extrator
    (`_montar_tabela_por_x`), e sobrar palavra fora recusa o bloco;
 2. tipo por coluna (data em coluna de data, dinheiro em coluna de dinheiro) — idem
    (`_conferir_tipos`);
 3. confronto com o parser de texto — é o que este script faz, comparando o MULTICONJUNTO DE
    CARACTERES de cada bloco nas duas leituras. Palavra colada num lado e separada no outro não
    conta como divergência (o achatamento cola de verdade: `MULTAISOLADA`); caractere PERDIDO ou
    INVENTADO conta.
"""

from __future__ import annotations

import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.extractors.sitfis_posicional import extrair_sitfis_posicional  # noqa: E402

# O console do Windows abre em cp1252 e engasga no "→" e nos acentos do relatório.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CAMPOS_COMPARADOS = ["titulo", "descricao", "colunas", "registros", "anotacoes", "naoInterpretado"]


def estado(bloco: dict) -> str:
    if (bloco.get("colunas") or []) and (bloco.get("registros") or []):
        return "TABELA"
    if bloco.get("naoInterpretado"):
        return "LINHAS CRUAS"
    return "SÓ DESCRIÇÃO"


def _j(bloco: dict, campo: str) -> str:
    vazio = None if campo == "titulo" else []
    return json.dumps(bloco.get(campo) or vazio, ensure_ascii=False, sort_keys=True)


def _caracteres(bloco: dict, com_rotulos: bool) -> collections.Counter:
    partes = [str(x) for x in (bloco.get("descricao") or []) + (bloco.get("colunas") or [])]
    for r in bloco.get("registros") or []:
        partes += [str(v) for v in r.values()]
    partes += [str(x) for x in (bloco.get("anotacoes") or [])]
    partes += [str(x) for x in (bloco.get("naoInterpretado") or [])]
    if com_rotulos:
        for pr in bloco.get("anotacoesPorRegistro") or []:
            partes += list(pr.keys())
    return collections.Counter("".join(partes).replace(" ", "").replace("\xa0", ""))


def main(pasta: str) -> int:
    indice = json.load(open(os.path.join(pasta, "index.json"), encoding="utf-8"))

    transicoes: collections.Counter = collections.Counter()
    identicos = divergentes = 0
    quebras: list[str] = []
    ganhos: list[str] = []
    inalterados: list[str] = []
    prova3_iguais = prova3_dif = 0
    residuo: collections.Counter = collections.Counter()

    for e in indice:
        base = e["base"]
        velho = json.load(open(os.path.join(pasta, base + ".json"), encoding="utf-8"))
        if not velho:
            continue
        with open(os.path.join(pasta, base + ".pdf"), "rb") as fh:
            novo = extrair_sitfis_posicional(fh.read())
        por_chave = {d["chave"]: d for d in novo.get("diagnosticos", [])}

        for d in velho.get("diagnosticos", []):
            antes = d.get("blocos") or []
            depois = (por_chave.get(d["chave"]) or {}).get("blocos") or []
            if len(antes) != len(depois):
                quebras.append(f"[{base}] {d['chave']}: {len(antes)} blocos no texto × {len(depois)} na posição")
                continue
            for a, b in zip(antes, depois):
                ea, eb = estado(a), estado(b)
                transicoes[f"{ea} → {eb}"] += 1
                rotulo = f"[{base}] {d['chave']} · {a.get('titulo')}"

                if ea == "TABELA":
                    dif = [c for c in CAMPOS_COMPARADOS if _j(a, c) != _j(b, c)]
                    if dif:
                        divergentes += 1
                        quebras.append(f"{rotulo}: DIVERGE em {dif}")
                        for c in dif:
                            quebras.append(f"      texto  : {_j(a, c)[:400]}")
                            quebras.append(f"      posição: {_j(b, c)[:400]}")
                    else:
                        identicos += 1
                elif eb == "TABELA":
                    ganhos.append(f"{rotulo}: {len(b['registros'])} registro(s) · colunas {b['colunas']}")
                else:
                    inalterados.append(f"{rotulo}: {ea} → {eb}"
                                       + (f"  ({b['aviso']})" if b.get("aviso") else ""))

                ca, cb = _caracteres(a, False), _caracteres(b, True)
                if ca == cb:
                    prova3_iguais += 1
                else:
                    prova3_dif += 1
                    residuo.update(ca - cb)
                    so_na_posicao = cb - ca
                    if so_na_posicao:
                        # Rótulo de anotação que o parser de texto joga fora não é caractere
                        # inventado — é o que o PDF imprime. Fica anotado, não escondido.
                        quebras.append(f"{rotulo}: só na posição {dict(so_na_posicao.most_common(6))}")

    print(f"\n=== SITFIS · PROVA POSICIONAL · {len(indice)} relatórios ===\n")
    print("--- ANTES → DEPOIS, bloco a bloco ---")
    for k, v in sorted(transicoes.items()):
        print(f"  {k:32} {v}")

    print(f"\n--- CRITÉRIO DE ACEITE (blocos que HOJE saem como tabela) ---")
    print(f"  IDÊNTICOS ....... {identicos}")
    print(f"  DIVERGENTES ..... {divergentes}   <== um só já derruba a abordagem")

    print(f"\n--- BLOCOS QUE PASSARAM A VIRAR TABELA ({len(ganhos)}) ---")
    for g in ganhos:
        print("  " + g)

    print(f"\n--- BLOCOS QUE CONTINUAM SEM VIRAR TABELA ({len(inalterados)}) ---")
    for i in inalterados:
        print("  " + i)

    print(f"\n--- PROVA 3 · mesmas palavras nas duas leituras ---")
    print(f"  blocos com conteúdo idêntico caractere a caractere: {prova3_iguais}")
    print(f"  blocos com resíduo ..............................: {prova3_dif}")
    print(f"  caracteres que o TEXTO tem e a POSIÇÃO não tem ...: {dict(residuo)}")

    if quebras:
        print(f"\n--- DETALHE ---")
        for q in quebras:
            print("  " + q)

    return 1 if divergentes else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
