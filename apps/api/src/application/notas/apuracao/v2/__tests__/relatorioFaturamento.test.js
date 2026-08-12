// RELATÓRIO "Faturamento no Período — Consolidado" — o que ele NÃO pode fazer.
//
// Cinco travas, e a última é a que mais importa:
//
// 1. O agrupamento por tipo de operação sai do que EXISTE (`tipoReceita`) combinado com o
//    vocabulário da RECEITA (Manual do PGDAS-D, itens 6.5 e 6.6.1) — nunca com os códigos
//    `01`/`02` do Scritta, que não existem em fonte pública nenhuma.
// 2. O grupo NÃO CLASSIFICADO aparece nomeado, separado e por último — nunca somado no meio dos
//    outros. É ele que diz ao contador que a competência não foi classificada, e hoje ele é o
//    grupo de TODA a receita: `tipoReceita` é nulo em 16.153/16.153 itens em produção.
// 3. ⚠ **A SEGREGAÇÃO DO ITEM 6.5 TEM TRÊS ESTADOS.** `flagST`/`flagMonofasico` não têm escritor,
//    então `false` no banco é o default da coluna, não uma conferência. Lê-lo como a opção "Sem
//    substituição tributária/…" seria responder ao PGDAS-D por default em nome do contribuinte.
//    Não há colunas de IPI/ST/Outros/Líquido — o aviso vive uma vez em `limitacoes[]`.
// 4. As 8 qualificações do item 6.6.1 são MODELADAS mesmo vindo sempre vazias: o relatório diz
//    "não apuramos", não omite a dimensão.
// 5. ⚠ **ABRIR O RELATÓRIO NÃO PODE MUDAR A APURAÇÃO.** `calcularApuracaoLocal` sempre persistiu
//    `ApuracaoSnapshot` com `estado:"calculada"` (e `LogDecisaoFatorR` junto). Chamado como
//    estava, o relatório mudaria o estado fiscal da empresa em silêncio, por causa de uma
//    leitura. O modo `persistir:false` existe para isso — e o comportamento de quem já chamava a
//    função (a rota `apurar-v2`) continua gravando, o que também é travado aqui.

jest.mock("../../../../../infrastructure/db/prisma.js", () => {
  const model = () => ({
    findUnique: jest.fn(async () => null),
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    aggregate: jest.fn(async () => ({ _sum: { total: 0 } })),
    count: jest.fn(async () => 0),
    create: jest.fn(async (args) => ({ id: "novo", ...(args?.data || {}) })),
    update: jest.fn(async (args) => ({ id: "existente", ...(args?.data || {}) })),
  });
  return {
    prisma: {
      portalClient: model(),
      portalInvoice: model(),
      apuracaoSnapshot: model(),
      cadastroFiscal: model(),
      filaPendencia: model(),
      companyMonthlyCircular: model(),
      logDecisaoFatorR: model(),
      aliquotaSimplesNacional: model(),
      relatorioFaturamento: model(),
    },
  };
});

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import {
  montarRelatorioFaturamento,
  gerarRelatorioFaturamento,
  modeloDoDocumento,
  grupoDoItem,
  segregacaoDoItem,
  qualificacoesDoItem,
  CHAVE_NAO_CLASSIFICADO,
  QUALIFICACOES,
  SEGREGACAO_REVENDA,
  FLAGS_TEM_ESCRITOR,
} from "../RelatorioFaturamentoService.js";
import { calcularApuracaoLocal } from "../MotorApuracaoService.js";

const PORTAL_ID = "portal-1";
const COMPETENCIA = "2026-06";

// Chave de NF-e real em forma: 44 dígitos, modelo "55" nas posições 20-21.
// cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
const CHAVE_NFE = `35` + `2606` + `34627370000175` + `55` + `001` + `000012345` + `1` + `00000042` + `7`;

const EMPRESA = {
  id: PORTAL_ID, razao: "ADIFER MATERIAIS DE CONSTRUCAO LTDA",
  cnpj: "34627370000175", municipio: "São Paulo", uf: "SP",
};

/** Nota de NF-e com dois itens classificados como REVENDA_MERCADORIA (mesmo grupo). */
const NOTA_REVENDA = {
  id: "nota-revenda", type: "NFE", numero: "12345", serie: "1", chaveAcesso: CHAVE_NFE,
  issueDate: new Date("2026-06-30T12:00:00Z"), competencia: new Date("2026-06-01T00:00:00Z"),
  total: "1000.00", tomadorNome: "CLIENTE A", tomadorDoc: "11222333000181",
  itens: [
    { id: "i1", valor: "600.00", descricao: "Cimento", cfop: "5102", codigoServico: null, ncm: "25232900", tipoReceita: "REVENDA_MERCADORIA", flagST: false, flagMonofasico: false, flagExportacao: false },
    { id: "i2", valor: "400.00", descricao: "Areia", cfop: "5102", codigoServico: null, ncm: "25051000", tipoReceita: "REVENDA_MERCADORIA", flagST: false, flagMonofasico: false, flagExportacao: false },
  ],
};

