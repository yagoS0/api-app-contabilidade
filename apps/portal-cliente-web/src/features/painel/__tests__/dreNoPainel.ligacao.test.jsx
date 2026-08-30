// ⚠⚠ O DRE NA TELA DO CLIENTE — ele virou REAL em 29/08/2026.
//
// > Dono: *"a nossa DRE para o cliente deve ser montada baseada no nosso plano de contas."*
//
// ⚠⚠ Até aqui o DRE era ficção com selo — não existia rota. O que este arquivo protege é o que a
// mudança tem de preservar: o selo continua dirigido pelo DADO (`demonstracao !== false`), o vazio
// continua tendo NOME, e a linha "não classificado" nunca some — ela carrega R$ 687 mil na base
// real, e sem ela os números acima descrevem meia empresa com cara de completos.

import { act, render, screen } from "@testing-library/react";
import { api } from "../../../api";
import { BlocoDeDemonstracao } from "../BlocoDeDemonstracao";
import { dreDeDemonstracao } from "../lib/dadosDeDemonstracao";
import { LINHAS_DO_DRE } from "../../../../../api/src/application/dre/lib/dreGerencial.js";

const COMPETENCIA = "2026-08";

async function abrirDre(payload) {
  jest.spyOn(api, "getFluxoCaixa").mockResolvedValue({ demonstracao: false, meses: [], janela: {} });
  jest.spyOn(api, "getDre").mockResolvedValue(payload);
  render(<BlocoDeDemonstracao companyId="pc-001" competencia={COMPETENCIA} />);
  await act(async () => {});
  await act(async () => { screen.getByRole("button", { name: "DRE" }).click(); });
}

const real = (over = {}) => ({
  ok: true,
  demonstracao: false,
  competencia: COMPETENCIA,
  semLancamento: false,
  linhas: LINHAS_DO_DRE.map((l) => ({ chave: l.chave, rotulo: l.rotulo, tipo: l.tipo, valor: 1000, contas: [] })),
  naoClassificado: [],
  ...over,
});

