// RECALCULAR GUIA VENCIDA PELO PORTAL DO CLIENTE — varredura de fonte + a regra da tradução.
//
// ⚠⚠ CADA CLIQUE AQUI É UMA CHAMADA PAGA ao SERPRO, contra o teto mensal do ESCRITÓRIO INTEIRO: um
// cliente insistindo consome o orçamento de toda a carteira. É a primeira porta do portal do cliente
// que gasta dinheiro do escritório.
//
// ⚠⚠ O QUE ESTE ARQUIVO **NÃO** PROVA: os blocos de varredura não sobem Express nem executam
// middleware — eles leem o ARQUIVO da rota. Provam que as guardas estão escritas e na ordem, não que
// barrem uma requisição real. Mesmo limite de `escopoGlobalNaRota.test.js`. O bloco da TRADUÇÃO, ao
// contrário, exercita a função de verdade.

import fs from "node:fs";
import path from "node:path";
import { traduzirRecusaParaCliente } from "../../../application/guides/lib/recalculoDaGuia.js";

const ROTA = path.resolve(__dirname, "../index.js");
const fonte = fs.readFileSync(ROTA, "utf-8");
const INICIO = fonte.indexOf('"/companies/:companyId/guides/:guideId/recalculate"');
const bloco = fonte.slice(INICIO, INICIO + 4800);

