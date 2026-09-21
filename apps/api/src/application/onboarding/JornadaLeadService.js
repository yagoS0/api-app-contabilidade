import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { criarServicoComercial, exigirEscopo } from "./ComercialService.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { OnboardingError } from "./OnboardingService.js";
import { encerrado } from "./LeadService.js";
import { enviarMensagemRastreada } from "../whatsapp/SaidaWhatsappService.js";
import { assinarMensagemHumana } from "../whatsapp/assinaturaAtendente.js";
import { janelaDaConversa } from "../whatsapp/ConversaWhatsappService.js";
import { whatsappPorCanal } from "../whatsapp/CanalWhatsappService.js";
import { adquirirLease, renovarLease, liberarLease } from "../whatsapp/WhatsappLeaseService.js";
import { exigirConversaDoCaso, capturarIdentidadeComercial, conferirIdentidadeComercial, assumirEnvioComercial } from "./ContextoComercialService.js";
import { resolverConversaEnvioComercial } from "./CanalEnvioComercialService.js";

const erro = (codigo, mensagem) => new OnboardingError(codigo, mensagem, 409);
const confirmados = new Set(["enviado", "entregue", "lido"]);
const tiposConferencia = ["JORNADA_PUBLICA_CONFERIDA", "JORNADA_PUBLICA_MANUAL_CONFERIDA", "JORNADA_SITFIS_CONFERIDA"];
function conferenciaPublica(analises, conferencias, ficha) {
  const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA" && a.cnpj === ficha.cnpj);
  const evento = conferencias.find(e => e.tipo === "JORNADA_PUBLICA_CONFERIDA" ? Boolean(publica && e.dados?.analiseId === publica.id)
    : e.tipo === "JORNADA_PUBLICA_MANUAL_CONFERIDA" && e.dados?.cnpj === ficha.cnpj && e.dados?.origem === ficha.origem && e.dados?.fonte && e.dados?.evidencia);
  if (!evento) return null;
  return { id: evento.id, modo: evento.tipo === "JORNADA_PUBLICA_MANUAL_CONFERIDA" ? "MANUAL" : "CONSULTA", conferidaEm: evento.createdAt ? new Date(evento.createdAt).toISOString() : null, ...evento.dados };
}
export function dadosIniciaisPendentes(ficha) {
  if (ficha.origem !== "ABERTURA") return ficha.cnpj ? [] : ["CNPJ"];
  const d = ficha.dados || {};
  return [[ficha.responsavelNome || d.responsavelNome, "Nome do responsável"], [d.atividadePretendida, "Atividade pretendida"],
    [d.municipioAtendimento || d.municipioPretendido, "Município da sede"], [d.enderecoPretendido, "Endereço para viabilidade"]]
    .filter(([v]) => !String(v || "").trim()).map(([, nome]) => nome);
}
function contextoDoDiagnostico(ficha, analiseId, conferencia = null) {
  const d = ficha.dados || {};
  const partes = [ficha.origem, ficha.cnpj || null, analiseId,
    d.atividadePretendida || null, d.municipioAtendimento || d.municipioPretendido || null, d.enderecoPretendido || null];
  // Preserva os hashes anteriores de conferências por consulta oficial.
  if (conferencia?.modo === "MANUAL") partes.push("CADASTRO_MANUAL", conferencia.id);
  return createHash("sha256").update(JSON.stringify(partes)).digest("hex");
}