afterEach(() => { jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o DRE real apaga o selo — e quem decide é o DADO", () => {
  it("com `demonstracao: false` o selo some", async () => {
    await abrirDre(real());
    expect(screen.queryByText(/Dados de demonstração/i)).toBeNull();
  });

  it("⚠⚠ com o campo AUSENTE o selo FICA — `!== false`, nunca `=== true`", async () => {
    // Uma resposta que não trouxesse o campo apresentaria ficção como fato, em silêncio. O modo de
    // falhar tem de ser "selo a mais", que é barato.
    const semCampo = real();
    delete semCampo.demonstracao;
    await abrirDre(semCampo);
    expect(screen.getByText(/Dados de demonstração/i)).toBeInTheDocument();
  });

  it("⚠ e o mock continua sendo ficção, com selo", async () => {
    await abrirDre(dreDeDemonstracao("pc-001", COMPETENCIA));
    expect(screen.getByText(/Dados de demonstração/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as linhas são as do plano de contas", () => {
  it("as quinze do `dreGerencial`, na ordem", async () => {
    await abrirDre(real());
    const rotulos = [...document.querySelectorAll(".table--dre tbody tr td:first-child")]
      .map((td) => td.textContent);
    expect(rotulos).toEqual(LINHAS_DO_DRE.map((l) => l.rotulo));
  });

  it("⚠⚠ o mock tem a MESMA forma do servidor — mock com forma própria treina a tela errada", async () => {
    // É o defeito medido no fluxo no mesmo dia: o mock chamava `base.origem` o que o servidor chama
    // de `base.doCliente`, e a lista saía vazia com o fluxo parecendo certo.
    const doMock = dreDeDemonstracao("pc-001", COMPETENCIA);
    expect(doMock.linhas.map((l) => l.chave)).toEqual(LINHAS_DO_DRE.map((l) => l.chave));
    expect(doMock.linhas.map((l) => l.rotulo)).toEqual(LINHAS_DO_DRE.map((l) => l.rotulo));
    expect(doMock.linhas.map((l) => l.tipo)).toEqual(LINHAS_DO_DRE.map((l) => l.tipo));
  });

  it("⚠ vermelho SÓ no subtotal/resultado negativo, nunca na dedução", async () => {
    // Imposto sobre a receita é negativo por DEFINIÇÃO; pintar toda linha de menos deixaria o DRE
    // inteiro vermelho num mês de lucro.
    await abrirDre(real({
      linhas: LINHAS_DO_DRE.map((l) => ({
        chave: l.chave, rotulo: l.rotulo, tipo: l.tipo,
        valor: l.chave === "deducoes" || l.chave === "resultadoDoPeriodo" ? -500 : 100,
        contas: [],
      })),
    }));
    const linha = (chave) => document.querySelector(`.table--dre tbody tr[data-linha-dre]`) && [...document.querySelectorAll(".table--dre tbody tr")]
      .find((tr) => tr.textContent.includes(LINHAS_DO_DRE.find((l) => l.chave === chave).rotulo));
    expect(linha("deducoes").querySelector("[data-negativo]")).toBeNull();
    expect(linha("resultadoDoPeriodo").querySelector('[data-negativo="sim"]')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ vazio tem NOME — nunca `R$ 0,00`", () => {
  it("empresa sem lançamento diz o que houve, e não mostra tabela", async () => {
    // Medido: 12 das 34 empresas. Zero em toda linha AFIRMA que ela não faturou nem gastou nada.
    await abrirDre(real({ semLancamento: true }));
    expect(screen.getByText(/Ainda não há lançamentos nesta competência/i)).toBeInTheDocument();
    expect(screen.getByText(/não quer dizer que a empresa não teve movimento/i)).toBeInTheDocument();
    expect(document.querySelector(".table--dre")).toBeNull();
  });

  it("⚠ e a frase manda falar com o contador, não com o sistema", async () => {
    await abrirDre(real({ semLancamento: true }));
    expect(screen.getByText(/contador ainda não lançou/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a linha NÃO CLASSIFICADO nunca some", () => {
  const naoClassificado = [
    {
      causa: "conta_em_branco",
      frase: "Estas linhas ainda não têm conta contábil. É um estado normal — a provisão de guia nasce assim —, e o seu contador ainda vai classificá-las.",
      valor: 687355.94,
      contas: [],
    },
    {
      causa: "fora_do_plano",
      frase: "Estas linhas usam uma conta que não existe no plano de contas desta empresa.",
      valor: 120,
      contas: [],
    },
  ];

  it("ela aparece com o VALOR — some com ela e a empresa some do DRE", async () => {
    await abrirDre(real({ naoClassificado }));
    expect(screen.getByText(/Fora do DRE, por enquanto/i)).toBeInTheDocument();
    expect(screen.getByText(/687\.355,94/)).toBeInTheDocument();
  });

  it("⚠⚠ as causas vêm SEPARADAS — o conserto de cada uma é diferente", async () => {
    await abrirDre(real({ naoClassificado }));
    expect(document.querySelector('[data-causa="conta_em_branco"]')).not.toBeNull();
    expect(document.querySelector('[data-causa="fora_do_plano"]')).not.toBeNull();
  });

  it("⚠⚠ conta em branco NÃO é apresentada como erro — a provisão de guia nasce assim", async () => {
    await abrirDre(real({ naoClassificado }));
    const bloco = document.querySelector('[data-causa="conta_em_branco"]');
    expect(bloco.textContent).toMatch(/estado normal/i);
    expect(bloco.textContent).not.toMatch(/\berro\b/i);
  });

  it("⚠ sem nada fora do DRE, o bloco não existe — nem como linha de zero", async () => {
    await abrirDre(real());
    expect(screen.queryByText(/Fora do DRE/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o nome do que isto é", () => {
  it("'DRE gerencial' e 'não é peça fiscal' estão na tela", async () => {
    // O projeto já recusa entregar balanço e balancete a partir de lançamentos: um demonstrativo com
    // NOME DE PEÇA CONTÁBIL saindo daqui é o que aquela recusa existe para impedir.
    await abrirDre(real());
    expect(screen.getByText(/DRE gerencial/)).toBeInTheDocument();
    expect(screen.getByText(/Não é peça fiscal/i)).toBeInTheDocument();
  });

  it("⚠ e a tela NÃO se chama balanço nem balancete", async () => {
    await abrirDre(real());
    expect(document.body.textContent).not.toMatch(/balanço|balancete/i);
  });
});
