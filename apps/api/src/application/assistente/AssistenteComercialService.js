import { prisma } from "../../infrastructure/db/prisma.js";
import { decidirRespostaComercial } from "./politicaComercialWhatsapp.js";
export { decidirRespostaComercial } from "./politicaComercialWhatsapp.js";
import { AssistenteClient } from "./AssistenteClient.js";
import { autorizarChamadaIa, concluirChamadaIa } from "./GuardaIaService.js";
import { iniciarAtendimento, registrarCampos, proximaPergunta } from "../onboarding/LeadService.js";
import { consultarPublicaLead } from "../onboarding/FiscalLeadService.js";
import { criarRecursosComerciais } from "../onboarding/RecursosComerciaisService.js";
import { resolverVinculoPorTelefone } from "../whatsapp/ContatoWhatsappService.js";
import { janelaDaConversa } from "../whatsapp/ConversaWhatsappService.js";
import { WhatsappCloudClient } from "../whatsapp/WhatsappCloudClient.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
import { adquirirLease, renovarLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
import { montarHistorico } from "./AssistenteService.js";
import { camposDaOrigem } from "@contabilidade/shared/onboarding";
import { montarPromptComercial, respostaComercialUtilizavel } from "./promptComercial.js";

const falha = codigo => Object.assign(new Error(codigo), { codigo });
const ordenar = (a, b) => new Date(a.registradaEm) - new Date(b.registradaEm) || a.id.localeCompare(b.id);
const FRASE_EQUIPE = "Registrei sua mensagem. O contador vai conferir os dados e continuar o atendimento por aqui.";

export async function responderLead({ conversaId, mensagemId, deps = {} }) {
  const db = deps.client || prisma;
  const turnoIaId = deps.turnoIaId || `mensagem:${mensagemId}`;
  let lease, timer, leaseValido = true, renovando = false, guarda, resposta, lead;
  let handoff = false, handoffEm = null, houveSaida = false, ferramentaValida = false;
  let bolhas = [], orientacao = null, consulta = null;
  const renovar = async () => {
    if (!leaseValido) throw falha("LEASE_PERDIDA");
    if (lease && !await renovarLease(lease, { client: db })) { leaseValido = false; throw falha("LEASE_PERDIDA"); }
    await deps.conferirLease?.();
  };
  const conferir = async () => {
    await renovar();
    const c = await db.conversaWhatsapp.findUnique({ where: { id: conversaId } });
    const m = await db.mensagemWhatsapp.findFirst({ where: { id: mensagemId, conversaId, direcao: "in" } });
    // Só a reserva humana feita por este turno permite confirmar o encaminhamento.
    const proprioHandoff = handoffEm && !c?.atendidaPor && new Date(c?.atendidaDesde).getTime() === handoffEm.getTime();
    const decisao = decidirRespostaComercial({ r: {
      conversa: proprioHandoff ? { ...c, atendidaDesde: null } : c, mensagem: m,
      vinculo: c ? await (deps.resolver || resolverVinculoPorTelefone)(c.telefoneE164) : null,
    }, ...(deps.piloto ? { piloto: deps.piloto } : {}), ...(deps.flag !== undefined ? { flag: deps.flag } : {}) });
    if (!m || !decisao.responde) throw falha(decisao.motivo || "SEM_MENSAGEM");
    if ((await (deps.janela || janelaDaConversa)(conversaId)).situacao !== "ABERTA") throw falha("FORA_DA_JANELA");
    if (lead) {
      const atual = await db.atendimentoLead.findFirst({ where: { id: lead.id, conversaId, encerradoEm: null }, include: { onboarding: true } });
      if (!atual || atual.onboardingId !== lead.onboardingId || atual.onboarding?.versao !== lead.onboarding?.versao) throw falha("FICHA_ALTERADA");
    }
    return { c, m };
  };
  const encaminhar = async () => {
    if (handoffEm) return;
    const { m } = await conferir();
    const em = new Date();
    const r = await db.conversaWhatsapp.updateMany({ where: {
      id: conversaId, portalClientId: null, excluidaEm: null, atendidaPor: null, atendidaDesde: null,
      OR: [{ automacaoInvalidadaEm: null }, { automacaoInvalidadaEm: { lt: m.registradaEm } }],
    }, data: { atendidaDesde: em } });
    if (!r.count) throw falha("ASSUMIDA_POR_HUMANO");
    handoffEm = em;
  };
  try {
    if (!deps.leaseExterno) {
      lease = await adquirirLease(`ia:${conversaId}`, { client: db });
      if (!lease) return { feito: false, motivo: "OCUPADO" };
      timer = setInterval(async () => {
        if (renovando) return;
        renovando = true;
        try { await renovar(); } catch { leaseValido = false; } finally { renovando = false; }
      }, 20000);
      timer.unref?.();
    }
    const { c, m } = await conferir();
    // Uma saída pode responder várias bolhas, cada uma com seu job. A correlação é gravada
    // antes da rede para que timeout ou falha ao marcar as entradas não libere outro job.
    if (await db.mensagemWhatsapp.findFirst({ where: { conversaId, direcao: "out", OR: [
      { turnoIaId },
      { referenciaComercial: { path: ["mensagensIds"], array_contains: [mensagemId] } },
    ] } })) return { feito: false, indeterminado: true, motivo: "SAIDA_JA_REGISTRADA" };
    bolhas = [m];
    if (m.tipo === "text") {
      const seguintes = await db.mensagemWhatsapp.findMany({ where: { conversaId, registradaEm: { gte: m.registradaEm, lte: new Date(new Date(m.registradaEm).getTime() + 8000) } }, orderBy: [{ registradaEm: "asc" }, { id: "asc" }], take: 12 });
      for (const b of seguintes.filter(b => b.id !== m.id && ordenar(b, m) > 0).sort(ordenar)) {
        if (b.direcao !== "in" || b.tipo !== "text" || b.respondidaPelaIaEm) break;
        bolhas.push(b);
      }
    }
    const ids = bolhas.map(b => b.id);
    const pedido = { ...bolhas.at(-1), corpo: bolhas.map(b => b.corpo || "").join("\n") };
    lead = await iniciarAtendimento({ conversaId, client: db });
    const recursos = criarRecursosComerciais({ db });
    const aprovadas = await recursos.listar({ aprovados: true, tipo: "ORIENTACAO" });
    const ferramentas = [{ name: "registrar_atendimento", strict: false,
      description: "Registra declarações do pedido atual antes de responder. Retorna os dados salvos, consulta pública e a próxima informação útil. Use uma vez por turno; em dúvida registre campos vazios. Não executa serviços fiscais nem aprova propostas.",
      input_schema: { type: "object", additionalProperties: false, properties: {
        origem: { type: "string", enum: ["ABERTURA", "TRANSFERENCIA", "INATIVA"] },
        campos: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, properties: {
          campo: { type: "string" }, acao: { type: "string", enum: ["set", "unset"] }, valor: {},
        }, required: ["campo", "acao"] } },
        autorizacaoConcluida: { type: "boolean", description: "Declaração de que outorgou procuração; exige conferência humana." },
        chamarContador: { type: "boolean" }, orientacaoId: { type: "string" },
      } },
    }];
    if (m.tipo === "text") {
      guarda = await (deps.autorizar || autorizarChamadaIa)({ conversaId, mensagemId, finalidade: "comercial_whatsapp", client: db });
      if (guarda.ok) {
        const historico = await db.mensagemWhatsapp.findMany({ where: { conversaId, OR: [
          { registradaEm: { lt: m.registradaEm } }, { registradaEm: m.registradaEm, id: { lt: m.id } },
        ] }, orderBy: [{ registradaEm: "desc" }, { id: "desc" }], take: 20 });
        let usada = false;
        try {
          resposta = await (deps.assistente || new AssistenteClient({ maxIteracoes: 2 })).responder({
            system: montarPromptComercial({ ficha: lead.onboarding, campos: (lead.onboarding ? camposDaOrigem(lead.onboarding.origem) : ["ABERTURA", "TRANSFERENCIA", "INATIVA"].flatMap(camposDaOrigem)).map(d => ({ campo: d.campo, tipo: d.tipo, opcoes: d.opcoes })), orientacoes: aprovadas.map(o => ({ id: o.id, chave: o.chave, titulo: o.titulo })) }),
            messages: montarHistorico(historico.filter(h => !ids.includes(h.id)), pedido), ferramentas,
            executar: async (nome, input) => {
              await conferir();
              if (nome !== "registrar_atendimento" || usada) return { ok: false, motivo: "FERRAMENTA_NAO_PERMITIDA" };
              usada = true;
              if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["origem", "campos", "autorizacaoConcluida", "chamarContador", "orientacaoId"].includes(k))) throw falha("ENTRADA_INVALIDA");
              if (input.campos !== undefined && (!Array.isArray(input.campos) || input.campos.length > 20)) throw falha("ENTRADA_INVALIDA");
              for (const k of ["autorizacaoConcluida", "chamarContador"]) if (input[k] !== undefined && typeof input[k] !== "boolean") throw falha("ENTRADA_INVALIDA");
              if (input.origem && !lead.onboardingId) lead = await iniciarAtendimento({ conversaId, origem: input.origem, client: db });
              else if (input.origem && lead.onboarding?.origem !== input.origem) handoff = true;
              if (!handoff && input.campos?.length && lead.onboardingId) lead.onboarding = await registrarCampos({ onboardingId: lead.onboardingId, versao: lead.onboarding.versao, operacoes: input.campos, mensagemId, mensagensIds: ids, client: db });
              if (input.chamarContador === true) handoff = true;
              if (input.autorizacaoConcluida === true) {
                await conferir();
                await db.atendimentoLead.update({ where: { id: lead.id }, data: { autorizacao: { ...(lead.autorizacao || {}), estado: "AGUARDANDO_CONFERENCIA", cnpj: lead.onboarding?.cnpj || null, declaracaoMensagemId: mensagemId } } });
                handoff = true;
              }
              if (!handoff && input.orientacaoId) {
                if (!aprovadas.some(o => o.id === input.orientacaoId)) throw falha("ORIENTACAO_NAO_APROVADA");
                orientacao = await recursos.prepararOrientacao(input.orientacaoId, { nome: lead.onboarding?.responsavelNome, cnpj: lead.onboarding?.cnpj });
              }
              if (!handoff && lead.onboarding?.cnpj) {
                await conferir();
                try { consulta = await (deps.consultaPublica || consultarPublicaLead)(lead.onboardingId, { db }); }
                catch { consulta = { mensagem: "A consulta pública não concluiu. O contador vai conferir." }; handoff = true; }
              }
              const pergunta = proximaPergunta(lead.onboarding);
              if (!handoff && pergunta.campo === null && lead.onboarding?.origem === "INATIVA" && !lead.autorizacao?.estado) {
                const autorizacao = aprovadas.find(o => o.chave === "autorizacao");
                if (autorizacao) orientacao = await recursos.prepararOrientacao(autorizacao.id, { nome: lead.onboarding.responsavelNome, cnpj: lead.onboarding.cnpj });
              }
              if (pergunta.campo === null && !orientacao) handoff = true;
              ferramentaValida = true;
              return { ok: true, dadosRegistrados: lead.onboarding?.dados || {}, consultaPublica: consulta, proximaPergunta: pergunta, encaminhamentoSolicitado: handoff, orientacao: orientacao?.texto || null, precos: "Dependem de proposta conferida pelo contador; nenhum valor foi aprovado neste turno." };
            },
          });
          await (deps.concluir || concluirChamadaIa)(guarda.contexto, { usage: resposta.usage, iteracoes: resposta.iteracoes, ferramentas: resposta.ferramentasChamadas, stopReason: resposta.stopReason }, { client: db });
        } catch (e) {
          await (deps.concluir || concluirChamadaIa)(guarda.contexto, { erroCodigo: e.codigo || "ERRO", usage: e.usage }, { client: db });
          handoff = true;
        }
        guarda = null;
      } else handoff = true;
    } else handoff = true;
    await conferir();
    const pergunta = proximaPergunta(lead.onboarding);
    if (!ferramentaValida || resposta?.recusou || ["max_iteracoes", "erro"].includes(resposta?.stopReason)) handoff = true;
    if (handoff) await encaminhar();
    const livre = respostaComercialUtilizavel(resposta?.texto) ? resposta.texto.trim() : null;
    const texto = handoff ? FRASE_EQUIPE : orientacao?.texto || livre || [consulta?.razaoSocial ? `Consultei os dados públicos de ${consulta.razaoSocial}. Situação cadastral: ${consulta.situacaoCadastral || "não informada"}. Isso não confirma a regularidade fiscal.` : "", pergunta.pergunta, pergunta.opcoes?.map(o => o.rotulo).join(" · ")].filter(Boolean).join("\n\n");
    const saida = await enviarMensagemRastreada({ conversa: c, corpo: texto, autor: "IA", turnoIaId, referenciaComercial: { ...(orientacao?.referencia || {}), mensagensIds: ids }, client: db, antesDeEnviar: conferir, enviar: () => (deps.cloud || new WhatsappCloudClient()).enviarTexto({ telefone: c.telefoneE164, texto }) });
    houveSaida = true;
    if (orientacao?.referencia.chave === "autorizacao" && !handoff) await db.atendimentoLead.update({ where: { id: lead.id }, data: { autorizacao: { ...(lead.autorizacao || {}), estado: "INSTRUCAO_ENVIADA", cnpj: lead.onboarding?.cnpj || null, mensagemId: saida.mensagem.id, recursoId: orientacao.referencia.recursoId } } });
    await db.mensagemWhatsapp.updateMany({ where: { conversaId, id: { in: ids }, direcao: "in", respondidaPelaIaEm: null }, data: { respondidaPelaIaEm: new Date() } });
    return { feito: true, mensagemId: saida.mensagem.id, mensagensRespondidas: ids, motivo: handoff ? "ENCAMINHADA" : "RESPONDIDA" };
  } catch (e) {
    if (guarda?.ok) await (deps.concluir || concluirChamadaIa)(guarda.contexto, { erroCodigo: e.codigo || "ERRO", usage: e.usage }, { client: db });
    return { feito: false, indeterminado: houveSaida || e.indeterminado === true, motivo: e.codigo || "ERRO" };
  } finally {
    clearInterval(timer);
    if (lease) await liberarLease(lease, { client: db });
  }
}
