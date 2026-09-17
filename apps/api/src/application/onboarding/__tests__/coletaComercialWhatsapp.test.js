jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../LeadService.js", () => ({ ...jest.requireActual("../LeadService.js"), iniciarAtendimento: jest.fn() }));
import { iniciarAtendimento } from "../LeadService.js";
import { interpretarColetaComercial, identificarOrigemComercial, pedidoOperacionalComercial, coletarComercialWhatsapp } from "../ColetaComercialWhatsappService.js";

test.each([
  ["Sou médico, quero abrir uma empresa", "ABERTURA"], ["Quero mudar de contador", "TRANSFERENCIA"],
  ["Minha empresa está parada e não sei o que fazer", "INATIVA"], ["Oi", null],
  ["Quero abrir uma e transferir outra empresa", "MULTIPLOS"],
])("intenção comercial reconhecida sem modelo: %s", (texto, esperado) => {
  expect(identificarOrigemComercial(texto)).toBe(esperado);
});
test("botões usam IDs estáveis, sem reutilizar um CNPJ operacional", () => {
  expect(identificarOrigemComercial("", { id: "altan.comercial.abertura.v1" })).toBe("ABERTURA");
  const r = interpretarColetaComercial({ texto: "Sou médico, me chamo Caio; só abertura", origem: "ABERTURA" });
  expect(r.operacoes).toEqual(expect.arrayContaining([{ campo: "responsavelNome", acao: "set", valor: "Caio" }, { campo: "atividadePretendida", acao: "set", valor: "médico" }, { campo: "modalidadeServico", acao: "set", valor: "AVULSO" }]));
});
test.each(["Me manda a guia", "Quero emitir nota", "Qual o faturamento?", "trocar de empresa", "documentos da empresa"])("pedido operacional preserva coleta: %s", texto => expect(pedidoOperacionalComercial(texto)).toBe(true));
test("volume de notas informado não é confundido com emissão", () => {
  expect(pedidoOperacionalComercial("Recebo 20 notas de compras por mês")).toBe(false);
  expect(interpretarColetaComercial({ texto: "Recebo 20 notas de compras", origem: "TRANSFERENCIA" }).operacoes).toContainEqual({ campo: "notasRecebidasMes", acao: "set", valor: 20 });
});
test("CNPJ é validado e gravado com dígitos; não comprova vínculo", () => {
  expect(interpretarColetaComercial({ texto: "11.222.333/0001-81", origem: "TRANSFERENCIA" }).operacoes).toEqual([{ campo: "cnpj", acao: "set", valor: "11222333000181" }]);
  const invalido = interpretarColetaComercial({ texto: "11.222.333/0001-00", origem: "TRANSFERENCIA" });
  expect(invalido.operacoes).toEqual([]); expect(invalido.resposta).toContain("CNPJ");
});
test("não sei preserva ausência e dúvida não vira dado cadastral", () => {
  const r = interpretarColetaComercial({ texto: "Não sei", origem: "ABERTURA", campoEsperado: "qtdFuncionarios" });
  expect(r.desconhecido).toBe("qtdFuncionarios"); expect(r.operacoes).toEqual([]);
  expect(interpretarColetaComercial({ texto: "Quanto custa?", origem: "ABERTURA", campoEsperado: "responsavelNome" }).operacoes).toEqual([]);
});

