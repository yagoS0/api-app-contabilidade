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
const telefones = Array.from({ length: 21 }, (_, i) => `55119${String(base + i).padStart(8, "0")}`);
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
const { montarPayloadLista } = await import("../src/application/whatsapp/WhatsappCloudClient.js");
const { garantirIdentidadeWhatsapp, projetarIdentidadeConversa } = await import("../src/application/whatsapp/IdentidadeComunicacaoService.js");
const saidas = [], checks = [], transcricoes = [], empresasSinteticas = [];
const entradasVistas = new Set();
let cenario = "Entrada e navegação", falha = null;
const ok = texto => { checks.push(texto); console.log("OK " + texto); };
const cloud = Object.fromEntries(["enviarTexto", "enviarLista", "enviarBotoes"].map(tipo => [tipo, async args => {
  if (tipo === "enviarLista") montarPayloadLista({ ...args, para: args.telefone });
  saidas.push({ tipo, ...args }); return { wamid: `${run}-out-${saidas.length}` };
}]));
const casos = async telefone => db.atendimentoLead.findMany({ where: { conversa: { telefoneE164: telefone } }, include: { onboarding: true } });
const casoAtivo = async telefone => (await casos(telefone)).find(c => !c.encerradoEm);
const entrada = async (telefone, texto, { id = `${run}-in-${++sequencia}`, interacao, principal = false, erroEsperado = false, ocorridaEm, midia, respostaA } = {}) => {
  const agora = new Date();
  const antes = saidas.length;
  const m = { id, from: telefone, timestamp: String(Math.floor(new Date(ocorridaEm || agora).getTime() / 1000)),
    ...(respostaA ? { context: { id: respostaA } } : {}),
    ...(midia ? { type: midia, [midia]: { id: "123456789012345", mime_type: midia === "image" ? "image/jpeg" : "application/pdf", ...(texto ? { caption: texto } : {}) } }
      : interacao ? { type: "interactive", interactive: { list_reply: { id: interacao, title: texto } } } : { type: "text", text: { body: texto } }) };
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
        assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Empresa parada", "Já sou cliente", "Falar com a equipe"]);
        assert.deepEqual((await db.atendimentoLead.findUnique({ where: { id: caso.id } })).triagem, triagem);
        assert.deepEqual((await db.onboarding.findUnique({ where: { id: ficha.id } })).dados, ficha.dados);
        assert.equal((await casos(telefone)).length, 1);
        await entrada(telefone, texto, { id: mensagemId });
        assert.equal(saidas.length, antes + 1, "Replay não duplica o menu");
      }
      if (indice === 0) {
        await entrada(telefone, "Trocar de contador", { interacao: "altan.comercial.transferencia.v1" });
        assert.equal(saidas.at(-1).texto, "Como você se chama?");
        await entrada(telefone, "Me chamo Caio");
        const retomada = (await casos(telefone))[0];
        assert.equal(retomada.id, caso.id); assert.equal(retomada.onboardingId, ficha.id);
        assert.equal(retomada.onboarding.dados.responsavelNome, "Caio");
        assert.equal(retomada.onboarding.cnpj, "11222333000181");
        assert.match(saidas.at(-1).texto, /troca/i);
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
  cenario = "Médico: abertura avulsa, preço e mensagens repetidas";
  await entrada(medico, "Olá");
  assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Empresa parada", "Já sou cliente", "Falar com a equipe"]);
  assert.equal((await casos(medico)).length, 0);
  ok("Saudação abre lista nativa válida sem criar ficha nem depender do piloto operacional");

  const id = await entrada(medico, "Sou médico e quero abrir uma empresa");
  assert.equal(saidas.at(-1).texto, "Como você se chama?");
  let ficha = (await casos(medico))[0].onboarding;
  assert.equal(ficha.dados.atividadePretendida, "médico"); assert.equal(ficha.cnpj, null);
  const quantidade = saidas.length; await entrada(medico, "Sou médico e quero abrir uma empresa", { id });
  assert.equal(saidas.length, quantidade); assert.equal((await casos(medico)).length, 1);
  ok("Pedido direto inicia abertura e replay não duplica ficha nem resposta");

  await entrada(medico, "Quanto custa?");
  assert.match(saidas.at(-1).texto, /Como você se chama/);
  assert.equal((await casos(medico))[0].onboarding.dados.responsavelNome, undefined);
  await entrada(medico, "Me chamo Caio");
  assert.match(saidas.at(-1).texto, /cidade e estado/);
  await entrada(medico, "Rio de Janeiro/RJ");
  assert.match(saidas.at(-1).texto, /apenas a abertura/);
  await entrada(medico, "Só abertura");
  assert.match(saidas.at(-1).texto, /endereço/);
  await entrada(medico, "endereco: Rua Sintética 123");
  assert.match(saidas.at(-1).texto, /equipe/);
  ficha = (await casos(medico))[0].onboarding;
  assert.equal(ficha.dados.modalidadeServico, "AVULSO");
  assert.equal(ficha.dados.responsavelNome, "Caio");
  assert.equal(ficha.dados.qtdFuncionarios, undefined);
  const antesHumano = saidas.length; await entrada(medico, "Olá");
  assert.equal(saidas.length, antesHumano);
  ok("Coleta responde dúvida, aproveita atividade, oferece avulso e entrega ficha à equipe");

  cenario = "Transferência: CNPJ e consulta pública";
  await entrada(transferencia, "Trocar de contador", { interacao: "altan.comercial.transferencia.v1" });
  assert.equal(saidas.at(-1).texto, "Qual é o CNPJ da empresa?");
  await entrada(transferencia, "11.222.333/0001-81");
  assert.match(saidas.at(-1).texto, /EMPRESA SINTÉTICA/);
  assert.match(saidas.at(-1).texto, /não comprova regularidade fiscal/);
  ficha = (await casos(transferencia))[0].onboarding;
  assert.equal(ficha.cnpj, "11222333000181");
  assert.equal(await db.trabalhoFiscalLead.count({ where: { onboardingId: ficha.id } }), 0);
  ok("Seleção de transferência coleta CNPJ numérico e consulta pública sem operação fiscal");

  cenario = "Empresa parada sem CNPJ";
  await entrada(inativa, "Minha empresa está parada e não sei o que fazer");
  assert.equal(saidas.at(-1).texto, "Qual é o CNPJ da empresa?");
  await entrada(inativa, "Não sei");
  assert.match(saidas.at(-1).texto, /equipe/);
  assert.equal((await casos(inativa))[0].onboarding.cnpj, null);
  ok("Empresa parada sem CNPJ é encaminhada sem inventar dados nem repetir perguntas");

  cenario = "Pedido de atendimento humano";
  await entrada(desconhecido, "Olá");
  await entrada(desconhecido, "quero falar com uma pessoa");
  assert.match(saidas.at(-1).texto, /equipe|atendimento/i);
  assert.equal((await casos(desconhecido)).length, 0);
  ok("Pedido de pessoa aciona equipe sem abrir solicitação comercial fictícia");

  const [mensal, comparar, pontual, reativar, retornante, recuperacao, encerrada, arquivo, atrasada, cliqueAntigo, variosPedidos] = telefones.slice(9);
  cenario = "Comércio: abertura e contabilidade mensal, respostas curtas";
  await entrada(mensal, "Quero abrir uma empresa; meu nome é Marina; atividade: loja de roupas; cidade: Niterói/RJ");
  assert.match(saidas.at(-1).texto, /abertura|contabilidade/i);
  await entrada(mensal, "abertura e contabilidade");
  assert.equal((await casoAtivo(mensal)).onboarding.dados.modalidadeServico, "RECORRENTE");
  await entrada(mensal, "não");
  assert.equal((await casoAtivo(mensal)).onboarding.dados.qtdFuncionarios, 0);
  await entrada(mensal, "20");
  await entrada(mensal, "endereço: Rua do Comércio 123, Niterói/RJ");
  let atual = await casoAtivo(mensal);
  assert.equal(atual.onboarding.dados.notasRecebidasMes, 20);
  assert.equal(atual.onboarding.dados.responsavelNome, "Marina");
  assert.equal(atual.onboarding.dados.atividadePretendida, "loja de roupas");
  assert.equal(atual.onboarding.cnpj, null);
  assert.match(saidas.at(-1).texto, /equipe|contador/i);
  assert((await db.conversaWhatsapp.findUnique({ where: { id: atual.conversaId } })).atendidaDesde);
  ok("Comércio chega à revisão mensal sem exigir jargão nem pedir novamente os dados da primeira mensagem");

  cenario = "Odontologia: comparar abertura avulsa e mensal";
  await entrada(comparar, "Sou dentista e quero abrir uma empresa; me chamo Bianca; cidade: Rio de Janeiro/RJ");
  await entrada(comparar, "quero ver as duas opções");
  await entrada(comparar, "só eu");
  await entrada(comparar, "não sei");
  await entrada(comparar, "endereço: Avenida Exemplo 50, Rio de Janeiro/RJ");
  atual = await casoAtivo(comparar);
  assert.equal(atual.onboarding.dados.modalidadeServico, "COMPARAR");
  assert.equal(atual.onboarding.dados.qtdFuncionarios, 0);
  assert.equal(atual.onboarding.dados.notasRecebidasMes, undefined);
  assert(atual.triagem.desconhecidos.includes("notasRecebidasMes"));
  assert.match(saidas.at(-1).texto, /equipe|contador/i);
  ok("Comparação conserva as duas opções e desconhecimento de volume sem inventar números");

  cenario = "Transferência: motivo natural e serviço pontual";
  await entrada(pontual, "Quero trocar de contador; me chamo Sérgio; CNPJ 11222333000181");
  await entrada(pontual, "Quero trocar de contador porque o atual demora a responder");
  assert.match((await casoAtivo(pontual)).onboarding.dados.motivoTroca, /demora a responder/);
  await entrada(pontual, "serviço pontual");
  atual = await casoAtivo(pontual);
  assert.equal(atual.onboarding.dados.modalidadeServico, "AVULSO");
  assert.equal(atual.onboarding.dados.qtdFuncionarios, undefined);
  assert.equal(atual.onboarding.dados.notasRecebidasMes, undefined);
  assert.match(saidas.at(-1).texto, /equipe|contador/i);
  ok("Transferência aproveita a explicação do motivo e encerra coleta avulsa sem perguntas de mensalidade");

  cenario = "Empresa parada: período, reativação e mensalidade";
  await entrada(reativar, "Minha empresa está parada; me chamo Daniela; CNPJ 11222333000181");
  await entrada(reativar, "desde 2020");
  assert.equal((await casoAtivo(reativar)).onboarding.dados.paradaDesde, undefined, "Ano sem mês não pode inventar janeiro");
  assert.match(saidas.at(-1).texto, /mês|mes/i);
  assert.equal((saidas.at(-1).texto.match(/\?/g) || []).length, 1, "A clarificação do mês deve substituir a pergunta genérica, sem perguntas duplicadas");
  await entrada(reativar, "janeiro");
  assert.equal((await casoAtivo(reativar)).onboarding.dados.paradaDesde, "2020-01", "Mês sozinho completa o ano da última pergunta, sem exigir repetição");
  await entrada(reativar, "quero voltar");
  await entrada(reativar, "mensal");
  await entrada(reativar, "2");
  await entrada(reativar, "não sei");
  atual = await casoAtivo(reativar);
  assert.equal(atual.onboarding.dados.paradaDesde, "2020-01");
  assert.equal(atual.onboarding.dados.pretendeReativar, "REATIVAR");
  assert.equal(atual.onboarding.dados.modalidadeServico, "RECORRENTE");
  assert.equal(atual.onboarding.dados.qtdFuncionarios, 2);
  assert.equal(await db.trabalhoFiscalLead.count({ where: { onboardingId: atual.onboardingId } }), 0);
  assert.match(saidas.at(-1).texto, /equipe|contador/i);
  ok("Empresa parada completa triagem após CNPJ; período parcial pede precisão e consulta pública não autoriza serviço fiscal");

  cenario = "Retorno: Voltei e Pode continuar preservam cadastro";
  await entrada(retornante, "Sou médica e quero abrir uma empresa");
  const inicioRetorno = await casoAtivo(retornante);
  for (const texto of ["Voltei", "Pode continuar", "Já falei com vocês antes"]) {
    await entrada(retornante, texto);
    atual = await casoAtivo(retornante);
    assert.equal(atual.id, inicioRetorno.id);
    assert.equal(atual.onboarding.versao, inicioRetorno.onboarding.versao);
    assert.deepEqual(atual.onboarding.dados, inicioRetorno.onboarding.dados);
    assert.equal(atual.triagem.esclarecimentos || 0, inicioRetorno.triagem.esclarecimentos || 0);
    assert.match(saidas.at(-1).texto, /chama|nome/i);
    assert.doesNotMatch(saidas.at(-1).texto, /Não consegui identificar/);
  }
  await entrada(retornante, "Sou Ana");
  assert.equal((await casoAtivo(retornante)).onboarding.dados.responsavelNome, "Ana");
  ok("Contato retornante retoma a pergunta pendente sem gravar Voltei como nome ou penalizar o cliente");

  cenario = "Informação desconhecida e enviada depois";
  await entrada(recuperacao, "Quero abrir uma empresa; me chamo Paulo; atividade: arquitetura; cidade: Rio de Janeiro/RJ");
  await entrada(recuperacao, "não sei");
  assert((await casoAtivo(recuperacao)).triagem.desconhecidos.includes("modalidadeServico"));
  await entrada(recuperacao, "quero contabilidade mensal");
  assert(!(await casoAtivo(recuperacao)).triagem.desconhecidos.includes("modalidadeServico"));
  await entrada(recuperacao, "não");
  await entrada(recuperacao, "não sei");
  assert((await casoAtivo(recuperacao)).triagem.desconhecidos.includes("notasRecebidasMes"));
  await entrada(recuperacao, "recebo 12 notas de compras");
  atual = await casoAtivo(recuperacao);
  assert.equal(atual.onboarding.dados.notasRecebidasMes, 12);
  assert(!atual.triagem.desconhecidos.includes("notasRecebidasMes"));
  await entrada(recuperacao, "endereço: Rua da Arquitetura 12");
  assert.match(saidas.at(-1).texto, /equipe|contador/i);
  ok("Resposta posterior remove a pendência desconhecida e entra na ficha sem perder os dados anteriores");

  cenario = "Lead encerrado retorna para novo serviço";
  await entrada(encerrada, "Quero trocar de contador; me chamo Otávio; CNPJ 11222333000181");
  const casoEncerrado = await casoAtivo(encerrada);
  await db.onboarding.update({ where: { id: casoEncerrado.onboardingId }, data: { status: "DESISTIU" } });
  // Reproduz legado: ficha encerrada, vínculo do atendimento ainda sem encerradoEm.
  await entrada(encerrada, "Quero abrir uma empresa; me chamo Otávio; atividade: consultoria");
  const listaRetorno = await casos(encerrada);
  atual = listaRetorno.find(c => !c.encerradoEm);
  assert.equal(listaRetorno.length, 2);
  assert(listaRetorno.find(c => c.id === casoEncerrado.id).encerradoEm);
  assert.notEqual(atual.onboardingId, casoEncerrado.onboardingId);
  assert.equal(atual.onboarding.origem, "ABERTURA");
  assert.equal(atual.onboarding.cnpj, null);
  assert.equal(atual.onboarding.dados.responsavelNome, "Otávio");
  assert.equal(listaRetorno.find(c => c.id === casoEncerrado.id).onboarding.cnpj, "11222333000181");
  ok("Solicitação antiga encerrada permanece intacta; novo pedido cria a ficha correta sem herdar CNPJ");

  cenario = "Imagem sem legenda durante pergunta de nome";
  await entrada(arquivo, "Quero abrir uma empresa");
  const antesArquivo = await casoAtivo(arquivo);
  const idArquivo = await entrada(arquivo, null, { midia: "image" });
  atual = await casoAtivo(arquivo);
  assert.deepEqual(atual.onboarding.dados, antesArquivo.onboarding.dados);
  assert.equal(atual.onboarding.versao, antesArquivo.onboarding.versao);
  assert.equal(atual.onboarding.dados.responsavelNome, undefined);
  assert.match(saidas.at(-1).texto, /equipe|contador/i);
  const mensagemArquivo = await db.mensagemWhatsapp.findUnique({ where: { providerMessageId: idArquivo } });
  assert(await db.arquivoWhatsapp.findUnique({ where: { mensagemId: mensagemArquivo.id } }));
  ok("Anexo é registrado e encaminhado à equipe sem fingir leitura nem gravar marcador como nome");

  cenario = "Mensagem antiga chega depois da correção";
  await entrada(atrasada, "Quero abrir uma empresa; me chamo Renata; atividade: design");
  const antesAtrasada = await casoAtivo(atrasada), saidasAntesAtrasada = saidas.length;
  await entrada(atrasada, "Me chamo Nome Antigo", { ocorridaEm: new Date(Date.now() - 120000) });
  atual = await casoAtivo(atrasada);
  assert.equal(saidas.length, saidasAntesAtrasada, "Mensagem atrasada não provoca nova pergunta");
  assert.deepEqual(atual.onboarding.dados, antesAtrasada.onboarding.dados);
  assert.deepEqual(atual.triagem, antesAtrasada.triagem);
  assert.equal(atual.onboarding.versao, antesAtrasada.onboarding.versao);
  ok("Ordenação usa instante do provedor: nome de mensagem atrasada não substitui a ficha atual");

  cenario = "Clique em menu antigo depois de avançar a coleta";
  await entrada(cliqueAntigo, "Olá");
  const menuAntigo = await db.mensagemWhatsapp.findFirst({ where: { conversa: { telefoneE164: cliqueAntigo }, direcao: "out", tipo: "interactive" }, orderBy: { registradaEm: "desc" } });
  assert(menuAntigo?.providerMessageId);
  await entrada(cliqueAntigo, "Quero trocar de contador; me chamo Joana; CNPJ 11222333000181");
  const antesClique = await casoAtivo(cliqueAntigo);
  await entrada(cliqueAntigo, "Abrir uma empresa", { interacao: "altan.comercial.abertura.v1", respostaA: menuAntigo.providerMessageId });
  atual = await casoAtivo(cliqueAntigo);
  assert.equal((await casos(cliqueAntigo)).length, 1);
  assert.deepEqual(atual.onboarding.dados, antesClique.onboarding.dados);
  assert.deepEqual(atual.triagem, antesClique.triagem);
  assert.equal(atual.onboarding.versao, antesClique.onboarding.versao);
  assert.equal((await db.conversaWhatsapp.findUnique({ where: { id: atual.conversaId } })).atendidaDesde, null);
  assert.match(saidas.at(-1).texto, /menu/i);
  ok("Menu antigo não substitui origem, não altera ficha nem inicia pausa humana");

  cenario = "Duas solicitações da mesma pessoa";
  await entrada(variosPedidos, "Sou médico e quero abrir uma empresa");
  await entrada(variosPedidos, "Me chamo André");
  const primeiraSolicitacao = await casoAtivo(variosPedidos);
  await entrada(variosPedidos, "Também quero transferir outra empresa");
  atual = await casoAtivo(variosPedidos);
  assert.equal((await casos(variosPedidos)).length, 1);
  assert.equal(atual.onboardingId, primeiraSolicitacao.onboardingId);
  assert.deepEqual(atual.onboarding.dados, primeiraSolicitacao.onboarding.dados);
  assert.match(saidas.at(-1).texto, /solicita|separar/i);
  assert((await db.conversaWhatsapp.findUnique({ where: { id: atual.conversaId } })).atendidaDesde);
  ok("Segundo serviço preserva a primeira solicitação e pede separação humana dos atendimentos");

  if (comercial) {
    cenario = "Responsável conhecido de duas empresas, sem permissão fiscal";
    const conhecido = telefones[20];
    const identidade = await garantirIdentidadeWhatsapp({ telefone: conhecido, client: db });
    for (const prefixo of ["97", "98"]) {
      const empresa = await db.portalClient.create({ data: { razao: `${run}-empresa-${prefixo}`, cnpj: `${prefixo}${String(Date.now()).slice(-12)}` } });
      empresasSinteticas.push(empresa.id);
      await db.contatoWhatsapp.create({ data: { portalClientId: empresa.id, nome: "Responsável sintético", telefoneE164: conhecido, vinculoNumeroId: identidade.vinculoNumero.id, permissoesAssistente: [] } });
      await entrada(conhecido, "Olá");
      assert.deepEqual(saidas.at(-1).linhas.map(o => o.titulo), ["Abrir uma empresa", "Trocar de contador", "Empresa parada", "Já sou cliente", "Falar com a equipe"]);
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
