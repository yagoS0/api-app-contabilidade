// O MOCK DA CONFERÊNCIA FALA A MESMA LÍNGUA QUE O SERVIDOR.
//
// ⚠⚠ POR QUE ESTE ARQUIVO EXISTE, e ele nasceu de um defeito real (25/08/2026): o mock devolvia
// `casamentos` e a rota devolve **`linhas`**. A tela lida com isso da pior maneira possível — ela
// funciona OFFLINE e quebra EM PRODUÇÃO, ou seja, o erro só aparece depois do deploy, na mão do
// contador, sem nada no console que aponte para a causa.
//
// A regra do `apps/web/CLAUDE.md` já dizia *"manter contratos de resposta idênticos entre mock e
// real"* — o que faltava era alguém verificar. É isso que este teste faz.
//
// ⚠ A AMARRAÇÃO É TEXTUAL, e é de propósito: o backend não é importável daqui (cruzar apps quebra o
// boot, e o Dockerfile não copia tudo). Mesma disciplina do teste que amarra `"autorizada"` à
// `whereFaturamentoEmit`, e das varreduras de fonte de `routes/client/__tests__/`.

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(__dirname, "..", "..", "..", "..", "..", "..", "..");
const FONTE_DA_ROTA = fs.readFileSync(
  path.join(RAIZ, "apps", "api", "src", "routes", "firm", "conferencia.js"),
  "utf8",
);

const { createMockApi } = require("../../../../api/mock/mockApi");
const mock = createMockApi();

/**
 * Cada chave é conferida DUAS vezes: que o mock a produz, e que a fonte do servidor a escreve.
 * Renomear no backend derruba a segunda; esquecer no mock derruba a primeira.
 */
const CONTRATOS = [
  {
    o_que: "a fila",
    chamar: () => mock.getConferenciaFila("emp-1", { competencia: "2026-07" }),
    chaves: ["itens", "porEstado", "total"],
  },
  {
    o_que: "as sugestões de casamento",
    chamar: () => mock.getConferenciaCasamentos("emp-1"),
    // ⚠⚠ `linhas`, NÃO `casamentos`. Foi exatamente aqui que o mock divergiu.
    chaves: ["linhas", "totalDebitos", "totalNotas"],
  },
  {
    o_que: "a varredura de notas",
    chamar: () => mock.postVarrerNotas("emp-1", "2026-07-01"),
    chaves: ["varridas", "criados", "jaExistiam", "fora", "recusados"],
  },
  {
    o_que: "a varredura de invariantes",
    chamar: () => mock.getConferenciaVarredura("emp-1"),
    chaves: [
      "lancamentoForaDeContabilizado",
      "contabilizadoSemLancamento",
      "ponteiroPendurado",
      "semDataDePagamento",
    ],
  },
];

describe("⚠⚠ AS CHAVES DO MOCK EXISTEM NA RESPOSTA DO SERVIDOR", () => {
  for (const c of CONTRATOS) {
    it(`${c.o_que}: o mock devolve exatamente as chaves que a rota promete`, async () => {
      const r = await c.chamar();
      for (const chave of c.chaves) expect(r).toHaveProperty(chave);
    });

    it(`${c.o_que}: cada chave aparece na FONTE da rota — renomear no backend quebra aqui`, () => {
      for (const chave of c.chaves) {
        // ⚠ A chave pode estar escrita literalmente na rota (`linhas:`) ou vir de um spread do
        // serviço (`...r`). No segundo caso ela aparece no serviço, então aceitamos as duas provas.
        const naRota = new RegExp(`\\b${chave}\\b`).test(FONTE_DA_ROTA);
        expect(naRota || FONTE_ESPALHADA.includes(chave)).toBe(true);
      }
    });
  }
});

/** As fontes que a rota espalha com `...r` — é lá que as chaves de fato nascem. */
const FONTE_ESPALHADA = [
  path.join(RAIZ, "apps", "api", "src", "application", "declarados", "DeclaradoService.js"),
  path.join(RAIZ, "apps", "api", "src", "application", "declarados", "VarreduraDeNotasService.js"),
]
  .map((p) => fs.readFileSync(p, "utf8"))
  .join("\n");

describe("⚠⚠ O CASO QUE ESTE ARQUIVO FOI ESCRITO PARA PEGAR", () => {
  it("⚠⚠ a chave do casamento é `linhas` — `casamentos` NÃO existe no servidor", async () => {
    const r = await mock.getConferenciaCasamentos("emp-1");
    expect(r).toHaveProperty("linhas");
    expect(r).not.toHaveProperty("casamentos");
    expect(FONTE_DA_ROTA).toMatch(/linhas: r\.linhas\.map/);
  });

  it("⚠ a sugestão devolve `pista` e `frase`, e NÃO `palavra`", async () => {
    // Campo a mais no mock vira tela que lê `undefined` em produção — e `undefined` não quebra
    // nada, só some da tela.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const comSugestao = linhas.find((l) => l.sugestao);
    expect(comSugestao.sugestao).toEqual(
      expect.objectContaining({ nota: expect.any(Object), pista: expect.any(String), frase: expect.any(String) }),
    );
    expect(comSugestao.sugestao).not.toHaveProperty("palavra");
    expect(FONTE_DA_ROTA).toMatch(/pista: l\.sugestao\.pista, frase: l\.sugestao\.frase/);
  });

  it("⚠⚠ AMBIGUIDADE: com dois candidatos, `sugestao` é NULA e os dois voltam", async () => {
    // O sistema não escolhe entre notas. Se o mock trouxesse uma sugestão eleita aqui, a tela
    // nasceria sem o desenho que impede a despesa de ir para o fornecedor errado.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const ambiguo = linhas.find((l) => l.motivo === "ambiguo");
    expect(ambiguo).toBeDefined();
    expect(ambiguo.sugestao).toBeNull();
    expect(ambiguo.candidatos.length).toBeGreaterThan(1);
  });

  it("⚠ o mock exercita as TRÊS respostas do casamento", async () => {
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const motivos = linhas.map((l) => l.motivo);
    expect(new Set(motivos)).toEqual(new Set([null, "ambiguo", "nenhum_candidato"]));
  });
});

describe("⚠⚠ A DATA-PISO DA VARREDURA É OBRIGATÓRIA no servidor", () => {
  it("a rota recusa sem `desde`, com código nomeado", () => {
    // São 1.897 notas recebidas: sem corte, a primeira varredura produz a base inteira de uma vez —
    // e isso não é fila, é muro. A tela NÃO pode inventar um default.
    expect(FONTE_DA_ROTA).toMatch(/error: "data_piso_obrigatoria"/);
    expect(FONTE_DA_ROTA).toMatch(/error: "data_piso_invalida"/);
  });

  it("⚠ a rota NÃO tem default de data — nenhum `desde ||` nem `?? new Date`", () => {
    const trecho = FONTE_DA_ROTA.slice(FONTE_DA_ROTA.indexOf("varrer-notas"));
    expect(trecho).not.toMatch(/desde\s*(\|\||\?\?)\s*[^;]*Date/);
  });
});
