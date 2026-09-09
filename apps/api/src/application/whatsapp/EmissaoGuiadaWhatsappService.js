import { randomUUID } from "node:crypto";
import { iniciarColeta, interpretarResposta, atualizarColeta, ehPedidoDeEmissao } from "../assistente/coletaEmissaoWhatsapp.js";
import { executarFerramenta, SERVICOS_PADRAO } from "../assistente/ferramentas/index.js";
import { criarPendencia } from "../assistente/AcoesPendentesService.js";
import { gerarCodigo, ALFABETO, rodapeDeConfirmacao, lerConfirmacao } from "../assistente/confirmacaoPendente.js";
import { processarConfirmacaoGuiada } from "./ConfirmacaoGuiadaWhatsappService.js";

export const TTL_COLETA_MS = 24 * 60 * 60 * 1000;
const limpar = (v) => JSON.parse(JSON.stringify(v));
const instante = (v) => v ? new Date(v).getTime() : null;
const encerrado = (s) => ["CANCELADO", "CONCLUIDO", "EQUIPE"].includes(s);
const erroEscopo = () => Object.assign(new Error("O acesso à coleta mudou."), { codigo: "AUTOMACAO_INVALIDADA" });

/** Sob o lease ia:conversa. Coleta e recibo são atômicos; nenhuma dependência de modelo. */
export async function processarEmissaoGuiada({ conversa, mensagem, sessao, texto = "", interacao = null, iniciar = false, pausar = false,
  agora = new Date(), client, conferirAcesso, executar = executarFerramenta, servicos = {}, confirmar = processarConfirmacaoGuiada, log } = {}) {
  await conferirAcesso();
  const escopo = { conversaId: conversa.id, portalClientId: sessao.portalClientId, userId: sessao.userId };
  const recibo = await client.etapaEmissaoWhatsapp.findUnique({ where: { mensagemId: mensagem.id } });
  if (recibo) {
    if (Object.entries(escopo).some(([k, v]) => recibo[k] !== v)) throw erroEscopo();
    return recibo.resultado;
  }
  const anterior = await client.rascunhoEmissaoWhatsapp.findUnique({ where: { conversaId: conversa.id } });
  const mesmoEscopo = anterior && Object.entries(escopo).every(([k, v]) => anterior[k] === v)
    && instante(anterior.corteAutomacao) === instante(conversa.automacaoInvalidadaEm);
  const vigente = mesmoEscopo && instante(anterior.expiraEm) > agora.getTime();
  const retomar = /^(?:continuar|retomar) (?:a )?(?:emiss[aã]o|nota)[.!]?$/i.test(texto.trim())
    || (vigente && !encerrado(anterior.estado.status) && /^(?:continuar|retomar)[.!]?$/i.test(texto.trim()));
  const pedidoInicial = iniciar || ehPedidoDeEmissao(texto) || retomar;
  const codigoRecebido = lerConfirmacao(texto).ehConfirmacao;
  if (!vigente && !pedidoInicial && !codigoRecebido) return { tratado: false };
  if (vigente && instante(mensagem.registradaEm) < instante(anterior.ultimaMensagemEm)) {
    return { tratado: true, texto: "Essa mensagem chegou fora de ordem. Confira a última pergunta acima e responda novamente.", motivo: "COLETA_FORA_DE_ORDEM" };
  }
  if (vigente && encerrado(anterior.estado.status) && !pedidoInicial && !codigoRecebido) return { tratado: false };
  if (vigente && anterior.estado.status === "PAUSADO" && !pedidoInicial && !codigoRecebido && !interacao?.id?.startsWith("altan.issue.")) return { tratado: false };
  let estado = vigente && !encerrado(anterior.estado.status) ? limpar(anterior.estado) : null;
  let rascunhoId = anterior?.id || randomUUID();
  let versao = (anterior?.versao || 0) + 1;
  let pendenciaParaSalvar = null;
  let cancelarAnterior = !vigente && Boolean(anterior);
  let resultado;

  // Cliques de perguntas antigas não selecionam uma opção de outra revisão/tomador.
  if (interacao?.id?.startsWith("altan.issue.")) {
    const prefixo = `altan.issue.${anterior?.id}.${anterior?.versao}.`;
    if (!vigente || !interacao.id.startsWith(prefixo)) return { tratado: true, texto: "Essa opção é de uma etapa anterior. Responda à última pergunta ou escreva “emitir nota” para retomar.", motivo: "OPCAO_ANTIGA" };
    interacao = { ...interacao, id: decodeURIComponent(interacao.id.slice(prefixo.length)) };
  }
  if (!pausar) {
    const confirmacao = await confirmar({ conversa, mensagem, sessao, texto, agora, client, conferirAcesso, log,
      ...(servicos.executores ? { executores: servicos.executores } : {}), ...(servicos.acoesDeps ? { acoesDeps: servicos.acoesDeps } : {}) });
    if (confirmacao.tratado) {
      estado ||= mesmoEscopo ? limpar(anterior.estado) : iniciarColeta({ agora }).estado;
      const revisarNovamente = ["CONFIRMACAO_SUPERADA", "EXPIRADA"].includes(confirmacao.codigo);
      if (confirmacao.finalizada) estado.status = confirmacao.filaHumana ? "EQUIPE" : revisarNovamente ? "REVISAO" : "CONCLUIDO";
      if (revisarNovamente) delete estado.codigo;
      resultado = { ...confirmacao, motivo: confirmacao.codigo || "CONFIRMACAO_GUIADA" };
      if (confirmacao.codigo === "EXPIRADA" && !codigoRecebido && interpretarResposta({ estado, texto, interacao, agora }).invalidarConfirmacao) resultado = null;
    }
  }
  const deps = { ...SERVICOS_PADRAO, ...servicos, prisma: client, log };
  const contexto = { sessao, conversa, prisma: client, agora, log, janela: { aberta: true }, servicos: deps };
  if (!resultado) {
    let passo;
    if (pausar && estado) {
      estado.status = "PAUSADO";
      // Sair da coleta não deixa um código antigo armado no atendimento livre/humano.
      cancelarAnterior = true;
      resultado = { tratado: false, motivo: "COLETA_PAUSADA" };
    } else {
      if (!estado) {
        await conferirAcesso();
        cancelarAnterior = true;
        await client.acaoPendenteWhatsapp.updateMany({ where: { conversaId: conversa.id, status: "pendente" }, data: { status: "cancelada" } });
        const lista = await executar("tomadores_conhecidos", {}, contexto);
        passo = iniciarColeta({ agora, tomadores: lista?.ok ? lista.tomadores : [] });
        if (texto.trim() && !retomar) passo = interpretarResposta({ estado: passo.estado, texto, agora });
      } else {
        if (estado.status === "REVISAO" && !estado.codigo && pedidoInicial) passo = atualizarColeta({ estado });
        else if (estado.status === "PAUSADO" && pedidoInicial) {
          passo = interpretarResposta({ estado, texto: "retomar emissão", agora });
          if (/[:=]/.test(texto)) passo = interpretarResposta({ estado: passo.estado, texto, interacao, agora });
        } else passo = interpretarResposta({ estado, texto: retomar ? "emitir nota" : texto, interacao, agora });
      }
      cancelarAnterior ||= passo.invalidarConfirmacao === true;
      estado = passo.estado;
      if (cancelarAnterior) {
        // A correção recebida invalida o código mesmo se a consulta seguinte falhar ou reiniciar.
        await conferirAcesso();
        await client.acaoPendenteWhatsapp.updateMany({ where: { conversaId: conversa.id, status: "pendente" }, data: { status: "cancelada" } });
      }
      // Cada iteração é uma função determinística. Coleta nunca chama emitir diretamente.
      for (let i = 0; i < 4; i += 1) {
        if (passo.acao === "PREPARAR_TOMADOR") {
          await conferirAcesso();
          const tomadorPreparado = await deps.prepararTomadorDoCliente({ ...estado.dados, portalClientId: sessao.portalClientId }, deps);
          passo = atualizarColeta({ estado, tomadorPreparado, camposPendentes: tomadorPreparado.camposParaPerguntar ?? tomadorPreparado.campos });
          estado = passo.estado;
          if (passo.mensagem && tomadorPreparado.tomador?.nome && !passo.filaHumana) {
            passo.mensagem = `Tomador: ${tomadorPreparado.tomador.nome} (${estado.dados.tomadorDoc}).\n\n${passo.mensagem}`;
          }
          continue;
        }
        if (passo.acao === "PREPARAR_EMISSAO") {
          await conferirAcesso();
          let codigo = gerarCodigo();
          while (codigo === anterior?.estado?.codigo) codigo = gerarCodigo();
          const preparacao = await executar("preparar_emissao", estado.dados, { ...contexto, servicos: { ...deps,
            // Só captura o pedido validado. O banco recebe pendência + coleta + recibo juntos.
            criarPendencia: async (args) => {
              pendenciaParaSalvar = { ...args, codigo };
              const textoExato = `${String(args.corpo || "").trim()}\n\n${rodapeDeConfirmacao(codigo)}`;
              return { codigo, texto: textoExato };
            },
          } });
          if (preparacao.ok && pendenciaParaSalvar) {
            estado = { ...estado, status: "REVISAO", etapa: "REVISAO", codigo, origensFiscal: preparacao.origens?.fiscal || {} };
            resultado = { tratado: true, texto: `${preparacao.textoDeConfirmacao}\n\nPara corrigir, escreva por exemplo “corrigir valor: 1.250,00” ou “corrigir tomador”.`, motivo: "EMISSAO_REVISAR" };
            break;
          }
          if (preparacao.perfis?.length) {
            passo = atualizarColeta({ estado, perfis: preparacao.perfis });
          } else if (preparacao.motivo === "DADOS_TOMADOR_PENDENTES") {
            passo = atualizarColeta({ estado, tomadorPreparado: preparacao, camposPendentes: preparacao.camposParaPerguntar ?? preparacao.campos });
          } else {
            estado.status = "EQUIPE";
            resultado = { tratado: true, filaHumana: true, texto: "A equipe precisa conferir a configuração da emissão antes de continuar. Guardei os dados informados; você não precisa informar alíquotas ou códigos tributários.", motivo: preparacao.motivo || preparacao.codigo || "PREPARACAO_INDISPONIVEL" };
            break;
          }
          estado = passo.estado;
          continue;
        }
        break;
      }
      if (!resultado) {
        if (passo.acao === "PAUSAR") {
          cancelarAnterior = true;
          resultado = { tratado: passo.consumiu === true, texto: passo.mensagem, motivo: "COLETA_PAUSADA" };
        } else {
          cancelarAnterior ||= ["CANCELAR", "EQUIPE"].includes(passo.acao);
          resultado = { tratado: true, texto: passo.mensagem, opcoes: passo.opcoes || [], filaHumana: passo.acao === "EQUIPE", motivo: `EMISSAO_${passo.acao}` };
        }
      }
    }
  }
  if (!estado) return { tratado: false };
  if (resultado.filaHumana && estado.dados?.tomadorDoc) {
    const d = estado.dados;
    const resumo = [d.tomadorNome, d.tomadorDoc, d.descricao, d.valor != null ? Number(d.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null, d.competencia ? `competência ${d.competencia}` : null].filter(Boolean).join(" · ");
    resultado.texto += `\n\nDados coletados: ${resumo}`;
  }
  if (resultado.tratado && !resultado.texto) throw new Error("A coleta não produziu uma pergunta ou resposta.");
  resultado.opcoes = (resultado.opcoes || []).map(o => ({ ...o, id: `altan.issue.${rascunhoId}.${versao}.${encodeURIComponent(o.id)}` }));
  await conferirAcesso();
  return client.$transaction(async tx => {
    // Mesmo lock usado pela exclusão/handoff e criação de pendências do assistente.
    const ativa = await tx.conversaWhatsapp.updateMany({ where: {
      id: conversa.id, portalClientId: sessao.portalClientId, escopoVerificado: true,
      excluidaEm: null, atendidaPor: null, atendidaDesde: null,
      OR: [{ automacaoInvalidadaEm: null }, { automacaoInvalidadaEm: { lt: mensagem.registradaEm } }],
    }, data: { updatedAt: agora } });
    if (!ativa.count) throw erroEscopo();
    if (cancelarAnterior) await tx.acaoPendenteWhatsapp.updateMany({ where: { conversaId: conversa.id, status: "pendente" }, data: { status: "cancelada" } });
    if (pendenciaParaSalvar) {
      const { codigo, ...args } = pendenciaParaSalvar;
      let i = 0;
      await criarPendencia({ ...args, client: tx, rand: () => (ALFABETO.indexOf(codigo[i++]) + 0.5) / ALFABETO.length });
    }
    const data = { ...escopo, estado: limpar(estado), corteAutomacao: conversa.automacaoInvalidadaEm || null,
      versao, ultimaMensagemEm: mensagem.registradaEm, expiraEm: new Date(agora.getTime() + TTL_COLETA_MS) };
    if (anterior) {
      const gravado = await tx.rascunhoEmissaoWhatsapp.updateMany({ where: { id: anterior.id, versao: anterior.versao }, data });
      if (!gravado.count) throw Object.assign(new Error("A coleta mudou durante a resposta."), { codigo: "COLETA_CONCORRENTE" });
    } else await tx.rascunhoEmissaoWhatsapp.create({ data: { id: rascunhoId, ...data } });
    await tx.etapaEmissaoWhatsapp.create({ data: { mensagemId: mensagem.id, ...escopo, resultado: limpar(resultado) } });
    return resultado;
  });
}
