import { prisma } from "../../infrastructure/db/prisma.js";
import { WHATSAPP_COLETA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";
import { iniciarAtendimento, registrarCampos, encerrado } from "./LeadService.js";
import { identidadeDoCaso, filtroCasoDaConversa, exigirConversaDoCaso } from "./ContextoComercialService.js";
import { OnboardingError } from "./OnboardingService.js";
import { coletaComercialHabilitada } from "./politicaColetaComercial.js";
import { pediuMenuWhatsapp, declarouSerCliente, pediuEquipeWhatsapp } from "../whatsapp/navegacaoWhatsapp.js";
import { avisoAtendimentoComercial, modalidadeDoBotao } from "./mensagensComerciais.js";

import { pedidoOperacionalComercial } from "./interpretacaoComercialWhatsapp.js";
import { identificarIntencaoComercial, origemDaIntencao, prepararPreatendimento, mensagemDeValor } from "./preatendimentoComercial.js";
export { interpretarColetaComercial, identificarOrigemComercial, pedidoOperacionalComercial } from "./interpretacaoComercialWhatsapp.js";

function mensagemAnterior(mensagem, triagem = {}) {
  // Compare relógios da mesma origem; fichas legadas não tinham o instante Meta.
  if (mensagem.ocorridaEmProvedor && triagem.ultimaMensagemProvedorEm
    && new Date(mensagem.ocorridaEmProvedor) < new Date(triagem.ultimaMensagemProvedorEm)) return true;
  return Boolean(triagem.ultimaMensagemEm && new Date(mensagem.registradaEm) < new Date(triagem.ultimaMensagemEm));
}

export async function coletarComercialWhatsapp({ registro, item = {}, contexto = null, deps = {} } = {}) {
  const db = deps.client || prisma, agora = deps.agora || new Date();
  if (!(deps.flag ?? WHATSAPP_COLETA_COMERCIAL)) return { tratado: false, motivo: "COLETA_DESLIGADA" };
  const conversa = registro?.conversa, mensagem = registro?.mensagem;
  const piloto = deps.piloto || IA_COMERCIAL_TELEFONES_PILOTO;
  if (!conversa || !mensagem || !coletaComercialHabilitada(conversa.telefoneE164, { flag: true, piloto, canal: registro.canal, canalId: conversa.canalId })) return { tratado: false, motivo: "FORA_DO_PILOTO" };
  const variasEmpresas = conversa.vinculoNumeroId && registro.vinculo?.ambiguidades?.length === 1
    && registro.vinculo.ambiguidades[0] === "EMPRESA";
  // A pessoa pode iniciar um novo serviço sem escolher uma empresa operacional.
  // Ambiguidade de pessoa e segmentos sem identidade migrada continuam bloqueados.
  if (registro.vinculo?.situacao === "AMBIGUO" && !variasEmpresas) return { tratado: false, motivo: "IDENTIDADE_EM_REVISAO" };
  const tipo = item.tipo || mensagem.tipo || "text";
  if (tipo === "reaction") return { tratado: true, motivo: "REACAO_SEM_COLETA" };
  const anexo = !["text", "interactive", "button"].includes(tipo);
  const idInteracao = typeof item.interacao === "string" ? item.interacao : item.interacao?.id || item.interacao?.button_reply?.id || item.interacao?.list_reply?.id;
  const escolhaModalidade = modalidadeDoBotao(idInteracao);
  // A escolha vem do ID emitido pelo servidor; o título não é uma declaração.
  const textoEntrada = anexo || escolhaModalidade ? "" : item.corpo || mensagem.corpo;
  // Um caso anterior, inclusive de outro canal, não transforma saudação/menu em
  // resposta cadastral. Cliques são decididos pelo ID, nunca pelo título recebido.
  const intencaoRecebida = identificarIntencaoComercial(textoEntrada, item.interacao);
  const palavraContador = String(textoEntrada || "").trim().toUpperCase() === "CONTADOR";
  const contadorOperacional = conversa.portalClientId && registro.canal?.finalidade !== "COMERCIAL";
  const navegacao = idInteracao ? !intencaoRecebida && !escolhaModalidade
    : pediuMenuWhatsapp(textoEntrada) || declarouSerCliente(textoEntrada) || (pediuEquipeWhatsapp(textoEntrada) && (!palavraContador || contadorOperacional));
  const inicial = await db.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
  const anterior = await db.coletaComercialWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
  const bloqueada = c => !c || c.excluidaEm || c.atendidaPor || c.atendidaDesde || c.automacaoInvalidadaEm && new Date(mensagem.registradaEm) <= new Date(c.automacaoInvalidadaEm);
  const proprioHandoff = c => anterior?.resultado?.handoffEm && !c?.atendidaPor && c?.atendidaDesde && new Date(c.atendidaDesde).toISOString() === anterior.resultado.handoffEm;
  if (bloqueada(proprioHandoff(inicial) ? { ...inicial, atendidaDesde: null } : inicial)) return { tratado: false, motivo: "AUTOMACAO_INVALIDADA" };
  let interlocutorId;
  try { interlocutorId = await identidadeDoCaso(inicial, db); }
  catch (err) {
    if (err.code !== "identidade_alterada") throw err;
    return { tratado: false, motivo: "IDENTIDADE_EM_REVISAO" };
  }
  const pessoa = interlocutorId ? await db.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }) : null;
  if (pessoa && (pessoa.estado !== "ATIVO" || pessoa.atendidaPor || pessoa.atendidaDesde && !proprioHandoff(pessoa))) return { tratado: false, motivo: "IDENTIDADE_OU_HUMANO" };
  const identidadeVersao = pessoa?.versao || 0;
  const escopo = filtroCasoDaConversa(inicial, interlocutorId);
  const vinculado = await db.atendimentoLead.findFirst({ where: { ...escopo, encerradoEm: null }, include: { onboarding: true } });
  // Um vínculo legado aberto não torna uma ficha concluída uma coleta ativa.
  const existente = vinculado && !encerrado(vinculado.onboarding) ? vinculado : null;
  const origem = intencaoRecebida;
  if (mensagemAnterior(mensagem, vinculado?.triagem)) return { tratado: true, motivo: "MENSAGEM_ANTIGA" };
  if (navegacao) return { tratado: false, motivo: "NAVEGACAO_DO_ATENDIMENTO" };
  if (pedidoOperacionalComercial(textoEntrada) || (conversa.portalClientId && registro.canal?.finalidade !== "COMERCIAL" && /^(IMPOSTO|DRE|MARGEM)$/i.test(String(textoEntrada || "").trim()))) return { tratado: false, motivo: "PEDIDO_OPERACIONAL" };
  if (!existente?.onboarding && !existente?.triagem?.preatendimento?.intencao && (!origem || origem === "MULTIPLOS")) return { tratado: false, motivo: origem === "MULTIPLOS" ? "MULTIPLOS_PEDIDOS" : "SEM_INTENCAO_COMERCIAL" };
  const persistido = await db.$transaction(async tx => {
    const atual = await tx.conversaWhatsapp.findUnique({ where: { id: inicial.id } });
    if (bloqueada(proprioHandoff(atual) ? { ...atual, atendidaDesde: null } : atual) || atual.vinculoNumeroId !== inicial.vinculoNumeroId || atual.canalId !== inicial.canalId) throw new OnboardingError("atendimento_alterado", "A conversa mudou durante a coleta.", 409);
    await identidadeDoCaso(atual, tx, { travar: true });
    const recibo = await tx.coletaComercialWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
    if (recibo) return recibo;
    if (interlocutorId) { const p = await tx.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }); if (p.versao !== identidadeVersao || p.estado !== "ATIVO" || p.atendidaPor || p.atendidaDesde && !proprioHandoff(p)) throw new OnboardingError("identidade_alterada", "A identificação mudou durante a coleta.", 409); }
    let caso = await iniciarAtendimento({ conversaId: atual.id, origem: existente ? null : origemDaIntencao(origem), client: tx });
    await exigirConversaDoCaso(caso, atual, tx);
    if (encerrado(caso.onboarding)) throw new OnboardingError("atendimento_encerrado", "A solicitação não está em coleta.", 409);
    const triagem = caso.triagem || {};
    if (mensagemAnterior(mensagem, triagem)) return { resultado: { texto: null }, atendimentoLeadId: caso.id, identidadeVersao };
    const intencao = triagem.preatendimento?.intencao || caso.onboarding?.origem || origem;
    const mudouOrigem = origem && origem !== intencao;
    const referencia = mensagem.respostaAProviderMessageId || item.respostaAProviderMessageId;
    const menuRespondido = idInteracao && mudouOrigem && referencia && triagem.ultimaMensagemEm
      ? await tx.mensagemWhatsapp.findFirst({ where: { providerMessageId: referencia, conversaId: atual.id, direcao: "out", tipo: "interactive" }, select: { registradaEm: true } }) : null;
    const menuAntigo = Boolean(menuRespondido && new Date(menuRespondido.registradaEm) < new Date(triagem.ultimaMensagemEm));
    const escolhaAntiga = escolhaModalidade && escolhaModalidade.atendimentoId !== caso.id;
    const preparo = prepararPreatendimento({ texto: anexo || mudouOrigem || escolhaModalidade ? "" : textoEntrada,
      intencao, anterior: triagem.preatendimento, dadosFicha: caso.onboarding?.dados,
      nomeConhecido: pessoa?.nome || inicial.nomePerfilProvedor, campoAnterior: triagem.campoEsperado, mensagemId: mensagem.id });
    const { leitura, pre } = preparo;
    const manterColeta = leitura.aguardar || leitura.retomada || menuAntigo || escolhaAntiga;
    const encaminhar = !manterColeta && (anexo || mudouOrigem || escolhaModalidade || preparo.encaminhar);
    if (!mudouOrigem && !menuAntigo && !escolhaAntiga && caso.onboardingId && preparo.operacoes.length) {
      caso.onboarding = await registrarCampos({ onboardingId: caso.onboardingId, versao: caso.onboarding.versao,
        operacoes: preparo.operacoes, mensagemId: mensagem.id, client: tx });
    }
    const motivoEquipe = anexo ? "Vou chamar a equipe para conferir o anexo e continuar seu atendimento."
      : mudouOrigem ? "Vou chamar a equipe para organizar esse novo pedido junto com as informações que você já enviou."
        : "Vou encaminhar seu atendimento ao contador junto com o que você já contou. Você não precisa repetir tudo.";
    const beneficio = mensagemDeValor(pre);
    const valor = (!pre.valorApresentado || pre.valorTexto && pre.valorTexto !== beneficio) && !anexo && !menuAntigo && !escolhaAntiga && !leitura.aguardar ? beneficio : null;
    const texto = escolhaAntiga || menuAntigo ? "Essa opção é de um atendimento anterior. Seus dados foram preservados. Conte o que precisa agora ou escreva menu para ver as opções."
      : encaminhar ? [preparo.resposta, valor, `${motivoEquipe} ${avisoAtendimentoComercial(agora)}`].filter(Boolean).join("\n\n")
        : leitura.aguardar ? "Tudo bem. Quando quiser continuar, é só escrever por aqui."
          : [leitura.retomada ? "Podemos continuar de onde paramos." : preparo.resposta, valor, preparo.pergunta].filter(Boolean).join("\n\n");
    const handoffEm = encaminhar ? agora : null;
    if (encaminhar) {
      await tx.conversaWhatsapp.update({ where: { id: atual.id }, data: { atendidaDesde: agora } });
      if (interlocutorId) await tx.interlocutorComunicacao.update({ where: { id: interlocutorId }, data: { atendidaDesde: agora } });
    }
    const salva = await tx.atendimentoLead.update({ where: { id: caso.id }, data: { versao: { increment: 1 },
      ...(!menuAntigo && !escolhaAntiga ? { triagem: { ...triagem,
        preatendimento: { ...pre, valorApresentado: Boolean(pre.valorApresentado || valor), valorTexto: valor || pre.valorTexto || null, estado: encaminhar ? "ENCAMINHADO" : "EM_CONVERSA",
          ...(handoffEm ? { encaminhadoEm: handoffEm.toISOString() } : {}) },
        campoEsperado: null,
        desconhecidos: (triagem.desconhecidos || []).filter(campo => !preparo.operacoes.some(o => o.campo === campo && o.acao === "set")),
        ultimaMensagemEm: new Date(mensagem.registradaEm).toISOString(),
        ...(mensagem.ocorridaEmProvedor ? { ultimaMensagemProvedorEm: new Date(mensagem.ocorridaEmProvedor).toISOString() } : {}),
        ...(mudouOrigem ? { proximaSolicitacao: { intencao: origem, mensagemId: mensagem.id, relato: String(textoEntrada || "").slice(0, 1000) } } : {}),
      } } : {}) } });
    return tx.coletaComercialWhatsapp.create({ data: { mensagemId: mensagem.id, atendimentoLeadId: caso.id, identidadeVersao,
      resultado: { texto, onboardingId: caso.onboardingId || null, atendimentoId: caso.id, casoVersao: salva.versao,
        fichaVersao: caso.onboarding?.versao ?? null, encaminhar: Boolean(encaminhar), handoffEm: handoffEm?.toISOString() || null,
        contexto: { interlocutorId, vinculoNumeroId: atual.vinculoNumeroId || null, canalId: atual.canalId || null, identidadeVersao } } } });
  });
  const resultado = persistido.resultado;
  if (!resultado.texto) return { tratado: true, resultado, motivo: "MENSAGEM_ANTIGA" };
  const conferir = async () => {
    const c = await db.conversaWhatsapp.findUnique({ where: { id: inicial.id } });
    const handoffDoTurno = resultado.handoffEm && !c?.atendidaPor && c?.atendidaDesde && new Date(c.atendidaDesde).toISOString() === resultado.handoffEm;
    if (bloqueada(handoffDoTurno ? { ...c, atendidaDesde: null } : c) || c.vinculoNumeroId !== inicial.vinculoNumeroId || c.canalId !== inicial.canalId) throw new OnboardingError("atendimento_alterado", "A conversa mudou antes da resposta.", 409);
    const caso = await db.atendimentoLead.findUnique({ where: { id: persistido.atendimentoLeadId }, include: { onboarding: true } });
    await exigirConversaDoCaso(caso, c, db);
    if (caso.versao !== resultado.casoVersao || (caso.onboarding?.versao ?? null) !== (resultado.fichaVersao ?? null)) throw new OnboardingError("atendimento_alterado", "A ficha mudou antes da resposta.", 409);
    if (interlocutorId) { const p = await db.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }); if (p.versao !== persistido.identidadeVersao || p.estado !== "ATIVO" || p.atendidaPor || p.atendidaDesde && (!resultado.handoffEm || new Date(p.atendidaDesde).toISOString() !== resultado.handoffEm)) throw new OnboardingError("identidade_alterada", "A identificação ou o responsável mudou antes da resposta.", 409); }
    await deps.conferirContexto?.(resultado.contexto);
    return c;
  };
  await conferir();
  if (deps.enviar) await deps.enviar({ conversa: await conferir(), texto: resultado.texto, referenciaComercial: { tipo: "COLETA_COMERCIAL", mensagemOrigemId: mensagem.id, atendimentoId: persistido.atendimentoLeadId }, antesDeEnviar: conferir, resultado });
  return { tratado: true, resultado, motivo: resultado.encaminhar ? "ENCAMINHADA" : "COLETA_COMERCIAL" };
}
