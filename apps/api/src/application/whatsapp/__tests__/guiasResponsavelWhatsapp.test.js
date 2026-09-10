// Serviço e saída rastreada reais, catálogo de permissões real. O executor é um spy que aceita
// exclusivamente quanto_devo. Nenhuma consulta externa, emissão, envio real ou chamada de modelo.
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../ConversaWhatsappService.js", () => ({
  garantirConversa: jest.fn(async ({ portalClientId, client }) => ({ ...client.conversas.find(c => c.portalClientId === portalClientId) })),
  janelaDaConversa: jest.fn(async () => ({ situacao: "ABERTA" })),
}));

import { consultarGuiasDoResponsavel } from "../GuiasResponsavelWhatsappService.js";

const AGORA = new Date("2026-09-10T12:00:00Z");
const TELEFONE = "5521999998888";
const IDS = ["klaus", "lente", "alessandro"];
const NOMES = ["Klaus sintética", "Lente sintética", "Alessandro sintético"];
const DOCS = ["11222333000181", "11444777000161", "19131243000197"];
const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
const copy = v => v == null ? v : structuredClone(v);

function fixture() {
  const attendance = { id: "atendimento", telefoneE164: TELEFONE, userId: "liz", versao: 8, expiraEm: new Date(+AGORA + 30 * 60000), atendidaPor: null, atendidaDesde: null, automacaoInvalidadaEm: null };
  const contatos = IDS.map((id, i) => ({ id: `contato-${id}`, portalClientId: id, nome: "Liz sintética", userId: "liz", permissoesAssistente: ["GUIAS"], papelRbac: "CLIENT_ADMIN", statusRbac: "ACTIVE", razao: NOMES[i], cnpj: DOCS[i] }));
  const conversas = [{ id: "neutra", portalClientId: null }, ...IDS.map(id => ({ id: `cv-${id}`, portalClientId: id }))].map(c => ({ ...c, telefoneE164: TELEFONE, atendimentoId: attendance.id, excluidaEm: null, automacaoInvalidadaEm: null }));
  const mensagens = [{ id: "entrada", conversaId: "neutra", direcao: "in", corpo: "guias de todas", registradaEm: AGORA, respondidaPelaIaEm: null }];
  let empresasRevogadas = [];
  const resolverVinculo = jest.fn(async () => ({ situacao: "AMBIGUO", leitura: "ESTRITA", ambiguidades: ["EMPRESA"], empresas: contatos.filter(c => !empresasRevogadas.includes(c.portalClientId)).map(c => ({ portalClientId: c.portalClientId, razao: c.razao, cnpj: c.cnpj, pessoaAmbigua: false, contatos: [{ contatoId: c.id, userId: c.userId, papelRbac: c.papelRbac, statusRbac: c.statusRbac }] })) }));
  const client = {
    conversas,
    atendimentoResponsavelWhatsapp: { findUnique: jest.fn(async () => copy(attendance)), update: jest.fn(() => { throw new Error("Consulta não altera o atendimento"); }), updateMany: jest.fn(() => { throw new Error("Consulta não altera o atendimento"); }) },
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => copy(conversas.find(c => c.id === where.id))), update: jest.fn(async ({ where, data }) => Object.assign(conversas.find(c => c.id === where.id), data)) },
    contatoWhatsapp: { findMany: jest.fn(async ({ where }) => contatos.filter(c => c.portalClientId === where.portalClientId).map(copy)) },
    companyClientUser: { findUnique: jest.fn(async ({ where }) => { const c = contatos.find(v => v.portalClientId === where.companyId_userId.companyId && v.userId === where.companyId_userId.userId); return c ? { role: c.papelRbac, status: c.statusRbac } : null; }) },
    mensagemWhatsapp: {
      findFirst: jest.fn(async ({ where }) => copy(mensagens.find(m => m.turnoIaId === where.turnoIaId && m.direcao === where.direcao) || null)),
      create: jest.fn(async ({ data }) => { const m = { id: `saida-${mensagens.length}`, registradaEm: new Date(), ...data }; mensagens.push(m); return copy(m); }),
      update: jest.fn(async ({ where, data }) => Object.assign(mensagens.find(m => m.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }) => { const matches = mensagens.filter(m => m.id === where.id && (where.statusEnvio === undefined || m.statusEnvio === where.statusEnvio) && (where.respondidaPelaIaEm === undefined || m.respondidaPelaIaEm === where.respondidaPelaIaEm)); matches.forEach(m => Object.assign(m, data)); return { count: matches.length }; }),
    },
    acaoPendenteWhatsapp: { create: jest.fn(() => { throw new Error("Consulta não cria ato"); }), updateMany: jest.fn(() => { throw new Error("Consulta não confirma ato"); }) },
    rascunhoEmissaoWhatsapp: { updateMany: jest.fn(() => { throw new Error("Consulta não altera emissor"); }) },
  };
  const registro = { conversa: copy(conversas[0]), mensagem: copy(mensagens[0]) };
  const recibo = { mensagemId: "entrada", atendimentoId: attendance.id, versao: attendance.versao, estado: "TODAS", resultado: { empresas: [...IDS] } };
  const executar = jest.fn(async (nome, input, ctx) => {
    if (nome !== "quanto_devo" || Object.keys(input).length) throw new Error("Função proibida no teste de consulta");
    const id = ctx.sessao.portalClientId;
    if (ctx.conversa.portalClientId !== id) throw new Error("Empresa da consulta divergente");
    return { ok: true, guias: [{ guideId: `guia-${id}`, tipo: `DAS-${id}`, competencia: "2026-08", valorFormatado: `R$ ${IDS.indexOf(id) + 1}00,00`, vencimento: "20/09/2026" }] };
  });
  const cloud = { enviarTexto: jest.fn(async () => ({ wamid: `wamid-${mensagens.length}` })) };
  const conferirLease = jest.fn(async () => {}), conferirJanela = jest.fn(async () => ({ situacao: "ABERTA" }));
  const rodar = over => consultarGuiasDoResponsavel({ registro, recibo, conferirLease, client, cloud, agora: AGORA, piloto: [...IDS], telefonesPiloto: [], resolverVinculo, conferirJanela, executar, log, ...over });
  return { attendance, contatos, conversas, mensagens, resolverVinculo, client, recibo, registro, executar, cloud, conferirLease, conferirJanela, rodar, revogar: ids => { empresasRevogadas = ids; } };
}

