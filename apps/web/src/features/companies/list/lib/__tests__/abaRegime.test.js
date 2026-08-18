// QUAL ABA ESTA EMPRESA OCUPA — a regra, sozinha.
//
// ⚠ O QUE ESTE TESTE EXISTE PARA IMPEDIR
// O pedido do dono foi "duas tabelas, uma para presumido e outra simples nacional". Duas abas
// FIXAS fariam a empresa sem regime cadastrado — ou de Lucro Real, ou MEI — desaparecer da página
// principal sem nada dizendo que ela existe. É a mesma classe de defeito que `acoesDaSelecao` trata
// quando recusa afirmar que uma empresa sem regime apura ou não apura. Por isso a terceira aba, e
// por isso ela só aparece quando tem gente dentro.

import {
  ABA_OUTROS, ABA_PADRAO, ABA_PRESUMIDO, ABA_SIMPLES,
  abaDaEmpresa, abasVisiveis, contarPorAba, corDaAba, corRegime,
  descricaoDoRegime, empresasDaAba, normalizarAba, regimeDe, rotuloAba,
} from "../abaRegime";

const empresa = (regime, over = {}) => ({
  companyId: over.companyId || "c1",
  razao: over.razao || "ACME LTDA",
  legacyCompany: regime === undefined ? {} : { regimeTributario: regime },
  ...over,
});

describe("de onde o regime é lido", () => {
  test("⚠ o regime mora em `legacyCompany` — o topo do payload NÃO tem o campo", () => {
    expect(regimeDe({ legacyCompany: { regimeTributario: "SIMPLES" } })).toBe("SIMPLES");
  });

  test("o topo é FALLBACK, para as telas/mocks que montam a linha na outra forma", () => {
    expect(regimeDe({ regimeTributario: "LUCRO_PRESUMIDO" })).toBe("LUCRO_PRESUMIDO");
  });

  test("normaliza caixa e espaço — o banco é texto livre (`String?`), não enum", () => {
    expect(regimeDe({ legacyCompany: { regimeTributario: "  simples " } })).toBe("SIMPLES");
  });

  test("sem regime devolve string vazia, não `undefined` — quem lê compara com ''", () => {
    expect(regimeDe({})).toBe("");
    expect(regimeDe(null)).toBe("");
  });
});

describe("em que aba a empresa cai", () => {
  test("as duas do pedido do dono", () => {
    expect(abaDaEmpresa(empresa("SIMPLES"))).toBe(ABA_SIMPLES);
    expect(abaDaEmpresa(empresa("LUCRO_PRESUMIDO"))).toBe(ABA_PRESUMIDO);
  });

  test("⚠ EMPRESA SEM REGIME NÃO SOME — vai para `OUTROS`, nunca para o Simples", () => {
    expect(abaDaEmpresa(empresa(null))).toBe(ABA_OUTROS);
    expect(abaDaEmpresa(empresa(undefined))).toBe(ABA_OUTROS);
    expect(abaDaEmpresa({})).toBe(ABA_OUTROS);
  });

  test("os regimes que o cadastro aceita e a página principal não separa também vão para `OUTROS`", () => {
    expect(abaDaEmpresa(empresa("LUCRO_REAL"))).toBe(ABA_OUTROS);
    expect(abaDaEmpresa(empresa("MEI"))).toBe(ABA_OUTROS);
    expect(abaDaEmpresa(empresa("OUTRO"))).toBe(ABA_OUTROS);
  });

  test("⚠ o critério é o MESMO de `acoesDaSelecao` (só `SIMPLES` exato): valor parecido não vira Simples", () => {
    // Se a aba fosse tolerante, a empresa cairia na aba do Simples e a barra de seleção da mesma
    // tela a recusaria dizendo "Lucro Presumido/Real". Em `OUTROS` a linha diz qual é o regime.
    expect(abaDaEmpresa(empresa("SIMPLES_NACIONAL"))).toBe(ABA_OUTROS);
  });
});

describe("a linha de `Outros` DIZ o que a empresa é", () => {
  test("regime conhecido sai com o rótulo do vocabulário, não com o enum cru", () => {
    expect(descricaoDoRegime(empresa("LUCRO_REAL"))).toBe("Lucro Real");
    expect(descricaoDoRegime(empresa("LUCRO_PRESUMIDO"))).toBe("Presumido");
  });

  test("⚠ ausência vira FRASE, não espaço em branco", () => {
    expect(descricaoDoRegime(empresa(null))).toBe("Sem regime cadastrado");
    expect(descricaoDoRegime({})).toBe("Sem regime cadastrado");
  });

  test("valor desconhecido é humanizado — enum cru nunca chega à tela", () => {
    expect(descricaoDoRegime(empresa("REGIME_NOVO"))).toBe("Regime novo");
  });
});

