// ⚠⚠ OS DOIS VOCABULÁRIOS DESTA TELA SÃO ESPELHOS DO BACKEND — e ficar incompleto é SILENCIOSO.
//
// Medido em 01/09/2026, antes desta entrega:
//
//   `ORIGEM`            backend 4 · tela 0   → nenhuma linha dizia de onde a despesa veio
//   `ORIGEM_PAGAMENTO`  backend 5 · tela 3   → **"Procedência desconhecida"** em duas delas
//
// ⚠⚠ O SEGUNDO É O CARO, e o motivo de ninguém ter percebido é que o fallback **não mente**: ele
// diz "esta tela não reconhece a procedência desta data". O que se perdia era informação — numa
// linha a PROVA do extrato em planilha era rebaixada a desconhecida; na outra sumia o aviso de que
// **ninguém viu o pagamento acontecer** (a data foi presumida por uma regra).
//
// ⚠ Os dois módulos não são importáveis daqui (o do backend é de outro app, e carrega o Prisma por
// transitividade), então a amarração é **TEXTUAL**: este arquivo LÊ a fonte da api e exige que cada
// valor declarado lá tenha lugar aqui. É a mesma disciplina de `duasTabelasDeAnexo.test.js` e das
// varreduras de `select` da api. Valor novo lá derruba isto aqui — que é o ponto.

import fs from "node:fs";
import path from "node:path";
import { ORIGEM_PAGAMENTO, leituraDaOrigemDoPagamento } from "../conferenciaTela";
import { ORIGEM_NA_TELA } from "../naturezaDaConferencia";

const FONTE = path.join(
  __dirname,
  "../../../../../../api/src/application/declarados/lib/estadosDeclarado.js",
);

/** As chaves declaradas dentro de um `Object.freeze({...})` nomeado, lidas do TEXTO da fonte. */
function chavesDoEnum(nome) {
  const fonte = fs.readFileSync(FONTE, "utf8");
  const i = fonte.indexOf(`export const ${nome} = Object.freeze({`);
  expect(i).toBeGreaterThan(-1);
  const corpo = fonte.slice(i, fonte.indexOf("\n});", i));
  // ⚠ `VALOR: "VALOR"` — só a forma literal do vocabulário. Comentários e JSDoc não casam, e é
  // isso que mantém a leitura estreita: um bloco de texto citando `OFX:` dentro de um comentário
  // não vira chave (nenhum deles começa a linha com o par).
  return [...corpo.matchAll(/^\s{2}([A-Z_]+):\s*"([A-Z_]+)",/gm)].map((m) => m[2]);
}

describe("⚠⚠ `ORIGEM` — de onde a despesa nasceu (o chip da linha)", () => {
  const doBackend = chavesDoEnum("ORIGEM");

  it("o backend declara quatro origens", () => {
    // Se este número mudar, é porque nasceu origem nova — e ela precisa de rótulo, não de silêncio.
    expect(doBackend).toHaveLength(4);
  });

  it.each([["NOTA_RECEBIDA"], ["CLIENTE_MANUAL"], ["OFX_CLIENTE"], ["EXTRATO_EXCEL_CLIENTE"]])(
    "%s está na fonte da api",
    (v) => expect(doBackend).toContain(v),
  );

  it("⚠⚠ TODA origem do backend tem chip nesta tela", () => {
    for (const v of doBackend) expect(ORIGEM_NA_TELA[v]).toBeTruthy();
  });

  it("⚠ e a tela não inventa origem que o backend não declara", () => {
    for (const v of Object.keys(ORIGEM_NA_TELA)) expect(doBackend).toContain(v);
  });
});

describe("⚠⚠ `ORIGEM_PAGAMENTO` — de onde veio a DATA (prova × declaração)", () => {
  const doBackend = chavesDoEnum("ORIGEM_PAGAMENTO");

  it("o backend declara cinco procedências", () => {
    expect(doBackend).toHaveLength(5);
  });

  it("⚠⚠ TODA uma delas é reconhecida — nenhuma cai em «Procedência desconhecida»", () => {
    for (const v of doBackend) {
      expect(ORIGEM_PAGAMENTO[v]).toBe(v);
      expect(leituraDaOrigemDoPagamento(v).rotulo).not.toMatch(/desconhecid/i);
    }
  });

  it("⚠⚠ o EXTRATO EM PLANILHA é PROVA — rebaixá-la a «desconhecida» era o defeito", () => {
    // O banco afirma que o dinheiro saiu, nos dois formatos. O que muda é o mapeamento de colunas.
    const r = leituraDaOrigemDoPagamento("EXTRATO_EXCEL");
    expect(r.ehProva).toBe(true);
    expect(r.frase).toMatch(/planilha/i);
  });

  it("⚠⚠ e ela NÃO é o OFX — as duas provam, e não com a mesma força", () => {
    // Colapsá-las apagaria a diferença exatamente na tela em que ela importa.
    expect(leituraDaOrigemDoPagamento("EXTRATO_EXCEL").rotulo)
      .not.toBe(leituraDaOrigemDoPagamento("OFX").rotulo);
  });

  it("⚠⚠ a data PRESUMIDA POR REGRA não é prova, e a tela diz que ninguém viu o pagamento", () => {
    // É a única procedência em que o lançamento afirma uma saída de caixa que ninguém testemunhou.
    const r = leituraDaOrigemDoPagamento("PRESUMIDO_POR_REGRA");
    expect(r.ehProva).toBe(false);
    expect(r.frase).toMatch(/ninguém viu/i);
    expect(r.frase).toMatch(/regra/i);
  });

  it("⚠ e ela NÃO se confunde com «declarado pelo contador»", () => {
    // Aquele atribuiria ao contador um ato que ele não praticou naquele mês; o conserto é outro.
    expect(leituraDaOrigemDoPagamento("PRESUMIDO_POR_REGRA").rotulo)
      .not.toBe(leituraDaOrigemDoPagamento("DECLARADO_PELO_CONTADOR").rotulo);
  });

  it("⚠ AUSÊNCIA continua não virando prova, e valor desconhecido continua sendo dito", () => {
    // O fallback não some por estar completo — ele é a rede para o valor que nascer amanhã.
    expect(leituraDaOrigemDoPagamento(null).ehProva).toBe(false);
    expect(leituraDaOrigemDoPagamento("VALOR_QUE_ALGUEM_ACRESCENTAR").rotulo).toMatch(/desconhecid/i);
    expect(leituraDaOrigemDoPagamento("VALOR_QUE_ALGUEM_ACRESCENTAR").ehProva).toBe(false);
  });
});
