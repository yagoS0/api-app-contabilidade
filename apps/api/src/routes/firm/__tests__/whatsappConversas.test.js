// AS ROTAS DE CONVERSAS DE WHATSAPP — a porta do escritório (F5, 02/09/2026).
//
// O que fica travado: (1) o escopo por CARTEIRA (fio de empresa fora da carteira é 404, nunca
// 403); (2) ASSUMIR grava quem e quando — é o que pausa a IA — e DEVOLVER limpa; (3) RESPONDER fora
// da janela de 24h é 409 SEM chamar a Meta; dentro, envia e registra `autor: HUMANO`; (4) VINCULAR
// cadastra o contato com o telefone DO FIO (o corpo não escolhe o número) e atribui.

import request from "supertest";
import express from "express";
import { MODOS_RASCUNHO_ATENDIMENTO } from "@contabilidade/shared";

const mockSaidas = [];
const mockIntencoes = [];
const mockRascunhos = [];
const FIO_DA_CARTEIRA = { excluidaEm: null, automacaoInvalidadaEm: null, chaveEscopo: "empresa:pc-1:5521999998888", escopoVerificado: true, id: "cv1", telefoneE164: "5521999998888", portalClientId: "pc-1", atendidaPor: null, atendidaDesde: null, lidaAteEm: null, updatedAt: new Date(), portalClient: { id: "pc-1", razao: "ACME", cnpj: "1" }, atendente: null };
const FIO_DE_FORA = { ...FIO_DA_CARTEIRA, id: "cv2", portalClientId: "pc-9", portalClient: { id: "pc-9", razao: "OUTRA", cnpj: "2" } };
const FIO_NA_FILA = { ...FIO_DA_CARTEIRA, id: "cv3", chaveEscopo:"sem-empresa:5521999998888", portalClientId: null, portalClient: null };

