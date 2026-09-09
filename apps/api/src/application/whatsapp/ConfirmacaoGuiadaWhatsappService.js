import { confirmarEExecutar } from "../assistente/AcoesPendentesService.js";
import { decidirResposta, lerConfirmacao, FRASES, STATUS } from "../assistente/confirmacaoPendente.js";

const LIMITE_ENTRADAS = 100;
const INDETERMINADA = "Não consegui confirmar o resultado deste pedido. A equipe vai conferir antes de qualquer nova tentativa; não envie outro pedido desta nota por enquanto.";
const SUPERADA = "Recebi uma nova mensagem depois da confirmação e não executei o pedido. Vamos conferir as alterações antes de confirmar novamente.";
const resposta = (texto, codigo, acaoId = null, finalizada = false, filaHumana = false) => ({ tratado: true, texto, codigo, acaoId, finalizada, filaHumana });
const erroAcesso = () => Object.assign(new Error("Não foi possível verificar o acesso à confirmação."), { codigo: "ACESSO_REVOGADO" });

function recuperar(acao) {
  // CONFIRMADA significa que o processo pode ter caído em qualquer ponto depois da reserva.
  // EXECUTADA sem texto é legado/resultado incompleto, não prova que o ato não ocorreu.
  if (acao.status === STATUS.CONFIRMADA || (acao.status === STATUS.EXECUTADA && !acao.respostaAoCliente?.trim())) {
    return resposta(INDETERMINADA, "RESULTADO_INDETERMINADO", acao.id, true, true);
  }
  return resposta(acao.respostaAoCliente || FRASES.CANCELADA, "RESULTADO_RECUPERADO", acao.id, true, Boolean(acao.encaminharHumano));
}

/**
 * Protocolo determinístico; o chamador mantém o lease ia:conversa até persistir a etapa e a saída.
 * conferirAcesso precisa renovar/verificar o lease e recompor escopo, sessão, corte e atendimento.
 * Não envia mensagem, não marca leitura e não cria pedidos: correções livres voltam ao coletor.
 */
