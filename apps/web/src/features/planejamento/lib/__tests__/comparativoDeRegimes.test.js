// O COMPARATIVO LADO A LADO — e as três regras de honestidade da tabela.
//
// Pedido do dono (25/08/2026): "Quatro colunas lado a lado (Simples III · Simples V · Presumido ·
// Real), com total anual, alíquota efetiva e composição por tributo. No Presumido, decompor (…)
// mais INSS patronal sobre a folha — que no Simples está dentro do DAS."
//
// ⚠⚠ E ELE APONTOU A COISA CERTA: é a CPP que explica por que "Presumido compensa acima de
// R$ 1,25 mi" não se sustenta para uma prestadora com folha. Os totais já a somavam corretamente;
// o que faltava era a tela MOSTRAR — um contador não confia num total cuja composição ele não vê.

import { compararRegimes } from "../comparador";
import {
  montarComparativo, celulaDoTributo, fraseDaAusencia, AUSENCIA, ROTULO_DO_TRIBUTO,
} from "../comparativoDeRegimes";

const entradas = (over = {}) => ({
  receitaAnual: 900_000,
  rbt12: 900_000,
  folhaAnual: 300_000,
  anexoSimples: "III",
  sujeitoAoFatorR: false,
  atividadePresumido: "servicos",
  aliquotaIss: 0.05,
  margemLucro: null,
  creditosPisCofins: null,
  ...over,
});

const montar = (over) => {
  const e = entradas(over);
  return { comp: montarComparativo(compararRegimes(e), e), e };
};

describe("⚠ as colunas saem do MOTOR — nada é recalculado aqui", () => {
  it("três colunas sem Fator R: Simples, Presumido e Real", () => {
    const { comp } = montar();
    expect(comp.colunas.map((c) => c.chave)).toEqual(["simples", "presumido", "real"]);
  });

  it("⚠⚠ COM FATOR R o Simples vira DUAS colunas — III e V lado a lado", () => {
    // A pergunta não é "quanto custa o Simples", é "quanto custa ficar no III em vez de cair no V".
    const { comp } = montar({ sujeitoAoFatorR: true, anexoSimples: null });
    expect(comp.colunas.map((c) => c.chave)).toEqual(["simplesIII", "simplesV", "presumido", "real"]);
  });

  it("⚠ e o anexo que o Fator R RESOLVEU fica marcado — no Fator R o anexo sai da folha", () => {
    // Folha de 300 mil sobre RBT12 de 900 mil = 33,3% ⇒ acima dos 28% ⇒ Anexo III.
    const { comp } = montar({ sujeitoAoFatorR: true, anexoSimples: null });
    const iii = comp.colunas.find((c) => c.chave === "simplesIII");
    const v = comp.colunas.find((c) => c.chave === "simplesV");
    expect(iii.atual).toBe(true);
    expect(v.atual).toBe(false);
  });

  it("⚠ o Anexo V custa MAIS que o III, e a tabela deixa isso à vista", () => {
    const { comp } = montar({ sujeitoAoFatorR: true, anexoSimples: null });
    const iii = comp.colunas.find((c) => c.chave === "simplesIII");
    const v = comp.colunas.find((c) => c.chave === "simplesV");
    expect(v.total).toBeGreaterThan(iii.total);
  });

  it("⚠ o VENCEDOR vem do motor, não de uma segunda ordenação", () => {
    const { comp } = montar();
    const vencedoras = comp.colunas.filter((c) => c.vencedora);
    expect(vencedoras).toHaveLength(1);
    expect(vencedoras[0].total).toBe(Math.min(...comp.colunas.filter((c) => !c.indisponivel).map((c) => c.total)));
  });
});

describe("⚠⚠ A CPP É A LINHA QUE RESPONDE À PERGUNTA DO DONO", () => {
  it("ela SEMPRE aparece — mesmo quando NENHUMA coluna a traz como número", () => {
    // ⚠ ESTE TESTE NASCEU ERRADO E O EXPERIMENTO PEGOU. A primeira versão usava só
    // `folhaAnual: null`, e nesse caso o Simples AINDA traz a CPP — ela vem da partilha do DAS.
    // Ou seja, a linha aparecia por outro motivo e a guarda não era exercida: desligando-a, zero
    // vermelhos. O caso REAL em que ninguém tem o número é o **Anexo IV sem folha**, onde a CPP
    // fica fora do DAS (art. 18, § 5º-C) e não há folha para calculá-la — e o Anexo IV é boa parte
    // da carteira (construção civil, vigilância).
    const { comp } = montar({ anexoSimples: "IV", folhaAnual: null, aliquotaIss: null });
    const alguemTemNumero = comp.colunas.some((c) => typeof c.porTributo?.cpp === "number");
    expect(alguemTemNumero).toBe(false);
    // Linha ausente não responde nada. Sem número, cada célula diz POR QUE não tem.
    expect(comp.tributos).toContain("cpp");
  });

  it("⚠ e aí cada célula da linha diz o motivo — nenhuma fica em branco", () => {
    const { comp } = montar({ anexoSimples: "IV", folhaAnual: null, aliquotaIss: null });
    for (const coluna of comp.colunas.filter((c) => !c.indisponivel)) {
      const celula = celulaDoTributo(coluna, "cpp");
      expect(celula.valor).toBeNull();
      expect(fraseDaAusencia(celula.ausencia)).toBeTruthy();
    }
  });

  it("no Simples ela vem da PARTILHA do DAS — é número, não branco", () => {
    const { comp } = montar();
    const simples = comp.colunas.find((c) => c.chave === "simples");
    const celula = celulaDoTributo(simples, "cpp");
    expect(celula.valor).toBeGreaterThan(0);
    expect(celula.ausencia).toBeNull();
  });

  it("⚠⚠ no Presumido ela é 20% da folha POR FORA — e é maior que a do Simples", () => {
    // É exatamente o que sustenta a observação do dono sobre o ponto de equilíbrio.
    const { comp } = montar();
    const simples = comp.colunas.find((c) => c.chave === "simples");
    const presumido = comp.colunas.find((c) => c.chave === "presumido");
    expect(celulaDoTributo(presumido, "cpp").valor).toBeCloseTo(300_000 * 0.20, 6);
    expect(celulaDoTributo(presumido, "cpp").valor).toBeGreaterThan(celulaDoTributo(simples, "cpp").valor);
  });

  it("sem folha informada, a célula do Presumido diz NÃO ESTIMADO — nunca zero", () => {
    const { comp } = montar({ folhaAnual: null });
    const presumido = comp.colunas.find((c) => c.chave === "presumido");
    const celula = celulaDoTributo(presumido, "cpp");
    expect(celula.valor).toBeNull();
    expect(celula.ausencia).toBe(AUSENCIA.NAO_ESTIMADO);
  });
});

