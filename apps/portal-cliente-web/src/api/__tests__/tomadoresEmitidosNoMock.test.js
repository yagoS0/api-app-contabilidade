// A MEMÓRIA DE TOMADORES NO MOCK — o par do `realApi`, e os três estados alcançáveis offline.
//
// ⚠⚠ DUAS RAZÕES INDEPENDENTES PARA ESTA SUÍTE EXISTIR:
//
//   1. **PAR MOCK/REAL.** Toda função nova precisa existir nos DOIS, com o mesmo contrato. Um mock
//      que devolvesse coisa diferente do real treinaria a tela errada — foi o caso já registrado do
//      `emitirNfse`, que recusava todo Lucro Presumido.
//   2. ⚠⚠ **OS TRÊS ESTADOS PRECISAM SER ALCANÇÁVEIS OFFLINE**: empresa COM tomadores (o seletor
//      aparece), empresa SEM nenhum (o seletor não aparece, e nada é dito) e o registro
//      INCOMPLETO — o CPF que a emissão anterior guardou sem endereço. Sem os três plantados, a
//      metade do desenho que trata ausência só existiria em produção, que é como este projeto já
//      foi mordido quatro vezes.
//
// ⚠ NADA AQUI EMITE NFS-e a não ser pelo próprio `emitirNfse` do MOCK, que não sai da máquina: não
// há `fetch`, não há rede, e o caso que o usa existe para provar a invariante "grava DEPOIS do
// sucesso".

import { createMockApi } from "../mock/mockApi";
import { createRealApi } from "../real/realApi";
import { definirTokens, limparSessao } from "../sessionStore";
import { normalizarTomadores } from "../../features/emitir/lib/tomadoresEmitidos";

beforeEach(() => {
  window.localStorage.clear();
  limparSessao();
});

async function apiLogada() {
  const api = createMockApi();
  const sessao = await api.login("cliente@exemplo.com", "123456");
  definirTokens({ accessToken: sessao.accessToken, refreshToken: sessao.refreshToken });
  return api;
}

describe("⚠ o par mock/real", () => {
  test("`getTomadoresEmitidos` existe nos dois", () => {
    expect(typeof createMockApi().getTomadoresEmitidos).toBe("function");
    expect(typeof createRealApi().getTomadoresEmitidos).toBe("function");
  });

  test("⚠⚠ NÃO existe porta de ESCRITA de tomador em nenhum dos dois — a memória é do que a emissão TEVE", () => {
    for (const api of [createMockApi(), createRealApi()]) {
      for (const proibida of ["salvarTomador", "criarTomador", "editarTomador", "removerTomador"]) {
        expect(api[proibida]).toBeUndefined();
      }
    }
  });
});

