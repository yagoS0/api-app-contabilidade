import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../guides/GuideStorageService.js";
import { arquivoParaTela, identificarArquivo, nomeSeguro, SELECT_ARQUIVO, RETENCAO_ARQUIVO_DIAS } from "./ArquivoWhatsappService.js";

const sha = value => createHash("sha256").update(value).digest("hex");
const erro = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const ORIGINAL = "ORIGINAL_REGISTRADO";
const RECUPERADO = "RECUPERADO_DO_VINCULO";
const dataISO = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const resumoGuia = s => [s.empresa || "Empresa", s.tipo || "Guia", s.competencia, s.valor != null ? `R$ ${Number(s.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null].filter(Boolean).join(" · ");

/** Prepared bytes and template parameters are frozen before the transport can run. */
export async function prepararHistoricoGuia({ tentativaId, envioGuiaId, guide, conversa, contato, canal, variaveis, nomeArquivo, conteudoPdf, tipoLabel }, { client = prisma, storage = new GuideStorageService() } = {}) {
  if (!conversa?.id || !tentativaId || !envioGuiaId) throw erro("HISTORICO_SEM_ORIGEM", "Não foi possível preparar o histórico desta guia.");
  const buffer = Buffer.from(conteudoPdf || []);
  if (identificarArquivo(buffer).mimeType !== "application/pdf") throw erro("HISTORICO_PDF_INVALIDO", "O arquivo da guia precisa ser um PDF.");
  const empresa = guide.portalClient || await client.portalClient.findUnique({ where: { id: guide.portalClientId }, select: { razao: true, cnpj: true } });
  if (!empresa?.razao) throw erro("HISTORICO_EMPRESA_INDISPONIVEL", "Não foi possível identificar a empresa da guia para o histórico.");
  const arquivoSha256 = sha(buffer);
  const template = { nome: canal.nomeMeta || null, idioma: canal.idioma || "pt_BR", variaveis: variaveis.map(String),
    componentes: [{ type: "header", documento: nomeSeguro(nomeArquivo) }, { type: "body", parametros: variaveis.map(String) }],
    // The existing catalog has no provider body/version. Do not invent either.
    texto: null, versaoProvedor: null, renderizacaoExataDisponivel: false };
  const snapshot = { versao: 1, origem: ORIGINAL, guideId: guide.id, portalClientId: guide.portalClientId,
    empresa: empresa.razao, cnpj: String(empresa.cnpj || "").replace(/\D/g, ""), tipo: tipoLabel,
    competencia: guide.competencia, valor: String(guide.valor), vencimento: dataISO(guide.vencimento),
    template: { ...template, hash: sha(JSON.stringify(template)) },
    arquivo: { nomeArquivo: nomeSeguro(nomeArquivo), mimeType: "application/pdf", tamanho: buffer.length, sha256: arquivoSha256 },
    conversaId: conversa.id, vinculoNumeroId: conversa.vinculoNumeroId || null, canalId: conversa.canalId || "principal",
    telefone: contato.telefoneE164, preparadoEm: new Date().toISOString() };
  const arquivoPdfFileId = `whatsapp/historico/guias/${encodeURIComponent(tentativaId)}/${arquivoSha256}.pdf`;
  const anterior = await client.envioGuiaTentativa.findUnique({ where: { id: tentativaId } });
  if (!anterior || anterior.envioGuiaId !== envioGuiaId) throw erro("HISTORICO_TENTATIVA_INVALIDA", "A tentativa da guia não está disponível.");
  if (!anterior.arquivoPdfFileId) {
    await storage.upload({ key: arquivoPdfFileId, buffer, contentType: "application/pdf" });
    const gravada = await client.envioGuiaTentativa.updateMany({ where: { id: tentativaId, envioGuiaId, status: "enviando", arquivoPdfFileId: null },
      data: { snapshot, arquivoPdfFileId, arquivoSha256 } });
    if (gravada.count !== 1) throw erro("HISTORICO_TENTATIVA_ALTERADA", "A tentativa mudou durante a preparação. Nenhuma nova mensagem foi enviada.");
  } else if (anterior.arquivoSha256 !== arquivoSha256 || anterior.snapshot?.conversaId !== conversa.id
    || anterior.snapshot?.template?.hash !== snapshot.template.hash || anterior.snapshot?.telefone !== contato.telefoneE164) {
    throw erro("HISTORICO_IMUTAVEL", "O conteúdo desta tentativa já foi preparado e não pode ser substituído.");
  }
  const salvo = anterior.snapshot || snapshot;
  return client.mensagemWhatsapp.upsert({ where: { id: `guia-whatsapp-${tentativaId}` }, update: {}, create: {
    id: `guia-whatsapp-${tentativaId}`, conversaId: salvo.conversaId, direcao: "out", tipo: "template", autor: "SISTEMA",
    corpo: resumoGuia(salvo), envioGuiaId, envioGuiaTentativaId: tentativaId,
  } });
}

/** Local-only reconciliation. Never imports or calls the WhatsApp transport. */
export async function reconciliarTentativaGuia(tentativaId, { client = prisma } = {}) {
  const t = await client.envioGuiaTentativa.findUnique({ where: { id: tentativaId } });
  if (!t?.providerMessageId || !t.snapshot?.conversaId) return { reconciliada: false };
  const conversa = await client.conversaWhatsapp.findFirst({ where: { id: t.snapshot.conversaId, portalClientId: t.snapshot.portalClientId,
    ...(t.snapshot.vinculoNumeroId ? { vinculoNumeroId: t.snapshot.vinculoNumeroId } : {}) } });
  if (!conversa) return { reconciliada: false };
  // A genuinely new accepted send reopens a previously archived conversation. Replaying
  // its receipt must not undo an archive the operator performed after that acceptance.
  if (t.aceitoEm) await client.conversaWhatsapp.updateMany({ where: { id: conversa.id, excluidaEm: { lte: t.aceitoEm } }, data: { excluidaEm: null } });
  const existente = await client.mensagemWhatsapp.findUnique({ where: { providerMessageId: t.providerMessageId } });
  if (existente) return { reconciliada: existente.envioGuiaTentativaId === t.id, mensagemId: existente.id };
  const id = `guia-whatsapp-${t.id}`;
  const data = { providerMessageId: t.providerMessageId, enviadoEm: t.aceitoEm || null };
  try {
    await client.mensagemWhatsapp.upsert({ where: { id }, update: data, create: { id, ...data,
      conversaId: t.snapshot.conversaId, direcao: "out", tipo: "template", autor: "SISTEMA", corpo: resumoGuia(t.snapshot),
      envioGuiaId: t.envioGuiaId, envioGuiaTentativaId: t.id, registradaEm: t.criadoEm } });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    const outra = await client.mensagemWhatsapp.findUnique({ where: { providerMessageId: t.providerMessageId } });
    if (outra?.envioGuiaTentativaId !== t.id) throw e;
  }
  return { reconciliada: true, mensagemId: id };
}

export async function reconciliarHistoricoGuiasWhatsapp({ client = prisma, limite = 25 } = {}) {
  const tentativas = await client.envioGuiaTentativa.findMany({ where: { providerMessageId: { not: null }, arquivoPdfFileId: { not: null },
    OR: [{ mensagens: { none: {} } }, { mensagens: { some: { providerMessageId: null } } }] },
  select: { id: true }, orderBy: { criadoEm: "asc" }, take: Math.min(100, Math.max(1, limite)) });
  let reconciliadas = 0;
  for (const t of tentativas) if ((await reconciliarTentativaGuia(t.id, { client })).reconciliada) reconciliadas += 1;
  return { verificadas: tentativas.length, reconciliadas };
}

/** Manual PDF/image uses the same retention and authenticated access as incoming files. */
export async function salvarArquivoManual({ mensagem, conversa, buffer, nomeArquivo, mimeType }, { client = prisma, agora = new Date() } = {}) {
  if (!mensagem?.id || mensagem.conversaId !== conversa?.id || mensagem.direcao !== "out") throw erro("ARQUIVO_ESCOPO_INVALIDO", "O arquivo não corresponde à mensagem.");
  const conteudo = Buffer.from(buffer || []);
  const tipo = identificarArquivo(conteudo, nomeArquivo);
  if (!["application/pdf", "image/png", "image/jpeg"].includes(tipo.mimeType) || (mimeType && tipo.mimeType !== mimeType)) throw erro("ARQUIVO_NAO_SUPORTADO", "Envie PDF ou imagem JPEG/PNG.");
  const sha256 = sha(conteudo);
  const salvo = await client.arquivoWhatsapp.upsert({ where: { mensagemId: mensagem.id }, update: {}, create: {
    mensagemId: mensagem.id, portalClientId: conversa.escopoVerificado === true ? conversa.portalClientId || null : null,
    midiaProvedorId: `local:${mensagem.id}`, nomeArquivo: nomeSeguro(nomeArquivo), mimeType: tipo.mimeType,
    tamanho: conteudo.length, sha256, conteudo, estado: "DISPONIVEL", recebidoEm: agora,
    expiraEm: new Date(agora.getTime() + RETENCAO_ARQUIVO_DIAS * 86400000),
  } });
  if (salvo.sha256 !== sha256) throw erro("ARQUIVO_IMUTAVEL", "O arquivo desta mensagem não pode ser substituído.");
  return salvo;
}

export function cartaoGuiaParaTela(mensagem, tentativa, envio) {
  const s = tentativa?.snapshot;
  const original = s?.versao === 1 && s.guideId === envio?.guideId;
  const g = envio?.guide;
  if (!original && !g) return null;
  const fonte = original ? s : { empresa: g.portalClient?.razao, cnpj: g.portalClient?.cnpj, tipo: g.tipo,
    competencia: g.competencia, valor: g.valor == null ? null : String(g.valor), vencimento: g.vencimento };
  const arquivo = original ? { ...s.arquivo, origem: ORIGINAL, podeAbrir: Boolean(tentativa.arquivoPdfFileId && tentativa.arquivoSha256), estado: "DISPONIVEL" }
    : { nomeArquivo: null, mimeType: "application/pdf", origem: RECUPERADO, podeAbrir: false, estado: "NAO_COMPROVADO" };
  return { origem: original ? ORIGINAL : RECUPERADO, empresa: fonte.empresa || null, cnpj: fonte.cnpj || null,
    tipo: fonte.tipo, competencia: fonte.competencia, valor: fonte.valor, vencimento: fonte.vencimento,
    template: original ? s.template : null, arquivo, tentativaId: tentativa?.id || null,
    statusEnvio: tentativa?.status || (mensagem.envioGuiaTentativaId ? null : envio?.status) || mensagem.statusEnvio || null,
    historicoPendente: Boolean(tentativa?.providerMessageId && !mensagem.providerMessageId),
    aviso: original ? null : "Dados recuperados do vínculo atual. A versão do PDF e do modelo enviados não foi preservada." };
}

export function resumoMensagemHistorico(mensagem) {
  if (mensagem?.corpo) return mensagem.corpo;
  if (mensagem?.cartaoGuia) return `${resumoGuia(mensagem.cartaoGuia)}${mensagem.cartaoGuia.origem === RECUPERADO ? " (dados recuperados)" : ""}`;
  if (mensagem?.arquivo?.nomeArquivo) return mensagem.arquivo.nomeArquivo;
  return ({ image: "Imagem", document: "Documento", audio: "Áudio", video: "Vídeo", template: "Mensagem de modelo" })[mensagem?.tipo] || "Mensagem";
}

/** Called only on messages already filtered by the inbox authorization rules. */
export async function enriquecerMensagensWhatsapp(mensagens, { client = prisma, agora = new Date(), empresasPermitidas = [] } = {}) {
  if (!mensagens.length) return mensagens;
  const ids = mensagens.map(m => m.id);
  const envioIds = [...new Set(mensagens.map(m => m.envioGuiaId).filter(Boolean))];
  const tentativaIds = [...new Set(mensagens.map(m => m.envioGuiaTentativaId || m.envioGuiaTentativa?.id).filter(Boolean))];
  const [arquivos, envios, tentativas] = await Promise.all([
    client.arquivoWhatsapp.findMany({ where: { mensagemId: { in: ids } }, select: SELECT_ARQUIVO }),
    envioIds.length ? client.envioGuia.findMany({ where: { id: { in: envioIds } }, include: { guide: { select: { id: true, tipo: true, competencia: true, valor: true, vencimento: true,
      portalClient: { select: { razao: true, cnpj: true } } } } } }) : [],
    tentativaIds.length ? client.envioGuiaTentativa.findMany({ where: { id: { in: tentativaIds } } }) : [],
  ]);
  const porArquivo = new Map(arquivos.map(a => [a.mensagemId, a]));
  const porEnvio = new Map(envios.map(e => [e.id, e]));
  const porTentativa = new Map(tentativas.map(t => [t.id, t]));
  return mensagens.map(m => {
    const a = porArquivo.get(m.id);
    const t = porTentativa.get(m.envioGuiaTentativaId || m.envioGuiaTentativa?.id);
    const cartaoGuia = m.envioGuiaId ? cartaoGuiaParaTela(m, t, porEnvio.get(m.envioGuiaId)) : null;
    const arquivoFora = a?.portalClientId && empresasPermitidas !== null && !empresasPermitidas.includes(a.portalClientId);
    const arquivo = arquivoFora ? { nomeArquivo: null, mimeType: null, tamanho: null, estado: "SEM_ACESSO", podeAbrir: false, origem: null }
      : a ? { ...arquivoParaTela(a, agora), origem: ORIGINAL } : ["document", "image"].includes(m.tipo)
      ? { nomeArquivo: m.referenciaComercial?.nome || null, mimeType: null, tamanho: null, estado: "INDISPONIVEL", podeAbrir: false, origem: RECUPERADO } : null;
    return { ...m, ...(cartaoGuia ? { cartaoGuia } : {}), ...(arquivo ? { arquivo } : {}) };
  });
}

/** Defense in depth: the route must provide the message IDs and segment IDs it authorized. */
export async function obterArquivoDaMensagem({ mensagemId, conversaIds, mensagemIds, empresasPermitidas = [] }, { client = prisma, storage = new GuideStorageService(), agora = new Date() } = {}) {
  if (!Array.isArray(conversaIds) || !conversaIds.length || !Array.isArray(mensagemIds) || !mensagemIds.includes(mensagemId)) throw erro("ARQUIVO_NAO_ENCONTRADO", "Arquivo não encontrado.", 404);
  const m = await client.mensagemWhatsapp.findFirst({ where: { id: mensagemId, conversaId: { in: conversaIds } }, include: { envioGuiaTentativa: true } });
  if (!m) throw erro("ARQUIVO_NAO_ENCONTRADO", "Arquivo não encontrado.", 404);
  let buffer, meta;
  if (m.envioGuiaTentativaId) {
    const t = m.envioGuiaTentativa;
    if (!t?.snapshot?.arquivo || !t.arquivoPdfFileId || t.snapshot.conversaId !== m.conversaId) throw erro("ARQUIVO_NAO_COMPROVADO", "O arquivo original deste envio não foi preservado.");
    if (t.snapshot.portalClientId && empresasPermitidas !== null && !empresasPermitidas.includes(t.snapshot.portalClientId)) throw erro("ARQUIVO_NAO_ENCONTRADO", "Arquivo não encontrado.", 404);
    try { buffer = await storage.downloadBuffer({ key: t.arquivoPdfFileId }); } catch { throw erro("ARQUIVO_INDISPONIVEL", "O arquivo original não está disponível agora.", 503); }
    if (sha(buffer) !== t.arquivoSha256) throw erro("ARQUIVO_DIVERGENTE", "O arquivo não corresponde à versão enviada.");
    meta = t.snapshot.arquivo;
  } else {
    const a = await client.arquivoWhatsapp.findUnique({ where: { mensagemId }, select: { ...SELECT_ARQUIVO, conteudo: true, sha256: true } });
    if (!a) throw erro("ARQUIVO_NAO_ENCONTRADO", "Arquivo não encontrado.", 404);
    if (a.portalClientId && empresasPermitidas !== null && !empresasPermitidas.includes(a.portalClientId)) throw erro("ARQUIVO_NAO_ENCONTRADO", "Arquivo não encontrado.", 404);
    if (new Date(a.expiraEm) <= agora) throw erro("ARQUIVO_EXPIRADO", "O prazo de disponibilidade deste arquivo terminou.", 410);
    if (a.estado !== "DISPONIVEL" || !a.conteudo) throw erro("ARQUIVO_INDISPONIVEL", "Este arquivo ainda não está disponível.");
    buffer = Buffer.from(a.conteudo);
    if (a.sha256 && sha(buffer) !== a.sha256) throw erro("ARQUIVO_DIVERGENTE", "O arquivo não corresponde ao original.");
    meta = a;
  }
  return { nomeArquivo: nomeSeguro(meta.nomeArquivo), mimeType: meta.mimeType, base64: buffer.toString("base64"), origem: ORIGINAL };
}
