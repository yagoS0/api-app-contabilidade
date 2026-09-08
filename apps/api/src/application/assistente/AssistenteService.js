// Turnos duráveis, lease com posse, escopo verificado e guardas refeitas antes de cada efeito.
import { prisma } from "../../infrastructure/db/prisma.js";
import { IA_HISTORICO_MENSAGENS, INTEGRACAO_WHATSAPP_IA, IA_EMPRESAS_PILOTO, log as logPadrao } from "../../config.js";
import { adquirirLease, renovarLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
import { WhatsappCloudClient } from "../whatsapp/WhatsappCloudClient.js";
import { registrarMensagemEnviada, janelaDaConversa, DIRECAO } from "../whatsapp/ConversaWhatsappService.js";
import { SITUACOES_JANELA } from "../whatsapp/janela24h.js";
import { AssistenteClient } from "./AssistenteClient.js";
import { autorizarChamadaIa, concluirChamadaIa } from "./GuardaIaService.js";
import { montarSystem, MENSAGENS_FIXAS } from "./promptDoAssistente.js";
import { sessaoDoContato, fraseSemSessao, papelAlcanca, PAPEL_MINIMO_LEITURA, PAPEL_MINIMO_SITUACAO_FISCAL } from "./sessaoDoContato.js";
import { PERMISSOES_ASSISTENTE, temPermissaoAssistente } from "../whatsapp/permissoesAssistente.js";
import { decidirResposta, lerConfirmacao, FRASES } from "./confirmacaoPendente.js";
import { criarPendencia, pendenciaAberta, confirmarEExecutar, cancelarPendencia, marcarExpirada } from "./AcoesPendentesService.js";
import { definicoes, executarFerramenta, PERMISSAO_POR_FERRAMENTA } from "./ferramentas/index.js";

export const AUTOR = Object.freeze({ IA: "IA", HUMANO: "HUMANO", SISTEMA: "SISTEMA" });
const LOCK_TTL_MS = 90_000;
const compararMensagens = (a, b) => new Date(a.registradaEm) - new Date(b.registradaEm) || String(a.id || "").localeCompare(String(b.id || ""));

/** A mensagem `in` → um turno da API. Mídia vira uma frase entre colchetes (o modelo não a lê). */
function paraTurno(m) {
  if (m.direcao === DIRECAO.ENTRADA) {
    const texto = ["text", "interactive"].includes(m.tipo) ? String(m.corpo || "") : `[${m.tipo || "mídia"} recebida — sem texto]`;
    return { role: "user", content: texto || "[mensagem vazia]" };
  }
  const texto = String(m.corpo || "").trim();
  return { role: "assistant", content: texto || `[${m.tipo || "mensagem"} enviada]` };
}

/** Turnos consecutivos do mesmo papel são fundidos (a API exige alternância), e o primeiro é `user`. */
export function montarHistorico(mensagens, mensagemAtual = null) {
  // O worker pode começar depois de outras entradas/saídas. O pedido que disparou este turno
  // sempre termina o histórico; uma resposta posterior nunca vira prefixo de assistant.
  const anteriores = mensagemAtual
    ? (mensagens || []).filter(m => m.id !== mensagemAtual.id && compararMensagens(m, mensagemAtual) < 0)
    : (mensagens || []);
  const ordenadas = [...anteriores, ...(mensagemAtual ? [mensagemAtual] : [])].filter(m => m.direcao !== DIRECAO.SAIDA || !["enviando", "falhou", "indeterminado"].includes(m.statusEnvio)).sort(compararMensagens);
  const turnos = [];
  for (const m of ordenadas) {
    const t = paraTurno(m);
    if (mensagemAtual) {
      const data = new Date(m.registradaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      t.content = `[${m.id === mensagemAtual.id ? "Mensagem atual" : "Histórico"} · ${data}]\n${t.content}`;
    }
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === t.role) ultimo.content = `${ultimo.content}\n${t.content}`;
    else turnos.push(t);
  }
  while (turnos.length && turnos[0].role !== "user") turnos.shift();
  return turnos;
}

/**
 * @param {object} p
 * @param {string} p.conversaId
 * @param {string} p.mensagemId  a mensagem `in` que disparou o turno
 * @param {object} [p.deps]  injeção para teste: `{ client (prisma), cloud (WhatsappCloudClient), assistente (AssistenteClient), servicos, agora, log, rand }`
 * @returns {Promise<{feito:boolean, motivo?:string, texto?:string}>}
 */
export async function responderMensagem({ conversaId, mensagemId, deps = {} } = {}) {
  const r = await executarMensagem({ conversaId, mensagemId, deps });
  if (r.feito) {
    for (const id of r.mensagensRespondidas || [mensagemId]) {
      await (deps.client || prisma).mensagemWhatsapp.updateMany({
        where: { id: String(id), conversaId: String(conversaId), direcao: DIRECAO.ENTRADA, respondidaPelaIaEm: null },
        data: { respondidaPelaIaEm: new Date() },
      });
    }
  }
  return r;
}

async function executarMensagem({ conversaId, mensagemId, deps = {} } = {}) {
  const client = deps.client || prisma;
  const log = deps.log || logPadrao;
  const agora = deps.agora || new Date();
  const lockId = `ia:${conversaId}`;
  const turnoIaId = deps.turnoIaId || `mensagem:${mensagemId}`;
  let lock = null;
  let timer = null;
  let leaseValido = true;
  let houveSaida = false;
  let arquivosEnviados = 0;
  let encaminhamentoDoTurno = null;
  let mensagensRespondidas = [mensagemId];
  const concluir = (r) => ({ ...r, mensagensRespondidas });
  try {
    if (!deps.leaseExterno) {
      lock = deps.tryLock ? await deps.tryLock(lockId, LOCK_TTL_MS) : await adquirirLease(lockId, { client, ttlMs: LOCK_TTL_MS });
      if (!lock) return { feito: false, motivo: "FIO_OCUPADO" };
      if (!deps.tryLock) {
        timer = setInterval(() => renovarLease(lock, { client }).then((ok) => { leaseValido = ok; }).catch(() => { leaseValido = false; }), 20000);
        timer.unref?.();
      }
    }

    // 3. O fio, a pessoa, a empresa.
    const conversa = await client.conversaWhatsapp.findUnique({ where: { id: String(conversaId) }, include: { portalClient: { select: { id: true, razao: true, cnpj: true } } } });
    const mensagem = await client.mensagemWhatsapp.findUnique({ where: { id: String(mensagemId) } });
    if (!conversa || !mensagem || mensagem.conversaId !== conversa.id || mensagem.direcao !== DIRECAO.ENTRADA) return { feito: false, motivo: "NAO_ENCONTRADA" };
    if (mensagem.respondidaPelaIaEm) return { feito: false, motivo: "JA_RESPONDIDA" };
    const saidaAnterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId, direcao: DIRECAO.SAIDA } });
    if (saidaAnterior) return { feito: false, motivo: "SAIDA_ANTERIOR", indeterminado: true };
    const conferirPortao = async () => {
      await deps.conferirLease?.();
      if (!leaseValido) throw Object.assign(new Error("Reserva do turno expirada."), { codigo: "LEASE_PERDIDA" });
      const atual = await client.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
      const corte = atual?.automacaoInvalidadaEm ? new Date(atual.automacaoInvalidadaEm).getTime() : null;
      const recebidaEm = new Date(mensagem.registradaEm).getTime();
      const codigo = atual?.excluidaEm ? "CHAT_EXCLUIDO"
        : corte != null && (!Number.isFinite(recebidaEm) || recebidaEm <= corte) ? "AUTOMACAO_INVALIDADA"
        : !atual?.escopoVerificado || atual.portalClientId !== conversa.portalClientId ? "SEM_ESCOPO_VERIFICADO"
        : atual.atendidaPor || (atual.atendidaDesde && (!encaminhamentoDoTurno || new Date(atual.atendidaDesde).getTime() !== encaminhamentoDoTurno.getTime())) ? "ASSUMIDA_POR_HUMANO"
          : !(deps.flag ?? INTEGRACAO_WHATSAPP_IA) || !(deps.piloto ?? IA_EMPRESAS_PILOTO).includes(conversa.portalClientId) ? "FORA_DO_PILOTO" : null;
      if (codigo) throw Object.assign(new Error("O assistente foi suspenso nesta conversa."), { codigo });
    };
    await conferirPortao();
    const cloud = deps.cloud || new WhatsappCloudClient({ log });
    const dizer = async (texto, { autor = AUTOR.IA, tipo = "text" } = {}) => {
      const r = await enviarMensagemRastreada({ conversa, tipo, corpo: texto, autor, turnoIaId, client,
        antesDeEnviar: async () => {
          await conferirPortao();
          const atual = await janelaDaConversa(conversa.id, new Date());
          if (atual.situacao !== SITUACOES_JANELA.ABERTA) throw Object.assign(new Error("A janela de atendimento fechou."), { codigo: "FORA_DA_JANELA" });
        }, enviar: () => cloud.enviarTexto({ telefone: conversa.telefoneE164, texto }),
      });
      houveSaida = true;
      return r;
    };

    const carregarSessaoAtual = async () => {
      const contatos = conversa.portalClientId
        ? await client.contatoWhatsapp.findMany({ where: { portalClientId: conversa.portalClientId, ativo: true, OR: [{ telefoneE164: conversa.telefoneE164 }, { waId: conversa.telefoneE164 }] }, take: 2, select: { id: true, nome: true, userId: true, permissoesAssistente: true } })
        : [];
      const contato = contatos.length === 1 ? contatos[0] : null;
      const vinculoRbac = contato?.userId && conversa.portalClientId
        ? await client.companyClientUser.findUnique({ where: { companyId_userId: { companyId: conversa.portalClientId, userId: contato.userId } }, select: { role: true, status: true } })
        : null;
      return sessaoDoContato({ portalClientId: conversa.portalClientId, contato, vinculoRbac });
    };
    const sessao = await carregarSessaoAtual();
    if (!sessao.ok) {
      await dizer(fraseSemSessao(sessao.motivo), { autor: AUTOR.SISTEMA });
      return { feito: true, motivo: sessao.motivo };
    }
    const assinaturaDaSessao = (s) => JSON.stringify({
      ok: Boolean(s?.ok),
      userId: s?.userId || null,
      papel: s?.papel || null,
      permissoes: [...(s?.permissoesAssistente || [])].sort(),
    });
    const conferirSessaoNaoAlterada = async () => {
      await conferirPortao();
      const atual = await carregarSessaoAtual();
      if (assinaturaDaSessao(atual) !== assinaturaDaSessao(sessao)) {
        throw Object.assign(new Error("O acesso deste número mudou antes da resposta."), { codigo: "ACESSO_REVOGADO" });
      }
      return atual;
    };
    const encaminharParaEquipe = async () => {
      await conferirPortao();
      const quando = new Date();
      const r = await client.conversaWhatsapp.updateMany({ where: {
        id: conversa.id, portalClientId: conversa.portalClientId, escopoVerificado: true,
        excluidaEm: null, atendidaPor: null, atendidaDesde: null,
        OR: [{ automacaoInvalidadaEm: null }, { automacaoInvalidadaEm: { lt: mensagem.registradaEm } }],
      }, data: { atendidaDesde: quando } });
      if (!r.count) throw Object.assign(new Error("A conversa mudou antes do encaminhamento."), { codigo: "AUTOMACAO_INVALIDADA" });
      encaminhamentoDoTurno = quando;
    };
    const encaminharFalha = async () => {
      await encaminharParaEquipe();
      // O encaminhamento fica persistido mesmo se o aviso pela Meta falhar.
      await dizer(arquivosEnviados
        ? "O envio do arquivo já foi concluído. Não consegui finalizar o restante da resposta e encaminhei a conversa para a equipe continuar por aqui."
        : MENSAGENS_FIXAS.ERRO_MODELO, { autor: AUTOR.SISTEMA });
    };

    // Bolhas já recebidas pertencem ao mesmo pedido até a primeira resposta ou interação.
    // O limite impede que uma conversa contínua adie o atendimento indefinidamente.
    const seguintes = mensagem.tipo === "text" ? await client.mensagemWhatsapp.findMany({
      where: { conversaId: conversa.id, registradaEm: { gte: mensagem.registradaEm, lte: new Date(new Date(mensagem.registradaEm).getTime() + 8000) } },
      orderBy: [{ registradaEm: "asc" }, { id: "asc" }], take: 12,
    }) : [];
    const bolhas = [mensagem];
    for (const m of seguintes.filter(m => m.id !== mensagem.id && m.conversaId === conversa.id && new Date(m.registradaEm) >= new Date(mensagem.registradaEm) && new Date(m.registradaEm).getTime() <= new Date(mensagem.registradaEm).getTime() + 8000).sort(compararMensagens)) {
      if (m.direcao === DIRECAO.SAIDA && m.turnoIaId === `menu-inicio:${mensagem.id}`) continue;
      if (m.direcao !== DIRECAO.ENTRADA || m.tipo !== "text" || m.respondidaPelaIaEm) break;
      bolhas.push(m);
    }
    bolhas.sort(compararMensagens);
    mensagensRespondidas = bolhas.map(m => m.id);
    const confirmacoes = bolhas.map(m => lerConfirmacao(m.corpo));
    const somenteMesmaConfirmacao = confirmacoes.every(c => c.ehConfirmacao && c.codigo === confirmacoes[0].codigo);
    const confirmacaoComComplemento = bolhas.length > 1 && confirmacoes.some(c => c.ehConfirmacao) && !somenteMesmaConfirmacao;
    const pedidoAtual = { ...bolhas.at(-1), corpo: bolhas.map(m => m.corpo || "").join("\n") };
    await conferirPortao();

    // 4. A pendência — lida pela regex, ANTES do modelo.
    let pendente = await pendenciaAberta(conversa.id, { client });
    const ehTexto = mensagem.tipo === "text";
    if (confirmacaoComComplemento) {
      // Uma confirmação seguida de correção já recebida não autoriza executar o resumo antigo.
      await dizer("Recebi outras mensagens junto com a confirmação e não executei o pedido. Vamos conferir as alterações antes de confirmar novamente.", { autor: AUTOR.SISTEMA });
      if (pendente) await cancelarPendencia(pendente.id, { client });
      pendente = null;
    }
    if (pendente) {
      const d = decidirResposta({ texto: ehTexto ? (somenteMesmaConfirmacao ? mensagem.corpo : pedidoAtual.corpo) : "", pendente, agora });
      if (d.decisao === "EXPIRADA") {
        await marcarExpirada(pendente.id, { client });
        await dizer(FRASES.EXPIRADA, { autor: AUTOR.SISTEMA });
        return concluir({ feito: true, motivo: "EXPIRADA" });
      }
      if (d.decisao === "EXECUTAR") {
        await conferirPortao();
        const posterior = await client.mensagemWhatsapp.findFirst({ where: { conversaId: conversa.id, direcao: DIRECAO.ENTRADA, respondidaPelaIaEm: null, registradaEm: { gt: pedidoAtual.registradaEm } }, orderBy: { registradaEm: "asc" } });
        if (posterior && (!lerConfirmacao(posterior.corpo).ehConfirmacao || lerConfirmacao(posterior.corpo).codigo !== pendente.codigo)) {
          await cancelarPendencia(pendente.id, { client });
          await dizer("Recebi uma nova mensagem depois da confirmação e não executei o pedido. Vou conferir essa mensagem antes de preparar uma nova confirmação.", { autor: AUTOR.SISTEMA });
          return concluir({ feito: true, motivo: "CONFIRMACAO_SUPERADA" });
        }
        // ⚠ `conversaId` e `portalClientId` vão na reserva: a pendência de um fio nunca é
        // confirmada por outro, nem executada depois de o fio mudar de empresa.
        const r = await confirmarEExecutar({ acaoId: pendente.id, conversaId: conversa.id, portalClientId: conversa.portalClientId, agora, client, log, executores: deps.executores || null, ...(deps.acoesDeps ? { deps: deps.acoesDeps } : {}) });
        if (r.filaHumana) await encaminharParaEquipe();
        await dizer(r.texto, { autor: AUTOR.SISTEMA });
        return concluir({ feito: true, motivo: "EXECUTADA", texto: r.texto });
      }
      if (d.decisao === "CODIGO_ERRADO") {
        await dizer(FRASES.CODIGO_ERRADO(pendente.codigo), { autor: AUTOR.SISTEMA });
        return concluir({ feito: true, motivo: "CODIGO_ERRADO" });
      }
      if (d.decisao === "LEMBRAR_CONFIRMACAO") {
        await dizer(FRASES.LEMBRAR_CONFIRMACAO(pendente.codigo), { autor: AUTOR.SISTEMA });
        return concluir({ feito: true, motivo: "LEMBRAR_CONFIRMACAO" });
      }
      if (d.decisao === "CANCELAR") {
        await cancelarPendencia(pendente.id, { client });
        await dizer(FRASES.CANCELADA, { autor: AUTOR.SISTEMA });
        return concluir({ feito: true, motivo: "CANCELADA" });
      }
    } else if (!confirmacaoComComplemento && lerConfirmacao(pedidoAtual.corpo).ehConfirmacao) {
      await dizer(FRASES.SEM_PENDENCIA, { autor: AUTOR.SISTEMA });
      return concluir({ feito: true, motivo: "SEM_PENDENCIA" });
    }

    // 5. Mídia ⇒ frase fixa. Texto ⇒ modelo.
    if (!ehTexto) {
      await dizer(MENSAGENS_FIXAS.SO_TEXTO, { autor: AUTOR.SISTEMA });
      return concluir({ feito: true, motivo: "SO_TEXTO" });
    }

    const guarda = await autorizarChamadaIa({ portalClientId: conversa.portalClientId, conversaId: conversa.id, mensagemId: mensagem.id, finalidade: "assistente_whatsapp", agora, client, log, ...(deps.chaveIa !== undefined ? { chave: deps.chaveIa } : {}) });
    if (!guarda.ok) {
      await encaminharFalha();
      return concluir({ feito: true, motivo: guarda.motivo });
    }

    const janela = await janelaDaConversa(conversa.id, agora);
    const inicioPedido = bolhas[0];
    const historico = await client.mensagemWhatsapp.findMany({ where: { conversaId: conversa.id, OR: [
      { registradaEm: { lt: inicioPedido.registradaEm } }, { registradaEm: inicioPedido.registradaEm, id: { lt: inicioPedido.id } },
    ] }, orderBy: [{ registradaEm: "desc" }, { id: "desc" }], take: IA_HISTORICO_MENSAGENS });
    const messages = montarHistorico(historico.filter(m => !mensagensRespondidas.includes(m.id)), pedidoAtual);
    const system = montarSystem({ empresa: conversa.portalClient, sessao, pendencia: pendente, confirmacaoComComplemento, janela: { aberta: janela.situacao === SITUACOES_JANELA.ABERTA }, hoje: agora });

    const pendenciasDoTurno = [];
    let chamouEscritorio = null;
    const documentosTentados = new Map();
    const ctx = {
      sessao, conversa, prisma: client, servicos: {
        ...(deps.servicos || {}),
        criarPendencia: async (args) => {
          await conferirPortao();
          return client.$transaction(async (tx) => {
            // Lock da conversa serializa criação da pendência com sua exclusão e cancelamento.
            const ativa = await tx.conversaWhatsapp.updateMany({ where: {
              id: conversa.id, portalClientId: conversa.portalClientId, escopoVerificado: true,
              excluidaEm: null, atendidaPor: null, atendidaDesde: null,
              OR: [{ automacaoInvalidadaEm: null }, { automacaoInvalidadaEm: { lt: mensagem.registradaEm } }],
            }, data: { updatedAt: new Date() } });
            if (!ativa.count) throw Object.assign(new Error("A conversa mudou antes de preparar o pedido."), { codigo: "AUTOMACAO_INVALIDADA" });
            return (deps.servicos?.criarPendencia || criarPendencia)({ ...args, client: tx });
          });
        },
      }, janela: { aberta: janela.situacao === SITUACOES_JANELA.ABERTA }, agora, log,
      enviarDocumento: async ({ conteudo, nomeArquivo, legenda, mimeType, guideId, notaId, documentId, situacaoFiscal = false }) => {
        const chaveDocumento = `${guideId || ""}:${notaId || ""}:${documentId || ""}:${nomeArquivo || ""}`;
        if (documentosTentados.has(chaveDocumento)) return documentosTentados.get(chaveDocumento);
        const ehImagem = String(mimeType || "").toLowerCase().startsWith("image/");
        const tentativa = enviarMensagemRastreada({ conversa, tipo: ehImagem ? "image" : "document", corpo: legenda || nomeArquivo, autor: AUTOR.IA, turnoIaId, client,
          antesDeEnviar: async () => {
            await conferirPortao();
            const atual = await carregarSessaoAtual();
            const permissao = situacaoFiscal ? PERMISSOES_ASSISTENTE.SITUACAO_FISCAL : guideId ? PERMISSOES_ASSISTENTE.GUIAS
              : notaId ? PERMISSOES_ASSISTENTE.NOTAS_DANFSE
                : PERMISSOES_ASSISTENTE.DOCUMENTOS_EMPRESA;
            const papelMinimo = (documentId || situacaoFiscal) ? PAPEL_MINIMO_SITUACAO_FISCAL : PAPEL_MINIMO_LEITURA;
            if (!atual.ok || atual.userId !== sessao.userId || !temPermissaoAssistente(atual, permissao) || !papelAlcanca(atual.papel, papelMinimo)) {
              throw Object.assign(new Error("O acesso deste número mudou antes do envio."), { codigo: "ACESSO_REVOGADO" });
            }
            const janelaAtual = await janelaDaConversa(conversa.id, new Date());
            if (janelaAtual.situacao !== SITUACOES_JANELA.ABERTA) throw Object.assign(new Error("Janela fechada."), { codigo: "FORA_DA_JANELA" });
          }, enviar: () => ehImagem
            ? cloud.enviarImagem({ telefone: conversa.telefoneE164, conteudo, nomeArquivo, legenda, mimeType })
            : cloud.enviarDocumento({ telefone: conversa.telefoneE164, conteudo, nomeArquivo, legenda, mimeType }),
        });
        documentosTentados.set(chaveDocumento, tentativa);
        const r = await tentativa;
        houveSaida = true;
        arquivosEnviados += 1;
        return r;
      },
      registrarPendencia: (p) => pendenciasDoTurno.push(p),
      registrarChamadaAoEscritorio: (p) => { chamouEscritorio = p; },
    };

    const assistente = deps.assistente || new AssistenteClient({ log });
    let resposta;
    let iniciouModelo = false;
    try {
      await conferirPortao();
      iniciouModelo = true;
      resposta = await assistente.responder({ system, messages, ferramentas: definicoes(sessao), executar: async (nome, input) => {
        await conferirPortao();
        const atual = await carregarSessaoAtual();
        const sessaoDaFerramenta = atual.userId === sessao.userId ? atual : { ...atual, ok: false };
        return executarFerramenta(nome, input, { ...ctx, sessao: sessaoDaFerramenta });
      } });
    } catch (err) {
      await concluirChamadaIa(guarda.contexto, { usage: iniciouModelo ? err?.usage : { input_tokens: 0, output_tokens: 0 }, usageCompleto: !iniciouModelo, iteracoes: err?.iteracoes, ferramentas: err?.ferramentasChamadas, erroCodigo: err?.codigo || "IA_ERRO", erroMensagem: err?.message }, { client, log });
      if (!iniciouModelo) throw err;
      log?.error?.({ conversaId: conversa.id, mensagemId: mensagem.id, codigo: err?.codigo, err: err?.message, diagnostico: err?.diagnostico, modelo: assistente.modelo, iteracoes: err?.iteracoes, ferramentas: err?.ferramentasChamadas }, "assistente: o modelo não respondeu");
      await encaminharFalha();
      return concluir({ feito: true, motivo: err?.codigo || "IA_ERRO" });
    }
    await concluirChamadaIa(guarda.contexto, { usage: resposta.usage, iteracoes: resposta.iteracoes, ferramentas: resposta.ferramentasChamadas, stopReason: resposta.stopReason }, { client, log });

    if (resposta.recusou || ["max_tokens", "max_iteracoes"].includes(resposta.stopReason) || (!resposta.texto?.trim() && !houveSaida && !pendenciasDoTurno.length)) {
      await encaminharFalha();
      return concluir({ feito: true, motivo: "RESPOSTA_INCOMPLETA" });
    }

    // 6. A resposta — e, se houve pendência, o texto de confirmação EXATO como segunda mensagem.
    if (chamouEscritorio) await encaminharParaEquipe();
    const texto = (resposta.texto || "").trim();
    if (texto) {
      // A ferramenta pode ter lido dados e a autorização ser retirada enquanto o modelo redige a
      // frase final. Reconfere o mesmo usuário, papel e conjunto de permissões antes de liberar o
      // texto; em caso de mudança, uma reentrega inicia um turno novo com o acesso atual.
      const usouDados = (resposta.ferramentasChamadas || []).some((nome) => PERMISSAO_POR_FERRAMENTA[nome]);
      if (usouDados) {
        await conferirSessaoNaoAlterada();
      }
      await dizer(texto, { autor: AUTOR.IA });
    }
    for (const p of pendenciasDoTurno) {
      // O código confirma um ato fiscal real. A autorização é conferida novamente imediatamente
      // antes de cada envio, inclusive quando o modelo devolve texto vazio.
      await conferirSessaoNaoAlterada();
      await dizer(p.texto, { autor: AUTOR.SISTEMA });
    }
    if (chamouEscritorio) {
      await conferirPortao();
      await registrarMensagemEnviada({ telefone: conversa.telefoneE164, portalClientId: conversa.portalClientId, tipo: "text", corpo: `[pedido de atendimento humano] ${chamouEscritorio.motivo}`, autor: AUTOR.SISTEMA }).catch(() => {});
    }
    return concluir({ feito: true, motivo: "RESPONDIDA", texto });
  } catch (err) {
    log?.error?.({ conversaId, mensagemId, err: err?.message }, "assistente: TURNO FALHOU");
    return { feito: false, motivo: err?.codigo || "ERRO", erro: err?.message, indeterminado: Boolean(err?.indeterminado || houveSaida) };
  } finally {
    clearInterval(timer);
    if (lock) {
      if (deps.releaseLock) await deps.releaseLock(lockId);
      else await liberarLease(lock, { client });
    }
  }
}
