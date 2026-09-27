// AS CONVERSAS DE WHATSAPP — as rotas do escritório para a tela mínima (F5, 02/09/2026). Mount: `/firm`.
//
// O que a tela precisa e o serviço já tinha (`ConversaWhatsappService`): a fila de não vinculados
// (`conversasNaoVinculadas`), o fio (`listarMensagens`, escopado), a janela (`janelaDaConversa`) e a
// atribuição (`atribuirConversa`). O que faltava era a PORTA — e três verbos novos: ASSUMIR (a IA
// pausa), DEVOLVER (a IA volta) e RESPONDER (texto livre, só dentro da janela de 24h).
//
// ── ⚠ MULTI-TENANCY ────────────────────────────────────────────────────────────────────────────
// Toda conversa VINCULADA só é alcançável se `portalClientId` estiver em `empresasVisiveis(req)` —
// o mesmo critério do calendário, das obrigações e do lote de guias. As NÃO vinculadas
// (`portalClientId` nulo) são a fila do escritório: quem enxerga é `admin|contador`, porque não há
// empresa a que restringir.
//
// ── ⚠ RESPONDER É MENSAGEM DE SERVIÇO ──────────────────────────────────────────────────────────
// Fora da janela de 24h a Meta recusa texto livre (131047). A rota recusa ANTES, com 409 e o
// motivo, e diz o caminho: o template `reabrir_conversa` — que hoje está `DECLARADO` (não
// aprovado), então a resposta nomeia isso em vez de fingir que existe um botão.

import { criarRecursosComerciais } from "../../application/onboarding/RecursosComerciaisService.js";
import { resolverConversaEnvioComercial } from "../../application/onboarding/CanalEnvioComercialService.js";
import { Router } from "express";
import multer from "multer";
import { validarAnexoManual } from "../../application/whatsapp/anexoManual.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { empresasVisiveis } from "./empresasVisiveis.js";
import {
  ConversaWhatsappError,
  conversasNaoVinculadas,
  listarMensagens,
  janelaDaConversa,
  atribuirConversa,
  registrarMensagemEnviada,
  FILTRO_FILA_WHATSAPP,
  pertenceAFilaWhatsapp,
  alterarExclusaoConversa,
} from "../../application/whatsapp/ConversaWhatsappService.js";
import { salvarContato, ContatoWhatsappError } from "../../application/whatsapp/ContatoWhatsappService.js";
import { resolverVinculoPorTelefone } from "../../application/whatsapp/ContatoWhatsappService.js";
import { SITUACOES_JANELA } from "../../application/whatsapp/janela24h.js";
import { WhatsappCloudClient, WhatsappError, mascararTelefone } from "../../application/whatsapp/WhatsappCloudClient.js";
import { baixarBuffer, CompanyDocumentError } from "../../application/companies/CompanyDocumentsService.js";
import { pendenciaAberta } from "../../application/assistente/AcoesPendentesService.js";
import { consumoIaDoMes } from "../../application/assistente/GuardaIaService.js";
import { resumoWhatsapp } from "../../application/whatsapp/resumoWhatsapp.js";
import { enviarMensagemRastreada } from "../../application/whatsapp/SaidaWhatsappService.js";
import { assinarMensagemHumana } from "../../application/whatsapp/assinaturaAtendente.js";
import { INCLUDE_CONVERSA, grupoNoEscopo, resumoDoGrupo, filtroMensagensDoGrupo, empresaDaMensagem } from "./whatsappAtendimento.js";
import { WHATSAPP_CHAT_V2 } from '../../config.js';
import { listarInboxWhatsapp, resumoInboxWhatsapp, lerHistoricoIdentidade, registrarLeituraIdentidade, salvarNotaInterna, carregarGrupoIdentidade, buscarMensagensIdentidade, filtroMensagensIdentidade } from '../../application/whatsapp/InboxWhatsappService.js';
import { conferirIdentificacao, conferirIdentidadeVigente } from '../../application/whatsapp/IdentidadeComunicacaoService.js';
import { whatsappPorCanal } from '../../application/whatsapp/CanalWhatsappService.js';
import { associarNumeroConferido } from '../../application/whatsapp/AssociacaoNumeroComunicacaoService.js';

import { comIntencaoEnvio, consultarIntencaoEnvio, recuperarIntencaoEnvio, erroAtendimento } from '../../application/whatsapp/IntencaoEnvioAtendimentoService.js';
import { lerRascunhoAtendimento, salvarRascunhoAtendimento, excluirRascunhoAtendimento } from '../../application/whatsapp/RascunhoAtendimentoService.js';
import { prepararRetomadaAtendimento } from '../../application/whatsapp/RetomadaAtendimentoService.js';
import { enriquecerMensagensWhatsapp, obterArquivoDaMensagem, salvarArquivoManual } from '../../application/whatsapp/HistoricoArquivoWhatsappService.js';

export const AUTOR_HUMANO = "HUMANO";

function somenteAdminOuContador(req, res) {
  const appRole = String(req.auth?.user?.role || "").toLowerCase();
  if (["admin", "contador"].includes(appRole)) return true;
  res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
  return false;
}

/** A conversa, DENTRO do escopo do usuário — ou null (404, nunca 403: a existência do fio de outra carteira não é informação). */
async function conversaNoEscopo(req, conversaId, { client = prisma } = {}) {
  const conversa = await client.conversaWhatsapp.findUnique({
    where: { id: String(conversaId) },
    include: INCLUDE_CONVERSA,
  });
  if (!conversa) return null;
  if (conversa.vinculoNumeroId) {
    try { await carregarGrupoIdentidade({ conversaId: conversa.id, visiveis: await empresasVisiveis(req), client }); return conversa; }
    catch (err) { if (err.status === 404) return null; throw err; }
  }
  // A fila de leads é pública ao escritório; recibos neutros de responsáveis conhecidos não são.
  if (!conversa.portalClientId) return !conversa.atendimentoId && pertenceAFilaWhatsapp(conversa) ? conversa : null;
  const visiveis = await empresasVisiveis(req);
  return visiveis.includes(conversa.portalClientId) ? conversa : null;
}

/**
 * ⚠⚠ OS LIMITES PARAM DE TRUNCAR EM SILÊNCIO (06/09/2026).
 *
 * Antes eram `take: 200` nos dois lugares, e mais nada: um fio com 300 mensagens mostrava 200 **sem
 * avisar**, e o contador lia como se fosse a conversa inteira. Ausência virando afirmação — a mesma
 * família do "0 achados" × "não dá para conferir" que a auditoria de notas já documenta.
 *
 * O conserto barato é pedir UM a mais do que se mostra: sobrou o extra, há mais. `temMais` sobe na
 * resposta e a tela DIZ. ⚠ Cursor de verdade fica para quando existir conversa longa — o que não se
 * pode é continuar cortando calado.
 */
const LIMITE_CONVERSAS = 200;
const LIMITE_MENSAGENS = 200;

