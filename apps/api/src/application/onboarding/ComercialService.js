import { podarInvisiveis } from "@contabilidade/shared/onboarding";
import { lerSitfisPosicional } from "../fiscal/serpro/lerRelatorioSitfis.js";
import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { OnboardingError, extrairColunas } from "./OnboardingService.js";
import { etapasDaOrigem } from "./etapasTemplate.js";
import { consultarCnpj } from "../tomador/consultaCnpj.js";
import { SerproProcurationService } from "../fiscal/serpro/SerproProcurationService.js";
import { obterRelatorio } from "../fiscal/serpro/SerproSitfisService.js";
import { comContextoSerpro } from "../fiscal/serpro/serproCallContext.js";
import { encryptSecret, decryptSecret } from "../../utils/crypto.js";

export const escopoComercial = (user) => ["admin", "contador"].includes(String(user?.role).toLowerCase()) ? {} : { criadoPorId: String(user?.id || "SEM_ACESSO") };
const erro = (code, message, status = 400) => new OnboardingError(code, message, status);
const fechado = (r) => ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(r.status);
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
export async function exigirEscopo(id, user, db = prisma) {
  if (!user?.id) throw erro("unauthorized", "Autenticação obrigatória.", 401);
  const r = await db.onboarding.findUnique({ where: { id: String(id) } });
  const escopo = escopoComercial(user);
  if (!r || (escopo.criadoPorId && r.criadoPorId !== escopo.criadoPorId)) throw erro("onboarding_nao_encontrado", "Onboarding não encontrado.", 404);
  return r;
}
const evento = (db, id, tipo, atorId, dados = {}) => db.onboardingEvento.create({ data: { onboardingId: id, tipo, atorId, dados } });
export function procuracaoHabilitaSitfis(p, agora = new Date()) {
  // Tabela oficial Serviços x Procurações: SITFIS usa 00002 / Situação Fiscal do Contribuinte.
  const nomes = new Set(["sitfis", "00002", "situacao fiscal do contribuinte"]);
  return p?.status === "ATIVA" && Boolean(p.validUntil && new Date(p.validUntil).getTime() > agora.getTime())
    && Array.isArray(p.systems) && p.systems.some((s) => nomes.has(String(typeof s === "string" ? s : s?.idSistema || s?.nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()));
}
export function criarServicoComercial({ db = prisma, consultaPublica = consultarCnpj, procura = (cnpj) => new SerproProcurationService().checkCnpjProcuration({ cnpj }), sitfis = obterRelatorio, cifrar = encryptSecret, decifrar = decryptSecret, agora = () => new Date() } = {}) {
  async function painel(id, user) {
    const r = await exigirEscopo(id, user, db);
    const [analises, eventos, links] = await Promise.all([
      db.onboardingAnalise.findMany({ where: { onboardingId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, tipo: true, status: true, cnpj: true, resultado: true, createdAt: true } }),
      db.onboardingEvento.findMany({ where: { onboardingId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
      db.onboardingLink.findMany({ where: { onboardingId: id }, orderBy: { createdAt: "desc" }, select: { id: true, expiresAt: true, revokedAt: true, submittedAt: true } }),
    ]);
    return { analises, eventos, links, faseComercial: r.faseComercial, proposta: r.proposta };
  }
  async function comercial(id, user, patch) {
    const r = await exigirEscopo(id, user, db);
    if (fechado(r)) throw erro("onboarding_fechado", "Ficha encerrada.", 409);
    if (!patch || Object.keys(patch).some((k) => !["faseComercial", "proposta"].includes(k))) throw erro("dados_invalidos", "Campos comerciais inválidos.");
    const data = {};
    if (patch.faseComercial !== undefined) {
      if (!["LEAD", "ANALISE", "PROPOSTA", "CONTRATADO"].includes(patch.faseComercial)) throw erro("fase_invalida", "Fase comercial inválida.");
      data.faseComercial = patch.faseComercial;
    }
    if (patch.proposta !== undefined) {
      const p = patch.proposta;
      if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => !["texto", "valorMensal"].includes(k)) || typeof p.texto !== "string" || p.texto.length > 10000 || (p.valorMensal != null && (typeof p.valorMensal !== "number" || !Number.isFinite(p.valorMensal) || p.valorMensal < 0))) throw erro("proposta_invalida", "Informe texto e valor mensal válido.");
      data.proposta = p;
    }
    return db.$transaction(async (tx) => {
      const atualizado = await tx.onboarding.update({ where: { id }, data });
      await evento(tx, id, "COMERCIAL_ATUALIZADO", user.id, data);
      return { faseComercial: atualizado.faseComercial, proposta: atualizado.proposta };
    });
  }
  async function analisar(id, user, tipo) {
    const r = await exigirEscopo(id, user, db);
    if (fechado(r)) throw erro("onboarding_fechado", "Ficha encerrada.", 409);
    if (!["PUBLICA", "SITFIS"].includes(tipo)) throw erro("tipo_invalido", "Escolha análise pública ou SITFIS.");
    if (!/^\d{14}$/.test(r.cnpj || "")) throw erro("cnpj_necessario", "Salve o CNPJ completo na ficha antes de consultar.");
    const ultima = await db.onboardingAnalise.findFirst({ where: { onboardingId: id, tipo, cnpj: r.cnpj }, orderBy: { createdAt: "desc" } });
    if (ultima && agora().getTime() - new Date(ultima.createdAt).getTime() < (tipo === "SITFIS" ? 4 * 3600000 : 60000)) {
      if (ultima.status === "CONSULTANDO" && agora().getTime() - new Date(ultima.updatedAt || ultima.createdAt).getTime() < 5 * 60000) throw erro("consulta_em_andamento", "A consulta já está em andamento.", 409);
      if (ultima.status === "CONCLUIDA") return { analise: { id: ultima.id, tipo, status: ultima.status, cnpj: ultima.cnpj, resultado: ultima.resultado, createdAt: ultima.createdAt }, reutilizada: true };
      if (agora().getTime() - new Date(ultima.createdAt).getTime() < 60000) throw erro("aguarde_consulta", "Aguarde um minuto antes de consultar novamente.", 429);
    }
    await db.onboardingAnalise.updateMany({ where: { onboardingId: id, tipo, status: "CONSULTANDO", updatedAt: { lt: new Date(agora().getTime() - 5 * 60000) } }, data: { status: "FALHOU", resultado: { mensagem: "Consulta interrompida. Execute novamente." } } });
    let analise;
    try { analise = await db.onboardingAnalise.create({ data: { onboardingId: id, tipo, status: "CONSULTANDO", cnpj: r.cnpj, criadoPorId: user.id } }); }
    catch (e) { if (e.code === "P2002") throw erro("consulta_em_andamento", "A consulta já está em andamento.", 409); throw e; }
    let resultado = { fonte: tipo === "PUBLICA" ? "Dados públicos de CNPJ (provedor não informado)" : "Receita Federal / SERPRO SITFIS", consultadoEm: agora().toISOString() };
    let status = "CONCLUIDA", documentoCifrado = null;
    try {
      if (tipo === "PUBLICA") {
        const out = await consultaPublica(r.cnpj);
        resultado.fonte = out.fonte === "BRASILAPI" ? "BrasilAPI / dados públicos CNPJ" : out.fonte === "MINHA_RECEITA" ? "Minha Receita / dados públicos CNPJ" : "Dados públicos de CNPJ (provedor não informado)";
        if (!out.ok) throw erro("consulta_publica_indisponivel", out.mensagem || "Consulta pública indisponível.", 502);
        const b = out.bruto || {};
        resultado = { ...resultado, mensagem: "Dados públicos consultados. Não equivalem a regularidade fiscal.", razaoSocial: b.razao_social || out.tomador?.nome || null, situacaoCadastral: b.descricao_situacao_cadastral || null, cnaePrincipal: b.cnae_fiscal || null, municipio: b.municipio || null, uf: b.uf || null };
      } else {
        await comContextoSerpro({ origem: "onboarding_analise", userId: user.id }, async () => {
          const p = await procura(r.cnpj);
          resultado.procuracao = { status: p.status, validUntil: p.validUntil, systems: p.systems, checkedAt: p.checkedAt, procuradorCnpj: p.procuradorCnpj };
          if (!procuracaoHabilitaSitfis(p, agora())) { status = "BLOQUEADA"; resultado.mensagem = "Confirme procuração vigente para o procurador informado e autorização explícita para SITFIS na Receita Federal. Nenhuma consulta fiscal foi executada."; return; }
          const anterior = ultima?.status === "PROCESSANDO" && ultima.cnpj === r.cnpj ? ultima.resultado?.protocolo : null;
          const out = await sitfis({ contribuinteCnpj: r.cnpj, contratanteCnpj: p.procuradorCnpj, protocoloExistente: anterior, onProtocolo: async (protocolo) => { resultado.protocolo = protocolo; await db.onboardingAnalise.update({ where: { id: analise.id }, data: { resultado } }); } });
          if (!out.ok) throw erro("sitfis_indisponivel", "O SITFIS não concluiu a consulta.", 502);
          status = out.processando ? "PROCESSANDO" : "CONCLUIDA";
          resultado.protocolo = out.protocolo || null;
          resultado.relatorioDisponivel = Boolean(out.relatorioPdfBuffer);
          resultado.mensagem = out.processando ? "Relatório em processamento. Consulte novamente para acompanhar." : "Relatório consultado; o contador deve revisar o documento antes da proposta.";
          if (out.relatorioPdfBuffer) {
            documentoCifrado = await cifrar(out.relatorioPdfBuffer.toString("base64"));
            const leitura = await lerSitfisPosicional({ pdfBuffer: out.relatorioPdfBuffer });
            resultado.leitura = { relatorio: leitura.relatorio, aviso: leitura.erro, revisaoContador: "PENDENTE" };
          }
        });
      }
    } catch (e) { status = "FALHOU"; resultado.mensagem = e instanceof OnboardingError ? e.message : "Consulta indisponível. Tente novamente mais tarde."; resultado.codigo = e.code || "consulta_falhou"; }
    const salva = await db.onboardingAnalise.update({ where: { id: analise.id }, data: { status, resultado, documentoCifrado } });
    await evento(db, id, "ANALISE_" + tipo, user.id, { analiseId: analise.id, status, cnpj: r.cnpj });
    return { analise: { id: salva.id, tipo, status, cnpj: r.cnpj, resultado, createdAt: salva.createdAt } };
  }
  async function documento(id, analiseId, user) {
    await exigirEscopo(id, user, db);
    const a = await db.onboardingAnalise.findFirst({ where: { id: analiseId, onboardingId: id } });
    if (!a?.documentoCifrado) throw erro("relatorio_ausente", "Relatório indisponível.", 404);
    const plain = await decifrar(a.documentoCifrado);
    if (!plain) throw erro("relatorio_indisponivel", "Não foi possível abrir o relatório.", 503);
    return Buffer.from(plain, "base64");
  }
  async function emitirLink(id, user, diasValidade = 7) {
    const r = await exigirEscopo(id, user, db);
    if (fechado(r)) throw erro("onboarding_fechado", "Ficha encerrada.", 409);
    if (!Number.isInteger(diasValidade) || diasValidade < 1 || diasValidade > 30) throw erro("prazo_invalido", "O link deve valer entre 1 e 30 dias.");
    const token = crypto.randomBytes(32).toString("base64url"), expiresAt = new Date(agora().getTime() + diasValidade * 86400000);
    const link = await db.$transaction(async (tx) => {
      // UPDATE trava a mesma ficha, inclusive quando ainda não existe link para revogar.
      const trava = await tx.onboarding.updateMany({ where: { id, status: { notIn: ["CONVERTIDO", "DESISTIU"] } }, data: { versao: { increment: 1 } } });
      if (trava.count !== 1) throw erro("onboarding_fechado", "Ficha encerrada.", 409);
      await tx.onboardingLink.updateMany({ where: { onboardingId: id, revokedAt: null }, data: { revokedAt: agora() } });
      const novo = await tx.onboardingLink.create({ data: { onboardingId: id, tokenHash: hash(token), expiresAt, criadoPorId: user.id } });
      await evento(tx, id, "LINK_CRIADO", user.id, { linkId: novo.id, expiresAt: expiresAt.toISOString() });
      return { id: novo.id, expiresAt };
    });
    return { link, token };
  }
  async function revogar(id, linkId, user) {
    await exigirEscopo(id, user, db);
    await db.onboardingLink.updateMany({ where: { id: linkId, onboardingId: id, revokedAt: null }, data: { revokedAt: agora() } });
    await evento(db, id, "LINK_REVOGADO", user.id, { linkId });
  }
  async function publico(token, patch = null) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) throw erro("link_invalido", "Link inválido ou expirado.", 404);
    const tokenHash = hash(token), instante = agora();
    const ativo = { tokenHash, revokedAt: null, submittedAt: null, expiresAt: { gt: instante } };
    const link = await db.onboardingLink.findFirst({ where: ativo, include: { onboarding: true } });
    if (!link || fechado(link.onboarding)) throw erro("link_invalido", "Link inválido ou expirado.", 404);
    let r = link.onboarding;
    if (patch) {
      if (!Number.isInteger(patch.versao) || patch.versao < 0 || Object.keys(patch).some((k) => !["dados", "ultimoPasso", "finalizar", "versao"].includes(k)) || (patch.finalizar !== undefined && typeof patch.finalizar !== "boolean") || (patch.ultimoPasso != null && (typeof patch.ultimoPasso !== "string" || patch.ultimoPasso.length > 60)) || !patch.dados || typeof patch.dados !== "object" || Array.isArray(patch.dados) || JSON.stringify(patch.dados).length > 60000) throw erro("dados_invalidos", "Confira os dados do formulário.");
      patch = { ...patch, dados: podarInvisiveis(r.origem, patch.dados) };
      r = await db.$transaction(async (tx) => {
        const atualizado = await tx.onboarding.updateMany({ where: { id: r.id, versao: patch.versao, status: r.status, links: { some: ativo } }, data: { dados: patch.dados, fontesDados: { ...(r.fontesDados || {}), ...Object.fromEntries(Object.keys(patch.dados).filter(k => JSON.stringify(r.dados?.[k]) !== JSON.stringify(patch.dados[k])).map(k => [k, { fonte: "FORMULARIO_PUBLICO", conferido: false, em: instante.toISOString() }])) }, ...extrairColunas(r.origem, patch.dados), ultimoPasso: patch.ultimoPasso || null, origemPreenchimento: "CLIENTE", versao: { increment: 1 }, ...(patch.finalizar && r.status === "RASCUNHO" ? { status: "RECEBIDO", enviadoEm: instante } : {}) } });
        if (atualizado.count !== 1) throw erro("formulario_alterado", "O formulário foi alterado ou o link expirou. Recarregue antes de salvar.", 409);
        if (extrairColunas(r.origem, patch.dados).cnpj !== r.cnpj) await tx.atendimentoLead.updateMany({ where: { onboardingId: r.id }, data: { autorizacao: {}, representanteVerificadoEm: null, representanteVerificadoPor: null, evidenciaRepresentante: null } });
        // Ordem de locks igual à geração: ficha primeiro, link depois. Revogação concorrente
        // vencendo este lock provoca rollback completo do rascunho.
        const trava = await tx.onboardingLink.updateMany({ where: { id: link.id, ...ativo }, data: { expiresAt: link.expiresAt } });
        if (trava.count !== 1) throw erro("link_invalido", "Link inválido ou expirado.", 404);
        if (patch.finalizar) {
          await tx.onboardingLink.update({ where: { id: link.id }, data: { submittedAt: instante } });
          await tx.onboardingEtapa.createMany({ data: etapasDaOrigem(r.origem).map((e) => ({ ...e, onboardingId: r.id })), skipDuplicates: true });
          await evento(tx, r.id, "FORMULARIO_ENVIADO", null);
        }
        return tx.onboarding.findUnique({ where: { id: r.id } });
      });
    }
    return { onboarding: { origem: r.origem, dados: r.dados, ultimoPasso: r.ultimoPasso, status: r.status, versao: r.versao } };
  }
  return { painel, comercial, analisar, documento, emitirLink, revogar, publico };
}
