// O DETECTOR DE RECORRÊNCIA — ele SUGERE, e nada do que ele devolve é gravado.
//
// ⚠⚠ O caso que decide o desenho inteiro é a TAXA ANUAL DO CONSELHO (dono, 25/08/2026): qualquer
// regra que conte MESES a expulsa do fluxo na segunda ausência. Por isso a saída conta CICLOS.

import fs from "node:fs";
import path from "node:path";
import {
  CICLOS_PARA_SAIR,
  LEITURA,
  MESES_DO_CICLO,
  PERIODICIDADE,
  PISO_DE_OBSERVACOES,
  ciclosConsecutivosNoFim,
  coeficienteDeVariacao,
  fraseDaBase,
  lerSerie,
  mediana,
  mesesDaCompetencia,
  porCiclo,
  dentroDaFaixaDaMediana,
  podeAutoAtivar,
} from "../recorrencia.js";

/** A "Claude" do exemplo do dono: 120 a 140, todo mês. */
const claude = (meses = ["2026-05", "2026-06", "2026-07"], valores = [120, 140, 130]) =>
  meses.map((competencia, i) => ({ competencia, valor: valores[i] }));

describe("⚠⚠ o exemplo do dono — 'a Claude sempre aparece com valor de 120 a 140'", () => {
  it("sugere entrada com 3 meses consecutivos, e o valor é a MEDIANA", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(r.valorProjetado).toBe(130);
  });

  it("⚠⚠ a FAIXA viaja junto — o ponto sozinho se lê como previsão precisa", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-07" });
    expect(r.base.min).toBe(120);
    expect(r.base.max).toBe(140);
    expect(fraseDaBase(r.base)).toBe("baseado em 3 observações, entre 120 e 140");
  });

  it("⚠ com 2 meses NÃO sugere — o piso é 3, decisão do dono", () => {
    const r = lerSerie({ observacoes: claude(["2026-06", "2026-07"], [120, 140]), cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.valorProjetado).toBeNull();
    // ⚠ mas a evidência viaja MESMO NA RECUSA — senão a tela não sabe dizer quanto falta
    expect(r.base.n).toBe(2);
  });
});

