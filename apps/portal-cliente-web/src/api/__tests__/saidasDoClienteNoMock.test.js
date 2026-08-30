// ⚠⚠ AS SAÍDAS DO CLIENTE NO MOCK — e a corrente inteira, do POST até a lista (29/08/2026).
//
// ⚠⚠ **ESTE ARQUIVO NASCEU DE UM DEFEITO MEDIDO NO NAVEGADOR.** A primeira versão do mock gravava
// a saída, a linha entrava no fluxo (dia 18 de setembro, −3.500,00 na tabela) e ela **não aparecia
// na lista "Suas saídas"** — porque o mock marcava a linha com `base.origem: "CLIENTE"` e
// `base.saidaId`, nomes que o SERVIDOR não usa. Ele manda `base.doCliente: true` e
// `referencia: { tipo: "saidaAvulsa", id }`, e é isso que a leitura procura.
//
// ⚠ Nenhum teste de unidade pegaria isso: a regra estava certa e o mock estava certo consigo mesmo.
// O que faltava era alguém exercer os DOIS juntos — é o que este arquivo faz.
//
// ⚠⚠ E é a razão de o mock existir do jeito que existe: ele reproduz o CONTRATO do servidor, não uma
// resposta plausível. Um mock que inventa o nome do campo treina a tela errada, e o erro só aparece
// em produção.

import { createMockApi } from "../mock/mockApi";
import { createRealApi } from "../real/realApi";
import { definirTokens, limparSessao } from "../sessionStore";
import { saidasDoClienteNoFluxo, TIPO_DA_SAIDA } from "../../features/painel/lib/leituraDoFluxo";

const EMPRESA = "pc-001";
const COMPETENCIA = "2026-08";

let mockApi;

/** ⚠ O mesmo arranjo dos outros testes do par: instância NOVA por caso, sessão de verdade. */
async function apiLogada() {
  const api = createMockApi();
  const sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
  return api;
}

const fluxo = () => mockApi.getFluxoCaixa(EMPRESA, { competencia: COMPETENCIA });

beforeEach(async () => {
  window.localStorage.clear();
  limparSessao();
  mockApi = await apiLogada();
});

describe("⚠⚠ a corrente inteira: criar → entrar no fluxo → aparecer na lista", () => {
  it("a AVULSA entra no DIA que a pessoa escolheu, e a lista a reconhece", async () => {
    const criada = await mockApi.criarSaidaDoFluxo(EMPRESA, {
      tipo: "AVULSA", descricao: "Reforma da sala", valor: 3500, data: "2026-09-18",
    });
    expect(criada.saida.estado).toBe("PENDENTE");

    const r = await fluxo();
    const setembro = r.meses.find((m) => m.competencia === "2026-09");
    const linha = setembro.linhas.find((l) => l.rotulo === "Reforma da sala");
    expect(linha).toBeDefined();
    expect(linha.dia).toBe(18);
    expect(linha.direcao).toBe("SAIDA");
    // ⚠⚠ SEMPRE previsão: o cliente planejou, ninguém pagou.
    expect(linha.procedencia).toBe("PREVISAO");

    // ⚠⚠ E A LISTA A ENCONTRA — é este passo que o defeito quebrava.
    const lista = saidasDoClienteNoFluxo(r.meses);
    const dela = lista.find((s) => s.rotulo === "Reforma da sala");
    expect(dela).toBeDefined();
    expect(dela.tipo).toBe(TIPO_DA_SAIDA.AVULSA);
    expect(dela.pendente).toBe(true);
  });

  it("⚠⚠ o mock manda os MESMOS nomes de campo do servidor — `doCliente` e `referencia`", async () => {
    // A guarda é sobre o NOME, não sobre o efeito: um mock com `origem: "CLIENTE"` e `base.saidaId`
    // produz um fluxo que parece certo e uma lista vazia.
    await mockApi.criarSaidaDoFluxo(EMPRESA, {
      tipo: "AVULSA", descricao: "X", valor: 100, data: "2026-09-02",
    });
    const r = await fluxo();
    const linha = r.meses.flatMap((m) => m.linhas).find((l) => l.rotulo === "X");
    expect(linha.base.doCliente).toBe(true);
    expect(linha.referencia).toEqual({ tipo: "saidaAvulsa", id: expect.any(String) });
    expect(linha.base).not.toHaveProperty("saidaId");
  });

  it("a RECORRENTE se repete no ritmo dela, e a lista a mostra UMA vez", async () => {
    await mockApi.criarSaidaDoFluxo(EMPRESA, {
      tipo: "RECORRENTE", descricao: "Aluguel", valor: 1200, periodicidade: "MENSAL",
    });
    const r = await fluxo();
    const ocorrencias = r.meses.flatMap((m) => m.linhas).filter((l) => l.rotulo === "Aluguel");
    expect(ocorrencias.length).toBeGreaterThan(1);
    // ⚠ Sem dia: a periodicidade diz o ciclo, não a data.
    expect(ocorrencias.every((l) => l.dia === null)).toBe(true);

    const lista = saidasDoClienteNoFluxo(r.meses);
    const dela = lista.filter((s) => s.rotulo === "Aluguel");
    expect(dela).toHaveLength(1);
    expect(dela[0].tipo).toBe(TIPO_DA_SAIDA.RECORRENTE);
    expect(dela[0].periodicidade).toBe("MENSAL");
    expect(dela[0].ocorrencias).toBe(ocorrencias.length);
  });

  it("⚠ ANUAL aparece MENOS vezes que MENSAL — o passo sai da periodicidade, não de uma média", async () => {
    await mockApi.criarSaidaDoFluxo(EMPRESA, {
      tipo: "RECORRENTE", descricao: "Conselho", valor: 800, periodicidade: "ANUAL",
    });
    const r = await fluxo();
    const n = r.meses.flatMap((m) => m.linhas).filter((l) => l.rotulo === "Conselho").length;
    expect(n).toBe(1);
  });
});

