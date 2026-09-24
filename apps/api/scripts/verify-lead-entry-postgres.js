// Exercita o webhook, o menu, o coletor e o transporte rastreado reais.
// Somente PostgreSQL de teste; Meta, IA e consultas externas são bloqueadas.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const url = new URL(process.argv[2] || "");
const local = url.hostname === "127.0.0.1" && url.port === "55443" && url.pathname === "/comunicacao_v2_check" && url.username === "lead_test";
const ci = url.hostname === "127.0.0.1" && url.port === "55439" && url.pathname === "/whatsapp_delivery_check" && url.username === "whatsapp_check" && url.password === "ci_test_only";
assert(url.protocol === "postgresql:" && (local || ci), "Use apenas o banco descartável local/CI autorizado.");
const run = `entrada-lead-${crypto.randomUUID()}`;
const comercial = process.argv.includes("--commercial");
const canalId = `${run}-canal`;
const base = Number(String(Date.now()).slice(-7));
const telefones = Array.from({ length: 30 }, (_, i) => `55119${String(base + i).padStart(8, "0")}`);
Object.assign(process.env, { DATABASE_URL: url.href, NODE_ENV: "test", WHATSAPP_IDENTIDADE_V2: comercial ? "1" : "0", WHATSAPP_CHAT_V2: "0",
  WHATSAPP_MULTICANAL: comercial ? "1" : "0", WHATSAPP_COLETA_COMERCIAL: "1", IA_COMERCIAL_TELEFONES_PILOTO: comercial ? "" : telefones.filter((_, i) => i !== 4).join(","),
  WHATSAPP_TESTE_TOKEN: "fake-offline-commercial-token", WHATSAPP_PHONE_NUMBER_ID: "fixture-channel", WHATSAPP_WABA_ID: "fixture-waba",
  INTEGRACAO_WHATSAPP_MENU: "1", WHATSAPP_MENU_LEADS: "0", WHATSAPP_MENU_TELEFONES_PILOTO: "", IA_EMPRESAS_PILOTO: "",
  INTEGRACAO_WHATSAPP: "0", INTEGRACAO_IA_COMERCIAL: "0", INTEGRACAO_WHATSAPP_IA: "0", INTEGRACAO_FISCAL_LEADS: "0", LOG_LEVEL: "fatal" });