const mockConversas = new Map([["cv1", { ...FIO_DA_CARTEIRA }], ["cv2", { ...FIO_DE_FORA }], ["cv3", { ...FIO_NA_FILA }]]);
const mockCenario = { janela: { situacao: "ABERTA", permite: "TEXTO_LIVRE", expiraEm: null, avisos: [] } };
let mockAtendimento = null;

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const prisma = {
    rascunhoAtendimento: {
      create:jest.fn(async({data})=>{if(mockRascunhos.some(r=>r.userId===data.userId && r.chaveEscopo===data.chaveEscopo)) throw Object.assign(new Error('unique'),{code:'P2002'});const r={id:`d${mockRascunhos.length}`,...data};mockRascunhos.push(r);return{...r};}),
      findUnique:jest.fn(async({where:{userId_chaveEscopo:k}})=>{const r=mockRascunhos.find(r=>r.userId===k.userId && r.chaveEscopo===k.chaveEscopo);return r?{...r}:null;}),
      updateMany:jest.fn(async({where,data})=>{let count=0;for(const r of mockRascunhos){
        if(where.userId && r.userId!==where.userId || where.chaveEscopo && r.chaveEscopo!==where.chaveEscopo || where.versao!==undefined && r.versao!==where.versao || where.expiraEm?.lte && r.expiraEm>where.expiraEm.lte || where.NOT && r.conteudo.apagado)continue;
        Object.assign(r,{...data,...(data.versao?.increment?{versao:r.versao+data.versao.increment}:{})});count++;
      }return{count};}),
    },
    intencaoEnvioAtendimento: {
      create:jest.fn(async({data})=>{if(mockIntencoes.some(r=>r.userId===data.userId && r.clientRequestId===data.clientRequestId)) throw Object.assign(new Error('unique'),{code:'P2002'}); const r={id:`i${mockIntencoes.length}`,status:'RESERVADA',createdAt:new Date(),...data};mockIntencoes.push(r);return r;}),
      findUnique:jest.fn(async({where:{userId_clientRequestId:k}})=>mockIntencoes.find(r=>r.userId===k.userId && r.clientRequestId===k.clientRequestId) || null),
      update:jest.fn(async({where,data})=>Object.assign(mockIntencoes.find(r=>r.id===where.id),data)),
      updateMany:jest.fn(async({where,data})=>{Object.assign(mockIntencoes.find(r=>r.id===where.id),data);return{count:1};}),
    },
    arquivoWhatsapp: { findMany: jest.fn(async () => []), upsert: jest.fn(async ({create}) => ({id:'arquivo-test',...create})) },
    portalClient: { findMany: jest.fn(async () => [{ id: "pc-1" }]), update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })) },
    companyFirmAccess: { findMany: jest.fn(async () => []) },
    conversaWhatsapp: {
      findFirst: jest.fn(async ({ where }) => [...mockConversas.values()].find(c => c.atendimentoId === where.atendimentoId && c.portalClientId && !where.portalClientId.notIn.includes(c.portalClientId)) || null),
      findUnique: jest.fn(async ({ where }) => mockConversas.has(where.id) ? { ...mockConversas.get(where.id) } : null),
      // ⚠ O dublê passa a HONRAR o `where` (06/09/2026): sem isso o filtro por empresa "passaria"
      // no teste devolvendo tudo, e a guarda de isolamento não teria prova nenhuma.
      findMany: jest.fn(async ({ where = {}, take, cursor, skip = 0 } = {}) => {
        const todas = [...mockConversas.values()];
        const casaUm = (c, w) => {
          if (w.OR && !w.OR.some((parte) => casaUm(c, parte))) return false;
          if (w.AND && !(Array.isArray(w.AND) ? w.AND : [w.AND]).every((parte) => casaUm(c, parte))) return false;
          if (w.NOT && (Array.isArray(w.NOT) ? w.NOT : [w.NOT]).some((parte) => casaUm(c, parte))) return false;
          if (w.portalClientId === null && c.portalClientId !== null) return false;
          if (w.atendimentoId === null && c.atendimentoId != null) return false;
          if (typeof w.atendimentoId === "string" && c.atendimentoId !== w.atendimentoId) return false;
          if (w.atendimentoId?.not === null && !c.atendimentoId) return false;
          if (w.atendimento?.is) {
            const escopo = w.atendimento.is;
            if (!c.atendimentoId) return false;
            if (escopo.atendidaPor && c.atendimento?.atendidaPor !== escopo.atendidaPor) return false;
            if (escopo.conversas?.some && !todas.some(s => s.atendimentoId === c.atendimentoId && casaUm(s, escopo.conversas.some))) return false;
          }
          if (w.portalClientId?.in && !w.portalClientId.in.includes(c.portalClientId)) return false;
          if (w.chaveEscopo?.startsWith && !String(c.chaveEscopo || "").startsWith(w.chaveEscopo.startsWith)) return false;
          if (w.excluidaEm === null && c.excluidaEm != null) return false;
          if (w.excluidaEm?.not === null && c.excluidaEm == null) return false;
          if (w.atendidaPor && c.atendidaPor !== w.atendidaPor) return false;
          return true;
        };
        let achadas = todas.filter((c) => casaUm(c, where));
        if (cursor) achadas = achadas.slice(achadas.findIndex((c) => c.id === cursor.id) + skip);
        return take ? achadas.slice(0, take) : achadas;
      }),
      update: jest.fn(async ({ where, data }) => Object.assign(mockConversas.get(where.id), data)),
      updateMany: jest.fn(async ({ where, data }) => {
        const conversa = mockConversas.get(where.id);
        if (!conversa) return { count: 0 };
        if (where.excluidaEm !== undefined) {
          const instante = (v) => v == null ? null : new Date(v).getTime();
          if (instante(conversa.excluidaEm) !== instante(where.excluidaEm)) return { count: 0 };
          if (where.automacaoInvalidadaEm !== undefined && instante(conversa.automacaoInvalidadaEm) !== instante(where.automacaoInvalidadaEm)) return { count: 0 };
          Object.assign(conversa, data);
          return { count: 1 };
        }
        if (!where.OR.some((condicao) => condicao.lidaAteEm === null
          ? conversa.lidaAteEm === null
          : conversa.lidaAteEm !== null && conversa.lidaAteEm < condicao.lidaAteEm.lt)) return { count: 0 };
        Object.assign(conversa, data);
        return { count: 1 };
      }),
    },
    mensagemWhatsapp: { findUnique:jest.fn(async({where})=>mockSaidas.find(m=>m.intencaoEnvioId===where.intencaoEnvioId) || null), create: jest.fn(async ({data}) => { const m={id:`out${mockSaidas.length+1}`,...data}; mockSaidas.push(m); return m; }), update: jest.fn(async ({where,data}) => Object.assign(mockSaidas.find(m=>m.id===where.id),data)), updateMany: jest.fn(async()=>({count:1})), findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    atendimentoLead: { findFirst: jest.fn(async () => null) },
    atendimentoResponsavelWhatsapp: { findUnique: jest.fn(async () => mockAtendimento ? { ...mockAtendimento } : null) },
    // ⚠ O nome do CADASTRO passou a viajar no payload (06/09/2026): a linha da lista precisa dizer
    // QUEM está falando, não só de qual empresa. Ver `resumoDaConversa`.
    contatoWhatsapp: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    templateWhatsapp: { findUnique: jest.fn(async () => ({ chave: "reabrir_conversa", statusAprovacao: "DECLARADO", nomeMeta: null })) },
    recursoComercial: { findUnique: jest.fn(async () => ({ id:'orientacao-teste', chave:'exemplo',tipo:'ORIENTACAO',versao:2,aprovadoEm:new Date(),texto:'Orientação atualizada' })),findFirst:jest.fn(async()=>null) },
    acaoPendenteWhatsapp: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({count: 1})) },
    turnoIaWhatsapp: { updateMany: jest.fn(async () => ({count: 1})) },
    chamadaIa: { aggregate: jest.fn(async () => ({ _sum: { custoEstimadoCentavos: 0 }, _count: { _all: 0 } })) },
  };
  prisma.$transaction = jest.fn(async (fn) => fn(prisma));
  return { prisma };
});