describe("⚠⚠ os três estados, alcançáveis offline", () => {
  test("empresa COM memória devolve a lista, mais recente primeiro", async () => {
    const api = await apiLogada();
    const lista = await api.getTomadoresEmitidos("pc-001");

    expect(lista.length).toBeGreaterThanOrEqual(3);
    const datas = lista.map((t) => t.ultimaEmissaoEm);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  test("⚠ o LUCRO PRESUMIDO também tem memória — ela não tem nada a ver com regime", async () => {
    const api = await apiLogada();
    expect(await api.getTomadoresEmitidos("pc-005")).toHaveLength(1);
  });

  test("⚠⚠ empresa SEM memória devolve lista VAZIA — é o caso em que o seletor não aparece", async () => {
    const api = await apiLogada();
    expect(await api.getTomadoresEmitidos("pc-006")).toEqual([]);
    // pc-007 é a de REGIME INDEFINIDO, e ela também nasce sem memória.
    expect(await api.getTomadoresEmitidos("pc-007")).toEqual([]);
  });

  test("⚠ o registro INCOMPLETO existe: um CPF sem endereço nenhum, e um tomador sem e-mail", async () => {
    const api = await apiLogada();
    const lista = normalizarTomadores(await api.getTomadoresEmitidos("pc-001"));

    const cpf = lista.find((t) => t.documento.length === 11);
    expect(cpf).toBeDefined();
    expect(cpf.xLgr).toBe("");
    expect(cpf.cMun).toBe("");

    expect(lista.some((t) => t.email === "")).toBe(true);
  });
});

describe("⚠ o escopo é a EMPRESA — e o acesso é conferido", () => {
  test("empresa fora do vínculo é 403, não lista vazia", async () => {
    const api = await apiLogada();
    await expect(api.getTomadoresEmitidos("pc-999")).rejects.toMatchObject({ status: 403 });
  });

  test("sem sessão, 401", async () => {
    const api = createMockApi();
    await expect(api.getTomadoresEmitidos("pc-001")).rejects.toMatchObject({ status: 401 });
  });

  test("uma empresa não enxerga o tomador da outra", async () => {
    const api = await apiLogada();
    const daUm = (await api.getTomadoresEmitidos("pc-001")).map((t) => t.documento);
    const daCinco = (await api.getTomadoresEmitidos("pc-005")).map((t) => t.documento);
    expect(daUm).not.toEqual(expect.arrayContaining(daCinco));
  });
});

describe("⚠⚠ a memória só se escreve DEPOIS do sucesso — invariante 2 do módulo real", () => {
  const ENDERECO = {
    cMun: "3550308",
    CEP: "01001000",
    xLgr: "RUA DAS FLORES",
    nro: "100",
    xBairro: "CENTRO",
  };

  function payload(descricao, { doc = "77888999000166", nome = "NOVO TOMADOR LTDA", endereco = ENDERECO } = {}) {
    return {
      tomador: { cnpjCpf: doc, nome, email: "novo@example.com", endereco },
      servico: { descricao, valorServicos: 1000, issRetido: false },
      totTrib: { pTotTribSN: 6 },
      competencia: "2026-08-10",
    };
  }

  test("emissão RECUSADA não grava nada — a nota que a Receita recusou não é 'já emitimos para este tomador'", async () => {
    const api = await apiLogada();
    const antes = await api.getTomadoresEmitidos("pc-001");
    await expect(api.emitirNfse("pc-001", payload("#receita servico"))).rejects.toBeDefined();
    expect(await api.getTomadoresEmitidos("pc-001")).toHaveLength(antes.length);
  });

  test("⚠⚠ desfecho DESCONHECIDO (TRANSPORTE) também não grava — ninguém sabe se a nota saiu", async () => {
    const api = await apiLogada();
    const antes = await api.getTomadoresEmitidos("pc-001");
    await expect(api.emitirNfse("pc-001", payload("#transporte servico"))).rejects.toBeDefined();
    expect(await api.getTomadoresEmitidos("pc-001")).toHaveLength(antes.length);
  });

  test("emissão bem-sucedida grava, e uma segunda para o MESMO documento atualiza em vez de duplicar", async () => {
    const api = await apiLogada();
    const antes = (await api.getTomadoresEmitidos("pc-001")).length;

    await api.emitirNfse("pc-001", payload("servico prestado"));
    const depois = await api.getTomadoresEmitidos("pc-001");
    expect(depois).toHaveLength(antes + 1);
    expect(depois[0]).toMatchObject({ documento: "77888999000166", nome: "NOVO TOMADOR LTDA" });

    await api.emitirNfse("pc-001", payload("outro servico", { nome: "NOVO TOMADOR LTDA - FILIAL" }));
    const final = await api.getTomadoresEmitidos("pc-001");
    expect(final).toHaveLength(antes + 1);
    expect(final.find((t) => t.documento === "77888999000166").nome).toBe("NOVO TOMADOR LTDA - FILIAL");
  });

  test("⚠ endereço INCOMPLETO na emissão vira registro SEM endereço — nada é completado nem deduzido", async () => {
    const api = await apiLogada();
    await api.emitirNfse(
      "pc-001",
      payload("servico", { doc: "55666777000188", endereco: { ...ENDERECO, nro: "" } })
    );
    const registro = (await api.getTomadoresEmitidos("pc-001")).find((t) => t.documento === "55666777000188");
    expect(registro.xLgr).toBe(null);
    expect(registro.cMun).toBe(null);
  });
});