function resumoDaConversa(c, { ultima = null, janela = null, pendencia = null, naoLidas = 0, contato = null } = {}) {
  return {
    id: c.id,
    telefoneE164: c.telefoneE164,
    telefoneMascarado: mascararTelefone(c.telefoneE164),
    nomePerfilProvedor: c.nomePerfilProvedor || null,
    // ⚠⚠ O NOME DO CADASTRO, e ele NÃO existia neste payload (06/09/2026).
    //
    // Sem ele a tela só tinha `nomePerfilProvedor` — que é o nome que a PRÓPRIA PESSOA escreveu no
    // aparelho dela, e pode ser qualquer coisa. A linha da lista então escolhia entre a empresa e o
    // nome do perfil com um `||`, e numa conversa de cliente o contador via a empresa e **nunca
    // sabia quem estava falando**. São duas perguntas — *quem* e *de quem* —, e uma não substitui a
    // outra.
    //
    // ⚠ A autoridade sobre o nome é o CADASTRO (`contatos_whatsapp`), como já é para o vínculo: o
    // nome de perfil nunca casa contato, e aqui ele também não manda.
    contato: contato ? { id: contato.id, nome: contato.nome, papel: contato.papel || null } : null,
    portalClientId: c.portalClientId || null,
    escopoVerificado: c.escopoVerificado === true,
    legadoNaoVerificado: Boolean(c.portalClientId && c.escopoVerificado !== true),
    empresa: c.portalClient ? { id: c.portalClient.id, razao: c.portalClient.razao, cnpj: c.portalClient.cnpj, apelidosWhatsapp: c.portalClient.apelidosWhatsapp || [] } : null,
    atendidaPor: c.atendidaPor || null,
    atendente: c.atendente ? { id: c.atendente.id, nome: c.atendente.name || null, email: c.atendente.email || null } : null,
    atendidaDesde: c.atendidaDesde || null,
    /** `atendidaDesde` sem `atendidaPor` = o assistente chamou o escritório (a fila humana). */
    naFilaDoEscritorio: Boolean(c.atendidaDesde && !c.atendidaPor),
    lidaAteEm: c.lidaAteEm || null,
    excluidaEm: c.excluidaEm || null,
    updatedAt: c.updatedAt,
    ultimaMensagem: ultima ? { direcao: ultima.direcao, tipo: ultima.tipo, corpo: ultima.corpo, registradaEm: ultima.registradaEm, autor: ultima.autor || null, empresa: ultima.empresa || null } : null,
    naoLidas,
    janela: janela ? { situacao: janela.situacao, permite: janela.permite, expiraEm: janela.expiraEm, avisos: janela.avisos } : null,
    pendencia: pendencia ? { id: pendencia.id, tipo: pendencia.tipo, codigo: pendencia.codigo, expiraEm: pendencia.expiraEm } : null,
  };
}