jest.mock("../../../application/whatsapp/AtendimentoResponsavelWhatsappService.js", () => ({
  comLeaseDoAtendimento: jest.fn(async (_args, enviar) => enviar(async () => true)),
  alterarAtendimentoHumano: jest.fn(async ({ conversa, atendidaPor, atendidaDesde }) => {
    Object.assign(mockAtendimento, { atendidaPor, atendidaDesde });
    for (const c of mockConversas.values()) if (c.atendimentoId === conversa.atendimentoId) Object.assign(c, { atendidaPor, atendidaDesde, atendimento: { ...mockAtendimento } });
    return { conversa: mockConversas.get(conversa.id), atendimento: mockAtendimento };
  }),
  selecionarEmpresaDoEscritorio: jest.fn(async ({ portalClientId }) => {
    const c = [...mockConversas.values()].find(c => c.portalClientId === portalClientId && c.atendimentoId === mockAtendimento.id);
    if (!c) throw Object.assign(new Error("Empresa não autorizada."), { code: "EMPRESA_NAO_AUTORIZADA" });
    Object.assign(mockAtendimento, { portalClientId, conversaId: c.id, aguardandoSelecao: false, versao: mockAtendimento.versao + 1 });
    for (const item of mockConversas.values()) if (item.atendimentoId === mockAtendimento.id) item.atendimento = { ...mockAtendimento };
    return { conversa: c, atendimento: mockAtendimento };
  }),
}));

jest.mock("../../../application/whatsapp/ConversaWhatsappService.js", () => {
  const real = jest.requireActual("../../../application/whatsapp/ConversaWhatsappService.js");
  return {
    ...real,
    conversasNaoVinculadas: jest.fn(async () => [{ conversa: { id: "cv3" }, motivo: "DESCONHECIDO", empresasCandidatas: [], divergemPeloNonoDigito: false }]),
    listarMensagens: jest.fn(async () => [{ id: "m1", direcao: "in", tipo: "text", corpo: "oi", autor: null, registradaEm: new Date() }]),
    janelaDaConversa: jest.fn(async () => mockCenario.janela),
    atribuirConversa: jest.fn(async ({ conversaId, portalClientId }) => ({ ...mockConversas.get(conversaId), portalClientId })),
    registrarMensagemEnviada: jest.fn(async (args) => ({ mensagem: { id: "out1", ...args }, duplicada: false })),
  };
});
// ⚠ O documento é buscado com o `portalClientId` DO FIO — o dublê honra isso, senão a guarda de
// isolamento (documento da empresa A pelo fio da empresa B) não teria prova nenhuma.
jest.mock("../../../application/companies/CompanyDocumentsService.js", () => {
  class CompanyDocumentError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
  }
  const DOCS = [
    { id: "doc-1", portalClientId: "pc-1", nome: "Contrato social.pdf", tipo: "CONTRATO_SOCIAL", mimeType: "application/pdf" },
    { id: "doc-9", portalClientId: "pc-9", nome: "Alvara de outra.pdf", tipo: "ALVARA", mimeType: "application/pdf" },
  ];
  return {
    CompanyDocumentError,
    baixarBuffer: jest.fn(async ({ portalClientId, documentId }) => {
      const doc = DOCS.find((d) => d.id === documentId && d.portalClientId === portalClientId);
      if (!doc) throw new CompanyDocumentError("documento_nao_encontrado", "Documento não encontrado.", 404);
      return { doc, buffer: Buffer.from("%PDF-1.4 fake") };
    }),
  };
});
jest.mock("../../../application/whatsapp/ContatoWhatsappService.js", () => ({
  ContatoWhatsappError: class extends Error { constructor(code, m) { super(m); this.code = code; } },
  salvarContato: jest.fn(async (args) => ({ id: "ctt1", ...args })),
  resolverVinculoPorTelefone: jest.fn(async () => ({ situacao: "VINCULADO", empresas: [{ portalClientId: "pc-1" }] })),
}));

