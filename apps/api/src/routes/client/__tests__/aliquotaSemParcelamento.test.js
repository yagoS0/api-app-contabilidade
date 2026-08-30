// ⚠⚠ A PARCELA DE PARCELAMENTO NÃO ENTRA NA ALÍQUOTA DA COMPETÊNCIA (30/08/2026).
//
// Relato do dono: *"o painel informa que a última alíquota foi de 1,41%, isso é impossível, se
// tratando de 07/2026."*
//
// ⚠⚠ MEDIDO EM PRODUÇÃO (ERISANGELA LACERDA PEREIRA, competência 2026-07):
//
//   o numerador de `efetiva` era ... R$    323,83  ← **Parcela 8 de parcelamento**, paga em 13/07
//   o faturamento da competência ... R$ 23.040,26
//   ⇒ efetiva ...................... **1,41%**
//   a verdade (apuração TRANSMITIDA): DAS R$ 1.437,15 / R$ 23.040,26 = **6,24%**
//
// A parcela paga DÍVIDA PASSADA — ela não é imposto sobre a receita deste mês. Dividi-la pelo
// faturamento produz um percentual que não significa nada, e o DAS real de 07 nem estava no
// numerador: ele continua em aberto.
//
// ⚠ Este arquivo é uma VARREDURA DA FONTE, não um teste de comportamento, e a escolha é
// deliberada: o defeito é uma cláusula ausente num `where` do Prisma. Um teste de comportamento com
// dublê passaria com a cláusula de volta removida — foi assim que `legacyCompanySelect` mordeu três
// vezes nesta casa, e por isso a trava daquele também é textual.

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(
  path.join(__dirname, "..", "index.js"),
  "utf8",
);

/**
 * ⚠ Os blocos de comentário saem ANTES dos de linha — a ordem importa, e este projeto já pagou por
 * ela: um `//` dentro de um `/* *\/` faria a varredura cortar o arquivo no lugar errado.
 */
const SEM_COMENTARIO = FONTE
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

/** Os trechos de código que consultam guias PAGAS — é neles que a cláusula tem de estar. */
function blocosDeGuiaPaga(fonte) {
  const blocos = [];
  const re = /paymentStatus:\s*"PAID"/g;
  let m;
  while ((m = re.exec(fonte)) !== null) {
    // ⚠ A janela é generosa dos DOIS lados: a cláusula pode estar antes ou depois do
    // `paymentStatus` dentro do mesmo `where`, e um recorte só para a frente perderia metade.
    blocos.push(fonte.slice(Math.max(0, m.index - 400), m.index + 400));
  }
  return blocos;
}

describe("⚠⚠ a alíquota da competência não conta parcela de parcelamento", () => {
  it("existem consultas de guia PAGA nesta rota — senão a varredura não mede nada", () => {
    // ⚠ Sem esta guarda, apagar as duas consultas deixaria o teste VERDE por vacuidade.
    expect(blocosDeGuiaPaga(SEM_COMENTARIO).length).toBeGreaterThanOrEqual(2);
  });

  it("⚠⚠ TODA consulta de guia PAGA carrega `parcelamentoId: null`", () => {
    // É o MESMO recorte que `guideCompliance` aplica no dashboard. Sem ele, a parcela (gravada com
    // `tipo: "SIMPLES"`, idêntica ao DAS) entra como se fosse o imposto do mês.
    for (const bloco of blocosDeGuiaPaga(SEM_COMENTARIO)) {
      expect(bloco).toMatch(/parcelamentoId:\s*null/);
    }
  });

  it("⚠ a cláusula está nas DUAS rotas — a singular e a SÉRIE", () => {
    // ⚠⚠ O card do painel lê a SÉRIE (`api.getAliquotas`), a tela de detalhe lê a singular. Numa só
    // delas, as duas telas mostrariam alíquotas diferentes para a MESMA empresa e o MESMO mês — que
    // é o defeito que o próprio comentário daquela rota já registra para o bloco por lançamento.
    const ocorrencias = (SEM_COMENTARIO.match(/parcelamentoId:\s*null/g) || []).length;
    expect(ocorrencias).toBeGreaterThanOrEqual(2);
  });
});

describe("⚠ a aritmética do defeito, para ninguém a redescobrir", () => {
  it("os números medidos em produção reproduzem 1,41% e 6,24%", () => {
    const faturamento = 23040.26;
    const parcelaPaga = 323.83;
    const dasDaApuracao = 1437.15;

    // ⚠ O que a tela mostrava: a parcela dividida pela receita do mês.
    expect(Number(((parcelaPaga / faturamento) * 100).toFixed(2))).toBe(1.41);
    // ⚠ O que a Receita calculou, e o que `deReceita` e a apuração transmitida já diziam.
    expect(Number(((dasDaApuracao / faturamento) * 100).toFixed(2))).toBe(6.24);
  });
});