export function createWhatsappConversasRouter({ log, client = prisma, cloud = null, chatV2 = WHATSAPP_CHAT_V2, consultarModelo = null } = {}) {
  const router = Router({ mergeParams: true });
  router.use((_req,res,next) => { res.set('Cache-Control','no-store'); next(); });

  router.post("/whatsapp/empresas/:portalClientId/apelidos", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    try {
      const portalClientId = String(req.params.portalClientId);
      if (!(await empresasVisiveis(req)).includes(portalClientId)) return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      const valores = req.body?.apelidos;
      if (!Array.isArray(valores) || valores.length > 5 || valores.some(v => typeof v !== "string" || v.trim().length < 2 || v.trim().length > 60 || /[\r\n\x00-\x1f]/.test(v))) {
        return res.status(400).json({ ok: false, error: "apelidos_invalidos", message: "Informe até cinco nomes curtos, cada um com 2 a 60 caracteres." });
      }
      const apelidos = [...new Map(valores.map(v => [v.trim().toLocaleLowerCase("pt-BR"), v.trim()])).values()];
      const empresa = await client.portalClient.update({ where: { id: portalClientId }, data: { apelidosWhatsapp: apelidos }, select: { id: true, apelidosWhatsapp: true } });
      return res.json({ ok: true, empresa });
    } catch (err) { return falhar(res, err, { operacao: "apelidos-whatsapp" }); }
  });

  router.get("/whatsapp/resumo", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    try {
      const resumo = await (chatV2 ? resumoInboxWhatsapp : resumoWhatsapp)(await empresasVisiveis(req), { client });
      return res.json({ ok: true, resumo });
    } catch (err) {
      return falhar(res, err, { operacao: "resumo" });
    }
  });

  function falhar(res, err, contexto) {
    const codigo = err?.codigo || err?.code;
    if (err.intencao && !err.status) return res.status(409).json({ok:false,error:codigo || 'ENVIO_INDETERMINADO',message:err.indeterminado ? 'Envio sem confirmação. Consulte esta tentativa antes de reenviar.' : 'Confira o resultado desta tentativa.',intencao:err.intencao});
    if (err?.status && [400,403,404,409,410,413,422,503].includes(err.status)) return res.status(err.status).json({ ok: false, error: codigo, message: err.message, ...(err.intencao ? { intencao: err.intencao } : {}) });
    if (codigo === "FORA_DA_JANELA" && err.janela) return recusarForaDaJanela(res, err.janela);
    if (["FIO_OCUPADO", "LEASE_PERDIDA", "CONTEXTO_INVALIDO", "CONTEXTO_CONCORRENTE", "EMPRESA_NAO_E_CANDIDATA", "ACESSO_REVOGADO", "AUTOMACAO_INVALIDADA", "CONTEXTO_ALTERADO"].includes(codigo)) return res.status(409).json({ ok: false, error: codigo, message: err.message });
    if (err?.code === "CHAT_EXCLUIDO") return res.status(409).json({ ok: false, error: err.code, message: err.message });
    if (["CONTEXTO_ALTERADO", "EMPRESA_NAO_AUTORIZADA", "VINCULO_AMBIGUO", "ATENDIMENTO_OCUPADO"].includes(err?.code)) return res.status(409).json({ ok: false, error: err.code, message: err.message });
    if (err instanceof ConversaWhatsappError || err instanceof ContatoWhatsappError) {
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    if (err instanceof WhatsappError) {
      return res.status(422).json({ ok: false, error: err.codigo, message: err.mensagemUsuario, podeTentarDeNovo: err.podeTentarDeNovo });
    }
    // O documento que nao esta nesta empresa e 404 NOMEADO, nunca 500: sem isto a recusa de escopo
    // sairia como "erro interno" e a tela mandaria o contador tentar de novo.
    if (err instanceof CompanyDocumentError) {
      return res.status(err.status || 400).json({ ok: false, error: err.code, message: err.message });
    }
    log?.error?.({ err: err?.message || err, ...contexto }, "Falha nas conversas de WhatsApp");
    return res.status(500).json({ ok: false, error: "erro_interno", message: "Erro interno." });
  }

  async function conferirConversaAtiva(conversa, { porPessoa = false } = {}) {
    if (conversa.vinculoNumeroId) await conferirIdentidadeVigente({ vinculoNumeroId: conversa.vinculoNumeroId, telefone: conversa.telefoneE164, permitirRevisao: porPessoa, client });
    const atual = await client.conversaWhatsapp.findUnique({ where: { id: conversa.id } });
    const instante = (valor) => valor == null ? null : new Date(valor).getTime();
    if (!atual || atual.excluidaEm || instante(atual.automacaoInvalidadaEm) !== instante(conversa.automacaoInvalidadaEm)) {
      throw new ConversaWhatsappError("CHAT_EXCLUIDO", "A conversa foi excluída durante esta ação. Atualize o atendimento antes de continuar.");
    }
    if (conversa.atendimentoId) {
      const atendimento = await client.atendimentoResponsavelWhatsapp.findUnique({ where: { id: conversa.atendimentoId } });
      if (!atendimento || (!porPessoa && (atendimento.aguardandoSelecao || atendimento.conversaId !== conversa.id
        || atendimento.portalClientId !== conversa.portalClientId
        || (atendimento.expiraEm && new Date(atendimento.expiraEm).getTime() <= Date.now())
        || atendimento.versao !== conversa.atendimento?.versao))) {
        throw new ConversaWhatsappError("CONTEXTO_ALTERADO", "A empresa deste atendimento mudou. Escolha a empresa e confira a mensagem antes de enviar.");
      }
      if (!conversa.portalClientId && porPessoa && conversa.vinculoNumeroId) return;
      const { empresasParaComunicacao } = await import("../../application/whatsapp/comunicacaoDoContato.js");
      const acesso = empresasParaComunicacao(await resolverVinculoPorTelefone(conversa.telefoneE164, { client }));
      if (acesso.bloqueado || !acesso.empresas.some(e => e.portalClientId === conversa.portalClientId)) {
        throw new ConversaWhatsappError("ACESSO_REVOGADO", "O vínculo deste responsável com a empresa mudou. Confira o cadastro antes de enviar.");
      }
    }
  }

  async function alterarHumano(conversa, atendidaPor, atendidaDesde, {preservarContextoOperacional=false}={}) {
    if (atendidaPor && conversa.atendidaPor && conversa.atendidaPor !== atendidaPor) throw erroAtendimento('ATENDIMENTO_OCUPADO', 'Outro atendente assumiu esta conversa. Combine a transferência antes de responder.');
    if (atendidaPor && conversa.atendidaPor === atendidaPor) return null;
    if (conversa.atendimentoId) {
      const { alterarAtendimentoHumano } = await import("../../application/whatsapp/AtendimentoResponsavelWhatsappService.js");
      return alterarAtendimentoHumano({ conversa, atendidaPor, atendidaDesde, preservarResponsavel: true, preservarContextoOperacional, client });
    }
    const mudou = await client.conversaWhatsapp.updateMany({
      where: { id: conversa.id, excluidaEm: null, automacaoInvalidadaEm: conversa.automacaoInvalidadaEm || null, atendidaPor: conversa.atendidaPor || null },
      data: { atendidaPor, atendidaDesde, automacaoInvalidadaEm: new Date() },
    });
    if (!mudou.count) throw new ConversaWhatsappError("CHAT_EXCLUIDO", "A conversa mudou durante esta ação. Atualize o atendimento.");
    await client.turnoIaWhatsapp.updateMany({where:{conversaId:conversa.id,status:{in:['pendente','falhou','processando']}},data:{status:'ignorado',motivo:'ASSUMIDA_POR_HUMANO',reservaToken:null,leaseAte:null,concluidoEm:new Date()}});
    await client.acaoPendenteWhatsapp.updateMany({where:{conversaId:conversa.id,status:'pendente'},data:{status:'cancelada'}});
    return null;
  }

  async function assumirParaEnvio(req, conversa, opcoes={}) {
    await alterarHumano(conversa, String(req.auth.user.id), new Date(),opcoes);
    const atual = await conversaNoEscopo(req, conversa.id, { client });
    if (!atual) throw erroAtendimento('conversa_nao_encontrada', 'Conversa não encontrada.', 404);
    return atual;
  }

  const recuperarIntencao = (req,conversa,payload) => recuperarIntencaoEnvio({userId:String(req.auth.user.id),clientRequestId:req.body?.clientRequestId,conversa,payload,client});
  const enviarIntencao = (req, conversa, payload, enviar) => comIntencaoEnvio({ userId: String(req.auth.user.id), clientRequestId: req.body?.clientRequestId, conversa, payload, enviar, client });

  async function comEnvioDoResponsavel(conversa, enviar) {
    if (!conversa.atendimentoId) return enviar(async () => true);
    const { comLeaseDoAtendimento } = await import("../../application/whatsapp/AtendimentoResponsavelWhatsappService.js");
    return comLeaseDoAtendimento({ conversa, client }, enviar);
  }

  async function conferirEnvio(conversa, conferirLease, opcoes = {}) {
    if (await conferirLease() === false) throw new ConversaWhatsappError("ATENDIMENTO_OCUPADO", "Outro envio está em andamento para este responsável. Atualize o atendimento antes de tentar novamente.");
    await conferirConversaAtiva(conversa, opcoes);
    const dono = await client.conversaWhatsapp.findUnique({where:{id:conversa.id},select:{atendidaPor:true}});
    if (!dono?.atendidaPor || dono.atendidaPor !== conversa.atendidaPor) throw erroAtendimento('ATENDIMENTO_OCUPADO','O responsável pelo atendimento mudou. Atualize antes de enviar.');
    const janela = await janelaDaConversa(conversa.id);
    if (janela.situacao !== SITUACOES_JANELA.ABERTA) throw Object.assign(new ConversaWhatsappError("FORA_DA_JANELA", "A janela de resposta fechou durante este envio."), { janela });
  }

  /**
   * A LISTA. `?filtro=nao-vinculadas | atendidas-por-mim | todas | historico`.
   * O histórico legado de empresa tem acesso separado; a lista padrão traz os fios atuais e
   * a fila. Cada fio vem com a última mensagem, as não lidas (derivadas de `lidaAteEm`), a janela e
   * a pendência aberta — o que a tela precisa para decidir o que oferecer ANTES do clique.
   */
  router.get("/whatsapp/conversas", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const filtro = String(req.query?.filtro || "todas");
    const empresa = String(req.query?.empresa || "").trim() || null;
    try {
      const visiveis = await empresasVisiveis(req);
      if (chatV2) {
        const resultado = await listarInboxWhatsapp({ visiveis, operadorId: req.auth.user.id, filtro, empresaId: empresa,
          relacionamento: String(req.query.relacionamento || ''), q: String(req.query.q || '').slice(0,200), naoLidas: req.query.naoLidas === '1',
          cursor: req.query.cursor || null, limite: req.query.limite, client });
        return res.json({ ok: true, filtro, empresa, ...resultado, consumoIa: await consumoIaDoMes() });
      }

      // ⚠⚠ `?empresa` é INTERSECTADO com a carteira, nunca somado (06/09/2026). Empresa fora do
      // escopo não devolve 403 nem lista vazia por acaso: ela simplesmente não está no `in`, e o
      // resultado é vazio pela MESMA regra que já protege o resto. Somar seria a forma de um
      // parâmetro de query ampliar o que o usuário enxerga.
      // ⚠ E `?empresa` com `filtro=nao-vinculadas` é contradição: aquele filtro é, por definição, o
      // que NÃO tem empresa. Recusa nomeada, em vez de ignorar um dos dois em silêncio.
      if (empresa && filtro === "nao-vinculadas") {
        return res.status(400).json({
          ok: false,
          error: "filtro_incompativel",
          message: "A fila de não vinculadas é, por definição, sem empresa — não dá para filtrá-la por empresa.",
        });
      }
      const daEmpresa = empresa && visiveis.includes(empresa) ? [empresa] : (empresa ? [] : visiveis);
      // Filtrar no banco, antes do cursor/take: segmentos antigos não consomem a página atual.
      const atuaisDaEmpresa = {
        portalClientId: { in: daEmpresa },
        NOT: { chaveEscopo: { startsWith: "legado:" } },
      };

      const filaSemResponsavel = { ...FILTRO_FILA_WHATSAPP, atendimentoId: null };
      // O recibo neutro ordena a chegada de um pedido ainda em seleção, mas o conteúdo só sai
      // pelo filtro do grupo. A existência de um segmento visível é exigida já nesta consulta.
      const indiceDoResponsavel = { ...FILTRO_FILA_WHATSAPP, atendimentoId: { not: null },
        atendimento: { is: { conversas: { some: { ...atuaisDaEmpresa, excluidaEm: null } },
          ...(filtro === "atendidas-por-mim" ? { atendidaPor: String(req.auth.user.id) } : {}) } } };
      const segmento = filtro === "lixeira"
        ? empresa ? { portalClientId: { in: daEmpresa } } : { OR: [{ portalClientId: { in: daEmpresa } }, filaSemResponsavel] }
        : filtro === "nao-vinculadas"
        ? filaSemResponsavel
        : filtro === "historico"
          ? { portalClientId: { in: daEmpresa }, chaveEscopo: { startsWith: "legado:" } }
          : filtro === "atendidas-por-mim"
          ? { OR: [{ ...atuaisDaEmpresa, atendidaPor: String(req.auth.user.id) }, indiceDoResponsavel] }
          : empresa
            // Com empresa escolhida, a fila (sem empresa) não entra: ela não é daquela empresa.
            ? { OR: [atuaisDaEmpresa, indiceDoResponsavel] }
            : { OR: [atuaisDaEmpresa, filaSemResponsavel, indiceDoResponsavel] };
      const where = { ...segmento, excluidaEm: filtro === "lixeira" ? { not: null } : null };

      // ⚠ `take: LIMITE + 1` — ver `LIMITE_CONVERSAS`.
      const achadas = await client.conversaWhatsapp.findMany({
        where,
        include: INCLUDE_CONVERSA,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        ...(req.query?.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}),
        take: Math.min(LIMITE_CONVERSAS, Math.max(1, Number(req.query?.limite) || LIMITE_CONVERSAS)) + 1,
      });
      const limite = Math.min(LIMITE_CONVERSAS, Math.max(1, Number(req.query?.limite) || LIMITE_CONVERSAS));
      const temMais = achadas.length > limite;
      const conversas = temMais ? achadas.slice(0, limite) : achadas;
      const grupos = new Map();
      const agrupadas = [];
      for (const conversa of conversas) {
        // Histórico e lixeira continuam a mostrar cada segmento, porque excluir não funde históricos.
        if (!conversa.atendimentoId || ["historico", "lixeira"].includes(filtro)) { agrupadas.push(conversa); continue; }
        if (grupos.has(conversa.atendimentoId)) continue;
        const grupo = await grupoNoEscopo({ conversa, visiveis, client });
        if (!grupo?.segmentos.length) continue;
        grupos.set(conversa.atendimentoId, grupo);
        const representante = (empresa ? grupo.segmentos.find(c => c.portalClientId === empresa) : grupo.segmentos.find(c => c.id === grupo.atendimento.conversaId)) || grupo.segmentos[0];
        agrupadas.push(representante);
      }

      // ⚠ UMA consulta de contatos para a página inteira, no molde de `enviosPorGuia` — nunca uma
      // por conversa. O casamento é `(portalClientId, telefoneE164)`, a mesma chave única do
      // cadastro; conversa sem empresa não tem contato por construção.
      const chavesComEmpresa = agrupadas.filter((c) => c.portalClientId);
      const contatos = chavesComEmpresa.length
        ? await client.contatoWhatsapp.findMany({
          where: {
            portalClientId: { in: [...new Set(chavesComEmpresa.map((c) => c.portalClientId))] },
            OR: [{ telefoneE164: { in: [...new Set(chavesComEmpresa.map((c) => c.telefoneE164))] } }, { waId: { in: [...new Set(chavesComEmpresa.map((c) => c.telefoneE164))] } }],
          },
          select: { id: true, nome: true, papel: true, portalClientId: true, telefoneE164: true, waId: true },
        })
        : [];
      const contatoPorChave = new Map(contatos.flatMap((k) => [k.telefoneE164, k.waId].filter(Boolean).map((n) => [`${k.portalClientId}|${n}`, k])));
      const itens = await Promise.all(agrupadas.map(async (c) => {
        const grupo = grupos.get(c.atendimentoId);
        const whereMensagem = grupo ? filtroMensagensDoGrupo(grupo, empresa) : { conversaId: c.id };
        const [ultima, naoLidas, janela, pendencia] = await Promise.all([
          client.mensagemWhatsapp.findFirst({ where: whereMensagem, orderBy: { registradaEm: "desc" }, ...(grupo ? { include: { contexto: { select: { conversaId: true } } } } : {}) }),
          grupo ? Promise.all([...grupo.segmentos.filter(s => !empresa || s.portalClientId === empresa).map(s => ({ s, filtro: filtroMensagensDoGrupo({ ...grupo, segmentos: [s], segmentosNeutros: [] }) })),
            ...(!empresa ? (grupo.segmentosNeutros || []).map(s => ({ s, filtro: filtroMensagensDoGrupo({ ...grupo, segmentos: [], segmentosNeutros: [s] }) })) : [])]
            .map(({ s, filtro: filtroMensagem }) => client.mensagemWhatsapp.count({ where: { AND: [filtroMensagem, { direcao: "in", ...(s.lidaAteEm ? { registradaEm: { gt: s.lidaAteEm } } : {}) }] } }))).then(contagens => contagens.reduce((a, b) => a + b, 0))
            : client.mensagemWhatsapp.count({ where: { conversaId: c.id, direcao: "in", ...(c.lidaAteEm ? { registradaEm: { gt: c.lidaAteEm } } : {}) } }),
          janelaDaConversa(c.id),
          pendenciaAberta(c.id, { client }),
        ]);
        return { ...resumoDaConversa(c, {
          ultima: grupo && ultima ? { ...ultima, empresa: empresaDaMensagem(ultima, grupo) } : ultima,
          naoLidas,
          janela,
          pendencia,
          contato: c.portalClientId ? contatoPorChave.get(`${c.portalClientId}|${c.telefoneE164}`) || null : null,
        }), ...resumoDoGrupo(grupo, c) };
      }));
      // O motivo de cada não vinculada (DESCONHECIDO/AMBIGUO + candidatas) vem do vínculo, na leitura.
      const fila = ["atendidas-por-mim", "historico", "lixeira"].includes(filtro) || empresa ? [] : await conversasNaoVinculadas({ limite: 50 });
      const motivoPorId = new Map(fila.map((f) => [f.conversa.id, { motivo: f.motivo, empresasCandidatas: (f.empresasCandidatas || []).filter(e => visiveis.includes(e.portalClientId || e.id)), divergemPeloNonoDigito: f.divergemPeloNonoDigito }]));
      return res.json({
        ok: true,
        filtro,
        empresa,
        conversas: itens.map((i) => ({ ...i, vinculo: motivoPorId.get(i.id) || null })),
        // ⚠ Ver `LIMITE_CONVERSAS`: a tela precisa poder dizer que há mais do que ela mostra.
        temMais,
        proximoCursor: temMais ? conversas[conversas.length - 1]?.id || null : null,
        consumoIa: await consumoIaDoMes(),
      });
    } catch (err) {
      return falhar(res, err, { filtro, empresa });
    }
  });

  /** GET é somente leitura; o navegador confirma uma entrada visível por POST /lida. */
  router.get("/whatsapp/conversas/:conversaId/mensagens", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    try {
      if (chatV2) return res.json(await lerHistoricoIdentidade({ conversaId,
        visiveis: await empresasVisiveis(req), cursor: req.query.cursor || null, mensagemId: req.query.mensagemId || null, limite: req.query.limite, client }));
      let conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const grupo = await grupoNoEscopo({ conversa, visiveis: await empresasVisiveis(req), client });
      const empresa = String(req.query?.empresa || "").trim() || null;
      if (empresa && (grupo ? !grupo.segmentos.some(c => c.portalClientId === empresa) : conversa.portalClientId !== empresa)) {
        return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      }
      const whereMensagem = grupo ? filtroMensagensDoGrupo(grupo, empresa) : { conversaId: conversa.id };
      // ⚠ Fio NÃO vinculado não passa por `listarMensagens` (que exige escopo de empresa): ele é a
      // fila do escritório, e o escritório inteiro o lê — só admin|contador chegam aqui.
      // ⚠ UM a mais do que se mostra — ver `LIMITE_MENSAGENS`. Um fio com 300 mensagens mostrava 200
      // sem avisar, e o contador lia como se fosse a conversa inteira.
      const limite = Math.min(LIMITE_MENSAGENS, Math.max(1, Number(req.query?.limite) || LIMITE_MENSAGENS));
      const cursor = req.query?.cursor ? String(req.query.cursor) : null;
      if (cursor && !await client.mensagemWhatsapp.findFirst({ where: { id: cursor, ...whereMensagem }, select: { id: true } })) {
        return res.status(400).json({ ok: false, error: "cursor_invalido" });
      }
      const achadas = grupo
        ? await client.mensagemWhatsapp.findMany({ where: whereMensagem, orderBy: [{ registradaEm: "desc" }, { id: "desc" }], take: limite + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { envioGuiaTentativa: true, contexto: { select: { conversaId: true, portalClientId: true } } } })
        : conversa.portalClientId
        ? await listarMensagens({ portalClientId: conversa.portalClientId, conversaId: conversa.id, limite: limite + 1, cursor })
        : await client.mensagemWhatsapp.findMany({ where: { conversaId: conversa.id }, orderBy: [{ registradaEm: "desc" }, { id: "desc" }], take: limite + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { envioGuiaTentativa: true } });
      const temMais = achadas.length > limite;
      const mensagens = temMais ? achadas.slice(0, limite) : achadas;
      const [janela, pendencia] = await Promise.all([janelaDaConversa(conversa.id), pendenciaAberta(conversa.id, { client })]);
      // ⚠ O contato também aqui: abrir a conversa precisa dizer QUEM está falando, não só de qual
      // empresa. Uma consulta, e só quando há empresa (fio da fila não tem cadastro por construção).
      const contato = conversa.portalClientId
        ? await client.contatoWhatsapp.findFirst({
          where: { portalClientId: conversa.portalClientId, OR: [{ telefoneE164: conversa.telefoneE164 }, { waId: conversa.telefoneE164 }] },
          select: { id: true, nome: true, papel: true },
        })
        : null;
      return res.json({
        ok: true,
        conversa: { ...resumoDaConversa(conversa, { janela, pendencia, contato }), ...resumoDoGrupo(grupo, conversa) },
        empresaFiltro: empresa,
        // ⚠ `temMais` diz que existe conversa ANTES da primeira mensagem mostrada.
        temMais,
        proximoCursor: temMais ? mensagens[mensagens.length - 1]?.id || null : null,
        mensagens: await enriquecerMensagensWhatsapp([...mensagens].reverse().map((m) => ({
          id: m.id, direcao: m.direcao, tipo: m.tipo, corpo: m.corpo, autor: m.autor || null,
          escopoPessoa: m.referenciaComercial?.escopo === "PESSOA",
          empresa: grupo ? empresaDaMensagem(m, grupo) : conversa.portalClient ? { id: conversa.portalClientId, razao: conversa.portalClient.razao, cnpj: conversa.portalClient.cnpj } : null,
          providerMessageId: m.providerMessageId || null, envioGuiaId: m.envioGuiaId || null, envioGuiaTentativaId: m.envioGuiaTentativaId || null,
          ocorridaEmProvedor: m.ocorridaEmProvedor || null, registradaEm: m.registradaEm,
          // ⚠ Só o PONTEIRO (o id na Meta), nunca uma URL: a da Meta expira, e este sistema ainda
          // não baixa arquivo. A tela usa isto para dizer "veio um áudio" em vez de "[audio]".
          temMidia: Boolean(m.midiaProvedorId),
          statusEnvio: m.envioGuiaTentativa?.status || m.statusEnvio || null,
          erroEnvio: m.envioGuiaTentativa?.erroCodigo
            ? { codigo: m.envioGuiaTentativa.erroCodigo, mensagem: m.envioGuiaTentativa.erroMensagemUsuario }
            : m.erroEnvioCodigo ? { codigo: m.erroEnvioCodigo, mensagem: m.erroEnvioMensagem } : null,
        })), {client,empresasPermitidas:await empresasVisiveis(req)}),
      });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  router.post('/whatsapp/conversas/:conversaId/lida', async (req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try { return res.json(await registrarLeituraIdentidade({ conversaId:req.params.conversaId,mensagemId:req.body?.mensagemId,visiveis:await empresasVisiveis(req),client })); }
    catch(err) { return falhar(res,err,{operacao:'leitura-whatsapp'}); }
  });
  router.post('/whatsapp/conversas/:conversaId/notas-internas', async (req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    if (!chatV2) return res.status(409).json({ ok:false,error:'CHAT_V2_DESABILITADO' });
    try { return res.json(await salvarNotaInterna({ ...req.body,conversaId:req.params.conversaId,visiveis:await empresasVisiveis(req),autor:req.auth.user,client })); }
    catch(err) { return falhar(res,err,{operacao:'nota-interna-whatsapp'}); }
  });
  router.post('/whatsapp/conversas/:conversaId/identificacao', async (req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    if (!chatV2) return res.status(409).json({ ok:false,error:'CHAT_V2_DESABILITADO' });
    try {
      const grupo = await carregarGrupoIdentidade({ conversaId:req.params.conversaId,visiveis:await empresasVisiveis(req),client });
      if (!grupo.completo || !grupo.origem.vinculoNumeroId) return res.status(404).json({ok:false,error:'conversa_nao_encontrada'});
      if(req.body?.acao==='ASSOCIAR_NUMERO') {
        const destino=await carregarGrupoIdentidade({conversaId:String(req.body.destinoConversaId || ''),visiveis:await empresasVisiveis(req),client});
        if(!destino.completo || !destino.interlocutorId) return res.status(404).json({ok:false,error:'conversa_nao_encontrada'});
        const identificacao=await associarNumeroConferido({vinculoOrigemId:grupo.origem.vinculoNumeroId,interlocutorDestinoId:destino.interlocutorId,
          versao:req.body.versao,versaoDestino:req.body.versaoDestino,evidencia:req.body.evidencia,atorId:req.auth.user.id,client});
        return res.json({ok:true,identificacao});
      }
      const identificacao = await conferirIdentificacao({ ...req.body,vinculoNumeroId:grupo.origem.vinculoNumeroId,atorId:req.auth.user.id,client });
      return res.json({ok:true,identificacao});
    } catch(err) { return falhar(res,err,{operacao:'identificacao-whatsapp'}); }
  });

  for (const acao of ["excluir", "restaurar"]) {
    router.post(`/whatsapp/conversas/:conversaId/${acao}`, async (req, res) => {
      if (!somenteAdminOuContador(req, res)) return undefined;
      const { conversaId } = req.params;
      try {
        const conversa = await conversaNoEscopo(req, conversaId, { client });
        if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
        const atualizada = await alterarExclusaoConversa({ conversaId: conversa.id, excluir: acao === "excluir", client });
        return res.json({ ok: true, conversa: resumoDaConversa({ ...conversa, ...atualizada }) });
      } catch (err) { return falhar(res, err, { conversaId, acao }); }
    });
  }

  // Uma aba antiga não pode agir sobre um chat que já foi para a lixeira.
  router.post("/whatsapp/conversas/:conversaId/:acao", async (req, res, next) => {
    if (!["assumir", "devolver", "responder", "enviar-anexo", "enviar-documento", "vincular", "selecionar-empresa", "retomar"].includes(req.params.acao)) return next();
    if (!somenteAdminOuContador(req, res)) return undefined;
    try {
      const conversa = await conversaNoEscopo(req, req.params.conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      if (conversa.excluidaEm) return res.status(409).json({ ok: false, error: "CHAT_EXCLUIDO", message: "Esta conversa está na lixeira. Restaure-a antes de continuar." });
      if (req.params.acao !== "vincular" && conversa.portalClientId && String(conversa.chaveEscopo || "").startsWith("legado:")) {
        return res.status(409).json({ ok: false, error: "HISTORICO_LEGADO", message: "Este é um segmento histórico. Abra a conversa atual para continuar o atendimento." });
      }
      return next();
    } catch (err) { return falhar(res, err, { conversaId: req.params.conversaId }); }
  });

  router.post("/whatsapp/conversas/:conversaId/selecionar-empresa", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    try {
      const conversa = await conversaNoEscopo(req, req.params.conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const portalClientId = String(req.body?.portalClientId || "").trim();
      const visiveis = await empresasVisiveis(req);
      if (!portalClientId || !visiveis.includes(portalClientId)) return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      const { selecionarEmpresaDoEscritorio } = await import("../../application/whatsapp/AtendimentoResponsavelWhatsappService.js");
      const resultado = await selecionarEmpresaDoEscritorio({ conversa, portalClientId, client });
      const atualizada = await conversaNoEscopo(req, resultado.conversa.id, { client });
      if (!atualizada) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const grupo = await grupoNoEscopo({ conversa: atualizada, visiveis, client });
      return res.json({ ok: true, conversa: { ...resumoDaConversa(atualizada), ...resumoDoGrupo(grupo, atualizada) } });
    } catch (err) { return falhar(res, err, { conversaId: req.params.conversaId, operacao: "selecionar-empresa" }); }
  });

  /** ASSUMIR: a pessoa passa a responder; a IA cala (`atendidaPor` preenchido). */
  router.post("/whatsapp/conversas/:conversaId/assumir", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    try {
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      await alterarHumano(conversa, String(req.auth.user.id), new Date());
      const atualizada = await conversaNoEscopo(req, conversa.id, { client });
      return res.json({ ok: true, conversa: resumoDaConversa(atualizada) });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /** DEVOLVER À IA: limpa `atendidaPor` E `atendidaDesde` (a fila do escritório também esvazia). */
  router.post("/whatsapp/conversas/:conversaId/devolver", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    try {
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      await alterarHumano(conversa, null, null);
      const atualizada = await conversaNoEscopo(req, conversa.id, { client });
      return res.json({ ok: true, conversa: resumoDaConversa(atualizada) });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /**
   * ⚠⚠ A RECUSA FORA DA JANELA É UMA SÓ, e por isso ela é função (06/09/2026).
   *
   * `responder` e `enviar-documento` são as duas MENSAGENS DE SERVIÇO deste sistema — a Meta recusa
   * as duas fora das 24h (131047). Duas redações do mesmo 409 divergiriam na primeira correção, e a
   * divergência apareceria como a tela explicando a janela de um jeito num botão e de outro no
   * vizinho. ⚠ O corpo é o contrato que a tela já lê (`payload.message` + `reabrirConversa`).
   */
  async function recusarForaDaJanela(res, janela, conversa) {
    // O catálogo atual pertence ao canal principal. A aprovação de uma WABA
    // não vale automaticamente para o segundo número de atendimento.
    const canalPrincipal = !conversa?.canalId || conversa.canalId === 'principal';
    const template = canalPrincipal ? await client.templateWhatsapp.findUnique({ where: { chave: "reabrir_conversa" } }).catch(() => null) : null;
    return res.status(409).json({
      ok: false,
      error: "FORA_DA_JANELA",
      situacao: janela.situacao,
      message: !canalPrincipal ? "A janela deste canal está fechada e ainda não há modelo de retomada configurado para ele."
        : janela.situacao === SITUACOES_JANELA.NUNCA_ABERTA
        ? "Este cliente nunca escreveu por aqui: a Meta só aceita texto livre nas 24h seguintes a uma mensagem DELE. Para iniciar, é preciso um modelo aprovado."
        : "A janela de 24h desde a última mensagem do cliente fechou: a Meta só aceita modelo aprovado agora.",
      reabrirConversa: {
        chave: "reabrir_conversa",
        statusAprovacao: template?.statusAprovacao || null,
        disponivel: String(template?.statusAprovacao || "").toUpperCase() === "APROVADO" && Boolean(template?.nomeMeta),
        ...(!canalPrincipal ? { motivo: 'MODELO_NAO_CONFIGURADO_PARA_CANAL' } : {}),
      },
      avisos: janela.avisos,
    });
  }

  /**
   * RESPONDER À MÃO. Texto livre — SÓ dentro da janela de 24h. Fora dela: 409 `FORA_DA_JANELA`
   * com a situação e o que existe (o template `reabrir_conversa`, quando aprovado).
   * Resposta humana assume o fio e invalida automações pendentes antes do transporte.
   */
  router.post("/whatsapp/conversas/:conversaId/responder", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    let texto = String(req.body?.texto || "").trim();
    let referenciaComercial;
    let casoComercial = null;
    if (req.body?.orientacaoId) {
      try {
        const p = await criarRecursosComerciais({ db: client }).prepararOrientacao(req.body.orientacaoId, req.body.variaveis || {});
        if (req.body.orientacaoVersao !== undefined && (!Number.isInteger(req.body.orientacaoVersao) || req.body.orientacaoVersao !== p.referencia.versao)) {
          return res.status(409).json({ok:false,error:'orientacao_alterada',message:'A orientação mudou. Confira a versão antes de enviar.'});
        }
        texto = p.texto; referenciaComercial = p.referencia;
      }
      catch (e) { return res.status(e.status || 500).json({ ok: false, message: e.status ? e.message : "Orientação indisponível." }); }
    }
    if (!texto) return res.status(400).json({ ok: false, error: "texto_obrigatorio", message: "Escreva a mensagem." });
    try {
      let conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      if (req.body?.orientacaoId && req.body?.atendimentoLeadId) {
        const grupo = conversa.vinculoNumeroId ? await carregarGrupoIdentidade({conversaId:conversa.id,visiveis:await empresasVisiveis(req),client}) : null;
        const caso = (!grupo || grupo.completo) && await client.atendimentoLead.findFirst({where:{id:String(req.body.atendimentoLeadId),...(grupo?.interlocutorId ? {interlocutorId:grupo.interlocutorId} : {conversaId:conversa.id}),encerradoEm:null}});
        if (!caso) return res.status(404).json({ok:false,error:'caso_nao_encontrado'});
        await resolverConversaEnvioComercial({ caso, conversaId: conversa.id, db: client });
        casoComercial = caso;
        referenciaComercial = {...referenciaComercial,atendimentoLeadId:caso.id};
      }
      if (req.body?.orientacaoAdaptada) {
        const adaptacao = req.body.orientacaoAdaptada;
        if (req.body.orientacaoId || !Number.isInteger(adaptacao.versao)) return res.status(400).json({ok:false,error:'orientacao_adaptada_invalida'});
        const recurso = await client.recursoComercial.findFirst({where:{id:String(adaptacao.id || ''),tipo:'ORIENTACAO',versao:adaptacao.versao,aprovadoEm:{not:null}}});
        if (!recurso) return res.status(409).json({ok:false,error:'orientacao_alterada',message:'A orientação mudou. Confira a versão antes de enviar.'});
        if (adaptacao.atendimentoLeadId) {
          const grupo = await carregarGrupoIdentidade({conversaId:conversa.id,visiveis:await empresasVisiveis(req),client});
          const caso = grupo.completo && await client.atendimentoLead.findFirst({where:{id:String(adaptacao.atendimentoLeadId),interlocutorId:grupo.interlocutorId,encerradoEm:null}});
          if (!caso) return res.status(404).json({ok:false,error:'caso_nao_encontrado'});
          await resolverConversaEnvioComercial({ caso, conversaId: conversa.id, db: client });
          casoComercial = caso;
        }
        referenciaComercial = {recursoId:recurso.id,chave:recurso.chave,versao:recurso.versao,adaptada:true,textoAprovado:false,atendimentoLeadId:adaptacao.atendimentoLeadId || null};
      }
      texto = assinarMensagemHumana(texto, req.auth.user);
      const recuperada = await recuperarIntencao(req,conversa,{tipo:'text',texto,referenciaComercial});
      if(recuperada) return res.json({ok:true,mensagem:recuperada.mensagem,intencao:recuperada.intencao,repetida:true});
      await conferirConversaAtiva(conversa, { porPessoa: true });
      const janela = await janelaDaConversa(conversa.id);
      if (janela.situacao !== SITUACOES_JANELA.ABERTA) return recusarForaDaJanela(res, janela, conversa);
      const cliente = await whatsappPorCanal(conversa, { cloud, client });
      conversa = await assumirParaEnvio(req, conversa);
      const r = await enviarIntencao(req, conversa, { tipo: 'text', texto, referenciaComercial }, intencaoEnvioId => comEnvioDoResponsavel(conversa, conferirLease => enviarMensagemRastreada({ intencaoEnvioId, conversa, tipo: "text", corpo: texto, autor: AUTOR_HUMANO, referenciaComercial: { ...referenciaComercial, escopo: "PESSOA" }, client,
        antesDeEnviar: async () => {
          await conferirEnvio(conversa, conferirLease, { porPessoa: true });
          if (casoComercial) {
            const atual = await client.atendimentoLead.findFirst({ where: { id: casoComercial.id, encerradoEm: null } });
            await resolverConversaEnvioComercial({ caso: atual, conversaId: conversa.id, db: client });
          }
        },
        enviar: () => cliente.enviarTexto({ telefone: conversa.telefoneE164, texto }),
      })));
      if (!referenciaComercial?.adaptada && ["autorizacao", "autorizacao-acesso"].includes(referenciaComercial?.chave)) {
        const lead = await client.atendimentoLead.findFirst({ where: { ...(casoComercial ? { id: casoComercial.id } : { conversaId }), encerradoEm: null }, include: { onboarding: true } });
        if (lead) await client.atendimentoLead.updateMany({ where: { id: lead.id, encerradoEm: null, autorizacao: { equals: lead.autorizacao || {} }, onboarding: { cnpj: lead.onboarding?.cnpj || null } }, data: { autorizacao: { ...(lead.autorizacao || {}), estado: lead.autorizacao?.cnpj === lead.onboarding?.cnpj && lead.autorizacao?.estado === "ATIVA" ? "ATIVA" : "INSTRUCAO_ENVIADA", cnpj: lead.onboarding?.cnpj || null, mensagemId: r.mensagem.id, recursoId: referenciaComercial.recursoId } } });
      }
      return res.json({ ok: true, mensagem: { id: r.mensagem.id, providerMessageId: r.wamid, autor: AUTOR_HUMANO, corpo: texto, statusEnvio: r.mensagem.statusEnvio } });
    } catch (err) {
      return falhar(res, err, { conversaId });
    }
  });

  /**
   * VINCULAR: cadastra o contato na empresa E atribui o fio. É por aqui que a fila esvazia.
   * Body: `{ portalClientId, contato: { nome, papel?, optIn?, optInOrigem?, userId? } }`.
   * ⚠ A empresa tem de estar na carteira do usuário; o número do fio é o telefone do contato (o
   * cadastro é a autoridade — dígito a dígito).
   */
  router.post("/whatsapp/conversas/:conversaId/vincular", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    const portalClientId = String(req.body?.portalClientId || "").trim();
    const contato = req.body?.contato || {};
    if (!portalClientId) return res.status(400).json({ ok: false, error: "empresa_obrigatoria", message: "Escolha a empresa." });
    try {
      const visiveis = await empresasVisiveis(req);
      if (!visiveis.includes(portalClientId)) return res.status(404).json({ ok: false, error: "empresa_nao_encontrada" });
      const conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      await conferirConversaAtiva(conversa, { porPessoa: true });
      const grupo = conversa.vinculoNumeroId ? await carregarGrupoIdentidade({conversaId:conversa.id,visiveis,client}) : null;
      if (grupo && !grupo.completo) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      const leadAtivo = await client.atendimentoLead.findFirst({ where: { ...(grupo?.interlocutorId ? { interlocutorId: grupo.interlocutorId } : { conversaId: conversa.id }), encerradoEm: null, onboardingId: { not: null } } });
      if (leadAtivo) return res.status(409).json({ ok: false, error: "LEAD_EM_ATENDIMENTO", message: "Este contato tem uma solicitação comercial ativa. Continue pelo atendimento; a conversão em cliente acontece no onboarding." });
      // 1) o contato — o telefone vem do FIO, nunca do corpo (o corpo não escolhe o número).
      const salvo = await salvarContato({ ...contato, portalClientId, telefone: `+${conversa.telefoneE164}` });
      // 2) a atribuição — agora o vínculo responde VINCULADO para esta empresa, e `atribuirConversa` aceita.
      const atualizada = await atribuirConversa({ conversaId: conversa.id, portalClientId });
      const vinculo = await resolverVinculoPorTelefone(conversa.telefoneE164);
      return res.json({ ok: true, contato: salvo, conversa: resumoDaConversa({ ...atualizada, portalClient: null }), vinculo: { situacao: vinculo.situacao } });
    } catch (err) {
      return falhar(res, err, { conversaId, portalClientId });
    }
  });

  /**
   * ⚠⚠ ENVIAR UM DOCUMENTO DA EMPRESA PELO FIO (F3, 06/09/2026).
   *
   * > Dono: as ações rápidas do chat são *"enviar guia · enviar documento · virar anotação"*.
   *
   * ⚠⚠ O DOCUMENTO É BUSCADO COM O `portalClientId` DO FIO, e isso é o desenho, não um `if`: um
   * documento da empresa A **não tem como** sair pelo fio da empresa B, porque a consulta que o
   * encontra já é escopada pela empresa do fio. Uma checagem `companyId === conversa.portalClientId`
   * seria uma guarda a mais para alguém esquecer.
   *
   * ⚠ O plano pedia esta rota em `/companies/:id/documentos/:id/enviar-whatsapp`, espelho de
   * `whatsappGuias.js`. Ela mora AQUI porque o sujeito é o FIO — é ele que tem telefone, janela e
   * histórico — e porque assim herda `conversaNoEscopo`, o mesmo isolamento que os testes desta
   * rota já provam. A GUIA continua saindo pela rota dela, que já tem as guardas de envio de guia
   * (opt-in, template aprovado, reenvio, todos os destinatários).
   *
   * ⚠⚠ É MENSAGEM DE SERVIÇO: só dentro da janela de 24h, com a MESMA recusa do `responder`.
   * ⚠ NÃO cria `EnvioGuia`: não é guia, não há entrega a rastrear — o histórico é o balão.
   */
  router.post("/whatsapp/conversas/:conversaId/enviar-documento", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return undefined;
    const { conversaId } = req.params || {};
    const documentId = String(req.body?.documentId || "").trim();
    if (!documentId) return res.status(400).json({ ok: false, error: "documento_obrigatorio", message: "Escolha o documento." });
    try {
      let conversa = await conversaNoEscopo(req, conversaId, { client });
      if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
      // ⚠ Fio da FILA não tem empresa, logo não há documento DELA para enviar — e não se escolhe uma.
      if (!conversa.portalClientId) {
        return res.status(422).json({
          ok: false,
          error: "FIO_SEM_EMPRESA",
          message: "Este número ainda não está vinculado a uma empresa: não há documento dela para enviar. Vincule o fio primeiro.",
        });
      }
      if (conversa.escopoVerificado !== true) return res.status(409).json({ ok: false, error: "ESCOPO_NAO_VERIFICADO", message: "Abra um novo segmento vinculado à empresa antes de enviar documentos. O histórico anterior precisa de conferência." });
      const payloadIntencao = {tipo:'document',documentId,legenda:String(req.body?.legenda || '').trim()};
      const recuperada = await recuperarIntencao(req,conversa,payloadIntencao);
      if(recuperada) return res.json({ok:true,mensagem:recuperada.mensagem,intencao:recuperada.intencao,repetida:true});
      await conferirConversaAtiva(conversa);

      const janela = await janelaDaConversa(conversa.id);
      if (janela.situacao !== SITUACOES_JANELA.ABERTA) return recusarForaDaJanela(res, janela, conversa);

      const { doc, buffer } = await baixarBuffer({ portalClientId: conversa.portalClientId, documentId });
      await conferirConversaAtiva(conversa);

      const cliente = await whatsappPorCanal(conversa, { cloud, client });
      const legenda = String(req.body?.legenda || "").trim() || doc.nome;
      const corpo = assinarMensagemHumana(conversa.atendimentoId ? `${conversa.portalClient.razao} · ${legenda}` : legenda, req.auth.user, { limite: 1024 });
      conversa = await assumirParaEnvio(req, conversa,{preservarContextoOperacional:true});
      const r = await enviarIntencao(req, conversa, payloadIntencao, intencaoEnvioId => comEnvioDoResponsavel(conversa, conferirLease => enviarMensagemRastreada({ intencaoEnvioId, conversa, tipo: "document", corpo, autor: AUTOR_HUMANO, client,
        aposRegistrar: mensagem => salvarArquivoManual({mensagem,conversa,buffer,nomeArquivo:doc.nome,mimeType:doc.mimeType || 'application/pdf'},{client}), antesDeEnviar: () => conferirEnvio(conversa, conferirLease), enviar: () => cliente.enviarDocumento({
        telefone: conversa.telefoneE164,
        conteudo: buffer,
        nomeArquivo: doc.nome,
        mimeType: doc.mimeType || "application/pdf",
        legenda: corpo,
      }) })));

      // ⚠ O balão diz O QUE saiu — o nome do arquivo. Sem isso o histórico teria "um documento", e o
      // contador não saberia qual dos alvarás da empresa foi mandado.
      const mensagem = r.mensagem;
      log?.info?.({ conversaId: conversa.id, documentId: doc.id, wamid: r?.wamid || null }, "whatsapp.documento.enviado");
      return res.json({
        ok: true,
        documento: { id: doc.id, nome: doc.nome, tipo: doc.tipo },
        mensagem: { id: mensagem?.id || null, providerMessageId: r?.wamid || null, autor: AUTOR_HUMANO, corpo },
      });
    } catch (err) {
      return falhar(res, err, { conversaId, documentId });
    }
  });

  const uploadAnexo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } }).single("arquivo");
  router.post("/whatsapp/conversas/:conversaId/enviar-anexo", (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    uploadAnexo(req, res, async erroUpload => {
      if (erroUpload) return res.status(400).json({ ok: false, error: "ANEXO_INVALIDO", message: "Envie um PDF ou imagem JPEG/PNG de até 5 MB." });
      try {
        const anexo = validarAnexoManual(req.file, req.body?.legenda || "");
        const corpo = assinarMensagemHumana([anexo.nomeArquivo, anexo.legenda].filter(Boolean).join("\n"), req.auth.user);
        anexo.legenda = assinarMensagemHumana(anexo.legenda, req.auth.user, { limite: 1024 });
        let conversa = await conversaNoEscopo(req, req.params.conversaId, { client });
        if (!conversa) return res.status(404).json({ ok: false, error: "conversa_nao_encontrada" });
        const recuperada = await recuperarIntencao(req,conversa,{tipo:anexo.tipo,corpo,hash:anexo.sha256});
        if(recuperada) return res.json({ok:true,mensagem:recuperada.mensagem,intencao:recuperada.intencao,repetida:true});
        await conferirConversaAtiva(conversa, { porPessoa: true });
        const janela = await janelaDaConversa(conversa.id);
        if (janela.situacao !== SITUACOES_JANELA.ABERTA) return recusarForaDaJanela(res, janela, conversa);
        conversa = await assumirParaEnvio(req, conversa);
        const cliente = await whatsappPorCanal(conversa, { cloud, client });
        const r = await enviarIntencao(req, conversa, { tipo: anexo.tipo, corpo, hash: anexo.sha256 }, intencaoEnvioId => comEnvioDoResponsavel(conversa, conferirLease => enviarMensagemRastreada({
          intencaoEnvioId, conversa, tipo: anexo.tipo, corpo, autor: AUTOR_HUMANO, client,
          referenciaComercial: { tipo: "ANEXO_MANUAL", escopo: "PESSOA", nome: anexo.nomeArquivo, mime: anexo.mimeType, sha256: anexo.sha256 },
          aposRegistrar: mensagem => salvarArquivoManual({mensagem,conversa,buffer:anexo.conteudo,nomeArquivo:anexo.nomeArquivo,mimeType:anexo.mimeType},{client}),
          antesDeEnviar: () => conferirEnvio(conversa, conferirLease, { porPessoa: true }),
          enviar: () => cliente[anexo.tipo === "image" ? "enviarImagem" : "enviarDocumento"]({ ...anexo, telefone: conversa.telefoneE164 }),
        })));
        return res.json({ ok: true, mensagem: { id: r.mensagem.id, providerMessageId: r.wamid, statusEnvio: r.mensagem.statusEnvio } });
      } catch (e) {
        if (["ANEXO_INVALIDO", "LEGENDA_INVALIDA"].includes(e.code)) return res.status(400).json({ ok: false, error: e.code, message: e.message });
        return falhar(res, e, { conversaId: req.params.conversaId, operacao: "enviar-anexo" });
      }
    });
  });
  router.get('/whatsapp/conversas/:conversaId/intencoes/:clientRequestId', async (req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try {
      const conversa = await conversaNoEscopo(req,req.params.conversaId,{client});
      if (!conversa) return res.status(404).json({ok:false,error:'conversa_nao_encontrada'});
      const intencao = await consultarIntencaoEnvio({userId:String(req.auth.user.id),clientRequestId:req.params.clientRequestId,conversa,client});
      return intencao ? res.json({ok:true,intencao}) : res.status(404).json({ok:false,error:'intencao_nao_encontrada'});
    } catch(e) { return falhar(res,e,{operacao:'consultar-intencao'}); }
  });
  for (const metodo of ['get','put','delete']) router[metodo]('/whatsapp/conversas/:conversaId/rascunho', async (req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try {
      const conversa = await conversaNoEscopo(req,req.params.conversaId,{client});
      if (!conversa) return res.status(404).json({ok:false,error:'conversa_nao_encontrada'});
      const args = {userId:String(req.auth.user.id),conversa,modo:(metodo === 'get' ? req.query.modo : req.body?.modo) || 'texto',client};
      if(metodo === 'get') return res.json({ok:true,rascunho:await lerRascunhoAtendimento(args)});
      if(metodo === 'delete') return res.json({ok:true,...await excluirRascunhoAtendimento({...args,versao:req.body?.versao})});
      if(conversa.excluidaEm) throw erroAtendimento('CHAT_EXCLUIDO','Restaure a conversa antes de editar o rascunho.');
      return res.json({ok:true,rascunho:await salvarRascunhoAtendimento({...args,versao:req.body?.versao,conteudo:req.body?.conteudo})});
    } catch(e) { return falhar(res,e,{operacao:'rascunho-atendimento'}); }
  });
  router.get('/whatsapp/conversas/:conversaId/buscar', async(req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try {
      const resultado = await buscarMensagensIdentidade({conversaId:req.params.conversaId,visiveis:await empresasVisiveis(req),q:req.query.q,cursor:req.query.cursor,limite:req.query.limite,client});
      return res.json({...resultado,resultados:await enriquecerMensagensWhatsapp(resultado.resultados,{client,empresasPermitidas:await empresasVisiveis(req)})});
    } catch(e) { return falhar(res,e,{operacao:'busca-mensagem'}); }
  });
  router.get('/whatsapp/conversas/:conversaId/mensagens/:mensagemId/arquivo', async(req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try {
      const visiveis = await empresasVisiveis(req);
      const grupo = await carregarGrupoIdentidade({conversaId:req.params.conversaId,visiveis,client});
      const mensagem = await client.mensagemWhatsapp.findFirst({where:{AND:[filtroMensagensIdentidade(grupo.segmentos),{id:req.params.mensagemId}]}});
      if(!mensagem) return res.status(404).json({ok:false,error:'arquivo_nao_encontrado'});
      const arquivo = await obterArquivoDaMensagem({mensagemId:mensagem.id,mensagemIds:[mensagem.id],conversaIds:[mensagem.conversaId],empresasPermitidas:visiveis},{client});
      res.set('Cache-Control','no-store'); res.set('X-Content-Type-Options','nosniff');
      return res.json({ok:true,arquivo});
    } catch(e) { return falhar(res,e,{operacao:'arquivo-mensagem'}); }
  });
  router.get('/whatsapp/conversas/:conversaId/retomar', async(req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try {
      const conversa = await conversaNoEscopo(req,req.params.conversaId,{client});
      if(!conversa) return res.status(404).json({ok:false,error:'conversa_nao_encontrada'});
      return res.json({ok:true,...await prepararRetomadaAtendimento({conversa,client,consultarModelo})});
    } catch(e) { return falhar(res,e,{operacao:'preparar-retomada'}); }
  });
  router.post('/whatsapp/conversas/:conversaId/retomar', async(req,res) => {
    if (!somenteAdminOuContador(req,res)) return;
    try {
      let conversa = await conversaNoEscopo(req,req.params.conversaId,{client});
      if(!conversa) return res.status(404).json({ok:false,error:'conversa_nao_encontrada'});
      if(!req.body?.clientRequestId || !req.body?.previaHash) throw erroAtendimento('PREVIA_OBRIGATORIA','Prepare e confira a retomada antes de enviar.',400);
      const r = await enviarIntencao(req,conversa,{tipo:'retomada',previaHash:req.body.previaHash},async intencaoEnvioId => {
        const previa = await prepararRetomadaAtendimento({conversa,client,consultarModelo});
        if(!previa.disponivel) throw erroAtendimento(previa.motivo,previa.message);
        if(previa.previaHash !== req.body.previaHash) throw erroAtendimento('PREVIA_ALTERADA','O modelo ou destinatário mudou. Prepare a retomada novamente.');
        await conferirConversaAtiva(conversa,{porPessoa:true});
        conversa = await assumirParaEnvio(req,conversa);
        const cliente = await whatsappPorCanal(conversa,{cloud,client});
        return comEnvioDoResponsavel(conversa,conferirLease => enviarMensagemRastreada({intencaoEnvioId,conversa,tipo:'template',corpo:previa.texto,autor:AUTOR_HUMANO,client,
          referenciaComercial:{tipo:'RETOMADA',escopo:'PESSOA',modelo:previa.modelo,previaHash:previa.previaHash},
          antesDeEnviar:async()=>{await conferirLease();await conferirConversaAtiva(conversa,{porPessoa:true});},
          enviar:()=>cliente.enviarTemplate({telefone:conversa.telefoneE164,template:previa.modelo.nome,idioma:previa.modelo.idioma,variaveis:[]})}));
      });
      return res.json({ok:true,mensagem:r.mensagem,intencao:r.intencao,aguardandoRespostaCliente:true});
    } catch(e) { return falhar(res,e,{operacao:'retomar-conversa'}); }
  });
  return router;
}
