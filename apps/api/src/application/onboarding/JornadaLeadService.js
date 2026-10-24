import { formatarEnderecoAbertura } from '../../../../../packages/shared/src/onboarding/onboardingSpec.js';
import { createHash } from "node:crypto";
import { conferenciaPdfVigente, hashApresentacao } from './IdentidadeApresentacao.js';
import { contratoAptoPagamento, contextoContrato, pagamentoDoContrato, urlCobrancaSegura } from "../../../../../packages/shared/src/onboarding/contratacaoComercial.js";
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
import { dadosAnaliseDaFicha, normalizarDiagnosticoComercial, pendenciasDiagnosticoComercial, textoDaDevolutiva } from "../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";

const erro = (codigo, mensagem) => new OnboardingError(codigo, mensagem, 409);
const confirmados = new Set(["enviado", "entregue", "lido"]);
export const tiposConferencia = ["JORNADA_PUBLICA_CONFERIDA", "JORNADA_PUBLICA_MANUAL_CONFERIDA", "JORNADA_SITFIS_CONFERIDA", "JORNADA_FISCAL_ALTERNATIVA"];
const limitacaoFiscal = modo => modo === 'MANUAL'
  ? 'Situação fiscal informada manualmente pelo contador, sem consulta oficial válida. Não comprova regularidade fiscal.'
  : 'Etapa fiscal pulada pelo contador, sem consulta oficial válida. Situação e regularidade fiscal não verificadas.';
