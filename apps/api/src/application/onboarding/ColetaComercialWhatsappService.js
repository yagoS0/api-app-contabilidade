import { prisma } from "../../infrastructure/db/prisma.js";
import { WHATSAPP_COLETA_COMERCIAL, IA_COMERCIAL_TELEFONES_PILOTO } from "../../config.js";
import { iniciarAtendimento, registrarCampos, proximaPergunta, encerrado } from "./LeadService.js";
import { identidadeDoCaso, filtroCasoDaConversa, exigirConversaDoCaso } from "./ContextoComercialService.js";
import { consultarPublicaLead } from "./FiscalLeadService.js";
import { OnboardingError } from "./OnboardingService.js";
import { coletaComercialHabilitada } from "./politicaColetaComercial.js";
import { pediuMenuWhatsapp, declarouSerCliente, pediuEquipeWhatsapp } from "../whatsapp/navegacaoWhatsapp.js";
import { avisoAtendimentoComercial, botoesModalidadeServico, modalidadeDoBotao } from "./mensagensComerciais.js";

import { interpretarColetaComercial, identificarOrigemComercial, pedidoOperacionalComercial } from "./interpretacaoComercialWhatsapp.js";
export { interpretarColetaComercial, identificarOrigemComercial, pedidoOperacionalComercial } from "./interpretacaoComercialWhatsapp.js";

function mensagemAnterior(mensagem, triagem = {}) {
  // Compare relógios da mesma origem; fichas legadas não tinham o instante Meta.
  if (mensagem.ocorridaEmProvedor && triagem.ultimaMensagemProvedorEm
    && new Date(mensagem.ocorridaEmProvedor) < new Date(triagem.ultimaMensagemProvedorEm)) return true;
  return Boolean(triagem.ultimaMensagemEm && new Date(mensagem.registradaEm) < new Date(triagem.ultimaMensagemEm));
}