/** NFS-e classificada como serviço do Anexo III — grupo DIFERENTE do de revenda. */
const NOTA_SERVICO = {
  id: "nota-servico", type: "NFSE", numero: "7", serie: null, chaveAcesso: null,
  issueDate: new Date("2026-06-15T09:00:00Z"), competencia: new Date("2026-06-01T00:00:00Z"),
  total: "500.00", tomadorNome: "CLIENTE B", tomadorDoc: "22333444000192",
  itens: [
    { id: "i3", valor: "500.00", descricao: "Consultoria", cfop: null, codigoServico: "17.01", ncm: null, tipoReceita: "SERVICO_ANEXO_III", flagST: false, flagMonofasico: false, flagExportacao: false },
  ],
};

/** O caso de produção: item SEM `tipoReceita`. */
const NOTA_SEM_CLASSIFICACAO = {
  id: "nota-sem-classe", type: "NFSE", numero: "8", serie: null, chaveAcesso: null,
  issueDate: new Date("2026-06-20T09:00:00Z"), competencia: new Date("2026-06-01T00:00:00Z"),
  total: "300.00", tomadorNome: "CLIENTE C", tomadorDoc: null,
  itens: [
    { id: "i4", valor: "300.00", descricao: "Serviço", cfop: null, codigoServico: "17.01", ncm: null, tipoReceita: null, flagST: false, flagMonofasico: false, flagExportacao: false },
  ],
};

/** NF-e capturada pelo RESUMO (resNFe): existe, tem valor, e NÃO tem item nenhum. */
const NOTA_SEM_ITEM = {
  id: "nota-sem-item", type: "NFE", numero: "99", serie: "1", chaveAcesso: CHAVE_NFE.replace(/.$/, "8"),
  issueDate: new Date("2026-06-28T09:00:00Z"), competencia: new Date("2026-06-01T00:00:00Z"),
  total: "200.00", tomadorNome: null, tomadorDoc: null,
  itens: [],
};

function comNotas(notas) {
  const soma = notas.reduce((s, n) => s + Number(n.total || 0), 0);
  prisma.portalInvoice.findMany.mockResolvedValue(notas);
  prisma.portalInvoice.aggregate.mockResolvedValue({ _sum: { total: soma } });
  prisma.portalClient.findUnique.mockResolvedValue(EMPRESA);
  return soma;
}

