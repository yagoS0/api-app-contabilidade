// AS FERRAMENTAS — cada recusa medida por NÃO-CHAMADA do serviço que executaria.
//
// Os `servicos` são dublês injetados; o `prisma` é um objeto com os poucos métodos que as ferramentas
// usam. Nenhuma rede, nenhum banco.

import { definicoes, executarFerramenta } from "../ferramentas/index.js";
import { validateNfsePayload } from "../../validators/nfsePayload.js";
import { TIPOS } from "../confirmacaoPendente.js";
import { preparacaoEmissaoFalsa } from "../__fixtures__/preparacaoEmissao.js";
import { TODAS_PERMISSOES_ASSISTENTE } from "../../whatsapp/permissoesAssistente.js";

const silencio = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

describe('faturamento completo do período', () => {
  it('agrega todas as notas autorizadas da empresa, sem limite de página', async () => {
    const aggregate = jest.fn(async () => ({ _count: { _all: 25, total: 25 }, _sum: { total: 12500 }, _max: { updatedAt: new Date('2026-09-10T12:00:00Z') } }));
    const c = ctx({ prisma: { portalInvoice: { aggregate } } });
    const r = await executarFerramenta('consultar_faturamento', { inicio: '2026-01', fim: '2026-08' }, c);
    expect(r).toMatchObject({ ok: true, quantidade: 25, total: 12500, inicio: '2026-01', fim: '2026-08' });
    expect(aggregate).toHaveBeenCalledWith({ where: { clientId: 'pc-1', papel: 'EMIT', statusEfetivo: 'autorizada', competencia: { gte: new Date('2026-01-01T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') } }, _sum: { total: true }, _count: { _all: true, total: true }, _max: { updatedAt: true } });
  });
  it.each([{ inicio: '2026-13', fim: '2026-13' }, { inicio: '2026-09', fim: '2026-08' }, { inicio: '2025-01', fim: '2026-09' }])('não consulta período inválido %j', async input => {
    const aggregate = jest.fn(), c = ctx({ prisma: { portalInvoice: { aggregate } } });
    expect((await executarFerramenta('consultar_faturamento', input, c)).ok).toBe(false);
    expect(aggregate).not.toHaveBeenCalled();
  });
  it('permissão de guias não autoriza faturamento', async () => {
    const aggregate = jest.fn(), c = ctx({ sessao: sessao({ permissoesAssistente: ['GUIAS'] }), prisma: { portalInvoice: { aggregate } } });
    expect((await executarFerramenta('consultar_faturamento', { inicio: '2026-08', fim: '2026-08' }, c)).motivo).toBe('FUNCAO_NAO_LIBERADA');
    expect(aggregate).not.toHaveBeenCalled();
  });
  it('valor ausente não é convertido em faturamento zero', async () => {
    const aggregate = jest.fn(async () => ({ _count: { _all: 2, total: 1 }, _sum: { total: 100 }, _max: { updatedAt: null } }));
    const r = await executarFerramenta('consultar_faturamento', { inicio: '2026-08', fim: '2026-08' }, ctx({ prisma: { portalInvoice: { aggregate } } }));
    expect(r).toMatchObject({ ok: true, quantidade: 2, semValor: 1, total: null, totalFormatado: null });
  });
});

function sessao(over = {}) {
  return { ok: true, portalClientId: "pc-1", userId: "u1", papel: "CLIENT_ADMIN", contatoNome: "Maria", permissoesAssistente: [...TODAS_PERMISSOES_ASSISTENTE], motivo: null, ...over };
}

const GUIA = { id: "g1", portalClientId: "pc-1", tipo: "SIMPLES", competencia: "2026-08", valor: 500, vencimento: new Date("2026-08-20T00:00:00Z"), paymentStatus: "OVERDUE", status: "PROCESSED", liberadaCliente: true, parcelamentoId: null };