import { createWhatsappConversasRouter } from "../whatsappConversas.js";
import { registrarMensagemEnviada } from "../../../application/whatsapp/ConversaWhatsappService.js";
import { salvarContato, resolverVinculoPorTelefone } from "../../../application/whatsapp/ContatoWhatsappService.js";
import { listarMensagens } from "../../../application/whatsapp/ConversaWhatsappService.js";
import { prisma } from "../../../infrastructure/db/prisma.js";

import { baixarBuffer } from "../../../application/companies/CompanyDocumentsService.js";
import { alterarAtendimentoHumano, selecionarEmpresaDoEscritorio } from "../../../application/whatsapp/AtendimentoResponsavelWhatsappService.js";
import * as inboxIdentidade from "../../../application/whatsapp/InboxWhatsappService.js";

const cloud = {
  enviarTexto: jest.fn(async () => ({ wamid: "wamid.h" })),
  enviarDocumento: jest.fn(async () => ({ wamid: "wamid.doc" })),
  enviarImagem: jest.fn(async () => ({ wamid: "wamid.img" })),
  enviarTemplate: jest.fn(async () => ({ wamid: 'wamid.template' })),
};

function montarApp(user = { id: "u-contador", name: "Contador Teste", role: "contador", accountType: "FIRM" }, opcoes = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { user }; next(); });
  app.use("/firm", createWhatsappConversasRouter({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }, cloud, ...opcoes }));
  return app;
}

beforeEach(() => {
  cloud.enviarDocumento.mockClear(); cloud.enviarImagem.mockClear();
  prisma.atendimentoLead.findFirst.mockReset().mockResolvedValue(null);
  cloud.enviarTexto.mockClear();
  mockSaidas.length=0; mockIntencoes.length=0; mockRascunhos.length=0;
  cloud.enviarTemplate.mockClear();
  prisma.mensagemWhatsapp.create.mockClear();
  prisma.mensagemWhatsapp.update.mockClear();
  registrarMensagemEnviada.mockClear();
  salvarContato.mockClear();
  mockCenario.janela = { situacao: "ABERTA", permite: "TEXTO_LIVRE", expiraEm: null, avisos: [] };
  Object.assign(mockConversas.get("cv1"), { atendidaPor: null, atendidaDesde: null, lidaAteEm: null });
});