/** Empresa apta a apurar: cadastro do Simples, sem pendências, tabela de alíquota cadastrada. */
function comEmpresaApta() {
  prisma.cadastroFiscal.findUnique.mockResolvedValue({
    portalClientId: PORTAL_ID, regime: "SIMPLES_NACIONAL", sublimiteICMSISS: false,
  });
  prisma.filaPendencia.count.mockResolvedValue(0);
  prisma.aliquotaSimplesNacional.findMany.mockResolvedValue([{
    anexo: "I", faixa: 1, rbt12Min: 0, rbt12Max: 180000,
    aliquotaNominal: 0.04, parcelaDeduzir: 0,
    vigenciaInicio: new Date("2018-01-01T00:00:00Z"), vigenciaFim: null,
  }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue(EMPRESA);
  prisma.cadastroFiscal.findUnique.mockResolvedValue(null);
  prisma.filaPendencia.count.mockResolvedValue(0);
  prisma.aliquotaSimplesNacional.findMany.mockResolvedValue([]);
  prisma.companyMonthlyCircular.findFirst.mockResolvedValue(null);
  // ⚠ `jest.clearAllMocks()` limpa as CHAMADAS, não as implementações — sem este reset o
  // `semFaturamento: true` de um teste vaza para o seguinte e o faz passar por engano.
  prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);
  prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
  prisma.relatorioFaturamento.findUnique.mockResolvedValue(null);
  prisma.portalInvoice.findMany.mockResolvedValue([]);
  prisma.portalInvoice.aggregate.mockResolvedValue({ _sum: { total: 0 } });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("1. Agrupamento por TIPO DE OPERAÇÃO — pelo que existe, não pelo Scritta", () => {
  it("itens do mesmo tipoReceita caem num grupo só, com o total somado", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.gruposPorTipoOperacao).toHaveLength(1);
    const [g] = rel.gruposPorTipoOperacao;
    expect(g.tipoReceita).toBe("REVENDA_MERCADORIA");
    expect(g.classificado).toBe(true);
    expect(g.linhas).toHaveLength(2);
    expect(g.total.valorContabil).toBe(1000);
    expect(g.total.itens).toBe(2);
  });

  it("tipoReceita diferente = grupo diferente, cada um com o seu total", async () => {
    comNotas([NOTA_REVENDA, NOTA_SERVICO]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const porTipo = Object.fromEntries(rel.gruposPorTipoOperacao.map((g) => [g.tipoReceita, g.total.valorContabil]));
    expect(porTipo).toEqual({ REVENDA_MERCADORIA: 1000, SERVICO_ANEXO_III: 500 });
    expect(rel.totalMes.valorContabil).toBe(1500);
    expect(rel.totalConsolidado.valorContabil).toBe(1500);
  });

  it("a chave do grupo inclui SEGREGAÇÃO e QUALIFICAÇÕES — é isso que permite subdividir", () => {
    // ⚠ Manual, item 6.5, p. 26: uma mesma atividade pode ter N parcelas de receita com
    // qualificações diferentes (o botão "+" do PGDAS-D). A chave carregar as três dimensões é o
    // que faz "subdividir" virar simplesmente "mais grupos", sem mudança de estrutura.
    const base = { tipoReceita: "REVENDA_MERCADORIA", flagMonofasico: false, flagST: false };
    expect(grupoDoItem(base).chave).toBe("REVENDA_MERCADORIA|INDETERMINADA");
    expect(grupoDoItem({ ...base, flagST: true }).chave)
      .toBe("REVENDA_MERCADORIA|COM|SUBSTITUICAO_TRIBUTARIA");
    expect(grupoDoItem({ ...base, flagMonofasico: true }).chave)
      .toBe("REVENDA_MERCADORIA|COM|TRIBUTACAO_MONOFASICA");
    // Duas qualificações na mesma parcela: a lista é composta, não excludente.
    expect(grupoDoItem({ ...base, flagST: true, flagMonofasico: true }).chave)
      .toBe("REVENDA_MERCADORIA|COM|SUBSTITUICAO_TRIBUTARIA+TRIBUTACAO_MONOFASICA");
  });

  it("a segregação do 6.5 vale para REVENDA (linha 1) e INDUSTRIALIZAÇÃO (linha 3) — e só", () => {
    // Confirmado em fonte primária: a linha 3 ("Venda de mercadorias industrializadas pelo
    // contribuinte, exceto para o exterior") tem as MESMAS duas opções Com/Sem da linha 1.
    expect(segregacaoDoItem({ flagST: false }, "REVENDA_MERCADORIA")).not.toBeNull();
    expect(segregacaoDoItem({ flagST: false }, "INDUSTRIALIZACAO")).not.toBeNull();
    expect(segregacaoDoItem({ flagST: true }, "INDUSTRIALIZACAO").codigo).toBe("COM");

    // ⚠ As linhas 11/12 (comunicação e transporte) também se subdividem com/sem ST de ICMS, mas o
    // nosso enum não tem valor para elas — não há o que segregar, e criar um seria inventar.
    expect(segregacaoDoItem({ flagST: false }, "SERVICO_ANEXO_III")).toBeNull();
    expect(segregacaoDoItem({ flagST: false }, "SERVICO_ANEXO_IV")).toBeNull();
    expect(segregacaoDoItem({ flagST: false }, "SERVICO_FATOR_R")).toBeNull();
  });

  it("o valor contábil é rateado pelo TOTAL DA NOTA, não pela soma crua dos itens", async () => {
    // Nota de R$ 1.000 cujos itens somam R$ 800 (frete/desconto fora do item). O relatório tem de
    // fechar com o faturamento da competência, senão o contador vê duas somas do mesmo mês.
    comNotas([{
      ...NOTA_REVENDA,
      total: "1000.00",
      itens: [
        { ...NOTA_REVENDA.itens[0], valor: "600.00" },
        { ...NOTA_REVENDA.itens[1], valor: "200.00" },
      ],
    }]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.totalMes.valorContabil).toBe(1000);
    expect(rel.conferencia.confere).toBe(true);
  });

  it("o MODELO da NF-e sai da chave (posições 20-21); a NFS-e não ganha modelo inventado", () => {
    expect(modeloDoDocumento({ type: "NFE", chaveAcesso: CHAVE_NFE }))
      .toEqual({ modelo: "55", rotulo: "55", fonte: "chaveAcesso" });
    expect(modeloDoDocumento({ type: "NFSE", chaveAcesso: null }))
      .toEqual({ modelo: null, rotulo: "NFS-e", fonte: "tipo_documento" });
    // Chave da NFS-e Nacional não tem 44 dígitos — a guarda é o comprimento exato.
    expect(modeloDoDocumento({ type: "NFSE", chaveAcesso: "1".repeat(50) }).modelo).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2. O grupo NÃO CLASSIFICADO — nomeado, separado, e nunca escondido", () => {
  it("não se mistura com os classificados e vai por ÚLTIMO", async () => {
    comNotas([NOTA_REVENDA, NOTA_SEM_CLASSIFICACAO]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.gruposPorTipoOperacao).toHaveLength(2);
    const ultimo = rel.gruposPorTipoOperacao[rel.gruposPorTipoOperacao.length - 1];
    expect(ultimo.chave).toBe(CHAVE_NAO_CLASSIFICADO);
    expect(ultimo.classificado).toBe(false);
    expect(ultimo.rotulo).toMatch(/NÃO CLASSIFICADO/);
    expect(ultimo.total.valorContabil).toBe(300);

    // O valor NÃO entrou em nenhum grupo classificado.
    const classificados = rel.gruposPorTipoOperacao.filter((g) => g.classificado);
    expect(classificados.reduce((s, g) => s + g.total.valorContabil, 0)).toBe(1000);
  });

  it("sobe para o TOPO da estrutura, com valor, contagem e fração — antes do total", async () => {
    comNotas([NOTA_REVENDA, NOTA_SEM_CLASSIFICACAO]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.naoClassificado.valorContabil).toBe(300);
    expect(rel.naoClassificado.itens).toBe(1);
    expect(rel.naoClassificado.fracaoDoTotal).toBeCloseTo(300 / 1300, 4);
    expect(rel.naoClassificado.comoResolver).toMatch(/Classificar competência/);
  });

  it("competência 100% classificada não inventa um grupo vazio", async () => {
    comNotas([NOTA_REVENDA, NOTA_SERVICO]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.gruposPorTipoOperacao.every((g) => g.classificado)).toBe(true);
    expect(rel.naoClassificado.valorContabil).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2b. ⚠ \"Nunca recebemos o detalhe\" é um BLOCO PRÓPRIO, não \"não classificado\"", () => {
  it("a NF-e capturada só pelo resumo vai para SEM_DETALHE_CAPTURADO", async () => {
    // `resNFe` não traz itens por definição (`DfeParser.js:165` devolve `items: []`). Isso é
    // falta de DOCUMENTO, não falta de classificação: a ação é manifestar/baixar a NF-e completa,
    // não clicar em "Classificar competência".
    comNotas([NOTA_REVENDA, NOTA_SEM_ITEM]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const semDet = rel.gruposPorTipoOperacao.find((g) => g.chave === "SEM_DETALHE_CAPTURADO");
    expect(semDet).toBeDefined();
    expect(semDet.temDetalhe).toBe(false);
    expect(semDet.total.valorContabil).toBe(200);
    expect(semDet.linhas[0].motivoNaoClassificado).toBe("nota_sem_item");
  });

  it("⚠ soma no TOTAL DO MÊS, mas NÃO conta como não classificado", async () => {
    comNotas([NOTA_REVENDA, NOTA_SEM_ITEM]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    // A receita existe e está contada.
    expect(rel.totalMes.valorContabil).toBe(1200);
    expect(rel.conferencia.confere).toBe(true);
    expect(rel.semDetalheCapturado.valorContabil).toBe(200);
    expect(rel.semDetalheCapturado.notas).toBe(1);
    expect(rel.semDetalheCapturado.somaNoTotal).toBe(true);

    // Mas não é falta de classificação — somá-los daria um número que não aponta para ação nenhuma.
    expect(rel.naoClassificado.valorContabil).toBe(0);
    expect(rel.naoClassificado.itens).toBe(0);
    expect(rel.semDetalheCapturado.comoResolver).toMatch(/completa|procNFe/);
  });

  it("item que VEIO mas soma zero continua em NÃO CLASSIFICADO — o detalhe chegou", async () => {
    comNotas([{ ...NOTA_REVENDA, total: "500.00", itens: [{ ...NOTA_REVENDA.itens[0], valor: "0" }] }]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const naoClass = rel.gruposPorTipoOperacao.find((g) => g.chave === "NAO_CLASSIFICADO");
    expect(naoClass.linhas[0].motivoNaoClassificado).toBe("itens_sem_valor");
    expect(rel.naoClassificado.notasComItensSemValor).toBe(1);
    expect(rel.semDetalheCapturado.notas).toBe(0);
  });

  it("a ordem é: classificados → sem detalhe → NÃO CLASSIFICADO (o alarme por último)", async () => {
    comNotas([NOTA_REVENDA, NOTA_SEM_ITEM, NOTA_SEM_CLASSIFICACAO]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.gruposPorTipoOperacao.map((g) => g.chave)).toEqual([
      "REVENDA_MERCADORIA|INDETERMINADA", "SEM_DETALHE_CAPTURADO", "NAO_CLASSIFICADO",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2c. As 14 linhas da RFB — o de-para é PARCIAL, e isso vai DECLARADO", () => {
  it("o vocabulário traz as 14 linhas, com a fonte apontando para o arquivo do repo", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const linhas = rel.vocabulario.linhasAtividadeRfb;
    expect(linhas.quantidade).toBe(14);
    expect(linhas.itens).toHaveLength(14);
    expect(linhas.itens.map((i) => i.linha)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(linhas.baseLegal).toMatch(/CGSN 140\/2018, art\. 25/);
    // ⚠ A fonte é o ARQUIVO, para não existirem duas transcrições independentes do manual.
    expect(linhas.fonte).toMatch(/docs\/segregacao-receitas-simples\.md/);
    expect(linhas.itens[0].descricao).toBe("Revenda de mercadorias, exceto para o exterior");
    // Só as linhas 1 e 3 têm a subdivisão Com/Sem.
    expect(linhas.itens.filter((i) => i.temSegregacaoComSem).map((i) => i.linha)).toEqual([1, 3]);
  });

  it("REVENDA → linha 1 e INDUSTRIALIZAÇÃO → linha 3, nunca como resposta COMPLETA", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const rfb = rel.gruposPorTipoOperacao[0].linhaAtividade.rfb;
    expect(rfb.linha).toBe(1);
    expect(rfb.descricao).toBe("Revenda de mercadorias, exceto para o exterior");
    // ⚠ NUNCA `true`: falta o mercado (linha 1 × linha 2) e a segregação Com/Sem.
    expect(rfb.completo).toBe(false);
    expect(rfb.faltam).toEqual(expect.arrayContaining(["mercado", "segregacao"]));
    // É isto que impede alguém de ler `linha: 1` como "é a 1".
    expect(rfb.linhasAlternativas).toEqual([2]);

    expect(grupoDoItem({ tipoReceita: "INDUSTRIALIZACAO" }).linhaAtividade.rfb.linha).toBe(3);
    expect(grupoDoItem({ tipoReceita: "INDUSTRIALIZACAO" }).linhaAtividade.rfb.linhasAlternativas).toEqual([4]);
  });

  it("os SERVICO_* vão para a linha 7 — com as três dimensões que faltam nomeadas", () => {
    for (const t of ["SERVICO_ANEXO_III", "SERVICO_ANEXO_IV", "SERVICO_ANEXO_V", "SERVICO_FATOR_R"]) {
      const rfb = grupoDoItem({ tipoReceita: t }).linhaAtividade.rfb;
      expect(rfb.linha).toBe(7);
      expect(rfb.completo).toBe(false);
      expect(rfb.faltam).toEqual(["mercado", "estado_iss", "subitem_lc116"]);
      // Com outro mercado ou outro subitem da LC 116, a linha certa é a 8, a 9 ou a 10.
      expect(rfb.linhasAlternativas).toEqual([8, 9, 10]);
    }
  });

  it("⚠ a segregação só entra em `faltam` quando está INDETERMINADA", () => {
    const indet = grupoDoItem({ tipoReceita: "REVENDA_MERCADORIA" }).linhaAtividade.rfb;
    expect(indet.faltam).toContain("segregacao");
    // Respondida pela flag: deixa de faltar.
    const resp = grupoDoItem({ tipoReceita: "REVENDA_MERCADORIA", flagST: true }).linhaAtividade.rfb;
    expect(resp.faltam).not.toContain("segregacao");
    expect(resp.faltam).toEqual(["mercado"]);
  });

  it("cada dimensão que falta é EXPLICADA uma vez, no vocabulário", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const dims = rel.vocabulario.linhasAtividadeRfb.dimensoesFaltantes;
    for (const k of ["mercado", "estado_iss", "escritorio_contabil_iss_fixo", "subitem_lc116", "segregacao"]) {
      expect(String(dims[k]).length).toBeGreaterThan(40);
    }
    expect(dims.mercado).toMatch(/16\.153/);
    expect(dims.estado_iss).toMatch(/não existe campo nenhum/i);
  });

  it("item NÃO CLASSIFICADO não ganha linha da RFB — seria fabricar a resposta que falta", () => {
    expect(grupoDoItem(null).linhaAtividade.rfb).toBeNull();
    expect(grupoDoItem({ tipoReceita: "RECEITA_NAO_CLASSIFICADA" }).linhaAtividade.rfb).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("3. Nada de IPI/ST/Outros/Líquido — e a limitação dita uma vez, não em quatro colunas", () => {
  it("as colunas NÃO EXISTEM — nem na linha, nem no total, nem no resumo", async () => {
    comNotas([NOTA_REVENDA, NOTA_SEM_CLASSIFICACAO]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const alvos = [
      ...rel.gruposPorTipoOperacao.flatMap((g) => g.linhas),
      ...rel.gruposPorTipoOperacao.map((g) => g.total),
      rel.totalMes, rel.totalConsolidado,
      ...rel.resumoPorTipoOperacao,
    ];
    for (const t of alvos) {
      for (const campo of ["ipi", "st", "outros", "liquido"]) {
        // ⚠ Ausente COMO CHAVE, não presente com `null`. Quatro colunas vazias atravessando o
        // relatório inteiro são ruído; e uma chave `null` é um convite a um `|| 0` na tela.
        expect(campo in t).toBe(false);
      }
    }
  });

  it("o aviso vive UMA vez, em `limitacoes[]`, e nomeia o efeito no valor contábil", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const codigos = rel.limitacoes.map((l) => l.codigo);
    expect(codigos).toEqual(expect.arrayContaining([
      "VALOR_CONTABIL_SEM_DESCONTOS", "SEGREGACAO_65_NAO_APURADA", "QUALIFICACOES_NAO_APURADAS",
    ]));
    const desconto = rel.limitacoes.find((l) => l.codigo === "VALOR_CONTABIL_SEM_DESCONTOS");
    expect(desconto.efeito).toMatch(/vIPI/);
    expect(desconto.efeito).toMatch(/não é calculável|0,00/);
    for (const l of rel.limitacoes) expect(String(l.efeito).length).toBeGreaterThan(40);

    // Onde o dado VIVE — registrado para quem pegar a frente do parser (é frente separada).
    expect(desconto.frenteSeparada).toBe(true);
    expect(desconto.ondeEstaODado).toMatch(/procNFe/);
    expect(desconto.ondeEstaODado).toMatch(/xmlRaw/);
    expect(desconto.ondeEstaODado).toMatch(/NFS-e/);
  });

  it("⚠ a segregação do 6.5 é INDETERMINADA — `false` sem escritor não vira \"Sem ST\"", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const g = rel.gruposPorTipoOperacao[0];
    expect(g.segregacao.codigo).toBe("INDETERMINADA");
    expect(g.segregacao.codigo).not.toBe("SEM");
    expect(g.segregacao.fonte).toBe("sem_dado");
    expect(g.segregacao.motivo).toMatch(/não têm escritor|por default/);
    // O rótulo oficial do terceiro estado é `null` de propósito: ele NÃO é do manual.
    expect(g.segregacao.rotuloOficial).toBeNull();
    expect(FLAGS_TEM_ESCRITOR).toBe(false);
  });

  it("com a flag marcada, sai a opção OFICIAL \"Com…\", transcrita do manual", () => {
    const seg = segregacaoDoItem({ flagST: true }, "REVENDA_MERCADORIA");
    expect(seg.codigo).toBe("COM");
    expect(seg.rotuloOficial).toBe(
      "Com substituição tributária/tributação monofásica/antecipação com encerramento de tributação",
    );
    expect(seg.fonte).toBe("flag_da_nota");
  });

  it("os rótulos oficiais são os do manual, não os códigos do Scritta", () => {
    expect(SEGREGACAO_REVENDA.SEM.rotuloOficial).toBe(
      "Sem substituição tributária/tributação monofásica/antecipação com encerramento de tributação",
    );
    // ⚠ Os códigos `01`/`02` do impresso não existem em fonte pública nenhuma.
    const json = JSON.stringify(SEGREGACAO_REVENDA);
    expect(json).not.toMatch(/PIS\/COFINS MF/);
    expect(json).not.toMatch(/Subst\.Tributária/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. As 8 qualificações (item 6.6.1) — modeladas mesmo vindo vazias", () => {
  it("o vocabulário completo viaja no relatório, com os 8 rótulos oficiais", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.vocabulario.qualificacoes).toHaveLength(8);
    expect(rel.vocabulario.qualificacoes.map((q) => q.rotuloOficial)).toEqual([
      "antecipação com encerramento de tributação",
      "substituição tributária",
      "tributação monofásica",
      "exigibilidade suspensa",
      "imunidade",
      "isenção/redução",
      "isenção/redução cesta básica",
      "lançamento de ofício",
    ]);
    expect(rel.vocabulario.fonte).toMatch(/Manual do PGDAS-D/);
    // ⚠ Os `codigo` são NOSSOS, e o relatório diz isso — foi inventar numeração que produziu o
    // `01`/`02` do Scritta.
    expect(rel.vocabulario.avisoCodigos).toMatch(/identificadores NOSSOS/);
  });

  it("a dimensão aparece NAO_APURADO em vez de sumir — \"não sabemos\" ≠ \"nenhuma\"", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    const g = rel.gruposPorTipoOperacao[0];
    expect(g.qualificacoes.estado).toBe("NAO_APURADO");
    expect(g.qualificacoes.estado).not.toBe("NENHUMA");
    expect(g.qualificacoes.codigos).toEqual([]);
    expect(g.qualificacoes.motivo).toMatch(/falta de leitura/);
    for (const linha of g.linhas) expect(linha.qualificacoes.estado).toBe("NAO_APURADO");
  });

  it("com flag marcada vira APURADO, com o rótulo oficial da qualificação", () => {
    const q = qualificacoesDoItem({ flagST: true, flagMonofasico: true });
    expect(q.estado).toBe("APURADO");
    expect(q.codigos).toEqual(["SUBSTITUICAO_TRIBUTARIA", "TRIBUTACAO_MONOFASICA"]);
    expect(q.rotulos).toEqual(["substituição tributária", "tributação monofásica"]);
  });

  it("todo código do vocabulário é único e tem rótulo oficial não vazio", () => {
    const codigos = QUALIFICACOES.map((q) => q.codigo);
    expect(new Set(codigos).size).toBe(8);
    for (const q of QUALIFICACOES) expect(String(q.rotuloOficial).length).toBeGreaterThan(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. ⚠ O PRÉ-APURADO NÃO PERSISTE — abrir o relatório não muda a apuração", () => {
  it("com a empresa APTA (o motor calcula de verdade), NADA é gravado", async () => {
    comNotas([NOTA_REVENDA]);   // tudo classificado → o motor chega até o fim
    comEmpresaApta();

    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    // O número saiu…
    expect(rel.preApurado.ok).toBe(true);
    expect(rel.preApurado.das).toBeGreaterThan(0);
    expect(rel.preApurado.origem).toBe("MOTOR_LOCAL");
    expect(rel.preApurado.persistido).toBe(false);

    // …e o banco não foi tocado.
    expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
    expect(prisma.logDecisaoFatorR.create).not.toHaveBeenCalled();
    expect(prisma.logDecisaoFatorR.update).not.toHaveBeenCalled();
  });

  it("o LOG DO FATOR R também não é gravado — ele é escrita igual ao snapshot", async () => {
    comNotas([{
      ...NOTA_SERVICO,
      itens: [{ ...NOTA_SERVICO.itens[0], tipoReceita: "SERVICO_FATOR_R" }],
    }]);
    comEmpresaApta();
    prisma.aliquotaSimplesNacional.findMany.mockResolvedValue([{
      anexo: "III", faixa: 1, rbt12Min: 0, rbt12Max: 180000,
      aliquotaNominal: 0.06, parcelaDeduzir: 0,
      vigenciaInicio: new Date("2018-01-01T00:00:00Z"), vigenciaFim: null,
    }]);
    prisma.companyMonthlyCircular.findFirst.mockResolvedValue({ fs12Manual: 100, fs12Origem: "MANUAL" });

    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.preApurado.fatorR).not.toBeNull();
    expect(prisma.logDecisaoFatorR.create).not.toHaveBeenCalled();
    expect(prisma.logDecisaoFatorR.update).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
  });

  it("⚠ o comportamento de QUEM JÁ CHAMAVA continua gravando (rota apurar-v2)", async () => {
    comNotas([NOTA_REVENDA]);
    comEmpresaApta();

    // Sem `persistir` — exatamente como `POST /apurar-v2/:competencia` chama.
    const out = await calcularApuracaoLocal({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(out.ok).toBe(true);
    expect(out.persistido).toBe(true);
    expect(prisma.apuracaoSnapshot.create).toHaveBeenCalledTimes(1);
    expect(prisma.apuracaoSnapshot.create.mock.calls[0][0].data.estado).toBe("calculada");
  });

  it("SALVAR o relatório grava o relatório — e continua sem tocar na apuração", async () => {
    comNotas([NOTA_REVENDA]);
    comEmpresaApta();

    await gerarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA, userId: "user-1" });

    expect(prisma.relatorioFaturamento.create).toHaveBeenCalledTimes(1);
    const gravado = prisma.relatorioFaturamento.create.mock.calls[0][0].data;
    expect(gravado.portalClientId).toBe(PORTAL_ID);
    expect(gravado.competencia).toBe(COMPETENCIA);
    expect(gravado.geradoPor).toBe("user-1");
    expect(gravado.dados.totalMes.valorContabil).toBe(1000);

    expect(prisma.apuracaoSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.apuracaoSnapshot.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. A recusa do motor é RESULTADO, não erro", () => {
  it("o relatório sai INTEIRO mesmo com o motor bloqueado, e o DAS é `null`", async () => {
    // O caso de 100% das empresas hoje: receita sem `tipoReceita`.
    comNotas([NOTA_REVENDA, NOTA_SEM_CLASSIFICACAO]);
    comEmpresaApta();

    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    // A parte do faturamento está completa.
    expect(rel.totalMes.valorContabil).toBe(1300);
    expect(rel.gruposPorTipoOperacao).toHaveLength(2);

    // E o pré-apurado recusa, nomeando o motivo e o TAMANHO do buraco.
    expect(rel.preApurado.ok).toBe(false);
    expect(rel.preApurado.das).toBeNull();
    expect(rel.preApurado.das).not.toBe(0);
    expect(rel.preApurado.estado).toBe("bloqueada_pendencias");
    expect(rel.preApurado.motivo.code).toBe("RECEITA_NAO_CLASSIFICADA");
    expect(rel.preApurado.semClassificacao.valorContabil).toBe(300);
    expect(rel.preApurado.semClassificacao.itens).toBe(1);
    expect(rel.preApurado.semClassificacao.totalDaCompetencia).toBe(1300);
    expect(rel.preApurado.comoResolver).toMatch(/Classificar competência/);
  });

  it("sem Cadastro Fiscal o motivo é o do cadastro — e o faturamento sai igual", async () => {
    comNotas([NOTA_REVENDA]);
    prisma.cadastroFiscal.findUnique.mockResolvedValue(null);

    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.totalMes.valorContabil).toBe(1000);
    expect(rel.preApurado.das).toBeNull();
    expect(rel.preApurado.motivo.code).toBe("CADASTRO_FALTANDO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5b. ⚠ Mês sem nota NÃO é o relatório afirmando ausência de receita", () => {
  it("total zero sem nenhum sinal: o relatório sai e RECUSA afirmar", async () => {
    // Zero é a leitura de três situações opostas: a empresa não emitiu · o município está fora do
    // ADN · o cursor NSU travou / o A1 venceu.
    comNotas([]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.totalMes.valorContabil).toBe(0);
    expect(rel.ausenciaDeNotas.aplicavel).toBe(true);
    expect(rel.ausenciaDeNotas.podeAfirmarAusencia).toBe(false);
    expect(rel.ausenciaDeNotas.mensagem).toMatch(/NÃO é o mesmo que ausência de receita/);
    expect(rel.ausenciaDeNotas.mensagem).toMatch(/fora do ADN|A1 venceu|cursor NSU/);
  });

  it("⚠ o tri-estado é preservado — `null` viaja como `null`, nunca vira `false`", async () => {
    comNotas([]);
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    // "ninguém disse nada" ≠ "disseram que teve faturamento".
    expect(rel.ausenciaDeNotas.semFaturamentoAfirmado.valor).toBeNull();
    expect(rel.ausenciaDeNotas.semFaturamentoAfirmado.valor).not.toBe(false);
    expect(rel.ausenciaDeNotas.conferenciaAdn.status).toBeNull();
  });

  it("com a AFIRMAÇÃO do contador, pode afirmar — e diz de quem veio", async () => {
    comNotas([]);
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue({
      semFaturamento: true,
      semFaturamentoEm: new Date("2026-07-05T10:00:00Z"),
      semFaturamentoPor: "user-9",
      semFaturamentoConferencia: "sem_conferencia",
    });
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.ausenciaDeNotas.podeAfirmarAusencia).toBe(true);
    expect(rel.ausenciaDeNotas.semFaturamentoAfirmado.por).toBe("user-9");
    expect(rel.ausenciaDeNotas.semFaturamentoAfirmado.conferenciaNoMomento).toBe("sem_conferencia");
    expect(rel.ausenciaDeNotas.mensagem).toMatch(/o contador afirmou/);
  });

  it("com a CONFERÊNCIA do ADN em `ok`, também pode — é a outra prova aceita", async () => {
    comNotas([]);
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({
      conferenciaStatus: "ok", conferidaEm: new Date("2026-07-02T08:00:00Z"),
    });
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });

    expect(rel.ausenciaDeNotas.conferenciaAdn.status).toBe("ok");
    expect(rel.ausenciaDeNotas.podeAfirmarAusencia).toBe(true);
    expect(rel.ausenciaDeNotas.mensagem).toMatch(/conferência com o ADN/);
  });

  it("`nao_conferivel` NÃO autoriza — é exatamente o caso em que zero não prova nada", async () => {
    comNotas([]);
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({
      conferenciaStatus: "nao_conferivel", conferidaEm: new Date("2026-07-02T08:00:00Z"),
    });
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.ausenciaDeNotas.podeAfirmarAusencia).toBe(false);
  });

  it("com faturamento, o bloco fica `aplicavel: false` e sem mensagem", async () => {
    comNotas([NOTA_REVENDA]);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.ausenciaDeNotas.aplicavel).toBe(false);
    expect(rel.ausenciaDeNotas.total).toBe(1000);
    expect(rel.ausenciaDeNotas.mensagem).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("6. Procedência do número", () => {
  it("o DAS do relatório é NOSSO — `origem: MOTOR_LOCAL` viaja junto do valor", async () => {
    comNotas([NOTA_REVENDA]);
    comEmpresaApta();
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.preApurado.origem).toBe("MOTOR_LOCAL");
  });

  it("o número OFICIAL vem do snapshot, e a diferença só existe com OS DOIS", async () => {
    comNotas([NOTA_REVENDA]);
    comEmpresaApta();
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue({
      estado: "transmitida", dasRetornadoSerpro: 40, dasCalculadoLocal: 40,
      numeroDeclaracao: "65227792202606001", reciboNumero: "R-1",
      transmitidoEm: new Date("2026-07-10T10:00:00Z"), fechadaEm: null,
    });

    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.preApurado.oficial.numeroDeclaracao).toBe("65227792202606001");
    expect(rel.preApurado.oficial.dasRetornadoSerpro).toBe(40);
    expect(rel.preApurado.diferenca).toBe(round2(rel.preApurado.das - 40));

    // ⚠ `dasCalculadoLocal` do snapshot vem ROTULADO como ambíguo: `calcularFechamento` grava ali
    // o valor da SIMULAÇÃO OFICIAL da RFB, na coluna que o motor usa para o cálculo nosso.
    expect(rel.preApurado.oficial.dasCalculadoLocalNoSnapshot.procedenciaAmbigua).toBe(true);
  });

  it("sem número oficial, a diferença é `null` — não é uma divergência de zero", async () => {
    comNotas([NOTA_REVENDA]);
    comEmpresaApta();
    prisma.apuracaoSnapshot.findUnique.mockResolvedValue(null);
    const rel = await montarRelatorioFaturamento({ portalClientId: PORTAL_ID, competencia: COMPETENCIA });
    expect(rel.preApurado.oficial.dasRetornadoSerpro).toBeNull();
    expect(rel.preApurado.diferenca).toBeNull();
  });
});

function round2(n) { return +Number(n || 0).toFixed(2); }