let rede = 0, ia = 0, sequencia = 0;
const bloquear = () => { rede++; throw Error("Rede externa proibida."); };
globalThis.fetch = http.get = http.request = https.get = https.request = bloquear;
const { prisma: db } = await import("../src/infrastructure/db/prisma.js");
const { processarEventoWhatsapp } = await import("../src/application/whatsapp/ProcessarEventoWhatsappService.js");
const { responderMenuWhatsapp } = await import("../src/application/whatsapp/MenuWhatsappService.js");
const { responderColetaComercial } = await import("../src/application/whatsapp/RespostaColetaComercialWhatsappService.js");
const { coletarComercialWhatsapp } = await import("../src/application/onboarding/ColetaComercialWhatsappService.js");
const { iniciarAtendimento, registrarCampos } = await import("../src/application/onboarding/LeadService.js");
const { montarPayloadLista, montarPayloadBotoes } = await import("../src/application/whatsapp/WhatsappCloudClient.js");
const { garantirIdentidadeWhatsapp, projetarIdentidadeConversa } = await import("../src/application/whatsapp/IdentidadeComunicacaoService.js");
const saidas = [], checks = [], transcricoes = [], empresasSinteticas = [];
const entradasVistas = new Set();
let cenario = "Entrada e navegação", falha = null;
const ok = texto => { checks.push(texto); console.log("OK " + texto); };
const cloud = Object.fromEntries(["enviarTexto", "enviarLista", "enviarBotoes"].map(tipo => [tipo, async args => {
  if (tipo === "enviarLista") montarPayloadLista({ ...args, para: args.telefone });
  if (tipo === "enviarBotoes") montarPayloadBotoes({ ...args, para: args.telefone });
  saidas.push({ tipo, ...args }); return { wamid: `${run}-out-${saidas.length}` };
}]));
const casos = async telefone => db.atendimentoLead.findMany({ where: { conversa: { telefoneE164: telefone } }, include: { onboarding: true } });
const casoAtivo = async telefone => (await casos(telefone)).find(c => !c.encerradoEm);
const entrada = async (telefone, texto, { id = `${run}-in-${++sequencia}`, interacao, botao = false, principal = false, erroEsperado = false, ocorridaEm, midia, respostaA } = {}) => {
  const agora = new Date();
  const antes = saidas.length;
  const m = { id, from: telefone, timestamp: String(Math.floor(new Date(ocorridaEm || agora).getTime() / 1000)),
    ...(respostaA ? { context: { id: respostaA } } : {}),
    ...(midia ? { type: midia, [midia]: { id: "123456789012345", mime_type: midia === "image" ? "image/jpeg" : "application/pdf", ...(texto ? { caption: texto } : {}) } }
      : interacao ? { type: "interactive", interactive: { [botao ? "button_reply" : "list_reply"]: { id: interacao, title: texto } } } : { type: "text", text: { body: texto } }) };
  const resposta = await processarEventoWhatsapp({ entry: [{ id: "fixture-waba", changes: [{ field: "messages", value: {
    ...(comercial ? { metadata: { phone_number_id: principal ? "fixture-channel" : canalId } } : {}), messages: [m],
  } }] }] }, {
    agora, responder: async () => { ia++; throw Error("IA proibida."); },
    responderMenu: args => responderMenuWhatsapp({ ...args, client: db, cloud }),
    responderColeta: args => responderColetaComercial({ ...args, client: db, cloud,
      coletar: args => coletarComercialWhatsapp({ ...args, deps: { ...args.deps, consultaPublica: async () => ({
        razaoSocial: "EMPRESA SINTÉTICA", situacaoCadastral: "ATIVA", municipio: "Rio de Janeiro", uf: "RJ",
      }) } }) }),
  });
  transcricoes.push({ cenario, pessoa: `Contato sintético ${telefones.indexOf(telefone) + 1}`, entrada: texto || `[${midia || "seleção"} sem legenda]`, interacao: interacao || null, reentrega: entradasVistas.has(id),
    respostas: saidas.slice(antes).map(s => ({ texto: s.texto || "", opcoes: (s.linhas || s.botoes || []).map(o => o.titulo) })), erros: resposta.erros });
  entradasVistas.add(id);
  if (erroEsperado) assert(resposta.erros.length > 0); else assert.deepEqual(resposta.erros, [], JSON.stringify(resposta.erros));
  return id;
};
try {
  // Recusa colisão com qualquer fixture de outra execução, antes de escrever.
  assert.equal(await db.conversaWhatsapp.count({ where: { telefoneE164: { in: telefones } } }), 0);
  if (comercial) {
    await db.canalWhatsapp.create({ data: { id: canalId, chave: canalId, phoneNumberId: canalId, wabaId: "fixture-waba", referenciaCredencial: "WHATSAPP_TESTE_TOKEN", finalidade: "COMERCIAL" } });
    const principal = await db.canalWhatsapp.findUnique({ where: { id: "principal" } });
    assert(!principal.phoneNumberId || principal.phoneNumberId === "fixture-channel");
    assert(!principal.wabaId || principal.wabaId === "fixture-waba");
    // Mesmo cenário da falha: solicitação iniciada no principal, com CNPJ salvo,
    // volta ao comercial dizendo Olá enquanto a ficha aguarda o nome.
    for (const [indice, telefone] of telefones.slice(5, 9).entries()) {
      cenario = `Retorno de outro canal ${indice + 1}`;
      await entrada(telefone, "Pedido anterior de transferência", { principal: true });
      const anterior = await db.conversaWhatsapp.findFirstOrThrow({ where: { telefoneE164: telefone, canalId: "principal" } });
      const caso = await iniciarAtendimento({ conversaId: anterior.id, origem: "TRANSFERENCIA", client: db });
      const ficha = await registrarCampos({ onboardingId: caso.onboardingId, versao: caso.onboarding.versao,
        operacoes: [{ campo: "cnpj", acao: "set", valor: "11222333000181" }], client: db });
      const triagem = { campoEsperado: "responsavelNome", esclarecimentos: 1 };
      await db.atendimentoLead.update({ where: { id: caso.id }, data: { triagem } });
      for (const texto of ["Olá", "Oi, bom dia! Tudo bem?", "menu"]) {
        const antes = saidas.length;
        const mensagemId = await entrada(telefone, texto);
        assert.equal(saidas.length, antes + 1);
        assert.equal(saidas.at(-1).tipo, "enviarLista");
        assert.equal(saidas.at(-1).texto, "Olá! Como a Altan pode ajudar?");
        assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Planejamento tributário", "Regularizar empresa", "Falar com a equipe"]);
        assert.deepEqual((await db.atendimentoLead.findUnique({ where: { id: caso.id } })).triagem, triagem);
        assert.deepEqual((await db.onboarding.findUnique({ where: { id: ficha.id } })).dados, ficha.dados);
        assert.equal((await casos(telefone)).length, 1);
        await entrada(telefone, texto, { id: mensagemId });
        assert.equal(saidas.length, antes + 1, "Replay não duplica o menu");
      }
      if (indice === 0) {
        await entrada(telefone, "Trocar de contador", { interacao: "altan.comercial.transferencia.v1" });
        assert.match(saidas.at(-1).texto, /melhorar/);
        await entrada(telefone, "Me chamo Caio");
        const retomada = (await casos(telefone))[0];
        assert.equal(retomada.id, caso.id); assert.equal(retomada.onboardingId, ficha.id);
        assert.equal(retomada.onboarding.dados.responsavelNome, "Caio");
        assert.equal(retomada.onboarding.cnpj, "11222333000181");
        assert.match(saidas.at(-1).texto, /melhorar/i);
        ok("Histórico de outro canal: saudações/menu não alteram ficha nem acumulam erro; retomada conserva CNPJ e não duplica caso");
      } else {
        const escolhas = [null,
          { texto: "Já sou cliente", interacao: "altan.lead.existing-client.v1" },
          { texto: "Falar com a equipe", interacao: "altan.lead.human.v1" },
          { texto: "quero falar com uma pessoa" }];
        const escolha = escolhas[indice];
        await entrada(telefone, escolha.texto, { interacao: escolha.interacao });
        assert.match(saidas.at(-1).texto, /equipe|atendimento/i);
        assert.deepEqual((await db.onboarding.findUnique({ where: { id: ficha.id } })).dados, ficha.dados);
        const pessoa = await db.interlocutorComunicacao.findUnique({ where: { id: caso.interlocutorId } });
        assert(pessoa.atendidaDesde);
        const antes = saidas.length; await entrada(telefone, "Olá");
        assert.equal(saidas.length, antes, "Navegação não libera pausa humana");
        ok(`Ficha existente respeita escolha ${escolha.texto}, sem gravá-la no cadastro ou conceder acesso`);
      }
    }
  }
  const [medico, transferencia, inativa, desconhecido, fora] = telefones;
  let atual;
  const resumo = async tel => (await casoAtivo(tel)).triagem.preatendimento;
  const pausaConfirmada = async tel => {
    const c = await casoAtivo(tel);
    assert.equal(c.triagem.preatendimento.estado, "ENCAMINHADO");
    assert((await db.conversaWhatsapp.findUnique({ where: { id: c.conversaId } })).atendidaDesde);
    const n = saidas.length;
    await entrada(tel, "obrigado"); await entrada(tel, "Olá");
    assert.equal(saidas.length, n, "Após handoff, automação não disputa a conversa com a equipe");
  };
  cenario = "Abertura curta: médico, preço, dados fora de ordem e replay";
  await entrada(medico, "Olá");
  assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Planejamento tributário", "Regularizar empresa", "Falar com a equipe"]);
  assert.equal((await casos(medico)).length, 0);
  const id = await entrada(medico, "Sou médico e quero abrir uma empresa");
  assert.match(saidas.at(-1).texto, /Como você se chama/);
  const n = saidas.length; await entrada(medico, "Sou médico e quero abrir uma empresa", { id });
  assert.equal(saidas.length, n); assert.equal((await casos(medico)).length, 1);
  await entrada(medico, "Quanto custa?"); assert.match(saidas.at(-1).texto, /valor depende/);
  assert.equal((await resumo(medico)).nome, null);
  await entrada(medico, "Me chamo Caio; cidade: Rio de Janeiro/RJ");
  assert.match(saidas.at(-1).texto, /contador/); assert.equal((await resumo(medico)).atividade, "médico");
  assert.equal((await casoAtivo(medico)).onboarding.cnpj, null);
  await pausaConfirmada(medico);
  ok("Abertura curta responde dúvida, reutiliza dados, não pede contratação e encerra na equipe; replay não duplica");

  cenario = "Transferência: contador só manda guias";
  await entrada(transferencia, "Quero trocar de contador"); assert.match(saidas.at(-1).texto, /melhorar/);
  await entrada(transferencia, "Meu contador só manda guias");
  assert.match(saidas.at(-1).texto, /resultados/);
  assert.equal((await resumo(transferencia)).necessidade, "Meu contador só manda guias");
  assert.equal((await casoAtivo(transferencia)).onboarding.cnpj, null);
  await pausaConfirmada(transferencia);
  ok("Reclamação sobre guias é comercial e encaminha com contexto, sem pedir CNPJ, modalidade ou volumes");

  cenario = "Regularização: não sabe o que fazer";
  await entrada(inativa, "Minha empresa está parada e não sei o que fazer; CNPJ 11222333000181");
  assert.equal((await casoAtivo(inativa)).onboarding.cnpj, "11222333000181");
  assert.equal(await db.trabalhoFiscalLead.count({ where: { onboardingId: (await casoAtivo(inativa)).onboardingId } }), 0);
  await pausaConfirmada(inativa);
  ok("Empresa parada encaminha sem obrigar data exata, procuração ou diagnóstico automático");

  cenario = "Desconhecimento e retorno de contato já atendido";
  await entrada(desconhecido, "ABRIR"); await entrada(desconhecido, "Não sei");
  assert.equal((await resumo(desconhecido)).palavraEntrada, "ABRIR");
  await pausaConfirmada(desconhecido);
  ok("Não saber um dado não bloqueia o lead nem reinicia automação na próxima saudação");

  const exemplos = [
    [9, "IMPOSTO", "Tenho uma loja; me chamo Ana", "PLANEJAMENTO"],
    [10, "DRE", "Tenho um restaurante; me chamo Bento", "GESTAO"],
    [11, "MARGEM", "Sou dentista; me chamo Carla", "GESTAO"],
    [12, "Quero pagar menos impostos", "Tenho uma clínica; me chamo Dani", "PLANEJAMENTO"],
    [13, "CONTADOR", "O preço está muito alto", "TRANSFERENCIA"],
  ];
  for (const [i, primeira, segunda, intencao] of exemplos) {
    cenario = `Pedido comercial ${primeira}`;
    await entrada(telefones[i], primeira);
    assert.notEqual((await resumo(telefones[i])).estado, "ENCAMINHADO", "A palavra de entrada inicia a conversa antes do handoff");
    await entrada(telefones[i], segunda);
    const a = await casoAtivo(telefones[i]); assert.equal(a.triagem.preatendimento.intencao, intencao);
    if (intencao === "TRANSFERENCIA") assert.equal(a.triagem.preatendimento.necessidade, segunda);
    if (["GESTAO", "PLANEJAMENTO"].includes(intencao)) {
      assert.equal(a.onboardingId, null, "Não cria transferência fictícia para planejamento/gestão");
      if (comercial) {
        const c = await db.conversaWhatsapp.findUnique({ where: { id: a.conversaId } });
        assert.equal((await projetarIdentidadeConversa(c, { client: db })).relacionamento.tipo, "LEAD");
      }
    }
    await pausaConfirmada(telefones[i]); ok(`${primeira}: intenção correta, dados essenciais e handoff sem ficha artificial`);
  }

  cenario = "Botão de planejamento e origem de campanha explícita";
  await entrada(telefones[14], "Olá");
  await entrada(telefones[14], "Planejamento tributário", { interacao: "altan.comercial.planejamento.v1" });
  await entrada(telefones[14], "Vim pelo Instagram; tenho uma loja; me chamo Eva");
  assert.equal((await resumo(telefones[14])).origemDeclarada, "Instagram");
  await pausaConfirmada(telefones[14]); ok("Botão funciona pelo ID e origem de campanha só é registrada quando declarada");

  cenario = "Pausa, retorno, pergunta sem resposta conhecida e limite de perguntas";
  await entrada(telefones[15], "Quero abrir uma empresa; me chamo Clara");
  const antesPausa = await casoAtivo(telefones[15]);
  for (const texto of ["Aguarda um pouco", "Pera aí", "Só um minutinho", "Já te mando", "Voltei"]) {
    await entrada(telefones[15], texto);
    atual = await casoAtivo(telefones[15]);
    assert.deepEqual(atual.onboarding.dados, antesPausa.onboarding.dados);
    assert.equal(atual.triagem.preatendimento.perguntasFeitas, antesPausa.triagem.preatendimento.perguntasFeitas);
  }
  await entrada(telefones[15], "???"); await entrada(telefones[15], "???"); await entrada(telefones[15], "???");
  assert.equal((await resumo(telefones[15])).perguntasFeitas, 3);
  await pausaConfirmada(telefones[15]); ok("Pausas não viram dados; falta de compreensão chama equipe após no máximo três perguntas");

  cenario = "Anexo durante coleta não é interpretado como nome";
  await entrada(telefones[16], "Quero abrir uma empresa");
  const idArquivo = await entrada(telefones[16], "Meu nome é Legenda", { midia: "image" });
  assert.equal((await casoAtivo(telefones[16])).onboarding.dados.responsavelNome, undefined);
  const arquivo = await db.mensagemWhatsapp.findUnique({ where: { providerMessageId: idArquivo } });
  assert(await db.arquivoWhatsapp.findUnique({ where: { mensagemId: arquivo.id } }));
  await pausaConfirmada(telefones[16]); ok("Anexo é armazenado e passa à equipe, sem fingir leitura");

  cenario = "Mensagem atrasada não sobrescreve o resumo";
  await entrada(telefones[17], "Quero abrir uma empresa; me chamo Renata; atividade: design");
  const antesAtrasada = await casoAtivo(telefones[17]), antesSaidas = saidas.length;
  await entrada(telefones[17], "Me chamo Nome Antigo", { ocorridaEm: new Date(Date.now() - 120000) });
  assert.deepEqual((await casoAtivo(telefones[17])).triagem, antesAtrasada.triagem); assert.equal(saidas.length, antesSaidas);
  ok("Mensagem antiga é guardada no histórico, mas não troca os dados nem responde");

  cenario = "Clique em menu antigo preserva o pedido atual";
  await entrada(telefones[18], "Olá");
  const menuAntigo = await db.mensagemWhatsapp.findFirst({ where: { conversa: { telefoneE164: telefones[18] }, direcao: "out", tipo: "interactive" } });
  await entrada(telefones[18], "Quero trocar de contador; me chamo Joana");
  const antesClique = await casoAtivo(telefones[18]);
  await entrada(telefones[18], "Abrir uma empresa", { interacao: "altan.comercial.abertura.v1", respostaA: menuAntigo.providerMessageId });
  assert.deepEqual((await casoAtivo(telefones[18])).triagem, antesClique.triagem);
  assert.match(saidas.at(-1).texto, /anterior/); ok("Menu antigo não muda a intenção nem faz novo cadastro");

  cenario = "Duas solicitações na mesma conversa";
  await entrada(telefones[19], "Sou médico e quero abrir uma empresa");
  await entrada(telefones[19], "Também quero transferir outra empresa");
  atual = await casoAtivo(telefones[19]); assert.equal(atual.onboarding.origem, "ABERTURA");
  assert.equal(atual.triagem.proximaSolicitacao.intencao, "TRANSFERENCIA");
  await pausaConfirmada(telefones[19]); ok("Pedido adicional preserva a primeira ficha e entrega os dois relatos à equipe");

  cenario = "Dados completos e dúvida de viabilidade na primeira mensagem";
  await entrada(telefones[21], "Sou médica; quero abrir empresa; me chamo Fernanda; cidade: Rio/RJ; posso usar meu endereço de casa?");
  assert.match(saidas.at(-1).texto, /depende da atividade/);
  assert.doesNotMatch(saidas.at(-1).texto, /Como você se chama/);
  await pausaConfirmada(telefones[21]); ok("Dúvida recebe resposta sem promessa e os dados completos dispensam perguntas repetidas");

  cenario = "Pedido operacional durante coleta não altera campos";
  await entrada(telefones[22], "Quero abrir uma empresa");
  const antesOperacional = await casoAtivo(telefones[22]);
  await entrada(telefones[22], "Me manda as guias");
  assert.deepEqual((await casoAtivo(telefones[22])).onboarding.dados, antesOperacional.onboarding.dados);
  ok("Pedido de guia não vira atividade ou nome no pré-atendimento");

  cenario = "Pedido humano explícito conserva o contexto e encerra a automação";
  await entrada(telefones[23], "Quero abrir uma empresa");
  await entrada(telefones[23], "Quero falar com uma pessoa");
  const cHumana = await db.conversaWhatsapp.findUnique({ where: { id: (await casoAtivo(telefones[23])).conversaId } });
  assert(cHumana.atendidaDesde);
  const antesHumana = saidas.length; await entrada(telefones[23], "Me chamo Ana"); assert.equal(saidas.length, antesHumana);
  ok("Equipe solicitada explicitamente pausa o bot sem perder o pedido");

  if (comercial) {
    cenario = "Responsável conhecido de duas empresas, sem permissão fiscal";
    const conhecido = telefones[20];
    const identidade = await garantirIdentidadeWhatsapp({ telefone: conhecido, client: db });
    for (const prefixo of ["97", "98"]) {
      const empresa = await db.portalClient.create({ data: { razao: `${run}-empresa-${prefixo}`, cnpj: `${prefixo}${String(Date.now()).slice(-12)}` } });
      empresasSinteticas.push(empresa.id);
      await db.contatoWhatsapp.create({ data: { portalClientId: empresa.id, nome: "Responsável sintético", telefoneE164: conhecido, vinculoNumeroId: identidade.vinculoNumero.id, permissoesAssistente: [] } });
      await entrada(conhecido, "Olá");
      assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Planejamento tributário", "Regularizar empresa", "Falar com a equipe"]);
      assert.equal((await casos(conhecido)).length, 0);
    }
    const conversaConhecida = await db.conversaWhatsapp.findFirst({ where: { telefoneE164: conhecido, canalId } });
    assert.equal((await projetarIdentidadeConversa(conversaConhecida, { client: db })).relacionamento.tipo, "CLIENTE");
    await entrada(conhecido, "Quero abrir outra empresa; me chamo Lucas; atividade: consultoria");
    atual = await casoAtivo(conhecido);
    assert(atual, "Responsável de várias empresas deve poder abrir uma solicitação comercial sem escolher uma empresa fiscal");
    assert.equal(atual.onboarding.origem, "ABERTURA");
    assert.equal(atual.onboarding.cnpj, null);
    assert.equal((await projetarIdentidadeConversa(conversaConhecida, { client: db })).relacionamento.tipo, "CLIENTE");
    const contatos = await db.contatoWhatsapp.findMany({ where: { portalClientId: { in: empresasSinteticas } } });
    assert.equal(contatos.length, 2);
    assert(contatos.every(c => c.userId === null && c.permissoesAssistente.length === 0));
    assert.equal(await db.companyClientUser.count({ where: { companyId: { in: empresasSinteticas } } }), 0);
    ok("Cliente conhecido de uma ou duas empresas fora do piloto operacional conversa no comercial sem seletor fiscal ou concessão de acesso");
    const fichaAntesRevisao = structuredClone(atual.onboarding.dados), antesRevisao = saidas.length;
    await db.interlocutorComunicacao.update({ where: { id: identidade.interlocutor.id }, data: { estado: "EM_REVISAO" } });
    transcricoes.push({ cenario, nota: "Preparação do teste: identidade colocada EM_REVISAO. A próxima entrada deve ficar visível para conferência humana, sem resposta automática ou acesso fiscal." });
    await entrada(conhecido, "Me manda as guias das minhas empresas");
    assert.equal(saidas.length, antesRevisao, "Identidade em revisão não autoriza saída ou função fiscal");
    assert.deepEqual((await casoAtivo(conhecido)).onboarding.dados, fichaAntesRevisao);
    assert.equal(await db.companyClientUser.count({ where: { companyId: { in: empresasSinteticas } } }), 0);
    ok("Identidade conhecida em revisão bloqueia funções e mantém o caso comercial sem gravar pedido fiscal na ficha");
  }

  cenario = "Guardas de audiência e canal";
  const antesFora = saidas.length; await entrada(fora, "Quero abrir uma empresa", { principal: true });
  assert.equal(saidas.length, antesFora); assert.equal((await casos(fora)).length, 0);
  if (comercial) {
    const segmentos = await db.conversaWhatsapp.findMany({ where: { telefoneE164: { in: telefones.slice(0, 4) } } });
    assert(segmentos.every(c => c.canalId === canalId && c.vinculoNumeroId && !c.portalClientId));
    assert.equal(await db.turnoIaWhatsapp.count({ where: { conversaId: { in: segmentos.map(c => c.id) } } }), 0);
    await entrada(transferencia, "Olá", { principal: true });
    assert.equal(saidas.length, antesFora);
    const pausada = await db.conversaWhatsapp.findFirst({ where: { telefoneE164: medico, canalId } });
    const identidade = await db.vinculoNumeroInterlocutor.findUnique({ where: { id: pausada.vinculoNumeroId }, include: { interlocutor: true } });
    assert(identidade.interlocutor.atendidaDesde);
    ok("Comercial atende remetentes fora do piloto e conserva canal, identidade e pausa humana; principal não amplia audiência");
    await db.canalWhatsapp.update({ where: { id: canalId }, data: { ativo: false } });
    await entrada(fora, "Quero abrir uma empresa", { erroEsperado: true });
    assert.equal(saidas.length, antesFora); assert.equal((await casos(fora)).length, 0);
    ok("Canal comercial desativado recusa entrada sem criar solicitação ou resposta");
  }
  assert.equal(rede, 0); assert.equal(ia, 0);
  ok("Principal fora do piloto não ativa automação; nenhum cenário usa rede externa ou IA");
  console.log(JSON.stringify({ passed: checks.length, comercial, rede, ia }));
} catch (err) {
  falha = `${cenario}: ${err.message}`;
  console.error(err.message); process.exitCode = 1;
} finally {
  if (process.env.WHATSAPP_SIMULATION_REPORT) {
    const destino = path.resolve(process.env.WHATSAPP_SIMULATION_REPORT);
    mkdirSync(path.dirname(destino), { recursive: true });
    const linhas = ["# Simulação de comunicação — dados inteiramente sintéticos", "", `Modo: ${comercial ? "canal comercial V2" : "principal piloto"}. Verificações aprovadas: ${checks.length}. Rede externa: ${rede}. Chamadas IA: ${ia}.`, "",
      falha ? `Falha: ${falha}` : "Todas as verificações desta execução foram aprovadas.", ""];
    let grupo;
    for (const turno of transcricoes) {
      if (grupo !== turno.cenario) { grupo = turno.cenario; linhas.push(`## ${grupo}`, ""); }
      if (turno.nota) { linhas.push(`*${turno.nota}*`, ""); continue; }
      if (turno.reentrega) linhas.push("*Reentrega técnica do mesmo evento, com o mesmo identificador; não é uma nova mensagem da pessoa.*", "");
      linhas.push(`**${turno.pessoa}:** ${turno.entrada}`, "");
      if (!turno.respostas.length) linhas.push("*Sem nova saída automática.*", "");
      for (const resposta of turno.respostas) linhas.push(`**Altan:** ${resposta.texto}`, ...(resposta.opcoes.length ? ["", `Opções: ${resposta.opcoes.join(" · ")}`] : []), "");
    }
    writeFileSync(destino, linhas.join("\n"), "utf8");
  }
  const conversas = await db.conversaWhatsapp.findMany({ where: { telefoneE164: { in: telefones }, mensagens: { some: { providerMessageId: { startsWith: run } } } }, select: { id: true } });
  const ids = conversas.map(c => c.id);
  const fichas = await db.atendimentoLead.findMany({ where: { conversaId: { in: ids } }, select: { onboardingId: true } });
  await db.coletaComercialWhatsapp.deleteMany({ where: { atendimentoLead: { conversaId: { in: ids } } } });
  await db.atendimentoLead.deleteMany({ where: { conversaId: { in: ids } } });
  await db.onboarding.deleteMany({ where: { id: { in: fichas.map(f => f.onboardingId).filter(Boolean) } } });
  await db.arquivoWhatsapp.deleteMany({ where: { mensagem: { conversaId: { in: ids } } } });
  await db.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: ids } } });
  await db.contatoWhatsapp.deleteMany({ where: { portalClientId: { in: empresasSinteticas } } });
  const vinculos = comercial ? await db.vinculoNumeroInterlocutor.findMany({ where: { telefoneE164: { in: telefones } }, select: { id: true, interlocutorId: true } }) : [];
  if (comercial) {
    await db.conversaWhatsapp.updateMany({ where: { id: { in: ids } }, data: { atendimentoId: null } });
    await db.atendimentoResponsavelWhatsapp.deleteMany({ where: { vinculoNumeroId: { in: vinculos.map(v => v.id) } } });
  }
  await db.conversaWhatsapp.deleteMany({ where: { id: { in: ids } } });
  await db.portalClient.deleteMany({ where: { id: { in: empresasSinteticas } } });
  if (comercial) {
    await db.eventoIdentidadeComunicacao.deleteMany({ where: { vinculoNumeroId: { in: vinculos.map(v => v.id) } } });
    await db.vinculoNumeroInterlocutor.deleteMany({ where: { id: { in: vinculos.map(v => v.id) } } });
    await db.interlocutorComunicacao.deleteMany({ where: { id: { in: vinculos.map(v => v.interlocutorId) } } });
    await db.canalWhatsapp.deleteMany({ where: { id: canalId } });
  }
  await db.$disconnect();
}