describe("devolução do comercial com identidade e sem atendimento operacional", () => {
  let carregar, pessoa;
  beforeEach(() => {
    pessoa = { id: 'p-teste', versao: 7, atendidaPor: 'u-contador', atendidaDesde: new Date() };
    Object.assign(mockConversas.get('cv1'), { vinculoNumeroId: 'v-teste', atendimentoId: null });
    carregar = jest.spyOn(inboxIdentidade, 'carregarGrupoIdentidade').mockImplementation(async () => ({
      completo: true, origem: { ...mockConversas.get('cv1'), vinculoNumero: { interlocutor: pessoa } },
    }));
    alterarAtendimentoHumano.mockClear();
  });
  afterEach(() => {
    carregar.mockRestore();
    delete mockConversas.get('cv1').vinculoNumeroId;
    delete mockConversas.get('cv1').atendimentoId;
  });
  it('limpa o responsável da pessoa em vez de apenas devolver o segmento comercial', async () => {
    alterarAtendimentoHumano.mockImplementationOnce(async ({ atendidaPor, atendidaDesde }) => {
      Object.assign(pessoa, { atendidaPor, atendidaDesde });
    });
    const r = await request(montarApp()).post('/firm/whatsapp/conversas/cv1/devolver');
    expect(r.status).toBe(200);
    expect(alterarAtendimentoHumano).toHaveBeenCalledWith(expect.objectContaining({
      conversa: expect.objectContaining({ vinculoNumeroId: 'v-teste', atendimentoId: null, atendidaPor: 'u-contador', atendimentoHumanoVersao: 7 }),
      atendidaPor: null, atendidaDesde: null, preservarResponsavel: true,
    }));
    expect(r.body.conversa).toMatchObject({ atendidaPor: null, atendidaDesde: null });
  });
  it('não assume por cima de outro atendente oculto no segmento', async () => {
    pessoa.atendidaPor = 'outro-atendente';
    const r = await request(montarApp()).post('/firm/whatsapp/conversas/cv1/assumir');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('ATENDIMENTO_OCUPADO');
    expect(alterarAtendimentoHumano).not.toHaveBeenCalled();
  });
  it('não libera o contato inteiro com carteira parcial', async () => {
    carregar.mockResolvedValue({ completo: false, origem: { vinculoNumero: { interlocutor: pessoa } } });
    const r = await request(montarApp()).post('/firm/whatsapp/conversas/cv1/devolver');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('ATENDIMENTO_FORA_DA_CARTEIRA');
    expect(alterarAtendimentoHumano).not.toHaveBeenCalled();
  });
  it('conflito durante a devolução informa que o atendimento mudou', async () => {
    alterarAtendimentoHumano.mockRejectedValueOnce(Object.assign(new Error('Outro atendente assumiu.'), { codigo: 'ATENDIMENTO_OCUPADO' }));
    const r = await request(montarApp()).post('/firm/whatsapp/conversas/cv1/devolver');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('ATENDIMENTO_OCUPADO');
  });
});

describe("identificação de quem envia", () => {
  it("usa o usuário autenticado e ignora o nome recebido no corpo", async () => {
    mockConversas.get("cv1").atendente = { name: "Outra pessoa" };
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder")
      .send({ texto: "Olá", autorNome: "Nome forjado", atendente: { name: "Nome forjado" } });
    expect(r.status).toBe(200);
    expect(r.body.mensagem.corpo).toBe("*Contador Teste*\n\nOlá");
    expect(mockSaidas.at(-1).corpo).toBe(r.body.mensagem.corpo);
    expect(cloud.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ texto: r.body.mensagem.corpo }));
    mockConversas.get("cv1").atendente = null;
  });
  it("mensagem rápida recebe o nome sem alterar a versão da biblioteca", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder")
      .send({ orientacaoId: "orientacao-teste", orientacaoVersao: 2 });
    expect(r.status).toBe(200); expect(r.body.mensagem.corpo).toBe("*Contador Teste*\n\nOrientação atualizada");
    expect(mockSaidas.at(-1).referenciaComercial.versao).toBe(2);
  });
  it("recusa texto que ultrapassa o limite com a assinatura antes de registrar ou enviar", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder").send({ texto: "a".repeat(4096) });
    expect(r.status).toBe(400); expect(r.body.error).toBe("MENSAGEM_ASSINADA_LONGA");
    expect(mockSaidas).toHaveLength(0); expect(cloud.enviarTexto).not.toHaveBeenCalled();
  });
  it("legenda longa não produz envio parcial", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv3/enviar-anexo")
      .field("legenda", "a".repeat(1024)).attach("arquivo", Buffer.from("%PDF-1.7\nteste"), { filename: "teste.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(400); expect(mockSaidas).toHaveLength(0); expect(cloud.enviarDocumento).not.toHaveBeenCalled();
  });
});

