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
    eventoPushAtendimento: { upsert: jest.fn(async ({create}) => create) },
    conversaWhatsapp: { findUnique: jest.fn(async () => ({ ...conversa })), update: jest.fn(async ({ data }) => Object.assign(conversa, data)), updateMany: jest.fn(async () => ({ count: 1 })) },
    atendimentoLead: { findFirst: jest.fn(async () => caso), findUnique: jest.fn(async () => caso), update: jest.fn(async ({ data }) => { Object.assign(caso, data, { versao: caso.versao + (data.versao?.increment || 0) }); return caso; }), updateMany: jest.fn(async () => ({ count: 1 })) },
    onboarding: { findUnique: jest.fn(async () => ({ ...ficha })), updateMany: jest.fn(async ({ where, data }) => { if (where.versao !== ficha.versao) return { count: 0 }; Object.assign(ficha, data, { versao: ficha.versao + (data.versao?.increment || 0) }); return { count: 1 }; }) },
    onboardingEvento: { create: jest.fn(async () => ({})) },
    onboardingAnalise: { create: jest.fn(async () => ({})) },
    mensagemWhatsapp: { findFirst: jest.fn(async ({ where }) => mensagens.get(where.id)) },
    coletaComercialWhatsapp: { findUnique: jest.fn(async ({ where }) => recibos.get(where.mensagemId)), create: jest.fn(async ({ data }) => { recibos.set(data.mensagemId, structuredClone(data)); return structuredClone(data); }), update: jest.fn(async ({ where, data }) => { const r = { ...recibos.get(where.mensagemId), ...data }; recibos.set(where.mensagemId, r); return r; }) },
  };
  db.$transaction = fn => fn(db);
  iniciarAtendimento.mockImplementation(async () => caso);
  let n = 0;
  const chamar = async (texto, { id, enviar = jest.fn(), flag = true, interacao, tipo = "text", ocorridaEmProvedor, consultaPublica, ia = { flag: false } } = {}) => {
    const mensagem = { id: id || `m${++n}`, conversaId: "c", direcao: "in", corpo: texto, tipo, ocorridaEmProvedor, registradaEm: new Date(1760000000000 + n * 1000), conversa };
    mensagens.set(mensagem.id, mensagem);
    return coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: texto, interacao, tipo }, deps: { client: db, flag, piloto: [conversa.telefoneE164], enviar, consultaPublica, ia, agora: new Date(1760000010000 + n * 1000) } });
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

function iaTeste(interpretacao, executar) {
  return { flag: true, piloto: ['5521999990000'], canais: ['principal'], tetoTotalCentavos: 300, chave: 'teste',
    autorizar: jest.fn(async () => ({ ok: true, contexto: { chamadaId: 'call' } })), concluir: jest.fn(async () => {}),
    assistente: { interpretar: jest.fn(async () => { await executar?.(); return { interpretacao, usage: { input_tokens: 10, output_tokens: 5 } }; }) } };
}
const interpretacaoTeste = dados => ({ intencao: null, evidenciaIntencao: null, comportamento: 'DADOS', dados });

test('retomada com todos os dados encaminha em vez de deixar conversa sem próximo passo', async () => {
  const t = banco(); await t.chamar('Quero abrir uma empresa'); await t.chamar('Aguarda um pouco');
  const ia = iaTeste({ ...interpretacaoTeste([
    { campo: 'nome', valor: 'Marina', evidencia: 'sou a Marina' },
    { campo: 'atividade', valor: 'fotografia', evidencia: 'faço fotografia' },
    { campo: 'cidade', valor: 'Recife', evidencia: 'em Recife' },
  ]), comportamento: 'RETOMAR' });
  const fim = await t.chamar('voltei, sou a Marina, faço fotografia em Recife', { ia });
  expect(fim.resultado.encaminhar).toBe(true);
  expect(fim.resultado.texto).toContain('encaminhar');
  expect(t.caso.triagem.preatendimento).toMatchObject({ nome: 'Marina', atividade: 'fotografia', cidade: 'Recife', estado: 'ENCAMINHADO' });
});