describe("⚠⚠ MEDIANA, nunca MÉDIA", () => {
  it("um mês com cobrança anual embutida NÃO puxa a projeção", () => {
    // 130, 130, 130, e um mês com 1.500 (a anuidade cobrada junto)
    const obs = claude(["2026-04", "2026-05", "2026-06", "2026-07"], [130, 130, 1500, 130]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-07" });
    expect(r.valorProjetado).toBe(130);
    // ⚠ a média seria 472,50 — e o fluxo mentiria para cima TODO MÊS dali em diante
    const media = (130 + 130 + 1500 + 130) / 4;
    expect(r.valorProjetado).not.toBe(media);
  });

  it("série par: a mediana é a média dos dois centrais", () => {
    expect(mediana([10, 20, 30, 40])).toBe(25);
  });

  it("⚠ lista vazia devolve `null`, não zero — zero é uma afirmação", () => {
    expect(mediana([])).toBeNull();
    expect(mediana(null)).toBeNull();
  });

  it("⚠ valores ilegíveis são descartados, não viram zero", () => {
    expect(mediana([100, "banana", 200])).toBe(150);
  });
});

describe("⚠⚠ 'CONSECUTIVAS' é o piso — 3 salteadas NÃO são recorrência", () => {
  it("jan, mar, mai não sugere — é o mesmo fornecedor aparecendo de vez em quando", () => {
    const obs = claude(["2026-01", "2026-03", "2026-05"], [130, 130, 130]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-05" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    // ⚠ são 3 observações, mas só 1 consecutiva no fim
    expect(r.base.n).toBe(3);
    expect(r.base.consecutivos).toBe(1);
  });

  it("⚠ o buraco no MEIO conta: 4 observações com furo dão 2 consecutivas", () => {
    const obs = claude(["2026-01", "2026-02", "2026-04", "2026-05"], [1, 1, 1, 1]);
    expect(ciclosConsecutivosNoFim(porCiclo(obs))).toBe(2);
  });

  it("as consecutivas são contadas DO FIM — é o presente que importa", () => {
    const obs = claude(["2026-01", "2026-02", "2026-03", "2026-06", "2026-07", "2026-08"], [1, 1, 1, 1, 1, 1]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-08" });
    expect(r.base.consecutivos).toBe(3);
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A TAXA ANUAL DO CONSELHO — o caso que quebra qualquer desenho que conte MESES.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a taxa ANUAL", () => {
  const conselho = [
    { competencia: "2024-03", valor: 900 },
    { competencia: "2025-03", valor: 950 },
    { competencia: "2026-03", valor: 1000 },
  ];

  it("três anos consecutivos SUGEREM entrada — em MESES, ela teria 1 consecutiva", () => {
    const r = lerSerie({ observacoes: conselho, periodicidade: PERIODICIDADE.ANUAL, cicloAtual: "2026-03" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(r.base.consecutivos).toBe(3);
    expect(r.valorProjetado).toBe(950);
  });

  it("⚠⚠ lida como MENSAL, a MESMA série não sugere nada — é o defeito que a periodicidade evita", () => {
    const r = lerSerie({ observacoes: conselho, periodicidade: PERIODICIDADE.MENSAL, cicloAtual: "2026-03" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.base.consecutivos).toBe(1);
  });

  it("⚠⚠ marcada, ela NÃO sai depois de 2 MESES — a saída conta CICLOS", () => {
    // dois meses depois da última cobrança anual
    const r = lerSerie({
      observacoes: conselho, periodicidade: PERIODICIDADE.ANUAL, cicloAtual: "2026-05", jaMarcada: true,
    });
    expect(r.leitura).toBe(LEITURA.CONTINUA);
  });

  it("⚠ mas SAI depois de 2 ANOS sem aparecer", () => {
    const r = lerSerie({
      observacoes: conselho, periodicidade: PERIODICIDADE.ANUAL, cicloAtual: "2028-03", jaMarcada: true,
    });
    expect(r.leitura).toBe(LEITURA.SUGERE_SAIDA);
  });

  it("trimestral usa ciclos de 3 meses", () => {
    const obs = [
      { competencia: "2026-01", valor: 300 },
      { competencia: "2026-04", valor: 300 },
      { competencia: "2026-07", valor: 300 },
    ];
    const r = lerSerie({ observacoes: obs, periodicidade: PERIODICIDADE.TRIMESTRAL, cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(MESES_DO_CICLO[PERIODICIDADE.TRIMESTRAL]).toBe(3);
  });
});

describe("⚠⚠ a saída SUGERE, nunca desmarca", () => {
  it("um ciclo faltando é pagamento que escorregou — CONTINUA", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-08", jaMarcada: true });
    expect(r.leitura).toBe(LEITURA.CONTINUA);
  });

  it("dois ciclos faltando SUGEREM a saída", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-09", jaMarcada: true });
    expect(r.leitura).toBe(LEITURA.SUGERE_SAIDA);
    expect(CICLOS_PARA_SAIR).toBe(2);
  });

  it("⚠⚠ mesmo sugerindo saída, o valor e a evidência CONTINUAM — o contador precisa decidir", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-09", jaMarcada: true });
    expect(r.valorProjetado).toBe(130);
    expect(r.base.n).toBe(3);
    expect(r.base.ciclosDesdeAUltima).toBe(2);
  });

  it("⚠ série NÃO marcada que parou há 2 ciclos não vira sugestão de entrada", () => {
    // padrão antigo: existiu, mas acabou. Oferecê-lo poria no fluxo dinheiro que não sai.
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-09" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.valorProjetado).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ MARCADA E SEM UMA ÚNICA OBSERVAÇÃO — achado por agente de verificação em 27/08/2026.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ marcada com ZERO observações NÃO diz 'continua' — isso seria afirmar sem prova", () => {
    const r = lerSerie({ observacoes: [], cicloAtual: "2026-08", jaMarcada: true });
    expect(r.leitura).toBe(LEITURA.SEM_OBSERVACAO);
    expect(r.valorProjetado).toBeNull();
  });

  it("⚠⚠ e é a resposta certa porque a SAÍDA nunca morderia: `ciclosDesdeAUltima` é null", () => {
    // Sem última observação não há de onde contar ciclos perdidos, e `null >= 2` é FALSO. Enquanto
    // este ramo não existia, a série marcada cujas notas foram todas canceladas ficava viva no
    // fluxo de caixa dizendo "continua", para sempre.
    const r = lerSerie({ observacoes: [], cicloAtual: "2026-08", jaMarcada: true });
    expect(r.base.ciclosDesdeAUltima).toBeNull();
    expect(r.base.n).toBe(0);
    expect(null >= CICLOS_PARA_SAIR).toBe(false);
  });

  it("⚠ observação que não vira ciclo (valor ilegível) cai no mesmo ramo — não em 'continua'", () => {
    const r = lerSerie({
      observacoes: [{ competencia: "2026-07", valor: "abc" }],
      cicloAtual: "2026-08",
      jaMarcada: true,
    });
    expect(r.leitura).toBe(LEITURA.SEM_OBSERVACAO);
  });
});

describe("⚠⚠ duas notas no MESMO ciclo somam, não contam duas", () => {
  it("o N fala de CICLOS, não de notas", () => {
    const obs = [
      { competencia: "2026-05", valor: 60 }, { competencia: "2026-05", valor: 70 },
      { competencia: "2026-06", valor: 65 }, { competencia: "2026-06", valor: 65 },
      { competencia: "2026-07", valor: 130 },
    ];
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-07" });
    // 5 notas, 3 ciclos
    expect(r.base.n).toBe(3);
    // ⚠ e a mediana fala de "valor por MÊS" (130), não "valor por nota" (65)
    expect(r.valorProjetado).toBe(130);
  });
});

describe("⚠ o que NÃO vira observação", () => {
  it("⚠⚠ sem competência ou sem valor NÃO vira ciclo com ZERO", () => {
    const obs = [
      { competencia: "2026-05", valor: 130 },
      { competencia: null, valor: 130 },
      { competencia: "2026-06", valor: null },
      { competencia: "banana", valor: 130 },
    ];
    expect(porCiclo(obs)).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ A GUARDA DE VALOR É POR **TIPO**, e a versão por VALOR saía incompleta.
  //
  // Medido por agente de verificação em 27/08/2026 contra a primeira versão (`v == null || v ===
  // ""`): `[]`, `false` e `" "` PASSAVAM e fabricavam um ciclo de valor `0` — e o comentário do
  // arquivo afirmava cobrir `[]`. Cada caso abaixo é um desses.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string vazia", ""],
    ["texto", "abc"],
    ["objeto", {}],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["⚠⚠ array vazio — `Number([])` é 0, e 0 é finito", []],
    ["⚠⚠ false — `Number(false)` é 0", false],
    ["⚠⚠ só espaço — `Number(\" \")` é 0", " "],
    ["⚠ true — viraria um ciclo de valor 1", true],
    ["⚠ array de um número — `Number([5])` é 5", [5]],
  ])("⚠⚠ %s NÃO vira ciclo", (_nome, valor) => {
    expect(porCiclo([{ competencia: "2026-01", valor }])).toHaveLength(0);
  });

  it("⚠ mas número e string numérica entram — inclusive negativo e zero DECLARADO", () => {
    expect(porCiclo([{ competencia: "2026-01", valor: 130 }])[0].valor).toBe(130);
    expect(porCiclo([{ competencia: "2026-01", valor: "130.50" }])[0].valor).toBe(130.5);
    // ⚠ zero que alguém escreveu É uma afirmação, e entra. O que a guarda recusa é o zero FABRICADO
    // por coerção de um valor que não é número — a distinção do `folhaAusenteNaoEZero`.
    expect(porCiclo([{ competencia: "2026-01", valor: 0 }])[0].valor).toBe(0);
    expect(porCiclo([{ competencia: "2026-01", valor: -40 }])[0].valor).toBe(-40);
  });

  it("⚠ o `Decimal` do Prisma entra pelo `toString` — sem este módulo importar o Prisma", () => {
    // dublê com a mesma forma: objeto com `toString` próprio devolvendo a casa decimal.
    const decimal = { toString: () => "1250.75" };
    expect(porCiclo([{ competencia: "2026-01", valor: decimal }])[0].valor).toBe(1250.75);
  });

  it("⚠ mês fora de 1..12 não é competência", () => {
    expect(mesesDaCompetencia("2026-13")).toBeNull();
    expect(mesesDaCompetencia("2026-00")).toBeNull();
    expect(mesesDaCompetencia("2026-7")).toBeNull();
  });

  it("⚠⚠ competência SÓ como string — `String([\"2026-05\"])` é `\"2026-05\"`", () => {
    expect(mesesDaCompetencia(["2026-05"])).toBeNull();
    expect(mesesDaCompetencia(null)).toBeNull();
    expect(mesesDaCompetencia(202605)).toBeNull();
  });

  it("⚠ ciclo repetido no FIM não subconta os consecutivos", () => {
    // `porCiclo` deduplica por Map, mas a função é exportada e o próximo consumidor pode não.
    expect(ciclosConsecutivosNoFim([{ ciclo: 5 }, { ciclo: 6 }, { ciclo: 6 }])).toBe(2);
    expect(ciclosConsecutivosNoFim([{ ciclo: 5 }, { ciclo: 5 }, { ciclo: 6 }])).toBe(2);
  });

  it("⚠⚠ periodicidade fora da lista fechada RECUSA — nunca cai em MENSAL em silêncio", () => {
    // Era `MESES_DO_CICLO[p] || 1`: "SEMESTRAL" rodava com passo 1 e a evidência ecoava
    // `periodicidade: "SEMESTRAL"` — a base afirmando uma periodicidade que não foi a usada.
    expect(() => porCiclo([{ competencia: "2026-01", valor: 1 }], "SEMESTRAL")).toThrow(/SEMESTRAL/);
    expect(() => lerSerie({ observacoes: [], cicloAtual: "2026-01", periodicidade: "SEMESTRAL" }))
      .toThrow(/SEMESTRAL/);
  });

  it("⚠ a aritmética é de STRING — `Date` às 22h de Brasília daria o mês seguinte", () => {
    expect(mesesDaCompetencia("2026-01")).toBe(2026 * 12);
    expect(mesesDaCompetencia("2026-12") - mesesDaCompetencia("2026-01")).toBe(11);
    expect(mesesDaCompetencia("2027-01") - mesesDaCompetencia("2026-12")).toBe(1);
  });
});

describe("⚠ o coeficiente de variação — evidência, não gatilho", () => {
  it("série estável tem CV baixo", () => {
    expect(coeficienteDeVariacao([130, 130, 130])).toBe(0);
  });

  it("⚠ média ZERO devolve `null`, não Infinity — sem base não há proporção", () => {
    expect(coeficienteDeVariacao([-10, 10])).toBeNull();
  });

  it("⚠ uma observação só não tem variação a medir", () => {
    expect(coeficienteDeVariacao([130])).toBeNull();
  });

  it("⚠⚠ ele NÃO decide nada — série instável ainda SUGERE, com o CV à vista", () => {
    const obs = claude(["2026-05", "2026-06", "2026-07"], [10, 500, 90]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(r.base.cv).toBeGreaterThan(1);
  });
});

describe("⚠⚠ o detector é PURO — nada do que ele devolve é gravado", () => {
  const FONTE = fs.readFileSync(path.join(__dirname, "..", "recorrencia.js"), "utf8");

  it("não importa prisma, não escreve, não olha o relógio", () => {
    // ⚠ Os comentários saem ANTES da varredura: este arquivo CITA `new Date()` para explicar por
    // que não o usa, e a primeira versão do teste casou com a própria explicação. Varredura que
    // acusa o comentário que a justifica não prova nada.
    const codigo = FONTE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    // ⚠⚠ A PROVA MAIS FORTE É A MAIS BARATA: **este arquivo não importa NADA.**
    //
    // A lista de proibições abaixo era a única prova, e agente de verificação mediu, em 27/08/2026,
    // que ela é contornável de sete jeitos — inclusive por `import { prisma } from "…/db/X.js"`,
    // cujo caminho não contém a palavra "prisma". Enumerar o proibido sempre perde um; exigir zero
    // importações é fechado por construção, e é o estado real do arquivo hoje.
    expect(codigo).not.toMatch(/^\s*import\s/m);
    expect(codigo).not.toMatch(/\brequire\s*\(/);
    expect(codigo).not.toMatch(/\bimport\s*\(/);
    // ⚠ contraprova: a varredura reconhece uma importação quando ela existe de verdade.
    expect('import { prisma } from "../db/ClientRepository.js";').toMatch(/^\s*import\s/m);

    // ⚠ A lista de proibições fica como REFORÇO — ela pega o que se escreveria sem importar nada
    // (um `globalThis.prisma`, um relógio). ⚠ `Many` entra: `\.update\(` NÃO casa `.updateMany(`.
    expect(codigo).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(|\$transaction|\$executeRaw|\$queryRaw/);
    // ⚠ o "agora" é INJETADO (`cicloAtual`): um relógio aqui faria o mesmo dado dar respostas
    // diferentes em dias diferentes, e `baseDaObservacao` deixaria de ser reproduzível.
    // ⚠ `Date()` SEM `new` também é relógio, e passava.
    expect(codigo).not.toMatch(/\bnew\s+Date\s*\(\s*\)/);
    expect(codigo).not.toMatch(/\bDate\.now\s*\(/);
    expect(codigo).not.toMatch(/\bperformance\.now\s*\(|\bprocess\.hrtime\b|\bTemporal\.Now\b/);
    // ⚠ contraprova: a varredura reconhece o padrão quando ele existe de verdade
    expect("const agora = new Date();").toMatch(/\bnew\s+Date\s*\(\s*\)/);
    expect("await prisma.x.updateMany({});").toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
  });

  it("⚠ o vocabulário de periodicidade é o do projeto, não um segundo", () => {
    const gerar = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "obrigacoes", "gerarOcorrencias.js"),
      "utf8",
    );
    // ⚠⚠ A AMARRAÇÃO É CONTRA O **ARRAY**, NUNCA CONTRA O TEXTO DO ARQUIVO.
    //
    // Ela era `expect(gerar).toContain('"MENSAL"')`. Agente de verificação executou o experimento em
    // 27/08/2026: trocando `PERIODICIDADES` por `[]`, os três **continuavam passando** — porque as
    // três palavras aparecem no JSDoc da linha 20 (`@param {"MENSAL"|"TRIMESTRAL"|"ANUAL"}`) e no
    // corpo (`p !== "MENSAL"`). É exatamente o defeito consertado dez linhas acima, reintroduzido
    // na direção oposta: ali o comentário ACUSAVA, aqui ele SUSTENTAVA uma amarração vazia.
    const linha = /export const PERIODICIDADES\s*=\s*\[([^\]]*)\]/.exec(gerar);
    expect(linha).not.toBeNull();
    const deLa = linha[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

    // ⚠⚠ NOS DOIS SENTIDOS. Só um sentido não pega o caso real: alguém acrescenta `SEMESTRAL` ao
    // vocabulário das OBRIGAÇÕES e este módulo continua sem ele, em silêncio — que é o lado por onde
    // a divergência de fato começaria, porque aquele arquivo é o dono do vocabulário.
    expect([...deLa].sort()).toEqual([...Object.values(PERIODICIDADE)].sort());

    // ⚠ E cada um precisa ter um passo em meses — sem isso, `lerSerie` recusa em runtime.
    for (const p of deLa) expect(MESES_DO_CICLO[p]).toBeGreaterThan(0);
  });

  it("⚠ o piso e a saída são os do plano", () => {
    expect(PISO_DE_OBSERVACOES).toBe(3);
    expect(CICLOS_PARA_SAIR).toBe(2);
  });
});

describe("⚠ o vazio", () => {
  it("sem observações não quebra e não inventa", () => {
    const r = lerSerie({ observacoes: [], cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.valorProjetado).toBeNull();
    expect(r.base.mediana).toBeNull();
    expect(fraseDaBase(r.base)).toBeNull();
  });

  it("⚠ sem `cicloAtual`, `ciclosDesdeAUltima` é `null` — nunca 0", () => {
    const r = lerSerie({ observacoes: claude() });
    // 0 significaria "aconteceu neste ciclo", que é uma afirmação
    expect(r.base.ciclosDesdeAUltima).toBeNull();
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
  });

  it("⚠ chamada sem argumento nenhum não estoura", () => {
    expect(() => lerSerie()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A FAIXA DOS 10% — a série que entra no fluxo SEM o clique do contador (29/08/2026).
//
// > Dono: *"se a variação for = ou menor que 10%, pode ser lançado no fluxo automaticamente."*
// > Os 10% governam ***"a entrada no FLUXO (a projeção)"***, medidos ***"contra a MEDIANA"***.
//
// ⚠⚠ ISTO REVERTE A DECISÃO DE 25/08/2026 (*"a trava é a decisão dele, não o número"*). O que estes
// casos travam é o que sobrou dela: o piso de 3 continua, e o critério é o MAIS ESTRITO dos dois
// possíveis — para algo que dispensa a confirmação de uma pessoa.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ dentroDaFaixaDaMediana", () => {
  it("⚠⚠ A SÉRIE DA LENTE NÃO PASSA — é o caso que separa a faixa do `cv`", () => {
    // 1.000 · 1.050 · 1.180: mediana 1.050, faixa 945–1.155. O 1.180 fica FORA.
    // ⚠ Pelo coeficiente de variação (≈ 8,6%) ela passaria — e é por isso que a escolha entre os
    // dois é uma DECISÃO, não uma escolha de fórmula. O Alessandro Nigro continua pedindo o clique.
    expect(dentroDaFaixaDaMediana([1000, 1050, 1180])).toBe(false);
    expect(coeficienteDeVariacao([1000, 1050, 1180])).toBeLessThan(0.10);
  });

  it("uma série estável passa", () => {
    expect(dentroDaFaixaDaMediana([1000, 1050, 1020])).toBe(true);
  });

  it("⚠⚠ TODAS as observações precisam caber — não a média, não a maioria", () => {
    // Uma única fora já significa que a série não é estável o bastante para entrar sem ninguém olhar.
    expect(dentroDaFaixaDaMediana([1000, 1000, 1000, 1000, 2000])).toBe(false);
  });

  it("⚠ a borda EXATA passa — o dono disse *igual ou menor que 10%*", () => {
    expect(dentroDaFaixaDaMediana([900, 1000, 1100])).toBe(true);
    expect(dentroDaFaixaDaMediana([899.99, 1000, 1100])).toBe(false);
  });

  it("⚠⚠ sem observação NÃO passa — 'não sei' nunca vira 'pode entrar sozinha'", () => {
    expect(dentroDaFaixaDaMediana([])).toBe(false);
    expect(dentroDaFaixaDaMediana(null)).toBe(false);
  });

  it("⚠⚠ mediana ZERO não abre faixa — `0 ± 10%` é o próprio zero", () => {
    // Mesmo cuidado do `d > 0` da alíquota: zero no denominador não produz proporção.
    expect(dentroDaFaixaDaMediana([0, 0, 0])).toBe(false);
  });

  it("⚠ valor não numérico é descartado, não vira zero", () => {
    expect(dentroDaFaixaDaMediana([1000, 1050, null, 1020])).toBe(true);
  });
});

describe("⚠⚠ podeAutoAtivar exige as DUAS coisas", () => {
  it("faixa boa mas POUCA observação não auto-ativa", () => {
    // O piso de 3 é de 25/08 e continua: afrouxá-lo faria a projeção entrar sozinha em cima de
    // menos evidência do que o desenho exigia com o contador olhando.
    expect(podeAutoAtivar({ n: 2, valores: [1000, 1010] })).toBe(false);
  });

  it("observações bastantes mas faixa larga não auto-ativa", () => {
    expect(podeAutoAtivar({ n: 3, valores: [1000, 1050, 1180] })).toBe(false);
  });

  it("as duas ⇒ auto-ativa", () => {
    expect(podeAutoAtivar({ n: 3, valores: [1000, 1050, 1020] })).toBe(true);
  });

  it("⚠ base ausente ou torta não auto-ativa nada", () => {
    expect(podeAutoAtivar(null)).toBe(false);
    expect(podeAutoAtivar({})).toBe(false);
    expect(podeAutoAtivar({ n: 5 })).toBe(false);
  });

  it("⚠⚠ e ela NÃO decide lançamento nenhum — só a ENTRADA NO FLUXO", () => {
    // O lançamento contábil tem outro portão (a faixa `valorMin`/`valorMax` da regra do fornecedor)
    // e outra trava (a flag do ambiente). Uma varredura da fonte prova que esta lib não os conhece.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "recorrencia.js"), "utf8")
      // ⚠ BLOCO antes de LINHA: um `//` dentro de um comentário de bloco apaga o `*/`. E a
      // varredura é sobre o CÓDIGO — o comentário que EXPLICA a fronteira não pode derrubá-la.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(fonte).not.toMatch(/AccountingEntry|accountingEntry|lancaSozinha|INTEGRACAO_/);
  });
});

describe("⚠ os VALORES viajam na base — `min`/`max`/`mediana` não bastam", () => {
  it("duas séries com os mesmos resumos e faixas diferentes", () => {
    // 900 · 1.050 · 1.200 e 1.045 · 1.050 · 1.055 têm mediana 1.050; só a segunda cabe em ±10%.
    expect(dentroDaFaixaDaMediana([900, 1050, 1200])).toBe(false);
    expect(dentroDaFaixaDaMediana([1045, 1050, 1055])).toBe(true);
  });
});