function prismaFalso(over = {}) {
  return {
    guide: { findMany: jest.fn(async () => [GUIA]), findFirst: jest.fn(async ({ where }) => (where.id === "g1" && where.portalClientId === "pc-1" ? GUIA : null)) },
    portalInvoice: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    serviceInvoice: { findFirst: jest.fn(async () => null) },
    portalClient: { findUnique: jest.fn(async () => ({ cnpj: "11222333000181" })) },
    companyFiscalStatus: { findUnique: jest.fn(async () => null) },
    companyDocument: { findMany: jest.fn(async () => []) },
    ...over,
  };
}

function servicosFalsos(over = {}) {
  return {
    ...preparacaoEmissaoFalsa,
    listGuidesByCompany: jest.fn(async () => ({ items: [GUIA], total: 1 })),
    toGuideResponse: jest.fn((g) => ({ ...g, vencida: true })),
    getGuidePdfBuffer: jest.fn(async () => Buffer.from("%PDF-1.4")),
    gerarDanfseDaNota: jest.fn(async () => ({ pdf: Buffer.from("%PDF"), nomeArquivo: "danfse.pdf", marcaDagua: null })),
    listarTomadoresEmitidos: jest.fn(async () => [{ documento: "12345678000190", nome: "ACME", email: null, cMun: "3304557" }]),
    consultarCnpj: jest.fn(async () => ({ ok: true, cnpj: "12345678000190", tomador: { nome: "ACME", email: null, endereco: null, enderecoFaltantes: ["o CEP"], motivoMunicipio: null, avisoSituacao: null, municipioTexto: "Rio de Janeiro", uf: "RJ" } })),
    municipiosIbgeOuNulo: jest.fn(async () => null),
    validateNfsePayload: jest.fn((b) => ({ ok: true, data: { tomador: { cnpjCpf: "12345678000190", nome: b.tomador.nome, email: null, endereco: {} }, servico: { descricao: b.servico.descricao, valorServicos: b.servico.valor, aliquota: null, issRetido: false } } })),
    autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: true, via: "CLIENTE" })),
    resolveLegacyCompanyId: jest.fn(async () => "legacy-1"),
    canGuideRecalculate: jest.fn(() => true),
    isGuideOverdue: jest.fn(() => true),
    avisoDeRecalculo: jest.fn(() => ({ texto: "Gera uma nova guia com juros e multa." })),
    motivoValido: jest.fn((_e, c) => ["1", "2", "9"].includes(String(c))),
    validarJustificativa: jest.fn((t) => (String(t || "").length >= 15 ? { ok: true } : { ok: false, motivo: "curta" })),
    parseSitfisRelatorio: jest.fn(() => ({ diagnosticos: [] })),
    criarPendencia: jest.fn(async ({ tipo, corpo }) => ({ acao: { id: "ap1" }, codigo: "A7K2", texto: `${corpo}\n\nPara confirmar, responda CONFIRMAR A7K2.` })),
    baixarDocumentoDaEmpresa: jest.fn(async () => ({ doc: { id: "d1", tipo: "CONTRATO_SOCIAL", nome: "contrato.png", mimeType: "image/png" }, buffer: Buffer.from("png") })),
    ...over,
  };
}

function ctx(over = {}) {
  const enviarDocumento = jest.fn(async () => ({ wamid: "wamid.x" }));
  const registrarPendencia = jest.fn();
  return {
    sessao: sessao(), conversa: { id: "cv1" }, prisma: prismaFalso(), servicos: servicosFalsos(), janela: { aberta: true },
    agora: new Date("2026-09-02T12:00:00Z"), log: silencio, enviarDocumento, registrarPendencia, registrarChamadaAoEscritorio: jest.fn(),
    ...over,
  };
}