describe("⚠⚠ AS TRÊS TRAVAS — e nenhuma delas é a tela", () => {
  it("a rota existe, e é POST", () => {
    expect(fonte).toMatch(/router\.post\(\s*\n?\s*"\/companies\/:companyId\/guides\/:guideId\/recalculate"/);
  });

  it("⚠⚠ 1. SÓ GUIA LIBERADA — o gate `liberadaCliente` não se afrouxa", () => {
    // O cliente só alcança guia que o contador liberou. 8 das 9 DARF do LP estão com `false`.
    expect(bloco).toMatch(/liberadaCliente: true/);
    expect(bloco).toMatch(/portalClientId: String\(companyId\)/);
  });

  it("⚠ e guia não liberada volta 404, não 403 — a existência dela não é informação do cliente", () => {
    expect(bloco).toMatch(/return res\.status\(404\)\.json\(\{ error: "not_found" \}\)/);
  });

  it("⚠⚠ 2. SÓ GUIA VENCIDA (decisão do dono) — e a recusa é NOMEADA", () => {
    expect(bloco).toMatch(/if \(!isGuideOverdue\(guide, new Date\(\)\)\)/);
    expect(bloco).toMatch(/"guia_nao_vencida"/);
  });

  it("⚠⚠ 3. e a regra do recálculo é conferida NO SERVIDOR", () => {
    // Guia paga, parcela de parcelamento e guia que não é do SERPRO ficam de fora aqui, não na tela.
    expect(bloco).toMatch(/if \(!canGuideRecalculate\(guide\)\)/);
    expect(bloco).toMatch(/"recalculo_indisponivel"/);
  });

  it("⚠ as três guardas vêm ANTES de qualquer chamada paga", () => {
    const iLiberada = bloco.indexOf("liberadaCliente: true");
    const iPode = bloco.indexOf("canGuideRecalculate(guide)");
    const iVencida = bloco.indexOf("isGuideOverdue(guide");
    const iChamada = bloco.indexOf("comContextoSerpro(contexto");
    for (const i of [iLiberada, iPode, iVencida]) {
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(iChamada);
    }
  });

  it("⚠ o gate é `requireClientCompanyAccess()` SEM `minRole` — o piso das rotas financeiras", () => {
    expect(bloco).toMatch(/requireClientCompanyAccess\(\),/);
    expect(bloco).not.toMatch(/requireClientCompanyAccess\(\{/);
  });
});

describe("⚠⚠ O GASTO SE IDENTIFICA, E O CLIENTE NÃO FURA O TETO", () => {
  it("a origem é PRÓPRIA e não se confunde com a do contador", () => {
    // Sem isso o `serpro_chamadas` não distinguiria quem gastou.
    expect(bloco).toMatch(/origem: "cliente:recalcular"/);
    expect(fonte).not.toMatch(/origem: "guias:recalcular"/);
  });

  it("⚠⚠ `forcar` é FALSO, cravado — furar o teto é decisão de um ADMIN do escritório", () => {
    expect(bloco).toMatch(/forcar: false/);
    expect(bloco).not.toMatch(/podeForcarSerpro/);
  });
});

describe("⚠⚠ A RECUSA CHEGA TRADUZIDA — nada de orçamento do escritório na tela do cliente", () => {
  it("a rota usa a tradução, e nunca ecoa `err.message`", () => {
    expect(bloco).toMatch(/traduzirRecusaParaCliente\(err\)/);
    expect(bloco).not.toMatch(/err\?\.message|err\.message/);
  });

  it("⚠⚠ as três recusas da guarda de orçamento NÃO citam teto, consumo nem o fornecedor", () => {
    // A mensagem original diz "O escritório já consumiu 412 consultas pagas ao SERPRO neste mês
    // (teto 500, = 34 empresas × …)". Repassá-la publicaria o orçamento interno.
    for (const code of ["SERPRO_TETO_DIARIO", "SERPRO_TETO_MENSAL_ESCRITORIO", "SERPRO_CHAMADA_REPETIDA"]) {
      const r = traduzirRecusaParaCliente({ code, message: "O escritório já consumiu 412 consultas pagas ao SERPRO neste mês (teto 500)" });
      expect(r.mensagem).not.toMatch(/teto|escritório|SERPRO|consumiu|\d{2,}/i);
    }
  });

  it("⚠ o teto manda falar com o contador; a repetição manda esperar — consertos diferentes", () => {
    expect(traduzirRecusaParaCliente({ code: "SERPRO_TETO_MENSAL_ESCRITORIO" }).mensagem).toMatch(/Fale com o seu contador/);
    expect(traduzirRecusaParaCliente({ code: "SERPRO_TETO_MENSAL_ESCRITORIO" }).podeTentarDeNovo).toBe(false);
    expect(traduzirRecusaParaCliente({ code: "SERPRO_CHAMADA_REPETIDA" }).mensagem).toMatch(/Aguarde alguns minutos/);
    expect(traduzirRecusaParaCliente({ code: "SERPRO_CHAMADA_REPETIDA" }).podeTentarDeNovo).toBe(true);
  });

  it("⚠⚠ CÓDIGO DESCONHECIDO CAI NA FRASE GENÉRICA — falha FECHADO", () => {
    // Um código novo do SERPRO nasce traduzido em vez de vazar. E os erros do serviço carregam
    // idServiço, CNPJ do procurador e nomes de configuração.
    for (const err of [
      { code: "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED", message: "procurador 12345678000199 não configurado" },
      { code: "COISA_NOVA", message: "detalhe interno" },
      {},
      null,
    ]) {
      const r = traduzirRecusaParaCliente(err);
      expect(r.mensagem).toMatch(/Não foi possível gerar a guia atualizada agora/);
      expect(r.mensagem).not.toMatch(/12345678000199|detalhe interno|procurador/);
    }
  });

  it("⚠ o CÓDIGO viaja (a tela pode distinguir os casos); a MENSAGEM original, nunca", () => {
    const r = traduzirRecusaParaCliente({ code: "SERPRO_TETO_DIARIO", message: "vazamento" });
    expect(r.codigo).toBe("SERPRO_TETO_DIARIO");
    expect(JSON.stringify(r)).not.toMatch(/vazamento/);
  });

  it("⚠ trava de orçamento responde 429; falha do serviço externo responde 502", () => {
    expect(bloco).toMatch(/travaDeOrcamento \? 429 : 502/);
  });
});

describe("⚠ O QUE VOLTA AO CLIENTE", () => {
  it("a guia é serializada com o público do CLIENTE", () => {
    const usos = [...bloco.matchAll(/toGuideResponse\(atualizada, \{ publico: PUBLICO\.CLIENTE \}\)/g)];
    expect(usos.length).toBe(2);
    expect(bloco).not.toMatch(/PUBLICO\.ESCRITORIO/);
  });

  it("⚠ e a leitura dos acréscimos vai TAMBÉM para ele — quem paga precisa saber antes de pagar", () => {
    expect(bloco).toMatch(/acrescimos: leituraDosAcrescimos\(darf\.composicao, \{ ehCliente: true \}\)/);
  });

  it("⚠⚠ e ela vai com `ehCliente` — senão a frase manda o CLIENTE 'enviar ao cliente'", () => {
    // Achado no navegador em 27/08/2026, sobre a tela do cliente.
    expect(bloco).toMatch(/ehCliente: true/);
  });
});