function alternativaFiscal(conferencias, ficha) {
  const ultima = conferencias.find(e => ['JORNADA_FISCAL_ALTERNATIVA', 'JORNADA_SITFIS_CONFERIDA'].includes(e.tipo) && e.dados?.cnpj === ficha.cnpj);
  return ultima?.tipo === 'JORNADA_FISCAL_ALTERNATIVA' && ultima.dados.origemFicha === ficha.origem ? ultima : null;
}
// JSONB pode devolver as chaves em outra ordem; isso não representa nova análise.
const conteudoCanonico = valor => JSON.stringify(valor, (_, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
function conferenciaPublica(analises, conferencias, ficha) {
  const cadastro = ficha.dados?.cadastroCnpj;
  if (cadastro?.empresa?.cnpj === ficha.cnpj && cadastro?.atorId && cadastro?.em && ['MANUAL', 'CONSULTA'].includes(cadastro.origem)) return {
    id: `cadastro:${ficha.id}:${ficha.dados.cadastroRevisao}`, modo: cadastro.origem, cnpj: ficha.cnpj, origem: ficha.origem,
    conferidaEm: cadastro.em, fonte: cadastro.fonte, cadastroRevisao: ficha.dados.cadastroRevisao,
  };
  const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA" && a.cnpj === ficha.cnpj);
  const evento = conferencias.find(e => e.tipo === "JORNADA_PUBLICA_CONFERIDA" ? Boolean(publica && e.dados?.analiseId === publica.id)
    : e.tipo === "JORNADA_PUBLICA_MANUAL_CONFERIDA" && e.dados?.cnpj === ficha.cnpj && e.dados?.origem === ficha.origem && e.dados?.fonte && e.dados?.evidencia);
  if (!evento) return null;
  return { id: evento.id, modo: evento.tipo === "JORNADA_PUBLICA_MANUAL_CONFERIDA" ? "MANUAL" : "CONSULTA", conferidaEm: evento.createdAt ? new Date(evento.createdAt).toISOString() : null, ...evento.dados };
}
export function dadosIniciaisPendentes(ficha) {
  if (ficha.origem === "PESSOA_FISICA") return [[ficha.responsavelNome || ficha.dados?.responsavelNome, "Nome"], [ficha.dados?.servicoSolicitado, "Serviço solicitado"]].filter(([v]) => !String(v || "").trim()).map(([, n]) => n);
  if (!["ABERTURA", "PESSOA_FISICA"].includes(ficha.origem)) return ficha.cnpj ? [] : ["CNPJ"];
  const d = ficha.dados || {};
  return [[ficha.responsavelNome || d.responsavelNome, "Nome do responsável"], [d.atividadePretendida, "Atividade pretendida"],
    [d.enderecoAbertura?.cidade || d.municipioAtendimento || d.municipioPretendido, "Município da sede"], [(formatarEnderecoAbertura(d.enderecoAbertura) || d.enderecoPretendido), "Endereço para viabilidade"]]
    .filter(([v]) => !String(v || "").trim()).map(([, nome]) => nome);
}
function perfilDaAnalise(ficha) {
  const d = ficha.dados || {};
  return Object.fromEntries(Object.entries({ regime: d.regimeAtual || d.regimePretendido, qtdFuncionarios: d.qtdFuncionarios, notasEmitidasMes: d.notasEmitidasMes, faturamentoMensal: d.faturamentoMensal, notasRecebidasMes: d.notasRecebidasMes, consultoriaMensal: d.consultoriaMensal, pretendeReativar: d.pretendeReativar }).filter(([, v]) => v != null && v !== ""));
}
function contextoDoDiagnostico(ficha, analiseId, conferencia = null, roteiroVersao = 0, perfilConferido = {}, fiscalAlternativa = null) {
  const d = ficha.dados || {};
  const partes = [ficha.origem, ficha.cnpj || null, analiseId,
    d.atividadePretendida || null, d.enderecoAbertura?.cidade || d.municipioAtendimento || d.municipioPretendido || null, (formatarEnderecoAbertura(d.enderecoAbertura) || d.enderecoPretendido) || null];
  if (ficha.origem === "PESSOA_FISICA") partes.push(d.servicoSolicitado || null, d.responsavelCpf || null, ficha.responsavelNome || d.responsavelNome || null);
  // Preserva os hashes anteriores de conferências por consulta oficial.
  if (conferencia?.modo === "MANUAL") partes.push("CADASTRO_MANUAL", conferencia.id);
  if (fiscalAlternativa) partes.push('FISCAL_ALTERNATIVA', fiscalAlternativa.id);
  if (d.cadastroRevisao) partes.push('CADASTRO_REVISAO', d.cadastroRevisao);
  if (d.socios?.length || d.titular?.length) partes.push('PESSOAS', d.tipoEmpresa || null, d.socios || [], d.titular || []);
  if (roteiroVersao) {
    const atual = perfilDaAnalise(ficha);
    // Preencher um dado antes ausente não invalida uma análise que não o usou.
    // Alterar um dado efetivamente conferido exige revisão, inclusive zero/false.
    partes.push("ROTEIRO", roteiroVersao, Object.keys(perfilConferido).sort().map(k => [k, atual[k] ?? null]));
  }
  return createHash("sha256").update(JSON.stringify(partes)).digest("hex");
}

// Leitura interna: o chamador deve ter autorizado a ficha; não produz efeitos.
export async function carregarEvidenciasJornada(ficha, db = prisma, leituras = null) {
  const id = ficha.id;
    const [analises, registros, conferencias] = leituras ? [leituras.analises, leituras.registros, leituras.conferencias] : await Promise.all([
      db.onboardingAnalise.findMany({ where: { onboardingId: id, cnpj: ficha.cnpj || "" }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, tipo: true, status: true, cnpj: true, resultado: true, createdAt: true } }),
      db.onboardingEvento.findMany({ where: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 }),
      db.onboardingEvento.findMany({ where: { onboardingId: id, tipo: { in: tiposConferencia } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
    ]);
    const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
    const publicaConferencia = conferenciaPublica(analises, conferencias, ficha);
    const fiscalAlternativa = alternativaFiscal(conferencias, ficha);
    const referencia = contextoDoDiagnostico(ficha, ["ABERTURA", "PESSOA_FISICA"].includes(ficha.origem) || registros[0]?.dados?.dispensaConsultaPrivada ? null : fiscal?.id || null, publicaConferencia, registros[0]?.dados?.roteiro?.versao, registros[0]?.dados?.perfilConferido, fiscalAlternativa);
    const diagnostico = registros[0]?.dados?.contexto === referencia ? registros[0] : null;
    const saidas = diagnostico ? (leituras ? leituras.saidas.filter(s => s.referenciaComercial?.diagnosticoId === diagnostico.id) : await db.mensagemWhatsapp.findMany({ where: { direcao: "out", referenciaComercial: { path: ["diagnosticoId"], equals: diagnostico.id } },
      orderBy: [{ registradaEm: "desc" }, { id: "desc" }], select: { id: true, statusEnvio: true, referenciaComercial: true, erroEnvioMensagem: true } })) : [];
    const partes = (["ABERTURA", "PESSOA_FISICA"].includes(ficha.origem) || diagnostico?.dados?.dispensaConsultaPrivada ? ["TEXTO"] : ["RELATORIO", "TEXTO"]).map(parte => {
      const saida = saidas.find(s => s.referenciaComercial?.parte === parte);
      return { parte, mensagemId: saida?.id || null, status: saida?.statusEnvio || "nao_enviado", erro: saida?.erroEnvioMensagem || null };
    });
    const registroApresentacao = diagnostico ? (leituras ? leituras.apresentacoes.find(e => e.dados?.diagnosticoId === diagnostico.id) || null : await db.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_DEVOLUTIVA_CONFERIDA", dados: { path: ["diagnosticoId"], equals: diagnostico.id } }, orderBy: { createdAt: "desc" } })) : null;
    const fiscalApresentacao = diagnostico?.dados?.analiseId ? analises.find(a => a.id === diagnostico.dados.analiseId && a.cnpj === ficha.cnpj && a.tipo === 'SITFIS' && a.status === 'CONCLUIDA') : null;
    const conferenciaPdf = conferenciaPdfVigente(registroApresentacao, ficha, diagnostico, fiscalApresentacao) ? registroApresentacao : null;
    const apresentacao = registroApresentacao?.dados?.origem === 'PDF_CONTADOR' ? conferenciaPdf : registroApresentacao;
    const apresentacaoEnviada = diagnostico && saidas.find(s => s.referenciaComercial?.tipo === 'APRESENTACAO_DIAGNOSTICO'
      && s.referenciaComercial?.cadastroRevisao === (ficha.dados?.cadastroRevisao || 0)
      && s.referenciaComercial?.diagnosticoContexto === diagnostico.dados?.contexto
      && Number.isInteger(s.referenciaComercial?.fichaVersao)
      && s.referenciaComercial?.apresentacaoChave === hashApresentacao({ ...ficha, versao: s.referenciaComercial.fichaVersao }, diagnostico, fiscalApresentacao)
      && confirmados.has(s.statusEnvio));
    return { analises, encerrado: encerrado(ficha), dadosPendentes: dadosIniciaisPendentes(ficha), diagnostico,
      diagnosticoPendencias: pendenciasDiagnosticoComercial(diagnostico?.dados, ficha.origem),
      publicaConferida: Boolean(publicaConferencia), publicaConferencia,
      fiscalAlternativa,
      fiscalConferido: Boolean(!fiscalAlternativa && fiscal && conferencias.some(e => e.tipo === "JORNADA_SITFIS_CONFERIDA" && e.dados?.analiseId === fiscal.id)),
      diagnosticoDesatualizado: Boolean(registros[0] && !diagnostico),
      diagnosticoAnterior: !diagnostico && registros[0] ? registros[0].dados : null,
      diagnosticoAnteriorId: !diagnostico ? registros[0]?.id || null : null,
      devolutiva: { partes, apresentacao, conferenciaPdf, apresentacaoEnviada: apresentacaoEnviada || null, concluida: Boolean(diagnostico) && (Boolean(apresentacao) || Boolean(apresentacaoEnviada) || partes.every(p => confirmados.has(p.status))),
        incerta: partes.some(p => ["enviando", "indeterminado"].includes(p.status)) } };
  }

// O progresso nasce de provas salvas; abrir uma aba ou enviar um formulário não conclui análise.
export function criarJornadaLead({ db = prisma, cloud = null, janela = janelaDaConversa,
  comercial = criarServicoComercial({ db }) } = {}) {
  async function carregar(id, user) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    return carregarEvidenciasJornada(ficha, db);
  }

  async function diagnosticar(id, user, body = {}) {
    exigirGestor(user);
    if (!Number.isInteger(body.versao) || body.versao < 0) throw erro("formulario_alterado", "Recarregue a ficha antes do diagnóstico.");
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: body.versao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date() } });
      if (!Number.isInteger(body.versao) || !reserva.count) throw erro("formulario_alterado", "A ficha mudou. Recarregue e confira o diagnóstico.");
      if (dadosIniciaisPendentes(ficha).length) throw erro("dados_incompletos", "Conclua os dados iniciais antes de registrar o diagnóstico.");
      if (typeof body.servicos !== "string" || body.servicos.trim().length < 10 || body.servicos.length > 1200) throw erro("diagnostico_incompleto", "Descreva os serviços necessários (10 a 1.200 caracteres).");
      let analiseId = null;
      let conferenciaCadastro = null;
      let fiscalAlternativa = null;
      let dispensaConsultaPrivada = typeof body.dispensaConsultaPrivada === "string" ? body.dispensaConsultaPrivada.trim() : null;
      if (dispensaConsultaPrivada && (dispensaConsultaPrivada.length < 20 || dispensaConsultaPrivada.length > 1200)) throw erro("escopo_limitado_invalido", "Descreva a limitação do serviço sem consulta privada (20 a 1.200 caracteres).");
      if (!["ABERTURA", "PESSOA_FISICA"].includes(ficha.origem)) {
        const publica = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: "PUBLICA", status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
        const conferencias = await tx.onboardingEvento.findMany({ where: { onboardingId: id, tipo: { in: tiposConferencia } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
        fiscalAlternativa = alternativaFiscal(conferencias, ficha);
        if (fiscalAlternativa) dispensaConsultaPrivada = fiscalAlternativa.dados.limitacao;
        conferenciaCadastro = conferenciaPublica(publica ? [publica] : [], conferencias, ficha);
        if (!conferenciaCadastro) throw erro("analise_pendente", "Confira os dados cadastrais pela consulta ou registre a fonte e a evidência da conferência manual.");
      }
      if (!["ABERTURA", "PESSOA_FISICA"].includes(ficha.origem) && !dispensaConsultaPrivada) {
        const fiscal = await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: ficha.cnpj, tipo: "SITFIS", status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } });
        if (!fiscal?.resultado?.relatorioDisponivel || fiscal.id !== body.analiseId) throw erro("analise_pendente", "Conclua e confira o relatório fiscal atual antes do diagnóstico.");
        if (!await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_SITFIS_CONFERIDA", dados: { path: ["analiseId"], equals: fiscal.id } } })) throw erro("analise_pendente", "Registre a conferência do relatório antes do diagnóstico.");
        analiseId = fiscal.id;
      }
      const estruturado = normalizarDiagnosticoComercial({ ...body, roteiro: { ...body.roteiro, dados: dadosAnaliseDaFicha(ficha, body.roteiro?.dados) } }, ficha.origem);
      const perfilConferido = perfilDaAnalise(ficha);
      const contexto = contextoDoDiagnostico(ficha, analiseId, conferenciaCadastro, estruturado.roteiro.versao, perfilConferido, fiscalAlternativa);
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const achados = Object.values(estruturado.devolutiva).join("\n\n"), servicos = body.servicos.trim();
      if (anterior?.dados?.contexto === contexto && anterior.dados.achados === achados && anterior.dados.servicos === servicos && (anterior.dados.dispensaConsultaPrivada || null) === dispensaConsultaPrivada
        && conteudoCanonico(anterior.dados.roteiro) === conteudoCanonico(estruturado.roteiro) && conteudoCanonico(anterior.dados.regularizacao) === conteudoCanonico(estruturado.regularizacao)) return anterior;
      if (Object.hasOwn(body, "diagnosticoBaseId") && body.diagnosticoBaseId !== (anterior?.id || null)) throw erro("diagnostico_alterado", "Outro atendente atualizou o diagnóstico. Confira a versão atual antes de salvar.");
      const texto = textoDaDevolutiva({ ...estruturado, servicos, dispensaConsultaPrivada }, { cnpj: ficha.cnpj, pessoaFisica: ficha.origem === "PESSOA_FISICA", manual: conferenciaCadastro?.modo === "MANUAL" });
      if (texto.length > 3800) throw erro("diagnostico_incompleto", "Resuma a devolutiva e o escopo para até 3.800 caracteres no total, incluindo as limitações e pendências.");
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "JORNADA_DIAGNOSTICO", atorId: user.id,
        dados: { contexto, cnpj: ficha.cnpj, origem: ficha.origem, fichaVersao: ficha.versao, cadastroRevisao: ficha.dados?.cadastroRevisao || 0, perfilConferido, analiseId, achados, servicos, dispensaConsultaPrivada, fiscalAlternativa, conferenciaCadastro, ...estruturado, texto } } });
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
    let fiscalConferido = null;
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
        if (jornada.diagnostico?.dados?.analiseId && !jornada.diagnostico.dados.dispensaConsultaPrivada) {
          const prova = await comercial.conferirEnvioFiscal(id, jornada.diagnostico.dados.analiseId, user);
          if (fiscalConferido && prova !== fiscalConferido) throw erro('relatorio_alterado', 'O relatório ou a autorização mudou. Revise a devolutiva.');
          fiscalConferido = prova;
        }
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
    if (!Number.isInteger(body.versao) || body.versao < 0 || !Number.isInteger(body.propostaVersao)
      || typeof body.contratoId !== 'string' || !body.contratoId || body.confirmado !== true
      || !Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0
      || typeof body.referencia !== 'string' || body.referencia.trim().length < 3 || body.referencia.length > 2000
      || typeof body.contratoRevisao !== 'string') throw erro('pagamento_incompleto', 'Confirme o recebimento, valor, referência e revisão do contrato.');
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro("atendimento_encerrado", "O atendimento já foi encerrado.");
      const c = await tx.contratoComercial.findFirst({ where: { id: body.contratoId, onboardingId: id }, include: { proposta: true } });
      const p = c?.proposta;
      if ((p?.snapshot?.cadastroRevisao || 0) !== (ficha.dados?.cadastroRevisao || 0)) throw erro('contrato_desatualizado', 'O cadastro mudou. Revise a contratação antes de confirmar o recebimento.');
      if (!contratoAptoPagamento(p, c) || p.versao !== body.propostaVersao || !c.aprovadoEm
        || new Date(c.aprovadoEm).toISOString() !== body.contratoRevisao) throw erro('contrato_pendente', 'Confira o contrato aprovado e a revisão da proposta aceita.');
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { path: ["contratoId"], equals: c.id } } });
      if (anterior) {
        if (pagamentoDoContrato(p, c, [anterior]) && (anterior.dados.politica !== 'R35'
          || anterior.dados.valorCentavos === body.valorCentavos && anterior.dados.referencia === body.referencia.trim())) return anterior;
        throw erro('pagamento_divergente', 'Há confirmação anterior diferente. Confira o histórico.');
      }
      if (ficha.versao !== body.versao) throw erro('formulario_alterado', 'A ficha mudou. Recarregue antes de confirmar.');
      const { conferirDiagnosticoDaProposta } = await import('./PropostasComerciaisService.js');
      await conferirDiagnosticoDaProposta(tx, p);
      const atualizada = await tx.onboarding.updateMany({ where: { id, versao: body.versao }, data: { versao: { increment: 1 } } });
      if (!atualizada.count) throw erro('formulario_alterado', 'A ficha mudou. Recarregue antes de confirmar.');
      const { habilitarImplantacaoContratada } = await import('./PropostasComerciaisService.js');
      await habilitarImplantacaoContratada(tx, id, c, ficha);
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", atorId: user.id,
        dados: { contratoId: c.id, propostaId: p.id, propostaVersao: p.versao, fichaVersao: body.versao,
          contextoContrato: contextoContrato(p, c), politica: 'R35', confirmadoEm: new Date().toISOString(),
          valorCentavos: body.valorCentavos, referencia: body.referencia.trim(), origem: "CONFERENCIA_MANUAL" } } });
    });
  }
  async function registrarFiscalAlternativa(id, user, body = {}) {
    exigirGestor(user);
    if (!Number.isInteger(body.versao) || body.versao < 0 || !['MANUAL', 'PULADA'].includes(body.modo)
      || body.modo === 'MANUAL' && (typeof body.informacao !== 'string' || !body.informacao.trim() || body.informacao.length > 4000)) throw erro('fiscal_alternativa_invalida', 'Informe a versão e os dados fiscais manuais, ou escolha pular.');
    return db.$transaction(async tx => {
      const ficha = await exigirEscopo(id, user, tx);
      if (!/^\d{14}$/.test(ficha.cnpj || '') || ['ABERTURA', 'PESSOA_FISICA'].includes(ficha.origem)) throw erro('cnpj_necessario', 'Esta etapa exige uma ficha empresarial com CNPJ.');
      const dados = { cnpj: ficha.cnpj, origemFicha: ficha.origem, fichaVersao: body.versao, modo: body.modo,
        origem: 'CONTADOR', consultaOficialValida: false, informacao: body.modo === 'MANUAL' ? body.informacao.trim() : null,
        limitacao: limitacaoFiscal(body.modo) };
      const reserva = await tx.onboarding.updateMany({ where: { id, status: { notIn: ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro('atendimento_encerrado', 'O atendimento está encerrado.');
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: 'JORNADA_FISCAL_ALTERNATIVA' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (anterior && conteudoCanonico(anterior.dados) === conteudoCanonico(dados)) return anterior;
      const atualizada = await tx.onboarding.updateMany({ where: { id, versao: body.versao }, data: { versao: { increment: 1 } } });
      if (!atualizada.count) throw erro('formulario_alterado', 'A ficha mudou. Recarregue antes de salvar.');
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'JORNADA_FISCAL_ALTERNATIVA', atorId: user.id, dados } });
    });
  }
  async function registrarCobrancaExterna(id, user, body = {}) {
    exigirGestor(user);
    if (!Number.isInteger(body.versao) || body.versao < 0 || typeof body.contratoId !== 'string'
      || !Number.isInteger(body.propostaVersao) || !Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0
      || typeof body.referencia !== 'string' || body.referencia.trim().length < 3 || body.referencia.length > 2000) throw erro('cobranca_invalida', 'Confira versão, contrato, valor e referência da cobrança.');
    let url = null;
    if (body.url != null) {
      url = urlCobrancaSegura(body.url);
      if (!url) throw erro('cobranca_url_invalida', 'Use um link HTTPS público sem credenciais.');
    }
    if (!url && (typeof body.documentoId !== 'string' || !body.documentoId)) throw erro('cobranca_invalida', 'Informe link HTTPS ou documento da ficha.');
    return db.$transaction(async tx => {
      await exigirEscopo(id, user, tx);
      const reserva = await tx.onboarding.updateMany({ where: { id, status: { notIn: ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'] } }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw erro('atendimento_encerrado', 'O atendimento está encerrado.');
      const c = await tx.contratoComercial.findFirst({ where: { id: body.contratoId, onboardingId: id }, include: { proposta: true } });
      if (!contratoAptoPagamento(c?.proposta, c) || c.proposta.versao !== body.propostaVersao) throw erro('contrato_pendente', 'Confira o contrato e a proposta aceita.');
      if (body.documentoId != null && (typeof body.documentoId !== 'string' || !await tx.documentoOnboarding.findFirst({ where: { id: body.documentoId, onboardingId: id } }))) throw erro('documento_invalido', 'Documento não pertence à ficha.');
      const dados = { contratoId: c.id, propostaId: c.proposta.id, propostaVersao: c.proposta.versao,
        contextoContrato: contextoContrato(c.proposta, c), fichaVersao: body.versao, valorCentavos: body.valorCentavos,
        referencia: body.referencia.trim(), url, documentoId: body.documentoId || null, origem: 'EXTERNA', pagamentoConfirmado: false };
      const anterior = await tx.onboardingEvento.findFirst({ where: { onboardingId: id, tipo: 'COBRANCA_EXTERNA_REGISTRADA' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (anterior && conteudoCanonico(anterior.dados) === conteudoCanonico(dados)) return anterior;
      const atualizada = await tx.onboarding.updateMany({ where: { id, versao: body.versao }, data: { versao: { increment: 1 } } });
      if (!atualizada.count) throw erro('formulario_alterado', 'A ficha mudou. Recarregue antes de salvar.');
      return tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'COBRANCA_EXTERNA_REGISTRADA', atorId: user.id, dados } });
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
      const ultimaFiscal = body.tipo === 'SITFIS' ? await tx.onboardingEvento.findFirst({ where: { onboardingId: id,
        tipo: { in: ['JORNADA_FISCAL_ALTERNATIVA', 'JORNADA_SITFIS_CONFERIDA'] }, dados: { path: ['cnpj'], equals: ficha.cnpj } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : null;
      return (ultimaFiscal?.tipo !== 'JORNADA_FISCAL_ALTERNATIVA' && anterior) || tx.onboardingEvento.create({ data: { onboardingId: id, tipo, atorId: user.id, dados: { analiseId: a.id, cnpj: ficha.cnpj } } });
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
  return { carregar, diagnosticar, enviarDevolutiva, confirmarPagamento, registrarFiscalAlternativa, registrarCobrancaExterna, conferirAnalise, registrarApresentacao };
}