describe("cor de regime é cor de CATEGORIA", () => {
  test("⚠ só tokens `--accent-*`; nenhum `--state-*` (regime não é pendência nem conclusão)", () => {
    const cores = [
      corRegime("SIMPLES"), corRegime("LUCRO_PRESUMIDO"), corRegime("LUCRO_REAL"),
      corRegime(null), corDaAba(ABA_SIMPLES), corDaAba(ABA_PRESUMIDO), corDaAba(ABA_OUTROS),
    ];
    for (const cor of cores) {
      expect(cor).not.toMatch(/--state-/);
      expect(cor).toMatch(/^var\(--/); // nada de hex literal
    }
  });

  test("as mesmas cores que o card já usava — ciano Simples, laranja Presumido", () => {
    expect(corRegime("SIMPLES")).toBe("var(--accent-cyan)");
    expect(corRegime("LUCRO_PRESUMIDO")).toBe("var(--accent-orange)");
  });

  test("`Outros` é heterogênea — não empresta a cor de nenhum regime que contém", () => {
    expect(corDaAba(ABA_OUTROS)).toBe("var(--text-faint)");
  });
});

describe("as contagens saem da lista que a tabela vai mostrar", () => {
  const carteira = [
    empresa("SIMPLES", { companyId: "a" }),
    empresa("SIMPLES", { companyId: "b" }),
    empresa("LUCRO_PRESUMIDO", { companyId: "c" }),
    empresa(null, { companyId: "d" }),
  ];

  test("conta cada aba", () => {
    expect(contarPorAba(carteira)).toEqual({
      [ABA_SIMPLES]: 2, [ABA_PRESUMIDO]: 1, [ABA_OUTROS]: 1,
    });
  });

  test("a soma das abas é a lista inteira — ninguém fica fora de todas", () => {
    const c = contarPorAba(carteira);
    expect(c[ABA_SIMPLES] + c[ABA_PRESUMIDO] + c[ABA_OUTROS]).toBe(carteira.length);
  });

  test("lista vazia devolve zeros, não `undefined`", () => {
    expect(contarPorAba([])).toEqual({ [ABA_SIMPLES]: 0, [ABA_PRESUMIDO]: 0, [ABA_OUTROS]: 0 });
    expect(contarPorAba(null)).toEqual({ [ABA_SIMPLES]: 0, [ABA_PRESUMIDO]: 0, [ABA_OUTROS]: 0 });
  });

  test("`empresasDaAba` devolve exatamente as linhas daquela aba", () => {
    expect(empresasDaAba(carteira, ABA_SIMPLES).map((e) => e.companyId)).toEqual(["a", "b"]);
    expect(empresasDaAba(carteira, ABA_OUTROS).map((e) => e.companyId)).toEqual(["d"]);
  });
});

describe("quais abas são desenhadas", () => {
  test("⚠ `Outros` NÃO aparece quando está vazia — é o estado de hoje (33 empresas, zero fora dos dois)", () => {
    const abas = abasVisiveis({ [ABA_SIMPLES]: 22, [ABA_PRESUMIDO]: 11, [ABA_OUTROS]: 0 });
    expect(abas.map((a) => a.key)).toEqual([ABA_SIMPLES, ABA_PRESUMIDO]);
  });

  test("⚠ `Outros` APARECE assim que houver uma empresa nela — ninguém some da página principal", () => {
    const abas = abasVisiveis({ [ABA_SIMPLES]: 22, [ABA_PRESUMIDO]: 11, [ABA_OUTROS]: 1 });
    expect(abas.map((a) => a.key)).toEqual([ABA_SIMPLES, ABA_PRESUMIDO, ABA_OUTROS]);
    expect(abas[2].contagem).toBe(1);
    // A aba que denuncia o inesperado precisa dizer o que ela é.
    expect(abas[2].title).toMatch(/sem regime cadastrado/i);
  });

  test("as duas fixas ficam mesmo zeradas — aba que some faria parecer que a carteira não tem aquele regime", () => {
    const abas = abasVisiveis({ [ABA_SIMPLES]: 0, [ABA_PRESUMIDO]: 0, [ABA_OUTROS]: 0 });
    expect(abas.map((a) => a.key)).toEqual([ABA_SIMPLES, ABA_PRESUMIDO]);
    expect(abas.every((a) => a.contagem === 0)).toBe(true);
  });

  test("os rótulos são os nomes por extenso, não o enum", () => {
    expect(rotuloAba(ABA_SIMPLES)).toBe("Simples Nacional");
    expect(rotuloAba(ABA_PRESUMIDO)).toBe("Lucro Presumido");
    expect(rotuloAba(ABA_OUTROS)).toBe("Outros");
    expect(rotuloAba("qualquer-coisa")).toBe("Simples Nacional");
  });
});

describe("a aba guardada não pode apontar para uma aba que não existe", () => {
  test("as duas fixas valem sempre", () => {
    expect(normalizarAba(ABA_PRESUMIDO, { [ABA_OUTROS]: 0 })).toBe(ABA_PRESUMIDO);
    expect(normalizarAba(ABA_SIMPLES, {})).toBe(ABA_SIMPLES);
  });

  test("⚠ `Outros` guardada + `Outros` vazia ⇒ cai no padrão (senão a tabela ficaria vazia sem aba marcada)", () => {
    expect(normalizarAba(ABA_OUTROS, { [ABA_OUTROS]: 0 })).toBe(ABA_PADRAO);
  });

  test("`Outros` guardada continua valendo enquanto houver alguém nela", () => {
    expect(normalizarAba(ABA_OUTROS, { [ABA_OUTROS]: 2 })).toBe(ABA_OUTROS);
  });

  test("lixo no localStorage não quebra a tela", () => {
    expect(normalizarAba("SIMPLES_NACIONAL", {})).toBe(ABA_PADRAO);
    expect(normalizarAba(null, {})).toBe(ABA_PADRAO);
    expect(normalizarAba(undefined, {})).toBe(ABA_PADRAO);
  });
});