beforeEach(() => { jest.useFakeTimers({ now: AGORA, doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] }); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

it("três empresas produzem três respostas segregadas, sempre apenas quanto_devo", async () => {
  const f = fixture(), antes = copy(f.attendance);
  expect(await f.rodar()).toMatchObject({ motivo: "GUIAS_TODAS_EMPRESAS" });
  expect(f.executar.mock.calls.map(([name, , ctx]) => [name, ctx.sessao.portalClientId, ctx.conversa.portalClientId])).toEqual(IDS.map(id => ["quanto_devo", id, id]));
  const saidas = f.mensagens.filter(m => m.direcao === "out"); expect(saidas).toHaveLength(3);
  saidas.forEach((s, i) => { expect(s.conversaId).toBe(`cv-${IDS[i]}`); expect(s.corpo).toContain(NOMES[i]); expect(s.corpo).toContain(DOCS[i]); expect(s.corpo).toContain(`DAS-${IDS[i]}`); IDS.filter((_, j) => i !== j).forEach(id => expect(s.corpo).not.toContain(`DAS-${id}`)); });
  expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(3); expect(f.attendance).toEqual(antes); expect(f.mensagens[0].respondidaPelaIaEm).toBeTruthy();
  expect(f.client.acaoPendenteWhatsapp.create).not.toHaveBeenCalled(); expect(f.client.acaoPendenteWhatsapp.updateMany).not.toHaveBeenCalled(); expect(f.client.rascunhoEmissaoWhatsapp.updateMany).not.toHaveBeenCalled();
});

it("falha de consulta em uma empresa informa somente sua falha e continua nas demais", async () => {
  const f = fixture(), original = f.executar.getMockImplementation();
  f.executar.mockImplementation(async (name, input, ctx) => { if (ctx.sessao.portalClientId === "lente") throw new Error("DADO_INTERNO_SENSIVEL"); return original(name, input, ctx); });
  await f.rodar();
  expect(f.executar).toHaveBeenCalledTimes(3); expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(3);
  const textos = f.cloud.enviarTexto.mock.calls.map(([v]) => v.texto);
  expect(textos[0]).toContain("DAS-klaus"); expect(textos[1]).toContain("Lente sintética"); expect(textos[1]).toContain("Não consegui consultar"); expect(textos[2]).toContain("DAS-alessandro"); expect(textos.join("\n")).not.toContain("DADO_INTERNO_SENSIVEL");
});

it.each(["permissao", "vinculo", "usuario", "humano", "versao", "corte", "janela"])("mudança de %s após consulta impede resposta com seus dados", async mudanca => {
  const f = fixture(), original = f.executar.getMockImplementation();
  f.executar.mockImplementation(async (...args) => {
    const r = await original(...args);
    if (mudanca === "permissao") f.contatos[0].permissoesAssistente = [];
    if (mudanca === "vinculo") f.revogar(["klaus"]);
    if (mudanca === "usuario") f.contatos[0].userId = "outra-pessoa";
    if (mudanca === "humano") f.attendance.atendidaPor = "contador";
    if (mudanca === "versao") f.attendance.versao += 1;
    if (mudanca === "corte") f.conversas[0].automacaoInvalidadaEm = new Date();
    if (mudanca === "janela") f.conferirJanela.mockResolvedValue({ situacao: "FECHADA" });
    return r;
  });
  await expect(f.rodar()).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" });
  expect(f.cloud.enviarTexto).not.toHaveBeenCalled(); expect(f.executar).toHaveBeenCalledTimes(1); expect(f.mensagens[0].respondidaPelaIaEm).toBeNull();
});

it("repetição usa as saídas existentes sem repetir consulta nem envio", async () => {
  const f = fixture(); await f.rodar(); await f.rodar();
  expect(f.executar).toHaveBeenCalledTimes(3); expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(3); expect(f.mensagens.filter(m => m.direcao === "out")).toHaveLength(3);
});

it("reinício após envio incerto preserva esse resultado e continua somente a empresa restante", async () => {
  const f = fixture();
  f.cloud.enviarTexto.mockResolvedValueOnce({ wamid: "primeira" }).mockRejectedValueOnce(Object.assign(new Error("transporte interrompido"), { indeterminado: true })).mockResolvedValue({ wamid: "terceira" });
  await expect(f.rodar()).rejects.toThrow("transporte interrompido");
  expect(f.mensagens.find(m => m.conversaId === "cv-lente").statusEnvio).toBe("indeterminado");
  await f.rodar();
  expect(f.executar.mock.calls.map(([, , ctx]) => ctx.sessao.portalClientId)).toEqual(IDS);
  expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(3); expect(f.mensagens.filter(m => m.direcao === "out")).toHaveLength(3);
  expect(f.mensagens.find(m => m.conversaId === "cv-lente").statusEnvio).toBe("indeterminado");
});

it("sem GUIAS em uma empresa só avisa nessa empresa e não a consulta", async () => {
  const f = fixture(); f.contatos[1].permissoesAssistente = ["EMISSAO_NFSE"];
  await f.rodar();
  expect(f.executar.mock.calls.map(([, , ctx]) => ctx.sessao.portalClientId)).toEqual(["klaus", "alessandro"]);
  expect(f.cloud.enviarTexto.mock.calls[1][0].texto).toContain("Lente sintética"); expect(f.cloud.enviarTexto.mock.calls[1][0].texto).toContain("não permite consultar guias");
});

it("empresa fora do piloto só recebe aviso, sem consultar dados", async () => {
  const f = fixture(); await f.rodar({ piloto: ["klaus"] });
  expect(f.executar).toHaveBeenCalledTimes(1); expect(f.executar.mock.calls[0][2].sessao.portalClientId).toBe("klaus");
  expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(3);
  for (const i of [1, 2]) { expect(f.cloud.enviarTexto.mock.calls[i][0].texto).toContain(NOMES[i]); expect(f.cloud.enviarTexto.mock.calls[i][0].texto).toContain("não está habilitada"); }
});

it("sem permissão nem piloto nenhuma ferramenta é consultada", async () => {
  const f = fixture(); f.contatos.forEach(c => { c.permissoesAssistente = []; });
  await f.rodar({ piloto: [] }); expect(f.executar).not.toHaveBeenCalled(); expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(3);
});

it("piloto de telefone mantém exigência de permissão específica por empresa", async () => {
  const f = fixture(); f.contatos[2].permissoesAssistente = [];
  await f.rodar({ piloto: [], telefonesPiloto: [TELEFONE] });
  expect(f.executar.mock.calls.map(([, , ctx]) => ctx.sessao.portalClientId)).toEqual(["klaus", "lente"]);
  expect(f.cloud.enviarTexto.mock.calls[2][0].texto).toContain("não permite consultar guias");
});

it("recibo que contém empresa não autorizada não permite consultá-la", async () => {
  const f = fixture(); f.recibo.resultado.empresas = ["empresa-fora-do-cadastro"];
  await expect(f.rodar()).rejects.toMatchObject({ codigo: "CONTEXTO_ALTERADO" }); expect(f.executar).not.toHaveBeenCalled(); expect(f.cloud.enviarTexto).not.toHaveBeenCalled();
});

it("mudança de lease entre empresas interrompe antes da próxima consulta", async () => {
  const f = fixture(); f.cloud.enviarTexto.mockImplementation(async () => { f.conferirLease.mockRejectedValue(Object.assign(new Error("lease perdida"), { codigo: "LEASE_PERDIDA" })); return { wamid: "primeira" }; });
  await expect(f.rodar()).rejects.toMatchObject({ codigo: "LEASE_PERDIDA" }); expect(f.executar).toHaveBeenCalledTimes(1); expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});