describe("anexo manual para pessoa ou lead", () => {
  const pdf = Buffer.from("%PDF-1.7\nTeste offline\n%%EOF");
  it("envia PDF ao telefone do lead e registra a saída antes do transporte", async () => {
    cloud.enviarDocumento.mockImplementationOnce(async () => { expect(mockSaidas.at(-1).statusEnvio).toBe("enviando"); return { wamid: "pdf.offline" }; });
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv3/enviar-anexo").field("legenda", "Contrato para assinatura").attach("arquivo", pdf, { filename: "contrato.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(200); expect(r.body.mensagem.statusEnvio).toBe("enviado");
    expect(cloud.enviarDocumento).toHaveBeenCalledWith(expect.objectContaining({ telefone: FIO_NA_FILA.telefoneE164, nomeArquivo: "contrato.pdf", conteudo: pdf, legenda: "*Contador Teste*\n\nContrato para assinatura" }));
  });
  it("envia PNG como imagem e não como documento", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv3/enviar-anexo").attach("arquivo", Buffer.from([137,80,78,71,13,10,26,10]), { filename: "teste.png", contentType: "image/png" });
    expect(r.status).toBe(200); expect(cloud.enviarImagem).toHaveBeenCalledTimes(1); expect(cloud.enviarDocumento).not.toHaveBeenCalled();
    expect(cloud.enviarImagem).toHaveBeenCalledWith(expect.objectContaining({ legenda: "*Contador Teste*" }));
  });
  it("recusa janela expirada, carteira alheia e arquivo falso sem transporte", async () => {
    mockCenario.janela = { situacao: "EXPIRADA" };
    expect((await request(montarApp()).post("/firm/whatsapp/conversas/cv3/enviar-anexo").attach("arquivo", pdf, "teste.pdf")).status).toBe(409);
    expect((await request(montarApp()).post("/firm/whatsapp/conversas/cv2/enviar-anexo").attach("arquivo", pdf, "teste.pdf")).status).toBe(404);
    expect((await request(montarApp()).post("/firm/whatsapp/conversas/cv3/enviar-anexo").attach("arquivo", Buffer.from("falso"), "teste.pdf")).status).toBe(400);
    expect(cloud.enviarDocumento).not.toHaveBeenCalled();
  });
  it("lead classificado não é vinculado a empresa existente", async () => {
    prisma.atendimentoLead.findFirst.mockResolvedValueOnce({ id: "lead", onboardingId: "ficha" });
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv3/vincular").send({ portalClientId: "pc-1", contato: { nome: "Contato" } });
    expect(r.status).toBe(409); expect(r.body.error).toBe("LEAD_EM_ATENDIMENTO"); expect(salvarContato).not.toHaveBeenCalled();
  });
});

