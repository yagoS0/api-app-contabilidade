// ⚠⚠ O DRE DO MOCK TEM DE TER A FORMA DO SERVIDOR (30/08/2026).
//
// ⚠⚠ ESTE ARQUIVO NASCEU DE UM DEFEITO ACHADO NO NAVEGADOR, ao validar a `main`: a rota real do DRE
// existe desde 29/08 (Fase 7) e responde `demonstracao: false`, montada pelo plano de contas — e o
// mock continuava servindo `dreDeDemonstracao`, **com selo**. A tela que o dono confere offline não
// era a tela que o cliente vê.
//
// ⚠ É a divergência mock × real que este projeto já pagou várias vezes, e nesta direção ela é a
// pior: o navegador mostra o desenho ANTIGO e nada acusa. Nenhum teste de componente pegaria — eles
// montam com fixture própria — e o `npm run build` não olha dado.

import { createMockApi } from "../mock/mockApi";
import { definirTokens, limparSessao } from "../sessionStore";

let api;

/** ⚠ O mesmo arranjo dos outros testes do par: instância NOVA por caso, sessão de verdade. */
async function apiLogada() {
  const nova = createMockApi();
  const sessao = await nova.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
  return nova;
}

const CHAVES_ESPERADAS = [
  "receitaBruta", "deducoes", "receitaLiquida", "custos", "lucroBruto",
  "pessoal", "gerais", "tributarias", "depreciacao", "resultadoOperacional",
  "receitasFinanceiras", "despesasFinanceiras", "outrasReceitas", "irpjCsll",
  "resultadoDoPeriodo",
];

beforeEach(async () => {
  window.localStorage.clear();
  limparSessao();
  api = await apiLogada();
});

describe("⚠⚠ o DRE do mock reproduz o CONTRATO da rota real", () => {
  it("responde `demonstracao: false` — é ele que apaga o selo", async () => {
    const r = await api.getDre("pc-001", { competencia: "2026-08" });
    expect(r.demonstracao).toBe(false);
  });

  it("⚠ as 15 linhas, na ordem e com as chaves do servidor", async () => {
    const r = await api.getDre("pc-001", { competencia: "2026-08" });
    expect(r.linhas.map((l) => l.chave)).toEqual(CHAVES_ESPERADAS);
  });

  it("⚠ os subtotais são a SOMA das linhas, e não números soltos", async () => {
    // Um mock com subtotal cravado deixaria a tela conferindo uma conta que não fecha, e ninguém
    // saberia se o errado é a soma ou a exibição.
    const r = await api.getDre("pc-001", { competencia: "2026-08" });
    const v = Object.fromEntries(r.linhas.map((l) => [l.chave, l.valor]));
    expect(v.receitaLiquida).toBeCloseTo(v.receitaBruta + v.deducoes, 2);
    expect(v.lucroBruto).toBeCloseTo(v.receitaLiquida + v.custos, 2);
    expect(v.resultadoDoPeriodo).toBeCloseTo(
      v.resultadoOperacional + v.receitasFinanceiras + v.despesasFinanceiras + v.outrasReceitas + v.irpjCsll,
      2,
    );
  });

  it("⚠⚠ o DAS cai em DEDUÇÕES, nunca em despesa tributária", async () => {
    // É a decisão do desenho do DRE, e o mock precisa mostrá-la nesse lugar para ela ser conferível
    // na tela antes de o cliente ver.
    const r = await api.getDre("pc-001", { competencia: "2026-08" });
    const deducoes = r.linhas.find((l) => l.chave === "deducoes");
    expect(deducoes.contas.some((c) => /DAS|SIMPLES/i.test(c.nome))).toBe(true);
    const tributarias = r.linhas.find((l) => l.chave === "tributarias");
    expect(tributarias.contas.some((c) => /DAS|SIMPLES/i.test(c.nome || ""))).toBe(false);
  });

  it("⚠ as contas viajam com a linha, e o código é o COMPLETO", async () => {
    // O reduzido `5` é CAIXA e o completo `5` é IRPJ/CSLL: trocar inverte receita com despesa sem
    // erro nenhum.
    const r = await api.getDre("pc-001", { competencia: "2026-08" });
    const receita = r.linhas.find((l) => l.chave === "receitaBruta");
    expect(receita.contas.length).toBeGreaterThan(0);
    for (const c of receita.contas) expect(String(c.codigo).length).toBeGreaterThanOrEqual(9);
  });

  it("⚠⚠ 'Fora do DRE' é alcançável offline — sem ela o bloco inteiro seria invisível", async () => {
    // Medido em produção: essa linha carrega R$ 321.822,26 de receita e R$ 20.274,56 de DAS.
    const r = await api.getDre("pc-001", { competencia: "2026-08" });
    expect(r.naoClassificado.length).toBeGreaterThan(0);
    expect(r.naoClassificado[0].frase).toBeTruthy();
    expect(r.naoClassificado[0].valor).toBeGreaterThan(0);
  });
});

describe("⚠⚠ os DOIS outros ramos continuam alcançáveis offline", () => {
  it("⚠⚠ a empresa SEM lançamento devolve vazio NOMEADO — nunca `R$ 0,00` afirmando nada", async () => {
    const r = await api.getDre("pc-007", { competencia: "2026-08" });
    expect(r.semLancamento).toBe(true);
    expect(r.demonstracao).toBe(false);
    // ⚠ As linhas continuam existindo, zeradas — quem diz "não há o que mostrar" é a bandeira,
    // não a ausência das linhas.
    expect(r.linhas.map((l) => l.chave)).toEqual(CHAVES_ESPERADAS);
  });

  it("⚠ a demonstração continua existindo em UMA empresa — o selo precisa de caminho", async () => {
    // Selo sem caminho para acender é desenho que morre calado, e ele existe para número fictício
    // nunca passar por real.
    const r = await api.getDre("pc-006", { competencia: "2026-08" });
    expect(r.demonstracao).not.toBe(false);
  });
});
