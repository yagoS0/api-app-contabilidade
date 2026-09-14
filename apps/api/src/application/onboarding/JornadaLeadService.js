import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { criarServicoComercial, exigirEscopo } from "./ComercialService.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { OnboardingError } from "./OnboardingService.js";
import { encerrado } from "./LeadService.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
import { janelaDaConversa } from "../whatsapp/ConversaWhatsappService.js";
import { WhatsappCloudClient } from "../whatsapp/WhatsappCloudClient.js";
import { adquirirLease, renovarLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";

const erro = (codigo, mensagem) => new OnboardingError(codigo, mensagem, 409);
const confirmados = new Set(["enviado", "entregue", "lido"]);
export function dadosIniciaisPendentes(ficha) {
  if (ficha.origem !== "ABERTURA") return ficha.cnpj ? [] : ["CNPJ"];
  const d = ficha.dados || {};
  return [[ficha.responsavelNome || d.responsavelNome, "Nome do responsável"], [d.atividadePretendida, "Atividade pretendida"],
    [d.municipioAtendimento || d.municipioPretendido, "Município da sede"], [d.enderecoPretendido, "Endereço para viabilidade"]]
    .filter(([v]) => !String(v || "").trim()).map(([, nome]) => nome);
}
function contextoDoDiagnostico(ficha, analiseId) {
  const d = ficha.dados || {};
  return createHash("sha256").update(JSON.stringify([ficha.origem, ficha.cnpj || null, analiseId,
    d.atividadePretendida || null, d.municipioAtendimento || d.municipioPretendido || null, d.enderecoPretendido || null])).digest("hex");
}

// O progresso nasce de provas salvas; abrir uma aba ou enviar um formulário não conclui análise.
export function criarJornadaLead({ db = prisma, cloud = new WhatsappCloudClient(), janela = janelaDaConversa,
  comercial = criarServicoComercial({ db }) } = {}) {
  async function carregar(id, user) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    const [analises, registros, conferencias] = await Promise.all([
      db.onboardingAnalise.findMany({ where: { onboardingId: id, cnpj: ficha.cnpj || "" }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, tipo: true, status: true, cnpj: true, resultado: true, createdAt: true } }),
      db.onboardingEvento.findMany({ where: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 }),
      db.onboardingEvento.findMany({ where: { onboardingId: id, tipo: { in: ["JORNADA_PUBLICA_CONFERIDA", "JORNADA_SITFIS_CONFERIDA"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
    const referencia = contextoDoDiagnostico(ficha, ficha.origem === "ABERTURA" ? null : fiscal?.id || null);
    const diagnostico = registros[0]?.dados?.contexto === referencia ? registros[0] : null;
    const saidas = diagnostico ? await db.mensagemWhatsapp.findMany({ where: { direcao: "out", referenciaComercial: { path: ["diagnosticoId"], equals: diagnostico.id } },
      orderBy: [{ registradaEm: "desc" }, { id: "desc" }], select: { id: true, statusEnvio: true, referenciaComercial: true, erroEnvioMensagem: true } }) : [];
    const partes = (ficha.origem === "ABERTURA" ? ["TEXTO"] : ["RELATORIO", "TEXTO"]).map(parte => {
      const saida = saidas.find(s => s.referenciaComercial?.parte === parte);
      return { parte, mensagemId: saida?.id || null, status: saida?.statusEnvio || "nao_enviado", erro: saida?.erroEnvioMensagem || null };
    });
    const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA");
    return { analises, encerrado: encerrado(ficha), dadosPendentes: dadosIniciaisPendentes(ficha), diagnostico,
      publicaConferida: Boolean(publica && conferencias.some(e => e.tipo === "JORNADA_PUBLICA_CONFERIDA" && e.dados?.analiseId === publica.id)),
      fiscalConferido: Boolean(fiscal && conferencias.some(e => e.tipo === "JORNADA_SITFIS_CONFERIDA" && e.dados?.analiseId === fiscal.id)),
      diagnosticoDesatualizado: Boolean(registros[0] && !diagnostico),
      devolutiva: { partes, concluida: Boolean(diagnostico) && partes.every(p => confirmados.has(p.status)),
        incerta: partes.some(p => ["enviando", "indeterminado"].includes(p.status)) } };
  }

  async function diagnosticar(id, user, body = {}) {
    exigirGestor(user);
    if (!Number.isInteger(body.versao) || body.versao < 0) throw erro("formulario_alterado", "Recarregue a ficha antes do diagnóstico.");
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date() } });
      if (!Number.isInteger(body.versao) || !reserva.count) throw erro("formulario_alterado", "A ficha mudou. Recarregue e confira o diagnóstico.");
      if (dadosIniciaisPendentes(ficha).length) throw erro("dados_incompletos", "Conclua os dados iniciais antes de registrar o diagnóstico.");
      if (![body.achados, body.servicos].every(t => typeof t === "string" && t.trim().length >= 10 && t.length <= 1200)) throw erro("diagnostico_incompleto", "Descreva o que foi conferido e os serviços necessários (10 a 1.200 caracteres por campo).");
      let analiseId = null;
      if (ficha.origem !== "ABERTURA") {
        const fiscal = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: "SITFIS", status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
        if (!fiscal?.resultado?.relatorioDisponivel || fiscal.id !== body.analiseId) throw erro("analise_pendente", "Conclua e confira o relatório fiscal atual antes do diagnóstico.");
        if (!await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_SITFIS_CONFERIDA", dados: { path: ["analiseId"], equals: fiscal.id } } })) throw erro("analise_pendente", "Registre a conferência do relatório antes do diagnóstico.");
        analiseId = fiscal.id;
      }
      const contexto = contextoDoDiagnostico(ficha, analiseId);
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const achados = body.achados.trim(), servicos = body.servicos.trim();
      if (anterior?.dados?.contexto === contexto && anterior.dados.achados === achados && anterior.dados.servicos === servicos) return anterior;
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO", atorId: user.id,
        dados: { contexto, cnpj: ficha.cnpj, origem: ficha.origem, analiseId, achados, servicos,
          texto: `Conferimos ${ficha.origem === "ABERTURA" ? "as informações para a abertura" : `a situação da empresa de CNPJ ${ficha.cnpj}`}:\n\n${achados}\n\nServiços propostos:\n${servicos}\n\nNa próxima etapa, apresentaremos os valores dos serviços e, se desejar, da contabilidade mensal.` } } });
    });
  }

  async function enviarDevolutiva(id, user, body = {}) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    const lead = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null }, include: { conversa: true } });
    const c = lead?.conversa;
    if (encerrado(ficha) || !c || c.portalClientId || c.excluidaEm) throw erro("conversa_indisponivel", "Abra a conversa ativa deste lead.");
    const lease = await adquirirLease(`jornada:${id}`, { client: db });
    if (!lease) throw erro("envio_em_andamento", "Já existe um envio em andamento neste atendimento.");
    try {
      const conferir = async () => {
        if (!await renovarLease(lease, { client: db })) throw erro("envio_em_andamento", "A reserva do envio expirou. Confira o histórico.");
        const [atual, jornada, vinculo] = await Promise.all([
          db.conversaWhatsapp.findUnique({ where: { id: c.id } }), carregar(id, user),
          db.atendimentoLead.findFirst({ where: { id: lead.id, onboardingId: id, encerradoEm: null } }),
        ]);
        if (!vinculo || jornada.encerrado || !jornada.diagnostico || jornada.diagnostico.id !== body.diagnosticoId || !atual || atual.excluidaEm || atual.portalClientId
          || atual.telefoneE164 !== c.telefoneE164 || String(atual.automacaoInvalidadaEm) !== String(c.automacaoInvalidadaEm)) throw erro("atendimento_alterado", "O atendimento ou diagnóstico mudou. Confira antes de enviar.");
        if ((await janela(c.id)).situacao !== "ABERTA") throw erro("FORA_DA_JANELA", "Aguarde uma mensagem do lead para reabrir a janela de resposta do WhatsApp.");
        return jornada;
      };
      const jornada = await conferir();
      if (jornada.devolutiva.incerta) throw erro("envio_incerto", "Há um envio sem confirmação. Confira o histórico antes de qualquer nova tentativa.");
      if (jornada.devolutiva.concluida) return { jaEnviada: true };
      await db.conversaWhatsapp.update({ where: { id: c.id }, data: { atendidaPor: user.id, atendidaDesde: new Date() } });
      for (const parte of jornada.devolutiva.partes) {
        if (confirmados.has(parte.status)) continue;
        const pdf = parte.parte === "RELATORIO" ? await comercial.documento(id, jornada.diagnostico.dados.analiseId, user) : null;
        const texto = jornada.diagnostico.dados.texto;
        await enviarMensagemRastreada({ conversa: c, autor: "HUMANO", client: db,
          tipo: pdf ? "document" : "text", corpo: pdf ? `Relatório fiscal · CNPJ ${ficha.cnpj}` : texto,
          referenciaComercial: { tipo: "JORNADA_DEVOLUTIVA", diagnosticoId: jornada.diagnostico.id, parte: parte.parte },
          antesDeEnviar: conferir,
          enviar: () => pdf ? cloud.enviarDocumento({ telefone: c.telefoneE164, conteudo: pdf, mimeType: "application/pdf", nomeArquivo: "situacao-fiscal.pdf", legenda: `Situação fiscal · CNPJ ${ficha.cnpj}` }) : cloud.enviarTexto({ telefone: c.telefoneE164, texto }),
        });
      }
      return { enviada: true };
    } finally { await liberarLease(lease, { client: db }); }
  }
  async function confirmarPagamento(id, user, body = {}) {
    exigirGestor(user);
    if (typeof body.contratoId !== "string" || !body.contratoId || typeof body.evidencia !== "string" || body.evidencia.trim().length < 10 || body.evidencia.length > 2000) throw erro("pagamento_incompleto", "Registre como o pagamento deste contrato foi conferido.");
    return db.$transaction(async tx => {
      await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro("atendimento_encerrado", "O atendimento já foi encerrado.");
      const c = await tx.contratoComercial.findFirst({ where: { id: body.contratoId, onboardingId: id, status: "ASSINADO_CONFERIDO", proposta: { status: "ACEITA", revogadaEm: null } } });
      if (!c) throw erro("contrato_pendente", "Confira primeiro a assinatura do contrato da proposta aceita.");
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { path: ["contratoId"], equals: c.id } } });
      if (anterior) return anterior;
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", atorId: user.id,
        dados: { contratoId: c.id, evidencia: body.evidencia.trim(), origem: "CONFERENCIA_MANUAL" } } });
    });
  }
  async function conferirAnalise(id, user, body = {}) {
    exigirGestor(user);
    if (!["PUBLICA", "SITFIS"].includes(body.tipo) || !Number.isInteger(body.versao) || typeof body.analiseId !== "string") throw erro("conferencia_invalida", "Confira o resultado atual antes de continuar.");
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro("formulario_alterado", "A ficha mudou. Recarregue antes de conferir.");
      const a = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: body.tipo, status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
      if (!a || a.id !== body.analiseId || (body.tipo === "SITFIS" && !a.resultado?.relatorioDisponivel)) throw erro("analise_pendente", "A análise mudou ou ainda não está concluída.");
      const tipo = `JORNADA_${body.tipo}_CONFERIDA`;
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo, dados: { path: ["analiseId"], equals: a.id } } });
      return anterior || tx.onboardingEvento.create({ data: { onboardingId: id, tipo, atorId: user.id, dados: { analiseId: a.id, cnpj: ficha.cnpj } } });
    });
  }
  return { carregar, diagnosticar, enviarDevolutiva, confirmarPagamento, conferirAnalise };
}