const assuntoDoCaso = origem => ({ ABERTURA: "abertura", TRANSFERENCIA: "troca de contador", INATIVA: "regularização da empresa" })[origem] || "solicitação";

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
  const navegacao = idInteracao ? !identificarOrigemComercial("", item.interacao) && !escolhaModalidade
    : pediuMenuWhatsapp(textoEntrada) || declarouSerCliente(textoEntrada) || pediuEquipeWhatsapp(textoEntrada);
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
  const existente = vinculado?.onboarding && !encerrado(vinculado.onboarding) ? vinculado : null;
  const origem = identificarOrigemComercial(textoEntrada, item.interacao);
  if (mensagemAnterior(mensagem, vinculado?.triagem)) return { tratado: true, motivo: "MENSAGEM_ANTIGA" };
  if (navegacao) return { tratado: false, motivo: "NAVEGACAO_DO_ATENDIMENTO" };
  if (pedidoOperacionalComercial(textoEntrada)) return { tratado: false, motivo: "PEDIDO_OPERACIONAL" };
  if (!existente && (!origem || origem === "MULTIPLOS")) return { tratado: false, motivo: origem === "MULTIPLOS" ? "MULTIPLOS_PEDIDOS" : "SEM_INTENCAO_COMERCIAL" };
  const persistido = await db.$transaction(async tx => {
    const atual = await tx.conversaWhatsapp.findUnique({ where: { id: inicial.id } });
    if (bloqueada(proprioHandoff(atual) ? { ...atual, atendidaDesde: null } : atual) || atual.vinculoNumeroId !== inicial.vinculoNumeroId || atual.canalId !== inicial.canalId) throw new OnboardingError("atendimento_alterado", "A conversa mudou durante a coleta.", 409);
    await identidadeDoCaso(atual, tx, { travar: true });
    const recibo = await tx.coletaComercialWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
    if (recibo) return recibo;
    if (interlocutorId) { const p = await tx.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }); if (p.versao !== identidadeVersao || p.estado !== "ATIVO" || p.atendidaPor || p.atendidaDesde && !proprioHandoff(p)) throw new OnboardingError("identidade_alterada", "A identificação mudou durante a coleta.", 409); }
    let caso = await iniciarAtendimento({ conversaId: atual.id, origem: existente ? null : origem, client: tx });
    await exigirConversaDoCaso(caso, atual, tx);
    if (!caso.onboarding || encerrado(caso.onboarding)) throw new OnboardingError("atendimento_encerrado", "A solicitação não está em coleta.", 409);
    const triagem = caso.triagem || {};
    if (mensagemAnterior(mensagem, triagem)) return { resultado: { texto: null }, atendimentoLeadId: caso.id, identidadeVersao };
    let desconhecidos = [...(triagem.desconhecidos || [])];
    const esperada = proximaPergunta(caso.onboarding, { desconhecidos });
    // No primeiro pedido ainda não fizemos uma pergunta. "Minha empresa está
    // parada e não sei o que fazer" não significa que a pessoa desconhece o CNPJ.
    const escolhaAntiga = Boolean(escolhaModalidade && (escolhaModalidade.atendimentoId !== caso.id || esperada.campo !== "modalidadeServico" || triagem.campoEsperado !== "modalidadeServico"));
    const leitura = escolhaModalidade ? { operacoes: escolhaAntiga ? [] : [{ campo: "modalidadeServico", acao: "set", valor: escolhaModalidade.valor }] }
      : anexo ? { operacoes: [], humano: true }
      : interpretarColetaComercial({ texto: textoEntrada, origem: caso.onboarding.origem, campoEsperado: triagem.campoEsperado || (!origem ? esperada.campo : null), anoParadaPendente: triagem.anoParadaPendente });
    const mudouOrigem = origem && origem !== caso.onboarding.origem;
    const referencia = mensagem.respostaAProviderMessageId || item.respostaAProviderMessageId;
    const menuRespondido = idInteracao && mudouOrigem && referencia && triagem.ultimaMensagemEm
      ? await tx.mensagemWhatsapp.findFirst({ where: { providerMessageId: referencia, conversaId: atual.id, direcao: "out", tipo: "interactive" }, select: { registradaEm: true } }) : null;
    const menuAntigo = Boolean(menuRespondido && new Date(menuRespondido.registradaEm) < new Date(triagem.ultimaMensagemEm));
    let encaminhar = !menuAntigo && (leitura.humano || leitura.reinicio || Boolean(mudouOrigem));
    if (!mudouOrigem && leitura.operacoes.length) {
      caso.onboarding = await registrarCampos({ onboardingId: caso.onboardingId, versao: caso.onboarding.versao, operacoes: leitura.operacoes, mensagemId: mensagem.id, client: tx });
      desconhecidos = desconhecidos.filter(campo => !leitura.operacoes.some(o => o.campo === campo && o.acao === "set"));
    }
    if (leitura.desconhecido && !desconhecidos.includes(leitura.desconhecido)) desconhecidos.push(leitura.desconhecido);
    const proxima = proximaPergunta(caso.onboarding, { desconhecidos });
    const anoParadaPendente = proxima.campo !== "paradaDesde" ? null
      : !mudouOrigem && leitura.anoParadaPendente !== undefined ? leitura.anoParadaPendente : triagem.anoParadaPendente || null;
    const perguntaSeguinte = proxima.campo === "paradaDesde" && /^\d{4}$/.test(String(anoParadaPendente || ""))
      ? `Em que mês de ${anoParadaPendente} a empresa parou? Se não souber, pode dizer “não sei”.` : proxima.pergunta;
    const manterColeta = leitura.retomada || leitura.aguardar || menuAntigo || escolhaAntiga;
    const semInterpretacao = !leitura.operacoes.length && !leitura.desconhecido && !leitura.resposta && !origem && !leitura.humano && !leitura.reinicio && !manterColeta;
    const esclarecimentos = manterColeta ? triagem.esclarecimentos || 0 : semInterpretacao ? (triagem.esclarecimentos || 0) + 1 : 0;
    encaminhar ||= !manterColeta && (esclarecimentos > 1 || !proxima.campo || leitura.desconhecido === "cnpj");
    const motivoEquipe = anexo ? "Vou chamar a equipe para conferir sua mensagem com anexo e continuar por aqui."
      : mudouOrigem || leitura.reinicio ? "Vou chamar a equipe para organizar a nova solicitação. As informações que você já enviou ficam preservadas."
        : leitura.desconhecido === "cnpj" ? "Sem problema. A equipe vai ajudar você a localizar o CNPJ e continuar a análise."
          : leitura.humano || esclarecimentos > 1 ? "Vou chamar a equipe para entender melhor o que você precisa e continuar por aqui."
            : "Já tenho as informações iniciais. A equipe vai conferir seu caso e preparar a proposta com os serviços e valores.";
    const texto = escolhaAntiga ? `Essa opção é de outra solicitação ou de uma etapa que já passou. Vamos continuar o atendimento atual.\n\n${perguntaSeguinte}`
      : menuAntigo ? "Esse menu é anterior ao atendimento que você está preenchendo. Escreva “menu” para ver as opções atuais ou conte o que deseja mudar. Seus dados foram preservados."
      : encaminhar ? `${motivoEquipe} ${avisoAtendimentoComercial(agora)}`
        : leitura.aguardar ? "Tudo bem. Quando quiser continuar, é só escrever por aqui."
          : [leitura.retomada ? `Vamos continuar sua ${assuntoDoCaso(caso.onboarding.origem)} de onde paramos.` : leitura.resposta,
            leitura.desconhecido ? "Tudo bem se ainda não souber; a equipe confere essa informação com você." : null,
            leitura.respostaSubstituiPergunta ? null : semInterpretacao ? `Para continuar: ${perguntaSeguinte}` : perguntaSeguinte].filter(Boolean).join("\n\n");
    const handoffEm = encaminhar ? agora : null;
    if (encaminhar) {
      await tx.conversaWhatsapp.update({ where: { id: atual.id }, data: { atendidaDesde: agora } });
      if (interlocutorId) await tx.interlocutorComunicacao.update({ where: { id: interlocutorId }, data: { atendidaDesde: agora } });
    }
    const salva = await tx.atendimentoLead.update({ where: { id: caso.id }, data: { versao: { increment: 1 }, ...(!menuAntigo && !escolhaAntiga ? { triagem: { ...triagem, desconhecidos, campoEsperado: proxima.campo, esclarecimentos,
      anoParadaPendente,
      ultimaMensagemEm: new Date(mensagem.registradaEm).toISOString(),
      ...(mensagem.ocorridaEmProvedor ? { ultimaMensagemProvedorEm: new Date(mensagem.ocorridaEmProvedor).toISOString() } : {}),
      ...(mudouOrigem ? { proximaSolicitacao: { origem, mensagemId: mensagem.id } } : {}) } } : {}) } });
    const botoes = !encaminhar && !leitura.aguardar && !menuAntigo && proxima.campo === "modalidadeServico" ? botoesModalidadeServico(caso.id, caso.onboarding.origem) : null;
    return tx.coletaComercialWhatsapp.create({ data: { mensagemId: mensagem.id, atendimentoLeadId: caso.id, identidadeVersao, resultado: { texto, ...(botoes ? { botoes } : {}), onboardingId: caso.onboardingId, atendimentoId: caso.id, casoVersao: salva.versao, fichaVersao: caso.onboarding.versao, cnpj: caso.onboarding.cnpj || null, consultarPublica: Boolean(caso.onboarding.cnpj && leitura.operacoes.some(o => o.campo === "cnpj")), encaminhar, handoffEm: handoffEm?.toISOString() || null, contexto: { interlocutorId, vinculoNumeroId: atual.vinculoNumeroId || null, canalId: atual.canalId || null, identidadeVersao } } } });
  });
  let resultado = persistido.resultado;
  if (!resultado.texto) return { tratado: true, resultado, motivo: "MENSAGEM_ANTIGA" };
  const conferir = async () => {
    const c = await db.conversaWhatsapp.findUnique({ where: { id: inicial.id } });
    const handoffDoTurno = resultado.handoffEm && !c?.atendidaPor && c?.atendidaDesde && new Date(c.atendidaDesde).toISOString() === resultado.handoffEm;
    if (bloqueada(handoffDoTurno ? { ...c, atendidaDesde: null } : c) || c.vinculoNumeroId !== inicial.vinculoNumeroId || c.canalId !== inicial.canalId) throw new OnboardingError("atendimento_alterado", "A conversa mudou antes da resposta.", 409);
    const caso = await db.atendimentoLead.findUnique({ where: { id: persistido.atendimentoLeadId }, include: { onboarding: true } });
    await exigirConversaDoCaso(caso, c, db);
    if (caso.versao !== resultado.casoVersao || caso.onboarding?.versao !== resultado.fichaVersao) throw new OnboardingError("atendimento_alterado", "A ficha mudou antes da resposta.", 409);
    if (interlocutorId) { const p = await db.interlocutorComunicacao.findUnique({ where: { id: interlocutorId } }); if (p.versao !== persistido.identidadeVersao || p.estado !== "ATIVO" || p.atendidaPor || p.atendidaDesde && (!resultado.handoffEm || new Date(p.atendidaDesde).toISOString() !== resultado.handoffEm)) throw new OnboardingError("identidade_alterada", "A identificação ou o responsável mudou antes da resposta.", 409); }
    await deps.conferirContexto?.(resultado.contexto);
    return c;
  };
  await conferir();
  if (resultado.consultarPublica) {
    try {
      const consulta = await (deps.consultaPublica || consultarPublicaLead)(resultado.onboardingId, { db });
      const completo = [consulta.razaoSocial, consulta.atividadePrincipal, consulta.endereco, [consulta.municipio, consulta.uf].filter(Boolean).join(" / ")].filter(Boolean).join(" · ");
      // O corpo de botões tem limite menor; os dados completos ficam na análise salva.
      const detalhe = resultado.botoes && completo.length > 500 ? `${completo.slice(0, 497)}…` : completo;
      const situacao = String(consulta.situacaoCadastral || "não informada").slice(0, 60);
      resultado = { ...resultado, consultarPublica: false, texto: `Consultei os dados públicos: ${detalhe || "dados disponíveis"}. Situação cadastral: ${situacao}. Isso não comprova regularidade fiscal.\n\n${resultado.texto}` };
    } catch { resultado = { ...resultado, consultarPublica: false, texto: `Não foi possível concluir a consulta pública agora; deixei o CNPJ registrado para a equipe conferir.\n\n${resultado.texto}` }; }
    await conferir();
    await db.coletaComercialWhatsapp.update({ where: { mensagemId: mensagem.id }, data: { resultado } });
  }
  if (deps.enviar) await deps.enviar({ conversa: await conferir(), texto: resultado.texto, referenciaComercial: { tipo: "COLETA_COMERCIAL", mensagemOrigemId: mensagem.id, atendimentoId: persistido.atendimentoLeadId }, antesDeEnviar: conferir, resultado });
  return { tratado: true, resultado, motivo: resultado.encaminhar ? "ENCAMINHADA" : "COLETA_COMERCIAL" };
}
