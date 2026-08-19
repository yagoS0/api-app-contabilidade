// O LOTE POR PLANILHA NO MOCK — o par do `realApi`, e TODOS os estados de linha alcançáveis.
//
// ⚠⚠ DUAS RAZÕES INDEPENDENTES PARA ESTA SUÍTE EXISTIR:
//
//   1. **PAR MOCK/REAL.** Toda função nova precisa existir nos DOIS, com o mesmo contrato. Um mock
//      que devolvesse coisa diferente do real treinaria a tela errada — foi o caso já registrado do
//      `emitirNfse`, que recusava todo Lucro Presumido.
//   2. ⚠⚠ **O MOCK PRECISA ALCANÇAR TODOS OS ESTADOS DE LINHA.** Este projeto foi mordido QUATRO
//      vezes por ramo que só existia em produção. Se as linhas plantadas não cobrirem `pronta`,
//      `conferir`, `consultar` e `pendente` — e, dentro deles, a memória, a consulta que resolve, a
//      consulta que falha, o CPF que não se consulta e o município que a TELA reprova —, metade da
//      tela de conferência é inalcançável offline.

import { createMockApi } from "../mock/mockApi";
import { createRealApi } from "../real/realApi";
import { definirTokens, limparSessao } from "../sessionStore";
import { consultarDocumentos } from "../../features/lote/lib/consultasDoLote";
import { vereditosDoLote } from "../../features/lote/lib/estadoDaLinhaDoLote";

const EMPRESA = "pc-001";

/** Um recorte da lista oficial: os códigos que as linhas plantadas usam. */
const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
  ["3136702", "Juiz de Fora", "MG"],
  ["4106902", "Curitiba", "PR"],
];

const PLANILHA = { name: "notas.xlsx" };

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
  test("as duas funções do lote existem nos dois", () => {
    const mock = createMockApi();
    const real = createRealApi();
    for (const nome of ["baixarModeloDoLote", "lerPlanilhaDoLote"]) {
      expect(typeof mock[nome]).toBe("function");
      expect(typeof real[nome]).toBe("function");
    }
  });
});

describe("o modelo do mock é um .xlsx de verdade", () => {
  test("é um zip, com o tipo de planilha — não um Blob rotulado", async () => {
    const api = await apiLogada();
    const blob = await api.baixarModeloDoLote(EMPRESA);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const bytes = await bytesDoBlob(blob);
    // "PK\x03\x04" — a assinatura do zip, que é o contêiner do xlsx.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const texto = Buffer.from(bytes).toString("latin1");
    expect(texto).toContain("xl/worksheets/sheet1.xml");
  });
});

describe("⚠⚠ TODOS os estados de linha são alcançáveis offline", () => {
  test("a leitura crua já traz os quatro estados", async () => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    expect(r.resumo.prontas).toBeGreaterThan(0);
    expect(r.resumo.conferir).toBeGreaterThan(0);
    expect(r.resumo.consultar).toBeGreaterThan(0);
    expect(r.resumo.pendentes).toBeGreaterThan(0);
    expect(r.resumo.total).toBe(r.linhas.length);
  });

  test("a linha PRONTA vem da MEMÓRIA — o “se já teve antes, só preencher”", async () => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const pronta = r.linhas.find((l) => l.estado === "pronta");
    expect(pronta.origemEndereco).toBe("memoria");
    expect(pronta.dados.tomador.endereco.cMun).toBe("3304557");
  });

  test.each([
    ["municipio_nao_conferido", "conferir"],
    ["zero_a_esquerda_recuperado", "conferir"],
    ["email_fora_de_forma", "conferir"],
  ])("a conferência `%s` está plantada", async (codigo, estado) => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const linha = r.linhas.find((l) => (l.conferencias || []).some((c) => c.codigo === codigo));
    expect(linha).toBeDefined();
    expect(linha.estado).toBe(estado);
  });

  test.each([
    ["cpf_sem_endereco"],
    ["endereco_incompleto"],
    ["valor_ambiguo"],
    ["competencia_ausente"],
  ])("a pendência `%s` está plantada", async (codigo) => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const linha = r.linhas.find((l) => (l.pendencias || []).some((p) => p.codigo === codigo));
    expect(linha).toBeDefined();
    expect(linha.estado).toBe("pendente");
    expect(linha.dados).toBeNull();
  });

  test("⚠ `aConsultar` só tem CNPJ — CPF nunca é mandado para consulta", async () => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    expect(r.aConsultar.length).toBeGreaterThan(1);
    for (const doc of r.aConsultar) expect(doc).toHaveLength(14);
  });
});

