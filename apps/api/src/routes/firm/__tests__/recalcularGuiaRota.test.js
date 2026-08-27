// A ROTA DE RECALCULAR GUIA — varredura de fonte.
//
// ⚠⚠ O QUE ESTE ARQUIVO **NÃO** PROVA: nada aqui sobe Express nem executa middleware. Ele lê o
// ARQUIVO da rota e prova que a ligação está escrita — não que ela se comporte assim numa
// requisição real. Mesmo limite (e mesmo molde) de `escopoGlobalNaRota.test.js`.

import fs from "node:fs";
import path from "node:path";

const ROTA = path.resolve(__dirname, "../index.js");
const fonte = fs.readFileSync(ROTA, "utf-8");
const INICIO = fonte.indexOf('"/guides/:guideId/recalculate"');
const bloco = fonte.slice(INICIO, INICIO + 4200);

describe("⚠⚠ A ORIGEM ANÔNIMA — o gasto mais visível do contador não se identificava", () => {
  it("a rota é envolvida por `comContextoSerpro`", () => {
    // Medido em 27/08/2026: `comContextoSerpro` envolvia 4 pontos de chamada, e este não era um
    // deles. `serpro_chamadas.origem` gravava `null`, sem `userId`.
    expect(bloco).toMatch(/comContextoSerpro\(contexto,/);
  });

  it("com origem NOMEADA e o usuário que clicou", () => {
    expect(bloco).toMatch(/origem: "guias:recalcular"/);
    expect(bloco).toMatch(/userId: req\.auth\?\.user\?\.id/);
  });

  it("⚠ e o ADMIN volta a conseguir `?forcar=1` aqui", () => {
    // Sem `forcar`, o escape que a guarda de orçamento oferece (ADMIN **e** `?forcar=1`) não
    // existia justamente na rota que mais gasta.
    expect(bloco).toMatch(/forcar: podeForcarSerpro\(req\)/);
  });

  it("⚠⚠ o contexto envolve AS DUAS espécies — não só a nova", () => {
    // Envolver só o ramo do Presumido deixaria o DAS, que é a maioria dos cliques, anônimo.
    const chamadas = [...bloco.matchAll(/comContextoSerpro\(contexto,/g)];
    expect(chamadas.length).toBe(2);
  });
});

describe("⚠⚠ A DARF DO PRESUMIDO TEM CAMINHO PRÓPRIO", () => {
  it("a espécie é decidida pela regra, não por um `if` de tipo escrito aqui", () => {
    // `tipo: "OUTRA"` + SERPRO também é a guia de INSS/DCTFWeb: um `if` por tipo mandaria a guia
    // de INSS para o serviço errado.
    expect(bloco).toMatch(/especieDoRecalculo\(scoped\.guide\)/);
    expect(bloco).toMatch(/ESPECIE_RECALCULO\.DARF_PRESUMIDO/);
    expect(bloco).not.toMatch(/tipo === "OUTRA"/);
  });

  it("⚠ ele chama `reemitirDarfLp`, NÃO a captura inteira", () => {
    // A captura são DUAS chamadas pagas (CONSDECCOMPLETA33 + GERARGUIA31). Recalcular pede a GUIA
    // outra vez; a apuração declarada não mudou.
    expect(bloco).toMatch(/reemitirDarfLp\(/);
    expect(bloco).not.toMatch(/capturarLpDaCompetencia/);
  });

  it("o DAS continua escolhendo COBRANCA quando vencida", () => {
    expect(bloco).toMatch(/vencida \? SERPRO_PGDASD_SERVICE_COBRANCA : SERPRO_PGDASD_SERVICE_NORMAL/);
  });
});

describe("⚠⚠ A FALHA VISÍVEL DOS ACRÉSCIMOS", () => {
  it("a resposta traz a leitura da composição, pela regra", () => {
    // Não está confirmado que o `GERARGUIA31` gere a DARF com juros e multa quando vencida. A tela
    // recebe o que se VIU no documento, com três respostas.
    expect(bloco).toMatch(/acrescimos: leituraDosAcrescimos\(darf\.composicao\)/);
  });

  it("⚠ e a rota NÃO decide sozinha se veio acréscimo", () => {
    // Uma segunda leitura aqui divergiria da regra na primeira correção — e esta decide se o
    // contador manda ao cliente uma guia a menor.
    expect(bloco).not.toMatch(/multa\s*>\s*0|juros\s*>\s*0/);
  });

  it("`vencida` e `especie` chegam ao chamador nos DOIS ramos", () => {
    const ocorrencias = [...bloco.matchAll(/\n\s+vencida,\n/g)];
    expect(ocorrencias.length).toBe(2);
  });
});
