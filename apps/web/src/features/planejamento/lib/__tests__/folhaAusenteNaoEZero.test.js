// ⚠⚠ FOLHA AUSENTE NÃO É ZERO — a invariante mais cara do módulo de planejamento.
//
// O caminho que estes testes fecham não dava erro nenhum, e terminava num PDF entregue ao cliente:
//
//   folha desconhecida  →  `Number(null) || 0` = 0  →  Fator R = 0 / RBT12 = 0,00%
//                       →  `anexoPorFatorR` responde "V" (a alíquota MAIOR)
//                       →  o card do Simples mostra um total plausível
//                       →  o comparador coroa um vencedor a partir de um número que ninguém informou.
//
// A distinção que tudo isto preserva: `null` = NÃO INFORMADA (recusa) × `0` = folha zero informada
// (fato, e continua calculando). Trocar uma pela outra é o que o módulo inteiro existe para impedir.

import { compararRegimes } from "../comparador";
import { fatorR, anexoPorFatorR, folhaParaFatorR, custoAnualSimples } from "../simplesNacional";
import { custoAnualPresumido } from "../lucroPresumido";

const BASE = {
  receitaAnual: 1_200_000,
  rbt12: 1_150_000,
  sujeitoAoFatorR: true,
  atividadePresumido: "servicos",
};

describe("o Fator R, sem folha informada", () => {
  test("`fatorR` devolve null — NÃO 0", () => {
    expect(fatorR(null, 1_000_000)).toBeNull();
    expect(fatorR(undefined, 1_000_000)).toBeNull();
    // ⚠ O contraponto que prova que não é a mesma coisa: folha zero INFORMADA continua calculando.
    expect(fatorR(0, 1_000_000)).toBe(0);
  });

  test("`anexoPorFatorR` NÃO responde \"V\" — não responde nada", () => {
    expect(anexoPorFatorR(null, 1_000_000)).toBeNull();
    // Folha zero informada: aí sim é Anexo V, e isso é um fato sobre a empresa.
    expect(anexoPorFatorR(0, 1_000_000)).toBe("V");
    expect(anexoPorFatorR(280_000, 1_000_000)).toBe("III");
  });

  test("`folhaParaFatorR` não inventa \"faltam R$ X\" sobre uma folha que não se conhece", () => {
    expect(folhaParaFatorR(null, 1_000_000)).toBeNull();
    expect(folhaParaFatorR(0, 1_000_000)).toMatchObject({ atinge: false, fatorR: 0 });
  });
});

describe("compararRegimes com atividade de Fator R e folha ausente", () => {
  const semFolha = compararRegimes({ ...BASE, folhaAnual: null });

  test("o Simples sai INDISPONÍVEL, com a pergunta que falta responder", () => {
    const simples = semFolha.regimes.find((r) => r.regime === "Simples Nacional");
    expect(simples.indisponivel).toBe(true);
    expect(simples.faltam).toEqual(["a folha dos últimos 12 meses, com pró-labore e encargos"]);
    expect(simples.motivo).toMatch(/Anexo V/);
    // A recusa tem o mesmo peso do resultado no `CardRegime` — é o `indisponivel` que a produz.
    expect(simples.total).toBeUndefined();
  });

  test("NÃO existe anexo resolvido, e não existe Fator R", () => {
    expect(semFolha.anexoResolvido).toBeNull();
    expect(semFolha.fatorR).toBeNull();
  });

  test("o vencedor NUNCA é o Simples calculado sobre zero", () => {
    expect(semFolha.vencedor?.regime).not.toBe("Simples Nacional");
  });

  test("⚠ E O NÚMERO QUE TERIA SAÍDO ERA OUTRO: com folha 0 o Simples entra, no Anexo V", () => {
    // Este é o comportamento de ANTES, reproduzido de propósito para mostrar a diferença de
    // desfecho — é o mesmo cenário, com a ausência lida como zero.
    const comZero = compararRegimes({ ...BASE, folhaAnual: 0 });
    const simplesZero = comZero.regimes.find((r) => r.regime === "Simples Nacional");
    expect(simplesZero.indisponivel).toBeUndefined();
    expect(simplesZero.anexo).toMatch(/Anexo V/);
    expect(comZero.anexoResolvido).toBe("V");
    expect(comZero.fatorR).toMatchObject({ fatorR: 0 });

    // E o desfecho MUDA: com o zero há um vencedor eleito; sem folha, o Simples nem compete.
    expect(comZero.regimes.some((r) => r.regime === "Simples Nacional" && !r.indisponivel)).toBe(true);
    expect(semFolha.regimes.some((r) => r.regime === "Simples Nacional" && !r.indisponivel)).toBe(false);
  });

  test("folha informada resolve o anexo normalmente — a guarda não atrapalha o caminho feliz", () => {
    const comFolha = compararRegimes({ ...BASE, folhaAnual: 400_000 });
    expect(comFolha.anexoResolvido).toBe("III");
    expect(comFolha.regimes.find((r) => r.regime === "Simples Nacional").indisponivel).toBeUndefined();
  });
});

describe("a CPP que depende da folha não vira zero por ausência", () => {
  test("Lucro Presumido: sem folha, a CPP sai da soma E vai declarada", () => {
    const comum = { receitaAnual: 1_000_000, atividade: "servicos" };
    const semFolha = custoAnualPresumido({ ...comum, folhaAnual: null });
    const comFolha = custoAnualPresumido({ ...comum, folhaAnual: 300_000 });

    expect(semFolha.porTributo.cpp).toBeUndefined();
    expect(semFolha.naoConsiderado.join(" ")).toMatch(/CPP/);
    expect(semFolha.naoConsiderado.join(" ")).toMatch(/subestimado/);
    // Folha zero informada: CPP de R$ 0,00 é um fato, e não gera ressalva.
    const folhaZero = custoAnualPresumido({ ...comum, folhaAnual: 0 });
    expect(folhaZero.porTributo.cpp).toBe(0);
    expect(folhaZero.naoConsiderado.join(" ")).not.toMatch(/CPP/);
    expect(comFolha.porTributo.cpp).toBe(60_000);
  });

  test("Simples Anexo IV (CPP fora do DAS): sem folha, a ressalva aparece no card", () => {
    const semFolha = custoAnualSimples({ anexoChave: "IV", rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: null });
    expect(semFolha.cppPorFora).toBe(0);
    expect(semFolha.naoConsiderado.join(" ")).toMatch(/CPP/);

    const comFolha = custoAnualSimples({ anexoChave: "IV", rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: 200_000 });
    expect(comFolha.cppPorFora).toBe(40_000);
    expect(comFolha.naoConsiderado.join(" ")).not.toMatch(/CPP/);
  });

  test("nos anexos em que a CPP já está no DAS, a folha ausente não muda nada", () => {
    const a = custoAnualSimples({ anexoChave: "III", rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: null });
    const b = custoAnualSimples({ anexoChave: "III", rbt12: 1_000_000, receitaAnual: 1_000_000, folhaAnual: 500_000 });
    expect(a.total).toBe(b.total);
    expect(a.naoConsiderado.join(" ")).not.toMatch(/CPP/);
  });
});