describe("papel e sessão — a recusa vem ANTES de qualquer serviço", () => {
  it("sem sessão: nada é consultado, nem guias", async () => {
    const c = ctx({ sessao: sessao({ ok: false, papel: null, motivo: "SEM_PESSOA" }) });
    const r = await executarFerramenta("listar_guias", { competencia: null, status: null }, c);
    expect(r).toMatchObject({ ok: false, motivo: "SEM_SESSAO" });
    expect(c.servicos.listGuidesByCompany).not.toHaveBeenCalled();
  });
  it("⚠ FINANCEIRO não vê a situação fiscal (quadro societário) — e o banco não é consultado", async () => {
    const c = ctx({ sessao: sessao({ papel: "FINANCEIRO" }) });
    const r = await executarFerramenta("situacao_fiscal", {}, c);
    expect(r.motivo).toBe("PAPEL_INSUFICIENTE");
    expect(c.prisma.companyFiscalStatus.findUnique).not.toHaveBeenCalled();
  });
  it("⚠ FINANCEIRO não prepara emissão — o portão nem é consultado", async () => {
    const c = ctx({ sessao: sessao({ papel: "FINANCEIRO" }) });
    const r = await executarFerramenta("preparar_emissao", { tomadorDoc: "12345678000190", tomadorNome: "ACME", tomadorEmail: null, descricao: "x", valor: 100, competencia: null, aliquota: null, issRetido: null, pTotTribSN: null, endereco: null }, c);
    expect(r.motivo).toBe("PAPEL_INSUFICIENTE");
    expect(c.servicos.autorizarEmissaoDoCliente).not.toHaveBeenCalled();
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
  });
  it("ferramenta desconhecida recusa nomeando", async () => {
    expect((await executarFerramenta("emitir_nfse", {}, ctx())).motivo).toBe("FERRAMENTA_DESCONHECIDA");
  });
});

describe("permissões explícitas do número", () => {
  it("lista vazia esconde ferramentas de dados e o executor também recusa chamada forjada", async () => {
    const c = ctx({ sessao: sessao({ permissoesAssistente: [] }) });
    expect(definicoes(c.sessao).map((d) => d.name)).toEqual(["chamar_escritorio"]);
    const r = await executarFerramenta("listar_guias", { competencia: null, status: null }, c);
    expect(r).toMatchObject({ ok: false, motivo: "FUNCAO_NAO_LIBERADA", permissao: "GUIAS" });
    expect(c.servicos.listGuidesByCompany).not.toHaveBeenCalled();
  });

  it("liberação parcial só expõe o grupo correspondente e o encaminhamento", () => {
    const nomes = definicoes(sessao({ permissoesAssistente: ["SITUACAO_FISCAL"] })).map((d) => d.name);
    expect(nomes).toEqual(["situacao_fiscal", "chamar_escritorio"]);
  });

  it("não expõe ferramentas de emissão quando o papel do portal é somente financeiro", () => {
    const nomes = definicoes(sessao({ papel: "FINANCEIRO", permissoesAssistente: ["EMISSAO_NFSE"] })).map((d) => d.name);
    expect(nomes).toEqual(["chamar_escritorio"]);
  });
});

describe("leituras", () => {
  it("listar_guias: sempre apenasLiberadas, público CLIENTE, escopo da sessão", async () => {
    const c = ctx();
    const r = await executarFerramenta("listar_guias", { competencia: "2026-08", status: null }, c);
    expect(r.ok).toBe(true);
    expect(c.servicos.listGuidesByCompany).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "pc-1", competencia: "2026-08", apenasLiberadas: true }));
    expect(r.guias[0]).toMatchObject({ guideId: "g1", tipo: expect.any(String), valorFormatado: expect.stringMatching(/500,00/) });
  });
  it("⚠ lista vazia carrega a observação: 'liberada', nunca 'não há imposto'", async () => {
    const c = ctx({ servicos: servicosFalsos({ listGuidesByCompany: jest.fn(async () => ({ items: [], total: 0 })) }) });
    const r = await executarFerramenta("listar_guias", { competencia: null, status: null }, c);
    expect(r.observacao).toMatch(/LIBERADA/);
    expect(r.observacao).not.toMatch(/não há imposto/);
  });
  it("quanto_devo: a MESMA query do fluxo (liberadas, em aberto, com vencimento)", async () => {
    const c = ctx();
    const r = await executarFerramenta("quanto_devo", {}, c);
    const where = c.prisma.guide.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ portalClientId: "pc-1", liberadaCliente: true, paymentStatus: { in: ["OPEN", "OVERDUE"] } });
    expect(r.total).toBe(500);
    expect(r.vencidas).toBe(1);
  });
  it("situacao_fiscal sem linha: situação null e a frase 'ainda NÃO consultou' — nunca em dia", async () => {
    const r = await executarFerramenta("situacao_fiscal", {}, ctx());
    expect(r.situacao).toBeNull();
    expect(r.observacao).toMatch(/ainda NÃO consultou/);
    expect(JSON.stringify(r)).not.toMatch(/em dia/i);
  });
  it("consultar_cnpj: recusa da consulta vira frase que diz que a emissão SEGUE", async () => {
    const c = ctx({ servicos: servicosFalsos({ consultarCnpj: jest.fn(async () => ({ ok: false, motivo: "rede", mensagem: "Não conseguimos consultar a Receita agora." })) }) });
    const r = await executarFerramenta("consultar_cnpj", { cnpj: "12345678000190" }, c);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/emissão segue normalmente/);
  });
});