export async function processarConfirmacaoGuiada({ conversa, mensagem, sessao, texto = mensagem?.corpo || "", agora = new Date(), client, conferirAcesso, log, executores, acoesDeps } = {}) {
  if (typeof conferirAcesso !== "function") throw erroAcesso();
  await conferirAcesso();
  if (!conversa?.id || !conversa.portalClientId || !sessao?.ok || !sessao.userId
    || sessao.portalClientId !== conversa.portalClientId || mensagem?.conversaId !== conversa.id
    || mensagem.direcao !== "in" || !mensagem.id || !Number.isFinite(new Date(mensagem.registradaEm).getTime())) throw erroAcesso();
  const escopo = { conversaId: conversa.id, portalClientId: conversa.portalClientId, userId: sessao.userId };
  const lerAcao = (where) => client.acaoPendenteWhatsapp.findFirst({ where: { ...escopo, ...where }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });

  // O recibo da coleta pode não ter sido gravado após o ato. Recuperação é por entrada durável,
  // antes de procurar uma pendência nova. Nunca tenta o executor pela segunda vez.
  const anterior = await lerAcao({ mensagemConfirmacaoId: mensagem.id, status: { in: [STATUS.CONFIRMADA, STATUS.EXECUTADA, STATUS.CANCELADA] } });
  if (anterior) return recuperar(anterior);
  const incerta = await lerAcao({ status: STATUS.CONFIRMADA });
  if (incerta) return recuperar(incerta);

  const pendente = await lerAcao({ status: STATUS.PENDENTE });
  const textoConfirmacao = mensagem.tipo === "text" ? texto : "";
  const leitura = lerConfirmacao(textoConfirmacao);
  if (!pendente) {
    if (!leitura.ehConfirmacao) return { tratado: false };
    // Uma duplicata pode ter outro wamid. O código já executado permite recuperar a resposta,
    // mas somente dentro da mesma conversa/empresa/pessoa.
    const executada = await lerAcao({ codigo: leitura.codigo, status: STATUS.EXECUTADA });
    return executada ? recuperar(executada) : resposta(FRASES.SEM_PENDENCIA, "SEM_PENDENCIA");
  }
  const decisao = decidirResposta({ texto: textoConfirmacao, pendente, agora }).decisao;
  if (decisao === "SEGUE_PARA_IA") return { tratado: false, acaoId: pendente.id };
  if (decisao === "CODIGO_ERRADO") return resposta(FRASES.CODIGO_ERRADO(pendente.codigo), "CODIGO_ERRADO", pendente.id);
  if (decisao === "LEMBRAR_CONFIRMACAO") return resposta(FRASES.LEMBRAR_CONFIRMACAO(pendente.codigo), "LEMBRAR_CONFIRMACAO", pendente.id);

  await conferirAcesso();
  if (decisao === "CANCELAR" || decisao === "EXPIRADA") {
    const status = decisao === "CANCELAR" ? STATUS.CANCELADA : STATUS.EXPIRADA;
    const textoFinal = decisao === "CANCELAR" ? FRASES.CANCELADA : FRASES.EXPIRADA;
    const alterada = await client.acaoPendenteWhatsapp.updateMany({ where: { id: pendente.id, ...escopo, status: STATUS.PENDENTE }, data: { status } });
    if (!alterada.count) return resposta(INDETERMINADA, "PEDIDO_ALTERADO", pendente.id, true, true);
    return resposta(textoFinal, decisao === "CANCELAR" ? "CANCELADA" : "EXPIRADA", pendente.id, true);
  }
  if (decisao !== "EXECUTAR") return { tratado: false };
  if (!Number.isFinite(new Date(pendente.createdAt).getTime()) || new Date(mensagem.registradaEm) < new Date(pendente.createdAt)) {
    return resposta("Essa confirmação foi recebida antes deste pedido. Confira o resumo mais recente e envie o código novamente se os dados estiverem certos.", "CONFIRMACAO_ANTERIOR_RESUMO", pendente.id);
  }

  const ondePosteriores = { conversaId: conversa.id, direcao: "in", registradaEm: { gte: new Date(mensagem.registradaEm) }, id: { notIn: [mensagem.id] } };
  // Não filtrar respondidaPelaIaEm: uma correção já consumida por outro fluxo continua valendo.
  const posteriores = await client.mensagemWhatsapp.findMany({ where: ondePosteriores,
    orderBy: [{ registradaEm: "asc" }, { id: "asc" }], take: LIMITE_ENTRADAS + 1,
    select: { id: true, tipo: true, corpo: true },
  });
  if (posteriores.length > LIMITE_ENTRADAS || posteriores.some(m => m.tipo !== "text" || lerConfirmacao(m.corpo).codigo !== leitura.codigo)) {
    await conferirAcesso();
    const alterada = await client.acaoPendenteWhatsapp.updateMany({ where: { id: pendente.id, ...escopo, status: STATUS.PENDENTE }, data: { status: STATUS.CANCELADA } });
    return alterada.count ? resposta(SUPERADA, "CONFIRMACAO_SUPERADA", pendente.id, true) : resposta(INDETERMINADA, "PEDIDO_ALTERADO", pendente.id, true, true);
  }
  const confirmacao = { mensagemId: mensagem.id, registradaEm: mensagem.registradaEm, mensagensConhecidas: [mensagem.id, ...posteriores.map(m => m.id)] };
  await conferirAcesso();
  const r = await confirmarEExecutar({ acaoId: pendente.id, ...escopo, confirmacao, agora, client, log,
    ...(executores ? { executores } : {}), ...(acoesDeps ? { deps: acoesDeps } : {}),
    antesDeExecutar: async () => {
      await conferirAcesso();
      // A reserva fecha a corrida do SELECT/UPDATE. Esta nova leitura cobre ainda as entradas
      // que chegaram enquanto a permissão fiscal era reconferida, antes de iniciar o executor.
      const nova = await client.mensagemWhatsapp.findFirst({ where: { ...ondePosteriores, id: { notIn: confirmacao.mensagensConhecidas } }, select: { id: true } });
      if (nova) throw Object.assign(new Error("Uma nova entrada substituiu a confirmação."), { codigo: "CONFIRMACAO_SUPERADA" });
      await conferirAcesso();
    },
  });
  if (!r.executou && !r.codigo && !r.filaHumana) {
    // Reserva recusada não é permissão para pedir novamente: outro consumidor pode ter iniciado.
    const atual = await lerAcao({ id: pendente.id });
    if (atual && [STATUS.CONFIRMADA, STATUS.EXECUTADA].includes(atual.status)) return recuperar(atual);
  }
  return resposta(r.texto, r.codigo || (r.executou ? "EXECUTADA" : "EXECUCAO_RECUSADA"), pendente.id, true, Boolean(r.filaHumana));
}