describe("⚠⚠ as recusas do mock são as do SERVIDOR — mesmos códigos", () => {
  it.each([
    ["tipo fora da lista", { tipo: "QUALQUER", descricao: "X", valor: 10, data: "2026-09-01" }, "tipo_invalido"],
    ["sem descrição", { tipo: "AVULSA", descricao: "  ", valor: 10, data: "2026-09-01" }, "descricao_obrigatoria"],
    ["valor zero", { tipo: "AVULSA", descricao: "X", valor: 0, data: "2026-09-01" }, "valor_invalido"],
    ["data torta", { tipo: "AVULSA", descricao: "X", valor: 10, data: "18/09/2026" }, "data_invalida"],
    ["periodicidade fora da lista", { tipo: "RECORRENTE", descricao: "X", valor: 10, periodicidade: "SEMANAL" }, "periodicidade_invalida"],
  ])("%s ⇒ %s", async (_nome, corpo, codigo) => {
    await expect(mockApi.criarSaidaDoFluxo(EMPRESA, corpo)).rejects.toMatchObject({ code: codigo });
  });

  it("⚠⚠ valor ZERO recusa, e `Number(null)` também — a guarda é por TIPO, não por verdade", async () => {
    // `Number(null)` é 0 e 0 é finito: a primeira versão desta guarda em outra tela deixou passar.
    await expect(mockApi.criarSaidaDoFluxo(EMPRESA, { tipo: "AVULSA", descricao: "X", valor: null, data: "2026-09-01" }))
      .rejects.toMatchObject({ code: "valor_invalido" });
  });
});

describe("⚠⚠ remover — o `tipo` tem de bater com a tabela", () => {
  it("apaga a avulsa e ela SOME do fluxo", async () => {
    const { saida } = await mockApi.criarSaidaDoFluxo(EMPRESA, {
      tipo: "AVULSA", descricao: "Some", valor: 100, data: "2026-09-03",
    });
    await mockApi.removerSaidaDoFluxo(EMPRESA, saida.id, { tipo: "AVULSA" });
    const r = await fluxo();
    expect(r.meses.flatMap((m) => m.linhas).some((l) => l.rotulo === "Some")).toBe(false);
  });

  it("⚠⚠ pedir na tabela ERRADA devolve `não encontrada` — como o servidor", async () => {
    // Lá são duas tabelas; um `tipo` errado bate no `where` da outra e não acha nada. Um mock que
    // ignorasse o tipo deixaria a tela mandar o parâmetro errado e só descobrir em produção.
    const { saida } = await mockApi.criarSaidaDoFluxo(EMPRESA, {
      tipo: "AVULSA", descricao: "Fica", valor: 100, data: "2026-09-04",
    });
    await expect(mockApi.removerSaidaDoFluxo(EMPRESA, saida.id, { tipo: "RECORRENTE" }))
      .rejects.toMatchObject({ code: "saida_nao_encontrada" });
  });

  it("⚠ `tipo` fora da lista recusa antes de procurar qualquer coisa", async () => {
    await expect(mockApi.removerSaidaDoFluxo(EMPRESA, "x", { tipo: "QUALQUER" }))
      .rejects.toMatchObject({ code: "tipo_invalido" });
  });
});

describe("⚠⚠ o par mock/real — função só do mock NUNCA é alcançada no modo fallback", () => {
  it("as duas existem nos DOIS lados", () => {
    // `createApiClient` monta o wrapper iterando as chaves e só envolve o que é função nos dois.
    // Função ausente de um lado SOME do objeto, e a tela quebra com `is not a function`.
    const real = createRealApi();
    for (const nome of ["criarSaidaDoFluxo", "removerSaidaDoFluxo"]) {
      expect(typeof mockApi[nome]).toBe("function");
      expect(typeof real[nome]).toBe("function");
    }
  });
});