describe("documentos — só dentro da janela, e sempre pelo escopo", () => {
  it("enviar_pdf_da_guia: fora da janela recusa SEM ler o PDF", async () => {
    const c = ctx({ janela: { aberta: false } });
    const r = await executarFerramenta("enviar_pdf_da_guia", { guideId: "g1" }, c);
    expect(r.motivo).toBe("FORA_DA_JANELA");
    expect(c.servicos.getGuidePdfBuffer).not.toHaveBeenCalled();
    expect(c.enviarDocumento).not.toHaveBeenCalled();
  });
  it("enviar_pdf_da_guia: guia de OUTRA empresa não é encontrada (o where leva a sessão)", async () => {
    const c = ctx({ sessao: sessao({ portalClientId: "pc-2" }) });
    const r = await executarFerramenta("enviar_pdf_da_guia", { guideId: "g1" }, c);
    expect(r.motivo).toBe("GUIA_NAO_ENCONTRADA");
    expect(c.enviarDocumento).not.toHaveBeenCalled();
  });
  it("enviar_pdf_da_guia: dentro da janela sobe o PDF e envia com legenda", async () => {
    const c = ctx();
    const r = await executarFerramenta("enviar_pdf_da_guia", { guideId: "g1" }, c);
    expect(r).toMatchObject({ ok: true, enviado: true, guideId: "g1" });
    expect(c.enviarDocumento).toHaveBeenCalledWith(expect.objectContaining({ nomeArquivo: expect.stringMatching(/2026-08\.pdf$/), guideId: "g1" }));
  });
  it("danfse_da_nota: DANFSE_SEM_QRCODE vira frase honesta, nunca 'falha ao baixar'", async () => {
    const c = ctx({ servicos: servicosFalsos({ gerarDanfseDaNota: jest.fn(async () => { const e = new Error("sem qr"); e.code = "DANFSE_SEM_QRCODE"; e.motivo = "chave ausente"; throw e; }) }) });
    const r = await executarFerramenta("danfse_da_nota", { notaId: "n1" }, c);
    expect(r.motivo).toBe("DANFSE_SEM_QRCODE");
    expect(r.mensagem).toMatch(/sem o QR Code/);
    expect(c.enviarDocumento).not.toHaveBeenCalled();
  });
  it("documento da empresa: lista sem fileKey e envia usando a empresa da sessão", async () => {
    const companyDocument = {
      findMany: jest.fn(async () => [{ id: "d1", tipo: "CONTRATO_SOCIAL", nome: "contrato.pdf", mimeType: "application/pdf", bytes: 20, validade: null, createdAt: new Date("2026-09-01") }]),
    };
    const c = ctx({ prisma: prismaFalso({ companyDocument }) });
    const lista = await executarFerramenta("listar_documentos", {}, c);
    expect(lista.documentos[0]).toMatchObject({ documentId: "d1", tipoDescricao: "Contrato social" });
    expect(lista.documentos[0]).not.toHaveProperty("fileKey");
    expect(companyDocument.findMany.mock.calls[0][0].where).toEqual({ portalClientId: "pc-1" });

    const envio = await executarFerramenta("enviar_documento_da_empresa", { documentId: "d1" }, c);
    expect(envio).toMatchObject({ ok: true, enviado: true, documentId: "d1" });
    expect(c.servicos.baixarDocumentoDaEmpresa).toHaveBeenCalledWith({ portalClientId: "pc-1", documentId: "d1" });
    expect(c.enviarDocumento).toHaveBeenCalledWith(expect.objectContaining({ documentId: "d1", nomeArquivo: "contrato.png", mimeType: "image/png" }));
  });
});

