// O MOCK DA RECORRÊNCIA FALA A MESMA LÍNGUA QUE O SERVIDOR.
//
// ⚠⚠ POR QUE ESTE ARQUIVO EXISTE: o mock da Conferência já divergiu do servidor uma vez
// (`casamentos` × `linhas`), e o defeito falha da pior maneira possível — a tela funciona OFFLINE e
// quebra EM PRODUÇÃO, sem nada no console que aponte a causa. A regra do `apps/web/CLAUDE.md` já
// dizia *"manter contratos idênticos"*; o que faltava era alguém verificar.
//
// ⚠ A amarração é TEXTUAL: o backend não é importável daqui (cruzar apps quebra o boot). Mesma
// disciplina de `contratoDaConferencia.test.js`.

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(__dirname, "..", "..", "..", "..", "..", "..", "..");
const FONTE_DA_ROTA = fs.readFileSync(
  path.join(RAIZ, "apps", "api", "src", "routes", "firm", "recorrencia.js"),
  "utf8",
);
const FONTE_DO_SERVICO = fs.readFileSync(
  path.join(RAIZ, "apps", "api", "src", "application", "fluxo", "SerieRecorrenteService.js"),
  "utf8",
);

const { createMockApi } = require("../../../../api/mock/mockApi");
const mock = createMockApi();

const {
  ESTADO_DA_SERIE, LEITURA, ORIGEM_DA_SERIE, LADO,
} = require("../recorrenciaTela.js");

describe("⚠⚠ AS CHAVES DO MOCK EXISTEM NA RESPOSTA DO SERVIDOR", () => {
  it("a listagem devolve as chaves que a rota promete", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    for (const chave of ["series", "cicloAtual", "foraDoAlcance", "indisponivel"]) {
      expect(r).toHaveProperty(chave);
      // ⚠ Cada uma tem de aparecer na FONTE do servidor — renomear lá derruba aqui.
      expect(FONTE_DA_ROTA.includes(chave) || FONTE_DO_SERVICO.includes(chave)).toBe(true);
    }
  });

  it("⚠⚠ cada série traz o que a tela lê — campo fora do serializador some SEM ERRO", () => {
    const CAMPOS = [
      "lado", "chave", "rotulo", "periodicidade", "estado", "origem", "valorDeclarado",
      "leitura", "valorProjetado", "base", "entraNoFluxo", "declaradoEm",
    ];
    return mock.getRecorrencias("emp-1", "2026-08").then((r) => {
      for (const s of r.series) for (const c of CAMPOS) expect(s).toHaveProperty(c);
      for (const c of CAMPOS) expect(FONTE_DO_SERVICO).toContain(c);
    });
  });
});

describe("⚠⚠ O VOCABULÁRIO É O MESMO DOS DOIS LADOS", () => {
  it("as leituras que o mock produz existem no vocabulário da tela", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    const conhecidas = Object.values(LEITURA);
    for (const s of r.series) expect(conhecidas).toContain(s.leitura);
  });

  it("⚠ e o vocabulário da tela é o do SERVIDOR — não um segundo", () => {
    // Uma leitura nova no servidor sem entrada aqui cairia em "leitura desconhecida" na tela; uma
    // aqui sem lá seria texto morto. Os dois casos são divergência.
    const FONTE_DO_DETECTOR = fs.readFileSync(
      path.join(RAIZ, "apps", "api", "src", "application", "fluxo", "lib", "recorrencia.js"),
      "utf8",
    );
    const bloco = /export const LEITURA = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(FONTE_DO_DETECTOR);
    expect(bloco).not.toBeNull();
    const doServidor = [...bloco[1].matchAll(/:\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(Object.values(LEITURA).sort()).toEqual(doServidor);
  });

  it("⚠ os estados e as origens também", () => {
    for (const e of Object.values(ESTADO_DA_SERIE)) expect(FONTE_DO_SERVICO).toContain(`${e}:`);
    for (const o of Object.values(ORIGEM_DA_SERIE)) expect(FONTE_DO_SERVICO).toContain(`${o}:`);
    for (const l of Object.values(LADO)) expect(FONTE_DO_SERVICO).toContain(`${l}:`);
  });
});

describe("⚠⚠ O MOCK EXERCITA TODOS OS RAMOS — senão o desenho nasce inalcançável offline", () => {
  it("as cinco leituras aparecem", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    const vistas = new Set(r.series.map((s) => s.leitura));
    // ⚠ Este projeto foi mordido SETE vezes por ramo que só existia em produção.
    for (const l of Object.values(LEITURA)) expect(vistas).toContain(l);
  });

  it("⚠⚠ DETECTADA e DECLARADA — as duas, porque elas não podem se parecer na tela", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    const origens = new Set(r.series.map((s) => s.origem));
    expect(origens).toContain(ORIGEM_DA_SERIE.DETECTADA);
    expect(origens).toContain(ORIGEM_DA_SERIE.DECLARADA);
    // ⚠ E a CANDIDATA (sem marcação) é um terceiro caso, diferente dos dois.
    expect(origens).toContain(null);
  });

  it("⚠⚠ os DOIS confrontos: declaração sem observação, e declaração divergindo", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    const declaradas = r.series.filter((s) => s.origem === ORIGEM_DA_SERIE.DECLARADA);
    expect(declaradas.some((s) => !s.base?.n && s.valorDeclarado)).toBe(true);
    expect(declaradas.some((s) => s.base?.n > 0 && s.valorProjetado !== Number(s.valorDeclarado))).toBe(true);
  });

  it("⚠ os dois lados, e uma série de cada estado que a tela distingue", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    expect(new Set(r.series.map((s) => s.lado))).toEqual(new Set([LADO.RECEITA, LADO.DESPESA]));
    const estados = new Set(r.series.map((s) => s.estado));
    expect(estados).toContain(ESTADO_DA_SERIE.ATIVA);
    expect(estados).toContain(ESTADO_DA_SERIE.PENDENTE);
    expect(estados).toContain(null);
  });

  it("⚠⚠ e o que fica FORA da leitura sai contado — a limitação declarada não pode sumir", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    expect(r.foraDoAlcance.length).toBeGreaterThan(0);
    expect(r.foraDoAlcance[0].quantos).toBeGreaterThan(0);
    expect(r.foraDoAlcance[0].frase).toBeTruthy();
  });

  it("⚠ uma série ANUAL existe — é a taxa do Conselho, o caso que decide o desenho", async () => {
    const r = await mock.getRecorrencias("emp-1", "2026-08");
    expect(r.series.some((s) => s.periodicidade === "ANUAL")).toBe(true);
  });
});

describe("⚠ o mock NÃO decide nada — ele ecoa", () => {
  it("marcar devolve o que recebeu", async () => {
    const r = await mock.postMarcarRecorrencia("emp-1", { lado: "DESPESA", estado: "ATIVA" });
    expect(r.serie).toMatchObject({ lado: "DESPESA", estado: "ATIVA" });
  });

  it("⚠ reimplementar a regra aqui faria a tela offline aceitar o que a de produção recusa", () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "api", "mock", "mockApi.js"),
      "utf8",
    );
    const i = fonte.indexOf("async postMarcarRecorrencia");
    const bloco = fonte.slice(i, i + 600);
    expect(bloco).not.toMatch(/lerSerie|PISO_DE_OBSERVACOES|mediana/);
  });
});