test('pausa com dados completos aguarda e retomada posterior encaminha', async () => {
  const t = banco(); await t.chamar('Quero abrir uma empresa');
  const ia = iaTeste({ ...interpretacaoTeste([
    { campo: 'nome', valor: 'Marina', evidencia: 'sou a Marina' },
    { campo: 'atividade', valor: 'fotografia', evidencia: 'faço fotografia' },
    { campo: 'cidade', valor: 'Recife', evidencia: 'em Recife' },
  ]), comportamento: 'PAUSAR' });
  expect((await t.chamar('espera, sou a Marina, faço fotografia em Recife', { ia })).resultado.encaminhar).toBe(false);
  const fim = await t.chamar('voltei', { ia: iaTeste({ ...interpretacaoTeste([]), comportamento: 'RETOMAR' }) });
  expect(fim.resultado.encaminhar).toBe(true);
});
test('IA registra evidência no resumo, sem gravar campo fiscal interpretado', async () => {
  const t = banco(); const ia = iaTeste(interpretacaoTeste([{ campo: 'atividade', valor: 'cerâmica', evidencia: 'cerâmica' }]));
  await t.chamar('Produzo cerâmica', { ia });
  expect(t.caso.triagem.preatendimento).toMatchObject({ atividade: 'cerâmica', ultimaInterpretacaoIa: { estado: 'APLICADA' }, evidenciasIa: { atividade: { mensagemId: 'm1', trecho: 'cerâmica' } } });
  expect(t.ficha.dados.atividadePretendida).toBeUndefined(); expect(ia.concluir).toHaveBeenCalledTimes(1);
});
test('reentrega não chama IA novamente', async () => {
  const t = banco(); const ia = iaTeste(interpretacaoTeste([]));
  await t.chamar('Quero abrir uma empresa', { ia, id: 'replay' }); await t.chamar('Quero abrir uma empresa', { ia, id: 'replay' });
  expect(ia.assistente.interpretar).toHaveBeenCalledTimes(1); expect(t.db.coletaComercialWhatsapp.create).toHaveBeenCalledTimes(1);
});
test('desligar IA não deixa indicação enganosa na mensagem seguinte', async () => {
  const t = banco(); const ia = iaTeste(interpretacaoTeste([]));
  await t.chamar('Quero abrir uma empresa', { ia }); await t.chamar('Aguarda um pouco');
  expect(t.caso.triagem.preatendimento.ultimaInterpretacaoIa).toMatchObject({ estado: 'NAO_UTILIZADA', mensagemId: 'm2', modelo: null });
  expect(ia.assistente.interpretar).toHaveBeenCalledTimes(1);
});
test.each(['image', 'audio', 'document', 'reaction'])('anexo/reação %s não chama IA', async tipo => {
  const t = banco(); const ia = iaTeste(interpretacaoTeste([])); await t.chamar('Conteúdo', { tipo, ia }); expect(ia.autorizar).not.toHaveBeenCalled();
});
test.each(['menu', 'Falar com a equipe', 'Me manda a guia'])('navegação ou operação não chega ao modelo: %s', async texto => {
  const t = banco(); const ia = iaTeste(interpretacaoTeste([])); await t.chamar(texto, { ia }); expect(ia.autorizar).not.toHaveBeenCalled();
});
test('atendente assume durante modelo e impede gravação/envio', async () => {
  const t = banco(); const enviar = jest.fn(); const ia = iaTeste(interpretacaoTeste([]), () => { t.conversa.atendidaPor = 'contador'; });
  await expect(t.chamar('Quero abrir uma empresa', { ia, enviar })).rejects.toMatchObject({ code: 'atendimento_alterado' });
  expect(enviar).not.toHaveBeenCalled(); expect(t.db.coletaComercialWhatsapp.create).not.toHaveBeenCalled(); expect(ia.concluir).toHaveBeenCalledTimes(1);
});
test.each(['caso', 'ficha', 'canal'])('mudança de %s durante modelo descarta resultado antigo', async alvo => {
  const t = banco(); const enviar = jest.fn(); const ia = iaTeste(interpretacaoTeste([]), () => {
    if (alvo === 'caso') t.caso.versao++;
    if (alvo === 'ficha') t.ficha.versao++;
    if (alvo === 'canal') t.conversa.canalId = 'outro';
  });
  await expect(t.chamar('Quero abrir uma empresa', { ia, enviar })).rejects.toMatchObject({ code: 'atendimento_alterado' }); expect(enviar).not.toHaveBeenCalled();
});
test('limite do modelo encaminha sem inferir novos dados e registra fallback', async () => {
  const t = banco(); const ia = iaTeste(interpretacaoTeste([])); ia.autorizar.mockResolvedValue({ ok: false, motivo: 'TETO_LEAD' });
  const r = await t.chamar('Quero abrir uma empresa', { ia });
  expect(r.resultado.encaminhar).toBe(true); expect(r.resultado.texto).toContain('encaminhar');
  expect(t.caso.triagem.preatendimento.nome).toBeNull();
  expect(t.caso.triagem.preatendimento.ultimaInterpretacaoIa).toMatchObject({ estado: 'FALLBACK', motivo: 'TETO_LEAD' }); expect(ia.assistente.interpretar).not.toHaveBeenCalled();
});
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