describe("as três preparar_* — só PENDÊNCIA, nunca ato", () => {
  const emissao = { tomadorDoc: "12.345.678/0001-90", tomadorNome: "ACME", tomadorEmail: null, descricao: "Consultoria", valor: 1500.5, competencia: "2026-09", aliquota: null, issRetido: null, pTotTribSN: null, endereco: null };
  it("exige escolha entre perfis e leva o escolhido à confirmação", async () => {
    const perfis = [{ id: "p1", nome: "Contabilidade", codigoServicoNacional: "171901" }, { id: "p2", nome: "Consultoria", codigoServicoNacional: "170101" }];
    const c = ctx({ servicos: servicosFalsos({ listarPerfisEmissao: jest.fn(async () => perfis) }) });
    expect((await executarFerramenta("preparar_emissao", emissao, c)).motivo).toBe("ESCOLHER_PERFIL_EMISSAO");
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
    expect((await executarFerramenta("preparar_emissao", { ...emissao, perfilId: "outra-empresa" }, c)).ok).toBe(false);
    await executarFerramenta("preparar_emissao", { ...emissao, perfilId: "p2" }, c);
    expect(c.servicos.validateNfsePayload).toHaveBeenCalledWith(expect.objectContaining({ perfilId: "p2" }));
    expect(c.servicos.criarPendencia).toHaveBeenCalledWith(expect.objectContaining({ corpo: expect.stringContaining("Perfil de serviço: Consultoria") }));
  });

  it("campos por operação usam validador real e aparecem na confirmação e na pendência", async () => {
    const c = ctx({ servicos: servicosFalsos({ validateNfsePayload: jest.fn(validateNfsePayload), listarPerfisEmissao: jest.fn(async () => []) }) });
    const r = await executarFerramenta("preparar_emissao", { ...emissao, valorRetidoIRRF: 15.25, valorRetidoPrevidencia: 10, obraCnoCei: "123456789012", destinatarioDoc: "11222333000181", destinatarioNome: "Destinatário informado" }, c);
    expect(r.ok).toBe(true);
    const chamada = c.servicos.criarPendencia.mock.calls[0][0];
    expect(chamada.payload.retencoesComplementares).toEqual({ vRetIRRF: 15.25, vRetCP: 10 });
    expect(chamada.payload.obra).toEqual({ cObra: "123456789012" });
    expect(chamada.payload.destinatario.nome).toBe("Destinatário informado");
    expect(chamada.corpo).toContain("15,25");
    expect(chamada.corpo).toContain("CNO/CEI 123456789012");
    expect(chamada.corpo).toContain("Destinatário informado");
  });
  it("retenção maior que serviço e obra ambígua não criam pendência", async () => {
    const c = ctx({ servicos: servicosFalsos({ validateNfsePayload: jest.fn(validateNfsePayload), listarPerfisEmissao: jest.fn(async () => []) }) });
    for (const extra of [{ valorRetidoIRRF: 2000 }, { obraCnoCei: "123", obraCib: "12345678" }, { destinatarioNome: "Sem documento" }]) {
      expect((await executarFerramenta("preparar_emissao", { ...emissao, ...extra }, c)).ok).toBe(false);
    }
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
  });

  it("preparar_emissao: portão recusa → nenhuma pendência", async () => {
    const c = ctx({ servicos: servicosFalsos({ autorizarEmissaoDoCliente: jest.fn(async () => ({ ok: false, codigo: "EMISSAO_CLIENTE_NAO_LIBERADA", message: "não liberada", correcao: "peça ao contador" })) }) });
    const r = await executarFerramenta("preparar_emissao", emissao, c);
    expect(r.motivo).toBe("EMISSAO_CLIENTE_NAO_LIBERADA");
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
  });
  it("preparar_emissao: validador recusa → nenhuma pendência, com o código", async () => {
    const c = ctx({ servicos: servicosFalsos({ validateNfsePayload: jest.fn(() => ({ ok: false, error: "tomador_nome_obrigatorio" })) }) });
    const r = await executarFerramenta("preparar_emissao", { ...emissao, tomadorNome: null }, c);
    expect(r.motivo).toBe("tomador_nome_obrigatorio");
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
  });
  it("⚠ preparar_emissao OK: cria a pendência com o payload VALIDADO e o texto da declaração INTEIRA", async () => {
    const c = ctx();
    const r = await executarFerramenta("preparar_emissao", emissao, c);
    expect(r).toMatchObject({ ok: true, pendenciaCriada: true, codigo: "A7K2" });
    const chamada = c.servicos.criarPendencia.mock.calls[0][0];
    expect(chamada.tipo).toBe(TIPOS.EMITIR_NFSE);
    expect(chamada.conversaId).toBe("cv1");
    expect(chamada.portalClientId).toBe("pc-1");
    expect(chamada.payload.companyId).toBe("pc-1");
    for (const rotulo of ["Tomador", "Endereço", "Serviço", "Competência", "Valor dos serviços", "Alíquota de ISS", "ISS retido", "Regime declarado"]) {
      expect(chamada.corpo).toContain(`• ${rotulo}:`);
    }
    expect(chamada.corpo).toMatch(/R\$\s?1\.500,50/);
    expect(chamada.corpo).toMatch(/ato fiscal/);
    expect(c.registrarPendencia).toHaveBeenCalledWith(expect.objectContaining({ tipo: TIPOS.EMITIR_NFSE, codigo: "A7K2" }));
  });

  it("preparar_cancelamento: nota recebida, sem chave, já cancelada, motivo fora da lista, justificativa curta — cada uma recusa sem pendência", async () => {
    const base = { id: "n1", chaveAcesso: "5".repeat(50), numero: "12", status: "EMITIDA", statusEfetivo: "autorizada", papel: "EMIT", type: "NFSE", tomadorDoc: "12345678000190", tomadorNome: "ACME", emitenteDoc: null, total: 100, issueDate: new Date("2026-08-01T00:00:00Z") };
    const casos = [
      [{ ...base, papel: "DEST" }, { notaId: "n1", cMotivo: "1", justificativa: "erro na descrição do serviço" }, "nota_recebida"],
      [{ ...base, chaveAcesso: null }, { notaId: "n1", cMotivo: "1", justificativa: "erro na descrição do serviço" }, "nota_sem_chave"],
      [{ ...base, statusEfetivo: "cancelada" }, { notaId: "n1", cMotivo: "1", justificativa: "erro na descrição do serviço" }, "nota_ja_cancelada"],
      [base, { notaId: "n1", cMotivo: "01", justificativa: "erro na descrição do serviço" }, "c_motivo_invalido"],
      [base, { notaId: "n1", cMotivo: "1", justificativa: "curta" }, "justificativa_invalida"],
    ];
    for (const [nota, input, motivo] of casos) {
      const c = ctx({ prisma: prismaFalso({ portalInvoice: { findFirst: jest.fn(async () => nota), findMany: jest.fn(async () => []) } }) });
      const r = await executarFerramenta("preparar_cancelamento", input, c);
      expect(r.motivo).toBe(motivo);
      expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
    }
  });
  it("⚠ nota RECEBIDA pela 2ª fonte (o `papel` não veio da captura): o CNPJ do tomador é o da empresa → recusa", async () => {
    // A rota do cliente tem DUAS fontes para "recebida"; ler só a coluna `papel` deixa passar a
    // nota cuja captura não a trouxe. Experimento: com uma fonte só, este teste fica vermelho.
    const nota = { id: "n1", chaveAcesso: "5".repeat(50), numero: "12", status: "EMITIDA", statusEfetivo: "autorizada", papel: null, type: "NFSE", tomadorDoc: "11.222.333/0001-81", tomadorNome: "A EMPRESA", emitenteDoc: "99887766000155", total: 100, issueDate: new Date("2026-08-01T00:00:00Z") };
    const c = ctx({ prisma: prismaFalso({ portalInvoice: { findFirst: jest.fn(async () => nota), findMany: jest.fn(async () => []) } }) });
    const r = await executarFerramenta("preparar_cancelamento", { notaId: "n1", cMotivo: "1", justificativa: "erro na descrição do serviço" }, c);
    expect(r.motivo).toBe("nota_recebida");
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
  });
  it("⚠ mas emitir para SI MESMA não é receber: `papel: EMIT` encerra a pergunta", async () => {
    // O tomador é a própria empresa e o `emitenteDoc` da nossa emissão vem vazio — pela comparação
    // de CNPJ sozinha, a nota seria acusada de recebida e o cliente não poderia cancelá-la.
    const nota = { id: "n1", chaveAcesso: "5".repeat(50), numero: "12", status: "EMITIDA", statusEfetivo: "autorizada", papel: "EMIT", type: "NFSE", tomadorDoc: "11222333000181", tomadorNome: "A EMPRESA", emitenteDoc: null, total: 100, issueDate: new Date("2026-08-01T00:00:00Z") };
    const c = ctx({ prisma: prismaFalso({ portalInvoice: { findFirst: jest.fn(async () => nota), findMany: jest.fn(async () => []) } }) });
    const r = await executarFerramenta("preparar_cancelamento", { notaId: "n1", cMotivo: "2", justificativa: "serviço não foi prestado ao cliente" }, c);
    expect(r.ok).toBe(true);
    expect(c.servicos.criarPendencia).toHaveBeenCalledTimes(1);
  });
  it("preparar_cancelamento OK: pendência com chave, número, motivo e a frase 'A nota cancelada não volta.'", async () => {
    const nota = { id: "n1", chaveAcesso: "5".repeat(50), numero: "12", status: "EMITIDA", statusEfetivo: "autorizada", papel: "EMIT", type: "NFSE", tomadorDoc: "12345678000190", tomadorNome: "ACME", emitenteDoc: null, total: 100, issueDate: new Date("2026-08-01T00:00:00Z") };
    const c = ctx({ prisma: prismaFalso({ portalInvoice: { findFirst: jest.fn(async ({ where }) => (where.clientId === "pc-1" ? nota : null)), findMany: jest.fn(async () => []) } }) });
    const r = await executarFerramenta("preparar_cancelamento", { notaId: "n1", cMotivo: "2", justificativa: "serviço não foi prestado ao cliente" }, c);
    expect(r.ok).toBe(true);
    const chamada = c.servicos.criarPendencia.mock.calls[0][0];
    expect(chamada.tipo).toBe(TIPOS.CANCELAR_NFSE);
    expect(chamada.payload).toEqual({ notaId: "n1", chaveAcesso: "5".repeat(50), numero: "12", cMotivo: "2", justificativa: "serviço não foi prestado ao cliente" });
    expect(chamada.corpo).toMatch(/A nota cancelada não volta/);
    expect(chamada.corpo).toMatch(/Número: 12/);
  });

  it("preparar_recalculo: guia NÃO vencida recusa (a trava do dono) — sem pendência", async () => {
    const c = ctx({ servicos: servicosFalsos({ isGuideOverdue: jest.fn(() => false) }) });
    const r = await executarFerramenta("preparar_recalculo", { guideId: "g1" }, c);
    expect(r.motivo).toBe("guia_nao_vencida");
    expect(c.servicos.criarPendencia).not.toHaveBeenCalled();
  });
  it("preparar_recalculo OK: pendência com o aviso de juros e multa", async () => {
    const c = ctx();
    const r = await executarFerramenta("preparar_recalculo", { guideId: "g1" }, c);
    expect(r.ok).toBe(true);
    const chamada = c.servicos.criarPendencia.mock.calls[0][0];
    expect(chamada.tipo).toBe(TIPOS.RECALCULAR_GUIA);
    expect(chamada.payload).toEqual({ guideId: "g1" });
    expect(chamada.corpo).toMatch(/juros e multa/);
  });
  it("preparação não inventa valor atualizado nem data final de cálculo e preserva esse limite no resumo", async () => {
    const c = ctx();
    const r = await executarFerramenta("preparar_recalculo", { guideId: "g1" }, c);
    expect(r.calculo).toEqual({ apurado: false, valorAtualizado: null, dataFinalDosEncargos: null });
    expect(c.servicos.criarPendencia.mock.calls[0][0].corpo).toContain("O valor atualizado e a data final de cálculo dos encargos ainda não foram apurados.");
    expect(r.instrucao).toContain("Não prometa");
  });
  it("chamar_escritorio registra o pedido", async () => {
    const c = ctx();
    const r = await executarFerramenta("chamar_escritorio", { motivo: "quer saber se pode deduzir" }, c);
    expect(r.ok).toBe(true);
    expect(c.registrarChamadaAoEscritorio).toHaveBeenCalledWith({ motivo: "quer saber se pode deduzir" });
  });
});