describe("⚠⚠ a corrente do segundo passe, offline", () => {
  test("consultar resolve umas linhas, derruba outras — e o lote não trava", async () => {
    const api = await apiLogada();
    const primeira = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});

    const { resultados } = await consultarDocumentos(primeira.aConsultar, {
      consultar: (cnpj) => api.consultarCnpj(cnpj),
      municipios: MUNICIPIOS,
    });
    const segunda = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, { consultas: resultados });

    // Nada mais a consultar, e as três respostas diferentes viraram três desfechos diferentes.
    expect(segunda.aConsultar).toEqual([]);
    expect(segunda.resumo.prontas).toBeGreaterThan(primeira.resumo.prontas);

    const codigos = segunda.linhas.flatMap((l) => (l.pendencias || []).map((p) => p.codigo));
    // ⚠ a consulta que FALHA (rede) e a que responde SEM endereço provável são ramos distintos.
    expect(codigos).toContain("consulta_falhou");
    expect(codigos).toContain("consulta_sem_endereco");
    // ⚠ e a que deu certo entrou como endereço de origem `consulta`.
    expect(segunda.linhas.some((l) => l.origemEndereco === "consulta")).toBe(true);
  });

  test("⚠⚠ PARCIAL: metade consultada reclassifica metade, e o resto continua em `consultar`", async () => {
    const api = await apiLogada();
    const primeira = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const so = primeira.aConsultar.slice(0, 1);

    const { resultados } = await consultarDocumentos(so, {
      consultar: (cnpj) => api.consultarCnpj(cnpj),
      municipios: MUNICIPIOS,
    });
    const segunda = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, { consultas: resultados });

    expect(segunda.aConsultar.length).toBe(primeira.aConsultar.length - 1);
    expect(segunda.resumo.consultar).toBeGreaterThan(0);
  });
});

describe("⚠⚠ a segunda metade da prova do município — o mock precisa alcançá-la", () => {
  test("uma linha `conferir` do servidor vira PENDENTE na tela (código fora da lista do IBGE)", async () => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const { linhas } = vereditosDoLote(r, { municipios: MUNICIPIOS });

    const rebaixada = linhas.find((l) =>
      (l.pendencias || []).some((p) => p.codigo === "municipio_inexistente")
    );
    expect(rebaixada).toBeDefined();
    expect(rebaixada.estado).toBe("pendente");
    // No servidor, a MESMA linha estava em `conferir`.
    expect(r.linhas.find((l) => l.numero === rebaixada.numero).estado).toBe("conferir");
  });

  test("e a linha de código válido é resolvida, com município e UF", async () => {
    const api = await apiLogada();
    const r = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const { linhas } = vereditosDoLote(r, { municipios: MUNICIPIOS });
    expect(linhas.some((l) => l.municipio === "Rio de Janeiro / RJ")).toBe(true);
  });
});

describe("o ajuste, offline", () => {
  test("o endereço digitado leva a linha de pendente a conferir, e ela fica marcada", async () => {
    const api = await apiLogada();
    const antes = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {});
    const alvo = antes.linhas.find((l) => (l.pendencias || []).some((p) => p.codigo === "cpf_sem_endereco"));

    const depois = await api.lerPlanilhaDoLote(EMPRESA, PLANILHA, {
      ajustes: {
        [alvo.numero]: {
          cMun: "3304557",
          cep: "20040020",
          xLgr: "Rua da Assembleia",
          nro: "10",
          xBairro: "Centro",
        },
      },
    });
    const linha = depois.linhas.find((l) => l.numero === alvo.numero);
    expect(linha.estado).toBe("conferir");
    expect(linha.ajustada).toBe(true);
    expect(depois.linhasAjustadas).toEqual([alvo.numero]);
  });

  test("⚠ campo desconhecido RECUSA nomeando — nada é aplicado em silêncio", async () => {
    const api = await apiLogada();
    await expect(
      api.lerPlanilhaDoLote(EMPRESA, PLANILHA, { ajustes: { 2: { cidade: "Rio" } } })
    ).rejects.toMatchObject({ code: "ajuste_coluna_desconhecida" });
  });

  test("⚠ linha que não existe RECUSA nomeando", async () => {
    const api = await apiLogada();
    await expect(
      api.lerPlanilhaDoLote(EMPRESA, PLANILHA, { ajustes: { 999: { cep: "20040020" } } })
    ).rejects.toMatchObject({ code: "ajuste_linha_desconhecida" });
  });
});

describe("as recusas da leitura são alcançáveis offline", () => {
  test.each([
    ["#cabecalho.xlsx", "planilha_sem_cabecalho"],
    ["#vazia.xlsx", "planilha_sem_linhas"],
    ["#colunas.xlsx", "planilha_colunas_faltando"],
  ])("o arquivo `%s` produz `%s`", async (name, codigo) => {
    const api = await apiLogada();
    await expect(api.lerPlanilhaDoLote(EMPRESA, { name }, {})).rejects.toMatchObject({ code: codigo });
  });
});

/**
 * Blob → bytes.
 *
 * ⚠ `blob.arrayBuffer()` NÃO existe no jsdom desta versão do Jest (existe no navegador), e
 * `FileReader` existe nos dois — a mesma nota já registrada em `loteDanfseNoMock.test.js`.
 */
function bytesDoBlob(blob) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(leitor.error);
    leitor.onload = () => resolve(new Uint8Array(leitor.result));
    leitor.readAsArrayBuffer(blob);
  });
}