describe("responsável com várias empresas", () => {
  let anteriores;
  beforeEach(() => {
    anteriores = new Map([...mockConversas].map(([id, c]) => [id, { ...c }]));
    mockConversas.clear();
    mockAtendimento = { id: "at-1", userId: "responsavel", portalClientId: "pc-1", conversaId: "cv1", versao: 2, aguardandoSelecao: false, atendidaPor: null, atendidaDesde: null };
    resolverVinculoPorTelefone.mockResolvedValue({ situacao: "VINCULADO", empresas: [{ portalClientId: "pc-1", contatos: [{ userId: "responsavel", statusRbac: "ACTIVE", papelRbac: "OWNER" }] }] });
    for (const c of [FIO_DA_CARTEIRA, FIO_DE_FORA, FIO_NA_FILA]) mockConversas.set(c.id, { ...c, atendimentoId: "at-1", atendimento: { ...mockAtendimento } });
    alterarAtendimentoHumano.mockClear(); selecionarEmpresaDoEscritorio.mockClear(); cloud.enviarDocumento.mockClear();
  });
  afterEach(() => { mockAtendimento = null; mockConversas.clear(); for (const [id, c] of anteriores) mockConversas.set(id, c); resolverVinculoPorTelefone.mockResolvedValue({ situacao: "VINCULADO", empresas: [{ portalClientId: "pc-1" }] }); });

  it("lista agrupa e filtra empresas e recibo neutro da carteira parcial", async () => {
    const r = await request(montarApp()).get("/firm/whatsapp/conversas");
    expect(r.status).toBe(200);
    expect(r.body.conversas).toHaveLength(1);
    expect(r.body.conversas[0]).toMatchObject({ id: "cv1", atendimento: { id: "at-1", contextoSelecionado: true }, empresas: [{ id: "pc-1", razao: "ACME" }] });
    expect(JSON.stringify(r.body)).not.toContain("OUTRA");
    expect((await request(montarApp()).get("/firm/whatsapp/conversas/cv3/mensagens")).status).toBe(404);
  });
  it("pedido neutro recente atualiza a posição do responsável e preserva cursor sem expor o corpo", async () => {
    const recente = new Date(Date.now() + 1000);
    Object.assign(mockAtendimento, { aguardandoSelecao: true, ultimaInteracaoEm: recente });
    for (const c of mockConversas.values()) c.atendimento = { ...mockAtendimento };
    const neutra = mockConversas.get("cv3"); const empresa = mockConversas.get("cv1"); const fora = mockConversas.get("cv2");
    mockConversas.clear(); for (const c of [neutra, empresa, fora]) mockConversas.set(c.id, c);
    const r = await request(montarApp()).get("/firm/whatsapp/conversas?limite=1");
    expect(r.status).toBe(200); expect(r.body.conversas).toHaveLength(1);
    expect(r.body.conversas[0]).toMatchObject({ id: "cv1", updatedAt: recente.toISOString(), atendimento: { aguardandoSelecao: true } });
    expect(r.body.conversas[0].ultimaMensagem).toBeNull();
    expect(r.body.proximoCursor).toBe("cv3");
    expect((await request(montarApp()).get("/firm/whatsapp/conversas?empresa=pc-inexistente")).body.conversas).toEqual([]);
  });
  it("escolha fora da carteira é 404 antes de consultar o vínculo", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/selecionar-empresa").send({ portalClientId: "pc-9" });
    expect(r.status).toBe(404); expect(selecionarEmpresaDoEscritorio).not.toHaveBeenCalled();
  });
  it("escolha válida retorna o segmento ativado e versão sem transferir histórico", async () => {
    const r = await request(mont…11695 tokens truncated…e(true);
  const alterado=await request(app).post('/firm/whatsapp/conversas/cv1/retomar').send({assunto:'outro assunto',previaHash:previa.body.previaHash,clientRequestId:'retomar-tampered-1'});expect(alterado.status).toBe(409);expect(cloud.enviarTemplate).not.toHaveBeenCalled();
  const body={assunto:'as guias',previaHash:previa.body.previaHash,clientRequestId:'retomar-correto-01'};
  expect((await request(app).post('/firm/whatsapp/conversas/cv1/retomar').send(body)).status).toBe(200);
  expect((await request(app).post('/firm/whatsapp/conversas/cv1/retomar').send(body)).status).toBe(200);
  expect(cloud.enviarTemplate).toHaveBeenCalledTimes(1);expect(cloud.enviarTemplate).toHaveBeenCalledWith({telefone:FIO_DA_CARTEIRA.telefoneE164,template:'reabrir_conversa',idioma:'pt_BR',variaveis:['as guias'],botoesResposta:['altan.client.human.v1']});
  expect((await request(app).post('/firm/whatsapp/conversas/cv1/responder').send({texto:'não liberar'})).status).toBe(409);
 });
 it.each(['previa','modelo'])('ação %s nega outra carteira e papel de cliente antes da Meta',async acao=>{
  const consultarModelo=jest.fn(),criarModelo=jest.fn(),app=montarApp(undefined,{consultarModelo,criarModelo});
  expect((await request(app).post('/firm/whatsapp/conversas/cv2/retomar/'+acao).send({assunto:'guias'})).status).toBe(404);
  expect((await request(montarApp({id:'cliente',role:'cliente'},{consultarModelo,criarModelo})).post('/firm/whatsapp/conversas/cv1/retomar/'+acao).send({assunto:'guias'})).status).toBe(403);
  expect(consultarModelo).not.toHaveBeenCalled();expect(criarModelo).not.toHaveBeenCalled();
 });
 it('submissão cria apenas o modelo fixo e não dispara mensagem',async()=>{
  const criarModelo=jest.fn(async()=>({id:'novo',status:'PENDING'})),app=montarApp(undefined,{consultarModelo:async()=>null,criarModelo});
  const r=await request(app).post('/firm/whatsapp/conversas/cv1/retomar/modelo').send({token:'ignorar',nome:'arbitrario',corpo:'ignorar'});
  expect(r.status).toBe(200);expect(r.body.statusMeta).toBe('PENDING');expect(criarModelo).toHaveBeenCalledWith(expect.objectContaining({name:'reabrir_conversa'}));expect(cloud.enviarTemplate).not.toHaveBeenCalled();expect(cloud.enviarTexto).not.toHaveBeenCalled();
 });
});