test('pedido de ativação em ficha de abertura preserva ficha e não anuncia abertura', async () => {
  const t = banco();
  const r = await t.chamar('Quero ativar minha empresa');
  expect(r.motivo).toBe('ENCAMINHADA');
  expect(r.resultado.texto).not.toMatch(/abertura|abrir|primeiros passos/i);
  expect(t.caso.triagem.proximaSolicitacao).toMatchObject({intencao:'INATIVA',relato:'Quero ativar minha empresa'});
  expect(t.ficha.origem).toBe('ABERTURA');
});

const cadastroTeste = () => ({ ok: true, fonte: 'BRASILAPI', bruto: { cnpj: '11222333000181', razao_social: 'Empresa Teste', municipio: 'Niterói', uf: 'RJ', cnae_fiscal_descricao: 'Serviços médicos', descricao_situacao_cadastral: 'ATIVA' } });
const iaCompleta = () => iaTeste({ ...interpretacaoTeste([]), resposta: null });

test('ativação pede CNPJ, consulta uma vez e aproveita o cadastro na qualificação', async () => {
  const t = banco(); t.ficha.origem = 'INATIVA'; const consultaPublica = jest.fn(async () => cadastroTeste());
  const inicio = await t.chamar('Quero ativar minha empresa', { ia: iaCompleta(), consultaPublica });
  expect(inicio.resultado.texto).toContain('CNPJ'); expect(consultaPublica).not.toHaveBeenCalled();
  const resposta = await t.chamar('11.222.333/0001-81', { id: 'cnpj', ia: iaCompleta(), consultaPublica });
  expect(consultaPublica).toHaveBeenCalledWith('11222333000181');
  expect(resposta.resultado.texto).toContain('Empresa Teste'); expect(resposta.resultado.texto).toContain('ATIVA');
  expect(t.ficha.dados.razaoSocial).toBe('Empresa Teste'); expect(t.ficha.fontesDados.razaoSocial.fonte).toBe('CONSULTA_PUBLICA');
  expect(t.caso.triagem.preatendimento).toMatchObject({ cnpj: '11222333000181', atividade: 'Serviços médicos', cidade: 'Niterói', campoEsperado: 'necessidade' });
  expect(t.db.onboardingAnalise.create).toHaveBeenCalledTimes(1);
  await t.chamar('11.222.333/0001-81', { id: 'cnpj', ia: iaCompleta(), consultaPublica });
  await t.chamar('Quero voltar a operar', { ia: iaCompleta(), consultaPublica });
  expect(consultaPublica).toHaveBeenCalledTimes(1); expect(t.db.onboardingAnalise.create).toHaveBeenCalledTimes(1);
});

test('CNPJ inválido não consulta e após duas tentativas chama equipe', async () => {
  const t = banco(); t.ficha.origem = 'INATIVA'; const consultaPublica = jest.fn();
  await t.chamar('Quero ativar minha empresa', { ia: iaCompleta(), consultaPublica });
  const r = await t.chamar('11222333000100', { ia: iaCompleta(), consultaPublica });
  expect(r.resultado.texto).toContain('não passou na validação');
  expect((await t.chamar('11222333000100', { ia: iaCompleta(), consultaPublica })).motivo).toBe('ENCAMINHADA');
  expect(consultaPublica).not.toHaveBeenCalled(); expect(t.ficha.cnpj).toBeNull();
});

test('consulta indisponível é registrada sem travar ou repetir chamadas', async () => {
  const t = banco(); t.ficha.origem = 'INATIVA'; const consultaPublica = jest.fn(async () => { throw new Error('offline'); });
  const r = await t.chamar('CNPJ 11222333000181', { ia: iaCompleta(), consultaPublica });
  expect(r.resultado.texto).toContain('Não consegui consultar');
  expect(t.caso.triagem.preatendimento.consultaPublica.estado).toBe('INDISPONIVEL');
  await t.chamar('Quero voltar a operar', { ia: iaCompleta(), consultaPublica });
  expect(consultaPublica).toHaveBeenCalledTimes(1);
});

test.each(['humano','versao'])('mudança de %s durante consulta não grava nem envia resposta', async tipo => {
  const t = banco(); t.ficha.origem = 'INATIVA'; const enviar = jest.fn();
  const consultaPublica = jest.fn(async () => { if (tipo === 'humano') t.conversa.atendidaPor = 'contador'; else t.caso.versao++; return cadastroTeste(); });
  await expect(t.chamar('CNPJ 11222333000181', { ia: iaCompleta(), consultaPublica, enviar })).rejects.toMatchObject({ code: 'atendimento_alterado' });
  expect(enviar).not.toHaveBeenCalled(); expect(t.db.onboardingAnalise.create).not.toHaveBeenCalled(); expect(t.ficha.cnpj).toBeNull();
});

