jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../LeadService.js", () => ({ ...jest.requireActual("../LeadService.js"), iniciarAtendimento: jest.fn() }));
import { iniciarAtendimento } from "../LeadService.js";
import { botoesModalidadeServico } from "../mensagensComerciais.js";

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
  const chamar = async (texto, { id, enviar = jest.fn(), flag = true, interacao, tipo = "text", ocorridaEmProvedor, consultaPublica } = {}) => {
    const mensagem = { id: id || `m${++n}`, conversaId: "c", direcao: "in", corpo: texto, tipo, ocorridaEmProvedor, registradaEm: new Date(1760000000000 + n * 1000), conversa };
    mensagens.set(mensagem.id, mensagem);
    return coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: texto, interacao, tipo }, deps: { client: db, flag, piloto: [conversa.telefoneE164], enviar, consultaPublica, agora: new Date(1760000010000 + n * 1000) } });
  };
  return { db, conversa, ficha, caso, recibos, chamar };
}
test.each(["Olá", "Oi, bom dia! Tudo bem?", "menu", "Já sou cliente", "Falar com a equipe", "Tem alguém aí?"])("navegação preserva a ficha: %s", async texto => {
  const t = banco(); const antes = structuredClone(t.caso);
  expect((await t.chamar(texto)).motivo).toBe("NAVEGACAO_DO_ATENDIMENTO"); expect(t.caso).toEqual(antes);
});
test.each(["altan.lead.existing-client.v1", "altan.lead.human.v1", "id-desconhecido"])("clique externo não grava título: %s", async id => {
  const t = banco(); expect((await t.chamar("Nome forjado", { interacao: { id } })).tratado).toBe(false); expect(t.ficha.dados).toEqual({});
});
test("abertura termina com nome, atividade e cidade, sem questionário de contratação", async () => {
  const t = banco();
  expect((await t.chamar("Olá, sou médica e quero abrir uma empresa")).resultado.texto).toContain("Como você se chama?");
  expect((await t.chamar("Me chamo Ana")).resultado.texto).toContain("Em qual cidade");
  const fim = await t.chamar("Niterói/RJ"); expect(fim.motivo).toBe("ENCAMINHADA");
  expect(t.caso.triagem.preatendimento).toMatchObject({ nome: "Ana", atividade: "médica", cidade: "Niterói/RJ", estado: "ENCAMINHADO" });
  expect(fim.resultado.texto).not.toMatch(/funcionários|notas de compras|modalidade|CNPJ/); expect(fim.resultado.botoes).toBeUndefined();
  expect(t.conversa.portalClientId).toBe("empresa-atual"); expect(t.ficha.cnpj).toBeNull();
  expect((await t.chamar("Obrigado")).motivo).toBe("AUTOMACAO_INVALIDADA");
});
test("mensagem completa não repete perguntas; replay é idempotente", async () => {
  const t = banco(); const texto = "Quero abrir uma empresa; me chamo Ana; atividade: Medicina; cidade: Rio/RJ; só abertura";
  const fim = await t.chamar(texto, { id: "unico" }); await t.chamar(texto, { id: "unico" });
  expect(fim.motivo).toBe("ENCAMINHADA"); expect(fim.resultado.texto).not.toContain("?"); expect(t.ficha.dados.modalidadeServico).toBe("AVULSO");
  expect(t.db.onboarding.updateMany).toHaveBeenCalledTimes(1); expect(t.db.coletaComercialWhatsapp.create).toHaveBeenCalledTimes(1);
});
test.each(["Preço", "O preço", "valor", "caro", "atendimento", "O preço está muito alto", "Não me respondem", "Meu contador só manda guias"])("transferência encaminha o motivo sem exigir CNPJ: %s", async motivo => {
  const t = banco(); t.ficha.origem = "TRANSFERENCIA";
  expect((await t.chamar("Trocar de contador")).resultado.texto).toContain("melhorar");
  expect((await t.chamar(motivo)).motivo).toBe("ENCAMINHADA"); expect(t.caso.triagem.preatendimento.necessidade).toBe(motivo);
  expect(t.ficha.dados.modalidadeServico).toBeUndefined(); expect(t.ficha.cnpj).toBeNull();
});
test.each(["Quanto custa?", "Me passa o valor", "O preço de vocês", "Preço?"])("pergunta de preço não vira motivo: %s", async texto => {
  const t = banco(); t.ficha.origem = "TRANSFERENCIA"; await t.chamar("Quero trocar de contador");
  expect((await t.chamar(texto)).resultado.texto).toContain("O valor depende"); expect(t.caso.triagem.preatendimento.necessidade).toBeFalsy();
  expect((await t.chamar("Meu contador demora")).motivo).toBe("ENCAMINHADA");
});
test("nome fora de ordem não vira motivo", async () => {
  const t = banco(); t.ficha.origem = "TRANSFERENCIA"; await t.chamar("Quero trocar de contador"); await t.chamar("Meu nome é Ana");
  expect(t.caso.triagem.preatendimento.nome).toBe("Ana"); expect(t.caso.triagem.preatendimento.necessidade).toBeFalsy();
});
test.each(["PLANEJAMENTO", "GESTAO"])("%s segue sem onboarding fictício e sem consultar fiscal", async intencao => {
  const t = banco({ portalClientId: null }); t.caso.onboarding = null; t.caso.onboardingId = null; const consultaPublica = jest.fn();
  const inicio = await t.chamar(intencao === "GESTAO" ? "DRE" : "IMPOSTO", { consultaPublica });
  expect(iniciarAtendimento).toHaveBeenLastCalledWith(expect.objectContaining({ origem: null })); expect(inicio.resultado.texto).toContain("atividade");
  expect((await t.chamar("Tenho uma loja; me chamo Ana", { consultaPublica })).motivo).toBe("ENCAMINHADA");
  expect(t.caso.triagem.preatendimento).toMatchObject({ intencao, nome: "Ana", atividade: "loja" });
  expect(consultaPublica).not.toHaveBeenCalled(); expect(t.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test("CNPJ informado é preservado sem consulta automática ou acesso concedido", async () => {
  const t = banco(); t.ficha.origem = "INATIVA"; const consultaPublica = jest.fn();
  await t.chamar("Minha empresa está parada; CNPJ 11.222.333/0001-81", { consultaPublica });
  expect(t.ficha.cnpj).toBe("11222333000181"); expect(t.conversa.portalClientId).toBe("empresa-atual"); expect(consultaPublica).not.toHaveBeenCalled();
  expect((await t.chamar("Não sei o que fazer")).motivo).toBe("ENCAMINHADA");
});
test.each(["faturamento", "me manda as guias", "Quero emitir nota", "Quero abrir empresa para emitir notas. Também me mande as guias em aberto", "DRE", "IMPOSTO"])("cliente no principal conserva pedido operacional: %s", async texto => {
  const t = banco(); expect((await t.chamar(texto)).motivo).toBe("PEDIDO_OPERACIONAL"); expect(t.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test("flag desligada não altera nada", async () => { const t = banco(); expect((await t.chamar("Quero abrir", { flag: false })).motivo).toBe("COLETA_DESLIGADA"); expect(t.db.atendimentoLead.update).not.toHaveBeenCalled(); });
test("desconhecimento encaminha sem obrigar campos", async () => {
  const t = banco(); await t.chamar("Quero abrir uma empresa"); expect((await t.chamar("Não sei")).motivo).toBe("ENCAMINHADA"); expect(t.ficha.dados).toEqual({});
});
test.each(["Voltei", "Pode continuar", "Já falei com vocês antes", "ok", "obrigado", "Aguarda um pouco"])("pausa não vira dado nem soma pergunta: %s", async texto => {
  const t = banco(); await t.chamar("Quero abrir uma empresa"); const qtd = t.caso.triagem.preatendimento.perguntasFeitas;
  expect((await t.chamar(texto)).resultado.encaminhar).toBe(false); expect(t.caso.triagem.preatendimento.perguntasFeitas).toBe(qtd); expect(t.ficha.dados).toEqual({});
});
test("limite de três perguntas sem loop", async () => {
  const t = banco(); await t.chamar("Quero abrir uma empresa"); await t.chamar("???"); await t.chamar("???");
  expect((await t.chamar("???")).motivo).toBe("ENCAMINHADA"); expect(t.caso.triagem.preatendimento.perguntasFeitas).toBe(3);
});
test("mensagem antiga não altera resumo ou envia resposta", async () => {
  const t = banco(); await t.chamar("Me chamo Ana", { ocorridaEmProvedor: new Date("2025-10-09T08:00:10Z") });
  const antes = structuredClone(t.caso); const enviar = jest.fn();
  expect((await t.chamar("Bruno", { ocorridaEmProvedor: new Date("2025-10-09T08:00:00Z"), enviar })).motivo).toBe("MENSAGEM_ANTIGA"); expect(t.caso).toEqual(antes); expect(enviar).not.toHaveBeenCalled();
});
test("novo pedido preserva ficha e relato", async () => {
  const t = banco(); await t.chamar("Sou médica e quero abrir uma empresa"); const dados = structuredClone(t.ficha.dados);
  expect((await t.chamar("Também quero transferir outra empresa")).motivo).toBe("ENCAMINHADA"); expect(t.ficha.dados).toEqual(dados); expect(t.caso.triagem.proximaSolicitacao.intencao).toBe("TRANSFERENCIA");
});
test.each(["image", "document", "audio"])("anexo %s encaminha sem inventar leitura", async tipo => {
  const t = banco(); expect((await t.chamar("Meu nome é Legenda", { tipo })).motivo).toBe("ENCAMINHADA"); expect(t.ficha.dados).toEqual({});
});
test("reação não responde", async () => { const t = banco(); const enviar = jest.fn(); expect((await t.chamar("👍", { tipo: "reaction", enviar })).motivo).toBe("REACAO_SEM_COLETA"); expect(enviar).not.toHaveBeenCalled(); });
test("botão antigo de modalidade não contrata nem grava título", async () => {
  const t = banco(); const antes = structuredClone(t.caso.triagem);
  expect((await t.chamar("Nome forjado", { interacao: { id: botoesModalidadeServico("outro", "ABERTURA")[0].id } })).resultado.texto).toContain("anterior");
  expect(t.ficha.dados).toEqual({}); expect(t.caso.triagem).toEqual(antes);
});
test("intervenção humana antes do envio invalida saída", async () => {
  const t = banco(); const enviar = async ({ antesDeEnviar }) => { t.conversa.atendidaPor = "contador"; await antesDeEnviar(); throw Error("não enviar"); };
  await expect(t.chamar("Me chamo Ana", { enviar })).rejects.toMatchObject({ code: "atendimento_alterado" });
});
test("FAQ responde antes do handoff sem prometer viabilidade", async () => {
  const t = banco(); const fim = await t.chamar("Sou médica; quero abrir uma empresa; me chamo Ana; cidade: Rio/RJ; posso usar o endereço de casa?");
  expect(fim.motivo).toBe("ENCAMINHADA"); expect(fim.resultado.texto).toContain("depende da atividade"); expect(fim.resultado.texto).toContain("contador");
});
