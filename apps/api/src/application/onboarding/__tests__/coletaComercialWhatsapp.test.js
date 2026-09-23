jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../LeadService.js", () => ({ ...jest.requireActual("../LeadService.js"), iniciarAtendimento: jest.fn() }));
import { iniciarAtendimento } from "../LeadService.js";
import { botoesModalidadeServico } from "../mensagensComerciais.js";
import { montarPayloadBotoes } from "../../whatsapp/WhatsappCloudClient.js";
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
test.each(["Olá", "Ola!", "Oi, bom dia! Tudo bem?", "Boa tarde", "Boa noite 👋", "Oii", "menu", "voltar ao menu", "Já sou cliente", "Falar com a equipe", "quero falar com uma pessoa"])("navegação não preenche nem penaliza a ficha existente: %s", async texto => {
  const t = banco();
  t.caso.triagem = { campoEsperado: "responsavelNome", esclarecimentos: 1 };
  const antes = structuredClone({ ficha: t.ficha, triagem: t.caso.triagem });
  const enviar = jest.fn();
  expect((await t.chamar(texto, { enviar })).tratado).toBe(false);
  expect({ ficha: t.ficha, triagem: t.caso.triagem }).toEqual(antes);
  expect(t.db.atendimentoLead.update).not.toHaveBeenCalled();
  expect(t.db.coletaComercialWhatsapp.create).not.toHaveBeenCalled();
  expect(t.conversa.atendidaDesde).toBeUndefined();
  expect(enviar).not.toHaveBeenCalled();
});
test.each(["Posso falar com um atendente?", "Tem alguém aí?", "Quero falar com um especialista", "Falar com a equipe, por favor"])("pedido humano natural volta ao menu sem ser gravado no cadastro: %s", async texto => {
  const t = banco();
  expect((await t.chamar(texto)).motivo).toBe("NAVEGACAO_DO_ATENDIMENTO");
  expect(t.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test.each(["altan.lead.existing-client.v1", "altan.lead.human.v1", "altan.client.human.v1", "id-desconhecido"])("clique fora da coleta usa o menu pelo ID, sem gravar o título: %s", async id => {
  const t = banco();
  expect((await t.chamar("Texto que parece um nome", { interacao: { id } })).tratado).toBe(false);
  expect(t.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test("saudação acompanhada de pedido e dados continua na coleta", async () => {
  const t = banco();
  expect((await t.chamar("Olá, sou médico e quero abrir uma empresa; me chamo Caio")).tratado).toBe(true);
  expect(t.ficha.dados).toMatchObject({ responsavelNome: "Caio", atividadePretendida: "médico" });
});
test("resposta rápida de template usa a intenção pelo ID sem tratar botão como anexo", async () => {
  const t = banco();
  const r = await t.chamar("Abrir uma empresa", { tipo: "button", interacao: { id: "altan.comercial.abertura.v1" } });
  expect(r.resultado.encaminhar).toBe(false); expect(r.resultado.texto).toBe("Como você se chama?");
});

test.each([["AVULSO", "enderecoPretendido"], ["RECORRENTE", "qtdFuncionarios"], ["COMPARAR", "qtdFuncionarios"]])("botão de contratação %s preenche somente a escolha e continua, com replay idempotente", async (valor, proximo) => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ" } });
  const r = await t.chamar("Voltei");
  expect(r.resultado.botoes.map(b => b.titulo)).toEqual(["Só abertura", "Abertura + mensal", "Comparar opções"]);
  expect(montarPayloadBotoes({ para: t.conversa.telefoneE164, texto: r.resultado.texto, botoes: r.resultado.botoes }).interactive.type).toBe("button");
  const interacao = { id: r.resultado.botoes.find(b => b.id.endsWith(valor)).id };
  const escolha = await t.chamar("Me chamo Nome Forjado, quero falar com uma pessoa", { id: "escolha", tipo: "interactive", interacao });
  expect(t.ficha.dados.modalidadeServico).toBe(valor); expect(t.ficha.dados.responsavelNome).toBe("Ana");
  expect(t.caso.triagem.campoEsperado).toBe(proximo); expect(escolha.resultado.botoes).toBeUndefined();
  expect(escolha.resultado.encaminhar).toBe(false);
  await t.chamar("Título diferente", { id: "escolha", tipo: "interactive", interacao });
  expect(t.db.onboarding.updateMany).toHaveBeenCalledTimes(1);
});

test("modalidade por texto continua disponível mesmo depois de receber botões", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ" } });
  await t.chamar("Voltei"); await t.chamar("Quero apenas a abertura");
  expect(t.ficha.dados.modalidadeServico).toBe("AVULSO"); expect(t.caso.triagem.campoEsperado).toBe("enderecoPretendido");
});

test.each(["outro-caso", "a"])("botão de %s em etapa incompatível não altera ficha, triagem ou pausa", async atendimentoId => {
  const t = banco();
  t.caso.triagem = { campoEsperado: "responsavelNome", esclarecimentos: 1 };
  const antes = structuredClone(t.caso.triagem);
  const r = await t.chamar("Só abertura", { tipo: "interactive", interacao: { id: botoesModalidadeServico(atendimentoId, "ABERTURA")[0].id } });
  expect(r.resultado.texto).toContain("etapa que já passou"); expect(r.resultado.texto).toContain("Como você se chama");
  expect(t.ficha.dados).toEqual({}); expect(t.caso.triagem).toEqual(antes); expect(r.resultado.encaminhar).toBe(false);
});

test("botão de outra ficha não escolhe modalidade mesmo quando o campo atual é o mesmo", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ" } });
  await t.chamar("Voltei");
  const r = await t.chamar("Contabilidade mensal", { tipo: "interactive", interacao: { id: botoesModalidadeServico("outra-ficha", "ABERTURA")[1].id } });
  expect(t.ficha.dados.modalidadeServico).toBeUndefined(); expect(r.resultado.botoes.every(b => b.id.includes(".a."))).toBe(true);
});

test.each(["Preço", "O preço"])("motivo real %s avança à contratação com três botões", async texto => {
  const t = banco({ dados: { cnpj: "11222333000181", responsavelNome: "Ana" } });
  t.ficha.origem = "TRANSFERENCIA"; t.ficha.cnpj = "11222333000181"; t.caso.triagem = { campoEsperado: "motivoTroca" };
  const r = await t.chamar(texto);
  expect(t.ficha.dados.motivoTroca).toBe(texto); expect(t.caso.triagem.campoEsperado).toBe("modalidadeServico");
  expect(r.resultado.texto).not.toContain("O valor depende"); expect(r.resultado.encaminhar).toBe(false);
  expect(r.resultado.botoes.map(b => b.titulo)).toEqual(["Serviço avulso", "Contabilidade mensal", "Comparar opções"]);
});

test.each(["Preço", "O preço", "valor", "caro", "atendimento", "O preço está muito alto", "Não me respondem", "Quero pagar menos"])("conversa de transferência chega ao encaminhamento com motivo natural: %s", async motivo => {
  // Somente persistência em memória: nenhum modelo, transporte ou provedor fiscal.
  const t = banco({ dados: { cnpj: "11222333000181" } });
  t.ficha.origem = "TRANSFERENCIA"; t.ficha.cnpj = "11222333000181";
  expect((await t.chamar("Olá")).motivo).toBe("NAVEGACAO_DO_ATENDIMENTO");
  const inicio = await t.chamar("Trocar de contador");
  expect(inicio.resultado.texto).toBe("Como você se chama?");
  const nome = await t.chamar("Caio");
  expect(nome.resultado.texto).toBe("O que está motivando a troca de contador?");
  const respostaMotivo = await t.chamar(motivo);
  expect(t.ficha.dados).toMatchObject({ responsavelNome: "Caio", motivoTroca: motivo });
  expect(respostaMotivo.resultado.texto).not.toMatch(/motivando|O valor depende/);
  expect(respostaMotivo.resultado.botoes).toHaveLength(3);
  await t.chamar("mensal");
  expect(t.caso.triagem.campoEsperado).toBe("qtdFuncionarios");
  await t.chamar("só eu");
  expect(t.caso.triagem.campoEsperado).toBe("notasRecebidasMes");
  const fim = await t.chamar("não sei");
  expect(fim.motivo).toBe("ENCAMINHADA");
  expect(fim.resultado.texto).toContain("A equipe vai conferir seu caso e preparar a proposta");
  expect(t.ficha.dados).toMatchObject({ motivoTroca: motivo, modalidadeServico: "RECORRENTE", qtdFuncionarios: 0 });
  expect(t.ficha.dados.notasRecebidasMes).toBeUndefined();
  expect(t.caso.triagem.desconhecidos).toEqual(["notasRecebidasMes"]);
  expect(t.caso.triagem.esclarecimentos).toBe(0);
  expect(t.conversa.atendidaDesde).toBeTruthy();
  expect((await t.chamar("obrigado")).motivo).toBe("AUTOMACAO_INVALIDADA");
});

test.each(["Quanto custa?", "Me passa o valor", "O preço de vocês", "Preço?"])("dúvida %s mantém o motivo pendente e aceita a resposta seguinte", async duvida => {
  const t = banco({ dados: { cnpj: "11222333000181", responsavelNome: "Caio" } });
  t.ficha.origem = "TRANSFERENCIA"; t.ficha.cnpj = "11222333000181";
  t.caso.triagem = { campoEsperado: "motivoTroca" };
  const faq = await t.chamar(duvida);
  expect(faq.resultado.texto).toContain("O valor depende");
  expect(t.ficha.dados.motivoTroca).toBeUndefined();
  expect(t.caso.triagem.campoEsperado).toBe("motivoTroca");
  expect(faq.resultado.encaminhar).toBe(false);
  const resposta = await t.chamar("O preço está muito alto");
  expect(t.ficha.dados.motivoTroca).toBe("O preço está muito alto");
  expect(t.caso.triagem.campoEsperado).toBe("modalidadeServico");
  expect(resposta.resultado.texto).not.toMatch(/motivando|O valor depende/);
  const fim = await t.chamar("serviço pontual");
  expect(fim.motivo).toBe("ENCAMINHADA");
  expect(t.ficha.dados.modalidadeServico).toBe("AVULSO");
  expect(t.conversa.atendidaDesde).toBeTruthy();
});

test("consulta pública extensa cabe no mesmo envio da escolha com botões", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", motivoTroca: "Atendimento" } });
  t.ficha.origem = "TRANSFERENCIA"; t.caso.triagem = { campoEsperado: "cnpj" };
  const r = await t.chamar("11222333000181", { consultaPublica: async () => ({ razaoSocial: "Empresa ".repeat(100), endereco: "Endereço ".repeat(100), situacaoCadastral: "ATIVA" }) });
  expect(r.resultado.botoes).toHaveLength(3); expect(r.resultado.texto).toContain("Situação cadastral: ATIVA");
  expect(() => montarPayloadBotoes({ para: t.conversa.telefoneE164, texto: r.resultado.texto, botoes: r.resultado.botoes })).not.toThrow();
});
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
test.each(["faturamento", "meu faturamento", "faturamento de agosto", "Quero abrir empresa para emitir notas. Também me mande as guias em aberto"])("consulta não preenche a ficha comercial pendente: %s", async texto => {
  const t = banco();
  expect((await t.chamar(texto)).motivo).toBe("PEDIDO_OPERACIONAL");
  expect(t.ficha.dados).toEqual({}); expect(t.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test("resposta desconhecida é lembrada e duas ambiguidades encaminham sem loop", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ", modalidadeServico: "RECORRENTE" } });
  const r = await t.chamar("Não sei"); expect(t.caso.triagem.desconhecidos).toEqual(["qtdFuncionarios"]); expect(r.resultado.texto).toContain("notas");
  await t.chamar("banana"); const fim = await t.chamar("abacaxi");
  expect(fim.resultado.encaminhar).toBe(true); expect(t.conversa.atendidaDesde).toBeTruthy();
});

test.each(["Voltei", "Pode continuar", "Já falei com vocês antes", "ok", "obrigado"])("retorno/agradecimento não preenche cadastro nem acumula falhas: %s", async texto => {
  const t = banco(); t.caso.triagem = { campoEsperado: "responsavelNome", esclarecimentos: 1 };
  const r = await t.chamar(texto);
  expect(r.tratado).toBe(true); expect(r.resultado.encaminhar).toBe(false);
  expect(t.caso.triagem.esclarecimentos).toBe(1); expect(t.ficha.dados.responsavelNome).toBeUndefined();
  expect(t.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test("informação antes desconhecida pode ser recuperada sem marcador contraditório", async () => {
  const t = banco(); t.caso.triagem = { campoEsperado: "responsavelNome", desconhecidos: ["modalidadeServico"] };
  await t.chamar("Quero contabilidade mensal");
  expect(t.ficha.dados.modalidadeServico).toBe("RECORRENTE");
  expect(t.caso.triagem.desconhecidos).not.toContain("modalidadeServico");
});
test("mensagem antiga pelo relógio do provedor não preenche o próximo campo", async () => {
  const t = banco();
  await t.chamar("Me chamo Ana", { ocorridaEmProvedor: new Date("2025-10-09T08:00:10Z") });
  const antes = structuredClone({ dados: t.ficha.dados, triagem: t.caso.triagem });
  const enviar = jest.fn();
  const r = await t.chamar("Bruno", { ocorridaEmProvedor: new Date("2025-10-09T08:00:00Z"), enviar });
  expect(r.motivo).toBe("MENSAGEM_ANTIGA"); expect(enviar).not.toHaveBeenCalled();
  expect({ dados: t.ficha.dados, triagem: t.caso.triagem }).toEqual(antes);
  const saudacao = await t.chamar("Olá", { ocorridaEmProvedor: new Date("2025-10-09T08:00:00Z"), enviar });
  expect(saudacao).toMatchObject({ tratado: true, motivo: "MENSAGEM_ANTIGA" });
});

function inativaComDataPendente() {
  const t = banco({ dados: { cnpj: "11222333000181", responsavelNome: "Ana" } });
  t.ficha.origem = "INATIVA";
  t.ficha.cnpj = "11222333000181";
  t.caso.triagem = { campoEsperado: "paradaDesde" };
  return t;
}

test.each([["janeiro", "2020-01"], ["5", "2020-05"]])("ano e mês em turnos separados completam a data: %s", async (mes, data) => {
  const t = inativaComDataPendente();
  const ano = await t.chamar("desde 2020");
  expect(ano.resultado.texto).toBe("Em que mês de 2020 a empresa parou? Se não souber, pode dizer “não sei”.");
  expect(t.caso.triagem.anoParadaPendente).toBe("2020"); expect(t.ficha.dados.paradaDesde).toBeUndefined();
  const retomada = await t.chamar("Voltei");
  expect(t.caso.triagem.anoParadaPendente).toBe("2020");
  expect(retomada.resultado.texto).toContain("Em que mês de 2020");
  expect(retomada.resultado.texto).not.toContain("2023");
  const concluida = await t.chamar(mes);
  expect(t.ficha.dados.paradaDesde).toBe(data); expect(t.caso.triagem.anoParadaPendente).toBeNull();
  expect(t.caso.triagem.campoEsperado).toBe("pretendeReativar"); expect(concluida.resultado.encaminhar).toBe(false);
});

test("mês/ano explícito prevalece sobre ano pendente da conversa", async () => {
  const t = inativaComDataPendente();
  await t.chamar("desde 2020"); await t.chamar("janeiro de 2023");
  expect(t.ficha.dados.paradaDesde).toBe("2023-01"); expect(t.caso.triagem.anoParadaPendente).toBeNull();
});

test("não saber o mês preserva ausência e limpa contexto parcial", async () => {
  const t = inativaComDataPendente();
  await t.chamar("desde 2020"); await t.chamar("não sei");
  expect(t.ficha.dados.paradaDesde).toBeUndefined(); expect(t.caso.triagem.anoParadaPendente).toBeNull();
  expect(t.caso.triagem.desconhecidos).toContain("paradaDesde"); expect(t.caso.triagem.campoEsperado).toBe("pretendeReativar");
});

test("ano atrasado não troca o contexto do mês pendente", async () => {
  const t = inativaComDataPendente();
  await t.chamar("desde 2020", { ocorridaEmProvedor: new Date("2025-10-09T08:00:10Z") });
  const antes = structuredClone(t.caso.triagem);
  const enviar = jest.fn();
  const atrasada = await t.chamar("2021", { ocorridaEmProvedor: new Date("2025-10-09T08:00:00Z"), enviar });
  expect(atrasada.motivo).toBe("MENSAGEM_ANTIGA"); expect(enviar).not.toHaveBeenCalled(); expect(t.caso.triagem).toEqual(antes);
  await t.chamar("5", { ocorridaEmProvedor: new Date("2025-10-09T08:00:20Z") });
  expect(t.ficha.dados.paradaDesde).toBe("2020-05");
});
test.each(["image", "document", "audio"])("mídia %s não vira campo cadastral nem lê a legenda como declaração", async tipo => {
  const t = banco(); const r = await t.chamar("meu nome é um texto da legenda", { tipo });
  expect(r.resultado.encaminhar).toBe(true); expect(r.resultado.texto).toContain("anexo");
  expect(t.db.onboarding.updateMany).not.toHaveBeenCalled(); expect(t.ficha.dados).toEqual({});
});
test("reação não responde, altera ficha ou encaminha à equipe", async () => {
  const t = banco(); const enviar = jest.fn();
  expect((await t.chamar("👍", { tipo: "reaction", enviar })).motivo).toBe("REACAO_SEM_COLETA");
  expect(enviar).not.toHaveBeenCalled(); expect(t.db.atendimentoLead.update).not.toHaveBeenCalled();
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

test("pergunta sobre modalidades explica sem escolher avulso ou perder os botões atuais", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ" } });
  await t.chamar("Voltei");
  const anterior = structuredClone(t.ficha);
  const pergunta = await t.chamar("Qual a diferença entre só abertura e mensal?");
  expect(pergunta.resultado.texto).toContain("O serviço pontual");
  expect(pergunta.resultado.botoes).toHaveLength(3);
  expect(t.caso.triagem.campoEsperado).toBe("modalidadeServico");
  expect(t.ficha).toEqual(anterior);
  await t.chamar("Quero contabilidade mensal");
  expect(t.ficha.dados.modalidadeServico).toBe("RECORRENTE");
  expect(t.caso.triagem.campoEsperado).toBe("qtdFuncionarios");
});
test("FAQ de abertura durante transferência não troca origem ou encaminha uma nova solicitação", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", cnpj: "11222333000181", motivoTroca: "Atendimento" } });
  t.ficha.origem = "TRANSFERENCIA"; t.ficha.cnpj = "11222333000181";
  t.caso.triagem = { campoEsperado: "modalidadeServico" };
  const r = await t.chamar("Qual a diferença entre só abertura e mensal?");
  expect(r.motivo).toBe("COLETA_COMERCIAL");
  expect(t.ficha.origem).toBe("TRANSFERENCIA"); expect(t.ficha.dados.modalidadeServico).toBeUndefined();
  expect(t.caso.triagem.proximaSolicitacao).toBeUndefined(); expect(t.conversa.atendidaDesde).toBeUndefined();
});
test("pausa e retorno conservam atividade ausente sem somar erro", async () => {
  const t = banco({ dados: { responsavelNome: "Ana" } });
  await t.chamar("Voltei");
  const versao = t.ficha.versao;
  expect((await t.chamar("Aguarda um pouco")).resultado.texto).toContain("Quando quiser continuar");
  expect((await t.chamar("Voltei")).resultado.texto).toContain("Qual atividade");
  expect(t.ficha.versao).toBe(versao); expect(t.ficha.dados.atividadePretendida).toBeUndefined();
  expect(t.caso.triagem.esclarecimentos).toBe(0);
  await t.chamar("Sou médica"); expect(t.caso.triagem.campoEsperado).toBe("municipioAtendimento");
});
test("dúvida inicial é respondida antes de perguntar nome e não confirma viabilidade", async () => {
  const t = banco();
  const r = await t.chamar("Sou médica. Preciso abrir um CNPJ. Consigo usar meu endereço de casa?");
  expect(r.resultado.texto).toContain("depende da atividade");
  expect(r.resultado.texto.indexOf("viabilidade")).toBeLessThan(r.resultado.texto.indexOf("Como você se chama"));
  expect(t.ficha.dados).toEqual({ atividadePretendida: "médica" });
});
test("FAQ continua na resposta final quando os outros dados já permitem handoff", async () => {
  const t = banco({ dados: { responsavelNome: "Ana", atividadePretendida: "Medicina", municipioAtendimento: "Rio/RJ", modalidadeServico: "AVULSO" } });
  t.caso.triagem = { campoEsperado: "enderecoPretendido" };
  const r = await t.chamar("endereço: Rua Teste, 10; Preciso de alvará?");
  expect(r.motivo).toBe("ENCAMINHADA"); expect(r.resultado.texto).toContain("licença ou alvará");
  expect(r.resultado.texto).toContain("A equipe vai conferir");
  expect((await t.chamar("Obrigada")).motivo).toBe("AUTOMACAO_INVALIDADA");
});
test("pergunta sobre baixa conserva objetivo; decisão explícita encerra triagem sem oferecer mensalidade", async () => {
  const t = inativaComDataPendente();
  await t.chamar("janeiro de 2023");
  const duvida = await t.chamar("Posso dar baixa com dívida?");
  expect(duvida.resultado.texto).toContain("situação fiscal");
  expect(t.ficha.dados.pretendeReativar).toBeUndefined(); expect(t.ficha.dados.modalidadeServico).toBeUndefined();
  expect(t.caso.triagem.campoEsperado).toBe("pretendeReativar");
  const baixa = await t.chamar("Quero dar baixa");
  expect(baixa.motivo).toBe("ENCAMINHADA"); expect(baixa.resultado.texto).toContain("orçamento do encerramento");
  expect(baixa.resultado.botoes).toBeUndefined();
  expect(t.ficha.dados).toMatchObject({ pretendeReativar: "BAIXAR", modalidadeServico: "AVULSO" });
  expect(t.ficha.dados.qtdFuncionarios).toBeUndefined(); expect(t.ficha.dados.notasRecebidasMes).toBeUndefined();
});
