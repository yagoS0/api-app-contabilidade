// A LIGAÇÃO da distância até a próxima faixa — a regra já é medida em
// `lib/__tests__/distanciaProximaFaixa.test.js` (25 testes) e NÃO é remedida aqui. O que este
// arquivo prende é o que só a tela pode errar: o número aparecer, a ressalva do RBT12 vir JUNTO, e
// o aviso do sublimite não virar decoração permanente.

import { render, screen } from "@testing-library/react";
import { TabelaAnexoReferencia } from "../TabelaAnexoReferencia";

/** Uma atividade de Anexo III resolvida, sem depender do Fator R. */
const SERVICO_III = [{ anexoImplicito: "III", sujeitoFatorR: false }];

const textoDaTela = () => document.body.textContent.replace(/\s+/g, " ");

describe("⚠ o número aparece, e diz de QUE número está falando", () => {
  it("RBT12 de 500.000 no Anexo III → faltam 220.000 para a 4ª faixa", () => {
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={500_000} folha12m={null} />);
    const t = textoDaTela();
    expect(t).toMatch(/220\.000,00/);
    expect(t).toMatch(/4ª faixa/);
  });

  it("⚠⚠ e a ressalva do RBT12 vem JUNTO, no corpo — nunca só num `title`", () => {
    // "Faltam R$ 220.000" lido como "posso faturar R$ 220.000" é falso: o RBT12 é soma MÓVEL.
    // `title` não aparece no teclado nem no toque, e esta ressalva é o que impede a leitura errada.
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={500_000} folha12m={null} />);
    const t = textoDaTela();
    expect(t).toMatch(/soma móvel dos últimos 12 meses/i);
    expect(t).toMatch(/não.{0,3} é quanto ainda dá para faturar/i);
  });

  it("traz as DUAS alíquotas — 'faltam X' sem dizer para quanto vai não decide nada", () => {
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={500_000} folha12m={null} />);
    expect(textoDaTela()).toMatch(/13,50%.{0,30}16,00%/);
  });
});

describe("⚠⚠ O AVISO DO SUBLIMITE SÓ ACENDE NA VIRADA QUE O TEM", () => {
  it("da 5ª para a 6ª ele acende e NOMEIA o tributo que sai do DAS", () => {
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={3_000_000} folha12m={null} />);
    const t = textoDaTela();
    expect(t).toMatch(/art\. 13-A/);
    expect(t).toMatch(/ISS/);
    expect(t).toMatch(/sai do DAS/i);
  });

  it("nas outras viradas ele NÃO aparece — âmbar permanente treina o olho a ignorar", () => {
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={500_000} folha12m={null} />);
    expect(textoDaTela()).not.toMatch(/art\. 13-A/);
  });
});

describe("⚠⚠ NA ÚLTIMA FAIXA A TELA NÃO DIZ 'PRÓXIMA FAIXA'", () => {
  it("na 6ª faixa, a frase é sobre SAIR do Simples, não sobre alíquota maior", () => {
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={4_000_000} folha12m={null} />);
    const t = textoDaTela();
    expect(t).toMatch(/800\.000,00/);
    expect(t).toMatch(/não pode permanecer optante/i);
    expect(t).not.toMatch(/para a 7ª faixa/);
  });
});

describe("⚠ SEM RBT12 E ACIMA DO TETO, O BLOCO NÃO APARECE — a tabela já disse", () => {
  // Dois avisos sobre o mesmo fato é exatamente o defeito que a avaliação do dono apontou
  // ("avisos repetidos, sem ação").
  it.each([
    ["sem RBT12", null],
    ["acima do teto", 5_000_000],
  ])("%s", (_rotulo, rbt12) => {
    render(<TabelaAnexoReferencia atividades={SERVICO_III} rbt12={rbt12} folha12m={null} />);
    expect(textoDaTela()).not.toMatch(/de RBT12 para a/);
  });
});