describe("tabela SITFIS salva em PDF", () => {
  function fiscalContext(over = {}) {
    return ctx({ prisma: prismaFalso({ companyFiscalStatus: { findUnique: jest.fn(async () => ({ texto: "relatório salvo", situacao: "EM_PARCELAMENTO", checkedAt: new Date("2026-07-24"), ultimoRelatorioEm: new Date("2026-07-24") })) } }),
      servicos: servicosFalsos({ gerarPdfSitfisTabela: jest.fn(async () => Buffer.from("%PDF")) }), ...over });
  }
  it("envia anexo com parser completo e escopo da sessão", async () => {
    const c = fiscalContext(); const r = await executarFerramenta("situacao_fiscal", {}, c);
    expect(c.prisma.companyFiscalStatus.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: "pc-1" } }));
    expect(c.servicos.gerarPdfSitfisTabela).toHaveBeenCalledWith(expect.objectContaining({ relatorio: { diagnosticos: [] } }));
    expect(c.enviarDocumento).toHaveBeenCalledWith(expect.objectContaining({ situacaoFiscal: true, mimeType: "application/pdf", conteudo: expect.any(Buffer) }));
    expect(r).toMatchObject({ ok: true, enviado: true }); expect(r).not.toHaveProperty("diagnosticos");
  });
  it("janela fechada não gera ou envia PDF", async () => {
    const c = fiscalContext({ janela: { aberta: false } });
    expect((await executarFerramenta("situacao_fiscal", {}, c)).motivo).toBe("FORA_DA_JANELA");
    expect(c.servicos.gerarPdfSitfisTabela).not.toHaveBeenCalled(); expect(c.enviarDocumento).not.toHaveBeenCalled();
  });
  it("falha de envio nunca confirma entrega", async () => {
    const c = fiscalContext({ enviarDocumento: jest.fn(async () => { throw new Error("offline"); }) });
    expect(await executarFerramenta("situacao_fiscal", {}, c)).toMatchObject({ ok: false, motivo: "SITFIS_ANEXO_ERRO" });
  });
  it("falha de geração não envia arquivo", async () => {
    const c = fiscalContext({ servicos: servicosFalsos({ gerarPdfSitfisTabela: jest.fn(async () => { throw new Error("PDF"); }) }) });
    expect((await executarFerramenta("situacao_fiscal", {}, c)).ok).toBe(false); expect(c.enviarDocumento).not.toHaveBeenCalled();
  });
});