// O progresso nasce de provas salvas; abrir uma aba ou enviar um formulário não conclui análise.
export function criarJornadaLead({ db = prisma, cloud = null, janela = janelaDaConversa,
  comercial = criarServicoComercial({ db }) } = {}) {
  async function carregar(id, user) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    const [analises, registros, conferencias] = await Promise.all([
      db.onboardingAnalise.findMany({ where: { onboardingId: id, cnpj: ficha.cnpj || "" }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, tipo: true, status: true, cnpj: true, resultado: true, createdAt: true } }),
      db.onboardingEvento.findMany({ where: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 }),
      db.onboardingEvento.findMany({ where: { onboardingId: id, tipo: { in: tiposConferencia } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
    ]);
    const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
    const publicaConferencia = conferenciaPublica(analises, conferencias, ficha);
    const referencia = contextoDoDiagnostico(ficha, ficha.origem === "ABERTURA" || registros[0]?.dados?.dispensaConsultaPrivada ? null : fiscal?.id || null, publicaConferencia);
    const diagnostico = registros[0]?.dados?.contexto === referencia ? registros[0] : null;
    const saidas = diagnostico ? await db.mensagemWhatsapp.findMany({ where: { direcao: "out", referenciaComercial: { path: ["diagnosticoId"], equals: diagnostico.id } },
      orderBy: [{ registradaEm: "desc" }, { id: "desc" }], select: { id: true, statusEnvio: true, referenciaComercial: true, erroEnvioMensagem: true } }) : [];
    const partes = (ficha.origem === "ABERTURA" || diagnostico?.dados?.dispensaConsultaPrivada ? ["TEXTO"] : ["RELATORIO", "TEXTO"]).map(parte => {
      const saida = saidas.find(s => s.referenciaComercial?.parte === parte);
      return { parte, mensagemId: saida?.id || null, status: saida?.statusEnvio || "nao_enviado", erro: saida?.erroEnvioMensagem || null };
    });
    const apresentacao = diagnostico ? await db.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_DEVOLUTIVA_CONFERIDA", dados: { path: ["diagnosticoId"], equals: diagnostico.id } }, orderBy: { createdAt: "desc" } }) : null;
    return { analises, encerrado: encerrado(ficha), dadosPendentes: dadosIniciaisPendentes(ficha), diagnostico,
      publicaConferida: Boolean(publicaConferencia), publicaConferencia,
      fiscalConferido: Boolean(fiscal && conferencias.some(e => e.tipo === "JORNADA_SITFIS_CONFERIDA" && e.dados?.analiseId === fiscal.id)),
      diagnosticoDesatualizado: Boolean(registros[0] && !diagnostico),
      diagnosticoAnterior: !diagnostico && registros[0] ? registros[0].dados : null,
      devolutiva: { partes, apresentacao, concluida: Boolean(diagnostico) && (Boolean(apresentacao) || partes.every(p => confirmados.has(p.status))),
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
      let conferenciaCadastro = null;
      const dispensaConsultaPrivada = typeof body.dispensaConsultaPrivada === "string" ? body.dispensaConsultaPrivada.trim() : null;
      if (dispensaConsultaPrivada && (dispensaConsultaPrivada.length < 20 || dispensaConsultaPrivada.length > 1200)) throw erro("escopo_limitado_invalido", "Descreva a limitação do serviço sem consulta privada (20 a 1.200 caracteres).");
      if (ficha.origem !== "ABERTURA") {
        const publica = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: "PUBLICA", status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
        const conferencias = await tx.onboardingEvento.findMany({ where: { onboardingId: id, tipo: { in: tiposConferencia } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
        conferenciaCadastro = conferenciaPublica(publica ? [publica] : [], conferencias, ficha);
        if (!conferenciaCadastro) throw erro("analise_pendente", "Confira os dados cadastrais pela consulta ou registre a fonte e a evidência da conferência manual.");
      }
      if (ficha.origem !== "ABERTURA" && !dispensaConsultaPrivada) {
        const fiscal = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: "SITFIS", status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
        if (!fiscal?.resultado?.relatorioDisponivel || fiscal.id !== body.analiseId) throw erro("analise_pendente", "Conclua e confira o relatório fiscal atual antes do diagnóstico.");
        if (!await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_SITFIS_CONFERIDA", dados: { path: ["analiseId"], equals: fiscal.id } } })) throw erro("analise_pendente", "Registre a conferência do relatório antes do diagnóstico.");
        analiseId = fiscal.id;
      }
      const contexto = contextoDoDiagnostico(ficha, analiseId, conferenciaCadastro);
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const achados = body.achados.trim(), servicos = body.servicos.trim();
      if (anterior?.dados?.contexto === contexto && anterior.dados.achados === achados && anterior.dados.servicos === servicos && (anterior.dados.dispensaConsultaPrivada || null) === dispensaConsultaPrivada) return anterior;
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO", atorId: user.id,
        dados: { contexto, cnpj: ficha.cnpj, origem: ficha.origem, analiseId, achados, servicos, dispensaConsultaPrivada, conferenciaCadastro,
          texto: `Conferimos ${ficha.origem === "ABERTURA" ? "as informações para a abertura" : `as informações do atendimento da empresa de CNPJ ${ficha.cnpj}`}:\n\n${achados}${conferenciaCadastro?.modo === "MANUAL" ? "\n\nDados cadastrais conferidos manualmente pelo escritório; consulta automática não utilizada. Esta conferência não comprova regularidade fiscal." : ""}\n\nServiços propostos:\n${servicos}${dispensaConsultaPrivada ? `\n\nLimitação do escopo, sem consulta fiscal privada: ${dispensaConsultaPrivada}` : ""}\n\nNa próxima etapa, apresentaremos os valores dos serviços e, se desejar, da contabilidade mensal.` } } });
    });
  }

  async function enviarDevolutiva(id, user, body = {}) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    const lead = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null }, include: { conversa: true } });
    const c = await resolverConversaEnvioComercial({ caso: lead, conversaId: body.conversaId, db });
    if (encerrado(ficha) || !c || c.excluidaEm) throw erro("conversa_indisponivel", "Abra a conversa ativa deste atendimento.");
    await exigirConversaDoCaso(lead, c, db);
    const identidade = await capturarIdentidadeComercial(c, db);
    const transporte = await whatsappPorCanal(c, { cloud, client: db });
    const lease = await adquirirLease(`jornada:${id}`, { client: db });
    if (!lease) throw erro("envio_em_andamento", "Já existe um envio em andamento neste atendimento.");
    try {
      const conferir = async () => {
        if (!await renovarLease(lease, { client: db })) throw erro("envio_em_andamento", "A reserva do envio expirou. Confira o histórico.");
        const [atual, jornada, vinculo] = await Promise.all([
          db.conversaWhatsapp.findUnique({ where: { id: c.id } }), carregar(id, user),
          db.atendimentoLead.findFirst({ where: { id: lead.id, onboardingId: id, encerradoEm: null } }),
        ]);
        if (!vinculo || jornada.encerrado || !jornada.diagnostico || jornada.diagnostico.id !== body.diagnosticoId || !atual || atual.excluidaEm
          || atual.telefoneE164 !== c.telefoneE164 || atual.canalId !== c.canalId || atual.vinculoNumeroId !== c.vinculoNumeroId || String(atual.automacaoInvalidadaEm) !== String(c.automacaoInvalidadaEm)) throw erro("atendimento_alterado", "O atendimento ou diagnóstico mudou. Confira antes de enviar.");
        if ((await janela(c.id)).situacao !== "ABERTA") throw erro("FORA_DA_JANELA", "Aguarde uma mensagem do lead para reabrir a janela de resposta do WhatsApp.");
        await exigirConversaDoCaso(vinculo, atual, db);
        await resolverConversaEnvioComercial({ caso: vinculo, conversaId: c.id, db });
        await conferirIdentidadeComercial(atual, identidade, db);
        return jornada;
      };
      const jornada = await conferir();
      if (jornada.devolutiva.incerta) throw erro("envio_incerto", "Há um envio sem confirmação. Confira o histórico antes de qualquer nova tentativa.");
      if (jornada.devolutiva.concluida) return { jaEnviada: true };
      await assumirEnvioComercial(c, user, identidade, db);
      for (const parte of jornada.devolutiva.partes) {
        if (confirmados.has(parte.status)) continue;
        const pdf = parte.parte === "RELATORIO" ? await comercial.documento(id, jornada.diagnostico.dados.analiseId, user) : null;
        const texto = assinarMensagemHumana(pdf ? `Situação fiscal · CNPJ ${ficha.cnpj}` : jornada.diagnostico.dados.texto, user, { limite: pdf ? 1024 : 4096 });
        await enviarMensagemRastreada({ conversa: c, autor: "HUMANO", client: db,
          tipo: pdf ? "document" : "text", corpo: texto,
          referenciaComercial: { tipo: "JORNADA_DEVOLUTIVA", diagnosticoId: jornada.diagnostico.id, parte: parte.parte },
          antesDeEnviar: conferir,
          enviar: () => pdf ? transporte.enviarDocumento({ telefone: c.telefoneE164, conteudo: pdf, mimeType: "application/pdf", nomeArquivo: "situacao-fiscal.pdf", legenda: texto }) : transporte.enviarTexto({ telefone: c.telefoneE164, texto }),
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
    const manual = body.manual !== undefined;
    if (!["PUBLICA", "SITFIS"].includes(body.tipo) || !Number.isInteger(body.versao) || body.versao < 0 || (manual ? body.tipo !== "PUBLICA" || body.analiseId != null : typeof body.analiseId !== "string")) throw erro("conferencia_invalida", "Confira o resultado atual antes de continuar. A conferência manual é somente cadastral.");
    if (manual && (!body.manual || typeof body.manual.fonte !== "string" || body.manual.fonte.trim().length < 3 || body.manual.fonte.length > 300 || typeof body.manual.evidencia !== "string" || body.manual.evidencia.trim().length < 10 || body.manual.evidencia.length > 2000)) throw erro("conferencia_manual_invalida", "Informe a fonte consultada (3 a 300 caracteres) e o que foi conferido manualmente (10 a 2.000 caracteres).");
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      let anteriorManual = null, igual = false;
      if (manual) {
        if (!/^\d{14}$/.test(ficha.cnpj || "")) throw erro("cnpj_necessario", "Salve o CNPJ completo da empresa antes da conferência manual.");
        anteriorManual = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_PUBLICA_MANUAL_CONFERIDA", dados: { path: ["cnpj"], equals: ficha.cnpj } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        igual = anteriorManual?.dados?.origem === ficha.origem && anteriorManual.dados.fonte === body.manual.fonte.trim() && anteriorManual.dados.evidencia === body.manual.evidencia.trim();
        if (igual && anteriorManual.dados.fichaVersao === body.versao && ficha.versao === body.versao + 1 && !encerrado(ficha)) return anteriorManual;
      }
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date(), ...(manual && !igual ? { versao: { increment: 1 } } : {}) } });
      if (!reserva.count) throw erro("formulario_alterado", "A ficha mudou. Recarregue antes de conferir.");
      if (manual) return igual ? anteriorManual : tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "JORNADA_PUBLICA_MANUAL_CONFERIDA", atorId: user.id, dados: { cnpj: ficha.cnpj, origem: ficha.origem, fichaVersao: body.versao, fonte: body.manual.fonte.trim(), evidencia: body.manual.evidencia.trim() } } });
      const a = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: body.tipo, status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
      if (!a || a.id !== body.analiseId || (body.tipo === "SITFIS" && !a.resultado?.relatorioDisponivel)) throw erro("analise_pendente", "A análise mudou ou ainda não está concluída.");
      const tipo = `JORNADA_${body.tipo}_CONFERIDA`;
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo, dados: { path: ["analiseId"], equals: a.id } } });
      return anterior || tx.onboardingEvento.create({ data: { onboardingId: id, tipo, atorId: user.id, dados: { analiseId: a.id, cnpj: ficha.cnpj } } });
    });
  }
  async function registrarApresentacao(id, user, body = {}) {
    exigirGestor(user);
    if (![body.meio, body.evidencia].every(v => typeof v === "string" && v.trim().length >= 3 && v.length <= 2000) || !Number.isInteger(body.versao)) throw erro("apresentacao_invalida", "Informe meio e evidência da apresentação dos serviços.");
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro("formulario_alterado", "A ficha mudou. Confira a apresentação novamente.");
      const j = await criarJornadaLead({ db: tx }).carregar(id, user);
      if (!j.diagnostico || j.diagnostico.id !== body.diagnosticoId) throw erro("diagnostico_alterado", "Confira o diagnóstico atual antes de registrar a apresentação.");
      return await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_DEVOLUTIVA_CONFERIDA", dados: { path: ["diagnosticoId"], equals: body.diagnosticoId } } }) || tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "JORNADA_DEVOLUTIVA_CONFERIDA", atorId: user.id, dados: { diagnosticoId: body.diagnosticoId, meio: body.meio.trim(), evidencia: body.evidencia.trim(), fichaVersao: ficha.versao } } });
    });
  }
  return { carregar, diagnosticar, enviarDevolutiva, confirmarPagamento, conferirAnalise, registrarApresentacao };
}