function banco({ dados = {}, portalClientId = "empresa-atual" } = {}) {
  const conversa = { id: "c", portalClientId, telefoneE164: "5521999990000", chaveEscopo: "empresa:atual", canalId: "principal" };
  const ficha = { id: "o", origem: "ABERTURA", status: "RASCUNHO", versao: 0, dados, cnpj: null };
  const caso = { id: "a", conversaId: "c", onboardingId: "o", onboarding: ficha, triagem: {}, versao: 1 };
  const recibos = new Map(), mensagens = new Map();
  const db = {
    conversaWhatsapp: { findUnique: jest.fn(async () => ({ ...conversa })), update: jest.fn(async ({ data }) => Object.assign(conversa, data)) },
    atendimentoLead: { findFirst: jest.fn(async () => caso), findUnique: jest.fn(async () => caso), update: jest.fn(async ({ data }) => { Object.assign(caso, data, { versao: caso.versao + (data.versao?.increment || 0) }); return caso; }), updateMany: jest.fn(async () => ({ count: 1 })) },
    onboarding: { findUnique: jest.fn(async () => ({ ...ficha })), updateMany: jest.fn(async ({ where, data }) => { if (where.versao !== ficha.versao) return { count: 0 }; Object.assign(ficha, data, { versao: ficha.versao + (data.versao?.increment || 0) }); return { count: 1 }; }) },
    onboardingEvento: { create: jest.fn(async () => ({})) },
    mensagemWhatsapp: { findFirst: jest.fn(async ({ where }) => mensagens.get(where.id)) },
    coletaComercialWhatsapp: { findUnique: jest.fn(async ({ where }) => recibos.get(where.mensagemId)), create: jest.fn(async ({ data }) => { recibos.set(data.mensagemId, structuredClone(data)); return structuredClone(data); }), update: jest.fn(async ({ where, data }) => { const r = { ...recibos.get(where.mensagemId), ...data }; recibos.set(where.mensagemId, r); return r; }) },
  };
  db.$transaction = fn => fn(db);
  iniciarAtendimento.mockImplementation(async () => caso);
  let n = 0;
  const chamar = async (texto, { id, enviar = jest.fn(), flag = true } = {}) => {
    const mensagem = { id: id || `m${++n}`, conversaId: "c", direcao: "in", corpo: texto, tipo: "text", registradaEm: new Date(1760000000000 + n * 1000), conversa };
    mensagens.set(mensagem.id, mensagem);
    return coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: texto }, deps: { client: db, flag, piloto: [conversa.telefoneE164], enviar, agora: new Date(1760000010000 + n * 1000) } });
  };
  return { db, conversa, ficha, caso, recibos, chamar };
}
test("cliente atual pode preencher outra abertura sem copiar empresa, com replay idempotente", async () => {
  const t = banco();
  const r = await t.chamar("Me chamo Ana", { id: "m" });
  expect(r.tratado).toBe(true); expect(t.ficha.dados.responsavelNome).toBe("Ana"); expect(t.ficha.cnpj).toBeNull();
  expect(t.conversa.portalClientId).toBe("empresa-atual");
  await t.chamar("Me chamo Ana", { id: "m" });
  expect(t.db.onboarding.updateMany).toHaveBeenCalledTimes(1); expect(t.db.coletaComercialWhatsapp.create).toHaveBeenCalledTimes(1);
});
test("pedido operacional e flag desligada não alteram cadastro ou consomem IA", async () => {
  const t = banco(); expect((await t.chamar("me manda as guias")).tratado).toBe(false);
  expect((await t.chamar("Me chamo Ana", { flag: false })).tratado).toBe(false);
  expect(t.db.onboarding.updateMany).not.toHaveBeenCalled(); expect(t.db.coletaComercialWhatsapp.create).not.toHaveBeenCalled();
});
test("resposta desconhecida é lembrada e duas ambiguidades encaminham sem loop", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ", modalidadeServico: "RECORRENTE" } });
  const r = await t.chamar("Não sei"); expect(t.caso.triagem.desconhecidos).toEqual(["qtdFuncionarios"]); expect(r.resultado.texto).toContain("notas");
  await t.chamar("ok"); const fim = await t.chamar("ok");
  expect(fim.resultado.encaminhar).toBe(true); expect(t.conversa.atendidaDesde).toBeTruthy();
});

test("dados fora de ordem são preenchidos sem transformar perguntas em nome ou atividade", async () => {
  const t = banco();
  await t.chamar("cidade: Niterói/RJ; atividade: Medicina; não tenho funcionários");
  expect(t.ficha.dados).toMatchObject({ municipioAtendimento: "Niterói/RJ", atividadePretendida: "Medicina", qtdFuncionarios: 0 });
  const versao = t.ficha.versao;
  const duvida = await t.chamar("Como funciona? Quanto custa?");
  expect(t.ficha.versao).toBe(versao); expect(t.ficha.dados.responsavelNome).toBeUndefined();
  expect(duvida.resultado.texto).toContain("proposta"); expect(t.caso.triagem.campoEsperado).toBe("responsavelNome");
  await t.chamar("Meu nome é Ana");
  expect(t.ficha.dados.responsavelNome).toBe("Ana"); expect(t.ficha.dados.atividadePretendida).toBe("Medicina");
});
test("intervenção humana depois da coleta impede a saída pendente", async () => {
  const t = banco(); const enviar = async ({ antesDeEnviar }) => { t.conversa.atendidaPor = "contador"; await antesDeEnviar(); throw Error("não deveria enviar"); };
  await expect(t.chamar("Me chamo Ana", { enviar })).rejects.toMatchObject({ code: "atendimento_alterado" });
  expect(t.ficha.dados.responsavelNome).toBe("Ana");
});