test('atendimento neutro cria ficha quando cliente informa intenção de ativação', async () => {
  const t = banco(); t.caso.onboarding = null; t.caso.onboardingId = null;
  iniciarAtendimento.mockImplementation(async ({ origem }) => { t.ficha.origem = origem; t.caso.onboarding = t.ficha; t.caso.onboardingId = t.ficha.id; return t.caso; });
  await t.chamar('Quero ativar minha empresa', { ia: iaCompleta() });
  expect(iniciarAtendimento).toHaveBeenLastCalledWith(expect.objectContaining({ origem: 'INATIVA' }));
  expect(t.caso.triagem.preatendimento.campoEsperado).toBe('cnpj');
});

test.each([true,false])('qualificação fiscal entrega humano e usa somente guia aprovado disponível=%s',async aprovado=>{
  const t=banco({dados:{cnpj:'11222333000181'}});
  t.ficha.origem='INATIVA';t.ficha.cnpj='11222333000181';
  t.caso.autorizacao={estado:'NAO_SOLICITADA'};
  t.caso.triagem.preatendimento={qualificacaoVersao:2,intencao:'INATIVA',cnpj:t.ficha.cnpj,dadosInformados:{cnpj:t.ficha.cnpj},
    necessidade:'Quero reativar minha empresa',atividade:'médico',cidade:'Recife',estrutura:'sozinho',urgencia:'novembro',campoEsperado:'faturamento',
    consultaPublica:{cnpj:t.ficha.cnpj,estado:'CONCLUIDA',dados:{}}};
  const guia={id:'guia',versao:4,tipo:'ORIENTACAO',chave:'autorizacao-acesso',aprovadoEm:new Date(),texto:'Autorize {{escritorio}}, CNPJ {{procuradorCnpj}}, para analisar {{cnpj}}.'};
  const institucional={id:'inst',versao:2,tipo:'INSTITUCIONAL',chave:'escritorio',aprovadoEm:new Date(),dados:{escritorio:'Teste',procuradorCnpj:'04252011000110',linkAutorizacao:'https://www.gov.br/exemplo'}};
  t.db.recursoComercial={findFirst:jest.fn(async({where})=>!aprovado?null:where.tipo==='ORIENTACAO'?guia:institucional)};
  const enviar=jest.fn();const consultaPublica=jest.fn();
  const ia=iaTeste({intencao:null,evidenciaIntencao:null,comportamento:'DADOS',resposta:null,dados:[{campo:'faturamento',valor:'20 mil por mês',evidencia:'20 mil por mês'}]});
  const r=await t.chamar('20 mil por mês',{id:'fim-autorizacao',ia,enviar,consultaPublica});
  expect(r.motivo).toBe('ENCAMINHADA');
  expect(t.conversa.atendidaDesde).toBeTruthy();
  expect(t.caso.autorizacao).toEqual({estado:'NAO_SOLICITADA'});
  expect(t.caso.triagem.preatendimento.autorizacaoFiscal.estado).toBe(aprovado?'AGUARDANDO_AUTORIZACAO':'REVISAO_NECESSARIA');
  expect(t.db.eventoPushAtendimento.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({tipo:'COMERCIAL',id:'comercial:a:fim-autorizacao',conversaId:'c'})}));
  expect(t.caso.triagem.preatendimento.faturamento).toBe('20 mil por mês');
  expect(enviar).toHaveBeenCalledTimes(1);
  if(aprovado){expect(r.resultado.texto).toContain('04.252.011/0001-10');expect(r.resultado.texto).toContain('gratuita');}
  else expect(r.resultado.texto).not.toContain('CNPJ do escritório');
  expect(consultaPublica).not.toHaveBeenCalled();
  const leituras=t.db.recursoComercial.findFirst.mock.calls.length;
  await t.chamar('20 mil por mês',{id:'fim-autorizacao',ia,enviar,consultaPublica});
  expect(t.db.recursoComercial.findFirst).toHaveBeenCalledTimes(leituras);
  expect(t.db.coletaComercialWhatsapp.create).toHaveBeenCalledTimes(1);
  expect(t.db.eventoPushAtendimento.upsert).toHaveBeenCalledTimes(1);
  expect((await t.chamar('Já autorizei',{ia,enviar,consultaPublica})).motivo).toBe('AUTOMACAO_INVALIDADA');
  expect(t.caso.autorizacao.estado).toBe('NAO_SOLICITADA');
});