describe("⚠⚠ CÉLULA VAZIA É PROIBIDA — branco se lê como ZERO", () => {
  it("toda célula sem número tem um motivo NOMEADO", () => {
    const { comp } = montar({ aliquotaIss: null, folhaAnual: null });
    for (const coluna of comp.colunas) {
      if (coluna.indisponivel) continue;
      for (const t of comp.tributos) {
        const c = celulaDoTributo(coluna, t);
        if (c.valor == null) {
          expect(c.ausencia).not.toBeNull();
          expect(fraseDaAusencia(c.ausencia)).toBeTruthy();
        }
      }
    }
  });

  it("⚠⚠ FALTA DE DADO vem antes de \"não se aplica\", e a ordem importa", () => {
    // Um ISS que ficou de fora por falta da alíquota do município NÃO é um ISS que o regime não
    // cobra. Confundir os dois faria o total parecer completo justamente onde está subestimado.
    const { comp } = montar({ aliquotaIss: null });
    const presumido = comp.colunas.find((c) => c.chave === "presumido");
    expect(celulaDoTributo(presumido, "iss").ausencia).toBe(AUSENCIA.NAO_ESTIMADO);
  });

  it("as três frases de ausência existem e são distintas", () => {
    const frases = [AUSENCIA.DENTRO_DO_DAS, AUSENCIA.NAO_SE_APLICA, AUSENCIA.NAO_ESTIMADO].map(fraseDaAusencia);
    expect(new Set(frases).size).toBe(3);
    expect(frases.every(Boolean)).toBe(true);
  });

  it("todo tributo exibido tem rótulo em português", () => {
    const { comp } = montar();
    for (const t of comp.tributos) expect(ROTULO_DO_TRIBUTO[t]).toBeTruthy();
  });
});

describe("⚠ COLUNA SEM NÚMERO NÃO VIRA TRAÇO DISCRETO", () => {
  it("o Lucro Real sai indisponível com o motivo quando falta margem e créditos", () => {
    const { comp } = montar();
    const real = comp.colunas.find((c) => c.chave === "real");
    expect(real.indisponivel).toBe(true);
    expect(typeof real.motivo === "string" || Array.isArray(real.faltam)).toBe(true);
  });

  it("⚠ e ela NÃO pode ser eleita a mais barata", () => {
    const { comp } = montar();
    expect(comp.colunas.find((c) => c.chave === "real").vencedora).toBe(false);
  });

  it("o Simples indisponível (Fator R sem folha) também não compete", () => {
    const { comp } = montar({ sujeitoAoFatorR: true, anexoSimples: null, folhaAnual: null });
    // ⚠ Aqui as duas colunas de anexo são calculadas à força (III e V), porque a pergunta é
    // "quanto custaria em cada" — o que fica indisponível é a resposta de QUAL deles vale.
    expect(comp.colunas.map((c) => c.chave)).toEqual(["simplesIII", "simplesV", "presumido", "real"]);
    for (const c of comp.colunas.filter((x) => x.chave.startsWith("simples"))) {
      expect(c.atual).toBe(false);
    }
  });
});

describe("⚠ o que ficou de fora viaja POR COLUNA", () => {
  it("cada coluna carrega o próprio `naoConsiderado`", () => {
    // Somar as ressalvas num rodapé só faria o contador atribuí-las à coluna errada: o ISS falta no
    // Presumido e não no Simples abaixo do sublimite.
    const { comp } = montar({ aliquotaIss: null });
    const presumido = comp.colunas.find((c) => c.chave === "presumido");
    expect(presumido.naoConsiderado.join(" ")).toMatch(/ISS/i);
  });

  it("a vigência das tabelas é REPASSADA, não reinventada", () => {
    const { comp } = montar();
    expect(comp.fontesVerificadasEm).toBeTruthy();
    expect(comp.anoBase).toBe(2026);
  });
});

describe("⚠ entrada torta não estoura", () => {
  it.each([null, undefined, {}, { regimes: null }])("%p devolve null", (r) => {
    expect(montarComparativo(r, {})).toBeNull();
  });
});
