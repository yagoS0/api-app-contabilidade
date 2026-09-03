// AS FERRAMENTAS — cada recusa medida por NÃO-CHAMADA do serviço que executaria.
//
// Os `servicos` são dublês injetados; o `prisma` é um objeto com os poucos métodos que as ferramentas
// usam. Nenhuma rede, nenhum banco.

import { executarFerramenta } from "../ferramentas/index.js";
import { TIPOS } from "../confirmacaoPendente.js";

const silencio = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

function sessao(over = {}) {
  return { ok: true, portalClientId: "pc-1", userId: "u1", papel: "CLIENT_ADMIN", contatoNome: "Maria", motivo: null, ...over };
}

const GUIA = { id: "g1", portalClientId: "pc-1", tipo: "SIMPLES", competencia: "2026-08", valor: 500, vencimento: new Date("2026-08-20T00:00:00Z"), paymentStatus: "OVERDUE", status: "PROCESSED", liberadaCliente: true, parcelamentoId: null };

function prismaFalso(over = {}) {
  return {
    guide: { findMany: jest.fn(async () => [GUIA]), findFirst: jest.fn(async ({ where }) => (where.id === "g1" && where.portalClientId === "pc-1" ? GUIA : null)) },
    portalInvoice: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    serviceInvoice: { findFirst: jest.fn(async () => null) },
    companyFiscalStatus: { findUnique: jest.fn(async () => null) },
    ...over,
  };
}

function servicosFalsos(over = {}) {
  return {
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
});

describe("as três preparar_* — só PENDÊNCIA, nunca ato", () => {
  const emissao = { tomadorDoc: "12.345.678/0001-90", tomadorNome: "ACME", tomadorEmail: null, descricao: "Consultoria", valor: 1500.5, competencia: "2026-09", aliquota: null, issRetido: null, pTotTribSN: null, endereco: null };

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
  it("chamar_escritorio registra o pedido", async () => {
    const c = ctx();
    const r = await executarFerramenta("chamar_escritorio", { motivo: "quer saber se pode deduzir" }, c);
    expect(r.ok).toBe(true);
    expect(c.registrarChamadaAoEscritorio).toHaveBeenCalledWith({ motivo: "quer saber se pode deduzir" });
  });
});
