import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { WHATSAPP_TOKEN, WHATSAPP_GRAPH_BASE_URL, WHATSAPP_GRAPH_VERSION } from "../../config.js";

export const RETENCAO_ARQUIVO_DIAS = 90;
export const LIMITE_ARQUIVO_BYTES = 15 * 1024 * 1024;
const DIA = 86400000;
const META_HOSTS = ["facebook.com", "fbsbx.com", "whatsapp.net"];
export class ArquivoWhatsappError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const erro = (code, message) => new ArquivoWhatsappError(code, message);

export function nomeSeguro(nome, fallback = "arquivo-whatsapp") {
  return String(nome || fallback).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || fallback;
}

/** Validate content, not the extension supplied by the sender. Never execute uploaded content. */
export function identificarArquivo(buffer, nome = "") {
  if (!buffer?.length || buffer.length > LIMITE_ARQUIVO_BYTES) throw erro("ARQUIVO_TAMANHO_INVALIDO", "Arquivo vazio ou maior que 15 MB.");
  if (buffer.subarray(0, 5).toString() === "%PDF-") return { mimeType: "application/pdf", extensao: ".pdf" };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mimeType: "image/png", extensao: ".png" };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { mimeType: "image/jpeg", extensao: ".jpg" };
  const cabecalho = buffer.subarray(0, 8192).toString("utf8").replace(/^\uFEFF/, "").trim();
  if (/^(OFXHEADER\s*:|<\?xml\b[^>]*\?>\s*<OFX\b|<OFX\b)/i.test(cabecalho) && /<OFX[\s>]/i.test(cabecalho)) {
    return { mimeType: "application/x-ofx", extensao: /\.qfx$/i.test(nome) ? ".qfx" : ".ofx" };
  }
  throw erro("ARQUIVO_NAO_SUPORTADO", "Formato não suportado. Recebemos PDF, OFX, QFX, PNG e JPG.");
}

async function lerCorpoLimitado(response, limite) {
  const declarado = Number(response.headers?.get("content-length") || 0);
  if (declarado > limite) throw erro("ARQUIVO_TAMANHO_INVALIDO", "Arquivo maior que 15 MB.");
  const pedacos = []; let tamanho = 0;
  for await (const chunk of response.body) {
    const b = Buffer.from(chunk); tamanho += b.length;
    if (tamanho > limite) throw erro("ARQUIVO_TAMANHO_INVALIDO", "Arquivo maior que o limite permitido.");
    pedacos.push(b);
  }
  return Buffer.concat(pedacos);
}

function urlMetaPermitida(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !META_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
    throw erro("MIDIA_URL_INVALIDA", "A origem do arquivo não foi reconhecida.");
  }
  return u;
}

/** Only downloads from Meta. Redirects are refused so credentials cannot follow a foreign URL. */
export async function baixarMidiaMeta(id, { fetchImpl = fetch, token = WHATSAPP_TOKEN } = {}) {
  if (!token) throw erro("MIDIA_SEM_CREDENCIAL", "A conexão de arquivos do WhatsApp não está configurada.");
  if (!/^\d+$/.test(String(id))) throw erro("MIDIA_ID_INVALIDO", "Identificador do arquivo inválido.");
  const sinal = AbortSignal.timeout(30000);
  const headers = { Authorization: `Bearer ${token}` };
  const base = urlMetaPermitida(WHATSAPP_GRAPH_BASE_URL);
  const endpoint = new URL(`${WHATSAPP_GRAPH_VERSION}/${id}`, `${base.origin}/`);
  try {
    const meta = await fetchImpl(endpoint, { headers, signal: sinal, redirect: "error" });
    if (!meta.ok) throw erro(`MIDIA_META_${meta.status}`, "Não foi possível obter o arquivo no WhatsApp.");
    const info = JSON.parse((await lerCorpoLimitado(meta, 65536)).toString("utf8"));
    if (Number(info.file_size) > LIMITE_ARQUIVO_BYTES) throw erro("ARQUIVO_TAMANHO_INVALIDO", "Arquivo maior que 15 MB.");
    const url = urlMetaPermitida(info.url);
    const arquivo = await fetchImpl(url, { headers, signal: sinal, redirect: "error" });
    if (!arquivo.ok) throw erro(`MIDIA_DOWNLOAD_${arquivo.status}`, "O arquivo não está disponível no WhatsApp.");
    return { buffer: await lerCorpoLimitado(arquivo, LIMITE_ARQUIVO_BYTES), mimeType: info.mime_type || null };
  } catch (e) {
    if (e instanceof ArquivoWhatsappError) throw e;
    // Never propagate HTTP clients' request objects, signed media URLs or authorization headers.
    throw erro("MIDIA_DOWNLOAD_FALHOU", "Falha ao baixar o arquivo. O sistema tentará novamente.");
  }
}

export async function enqueueArquivoWhatsapp({ mensagem, conversa, nomeArquivo, mimeType }, db = prisma) {
  if (!mensagem?.id || !mensagem.midiaProvedorId) return null;
  if (!mensagem.conversaId || mensagem.conversaId !== conversa?.id) throw erro("MIDIA_ESCOPO_INVALIDO", "A origem do arquivo não corresponde à conversa.");
  // Historical assigned conversations cannot become a globally visible unassigned file.
  if (conversa?.portalClientId && conversa.escopoVerificado !== true) return null;
  const recebidoEm = mensagem.registradaEm ? new Date(mensagem.registradaEm) : new Date();
  const portalClientId = conversa?.escopoVerificado === true ? conversa.portalClientId || null : null;
  return db.arquivoWhatsapp.upsert({
    where: { mensagemId: mensagem.id }, update: {},
    create: {
      mensagemId: mensagem.id, portalClientId, midiaProvedorId: mensagem.midiaProvedorId,
      nomeArquivo: nomeSeguro(nomeArquivo), mimeType: mimeType || null,
      recebidoEm, expiraEm: new Date(recebidoEm.getTime() + RETENCAO_ARQUIVO_DIAS * DIA),
    },
  });
}

export function arquivoParaTela(a, agora = new Date()) {
  const expirado = new Date(a.expiraEm) <= agora;
  return {
    id: a.id, mensagemId: a.mensagemId, companyId: a.portalClientId, nomeArquivo: a.nomeArquivo,
    mimeType: a.mimeType, tamanho: a.tamanho, estado: expirado ? "EXPIRADO" : a.estado,
    erroCodigo: a.erroCodigo, recebidoEm: a.recebidoEm, expiraEm: a.expiraEm,
    importadoEm: a.importadoEm, podeAbrir: !expirado && a.estado === "DISPONIVEL",
    podeImportarOfx: !expirado && a.estado === "DISPONIVEL" && a.mimeType === "application/x-ofx",
  };
}

export const SELECT_ARQUIVO = {
  id: true, mensagemId: true, portalClientId: true, nomeArquivo: true, mimeType: true, tamanho: true,
  estado: true, erroCodigo: true, recebidoEm: true, expiraEm: true, importadoEm: true,
};

/** Clears only original bytes, never imported accounting entries or their origin metadata. */
export async function expirarArquivosWhatsapp(db = prisma, agora = new Date()) {
  return db.arquivoWhatsapp.updateMany({
    where: { expiraEm: { lte: agora }, estado: { not: "EXPIRADO" } },
    data: { conteudo: null, estado: "EXPIRADO", reservadoEm: null, reservaToken: null, proximaTentativaEm: null },
  });
}

export async function processarArquivosWhatsapp({ db = prisma, baixar = baixarMidiaMeta, agora = new Date(), limite = 5 } = {}) {
  const inicio = Date.now();
  const relogio = () => new Date(agora.getTime() + Date.now() - inicio);
  await expirarArquivosWhatsapp(db, agora);
  await db.arquivoWhatsapp.updateMany({
    where: { estado: "BAIXANDO", tentativas: { gte: 5 }, reservadoEm: { lt: new Date(agora.getTime() - 120000) } },
    data: { estado: "FALHOU", erroCodigo: "MIDIA_TENTATIVAS_ESGOTADAS", reservadoEm: null, reservaToken: null, proximaTentativaEm: null },
  });
  const disponivel = {
    expiraEm: { gt: agora }, tentativas: { lt: 5 },
    OR: [
      { estado: "PENDENTE" },
      { estado: "FALHOU", proximaTentativaEm: { lte: agora } },
      { estado: "BAIXANDO", reservadoEm: { lt: new Date(agora.getTime() - 120000) } },
    ],
  };
  const arquivos = await db.arquivoWhatsapp.findMany({ where: disponivel, orderBy: { recebidoEm: "asc" }, take: limite });
  let processados = 0;
  for (const a of arquivos) {
    const reservaToken = randomUUID();
    const reserva = await db.arquivoWhatsapp.updateMany({ where: { id: a.id, ...disponivel, expiraEm: { gt: relogio() } }, data: {
      estado: "BAIXANDO", reservadoEm: relogio(), reservaToken, tentativas: { increment: 1 },
    } });
    if (!reserva.count) continue;
    try {
      const { buffer } = await baixar(a.midiaProvedorId);
      const tipo = identificarArquivo(buffer, a.nomeArquivo);
      const baseNome = nomeSeguro(a.nomeArquivo).replace(/\.[a-z0-9]{1,8}$/i, "");
      await db.arquivoWhatsapp.updateMany({ where: { id: a.id, reservaToken, expiraEm: { gt: relogio() } }, data: {
        estado: "DISPONIVEL", conteudo: buffer, tamanho: buffer.length, mimeType: tipo.mimeType,
        nomeArquivo: `${baseNome}${tipo.extensao}`, sha256: createHash("sha256").update(buffer).digest("hex"),
        erroCodigo: null, reservadoEm: null, reservaToken: null, proximaTentativaEm: null,
      } });
    } catch (e) {
      const permanente = ["ARQUIVO_NAO_SUPORTADO", "ARQUIVO_TAMANHO_INVALIDO", "MIDIA_ID_INVALIDO", "MIDIA_URL_INVALIDA"].includes(e.code);
      await db.arquivoWhatsapp.updateMany({ where: { id: a.id, reservaToken }, data: {
        estado: permanente ? "NAO_SUPORTADO" : "FALHOU", erroCodigo: e.code || "MIDIA_DOWNLOAD_FALHOU",
        reservadoEm: null, reservaToken: null,
        proximaTentativaEm: permanente || a.tentativas >= 4 ? null : new Date(relogio().getTime() + Math.min(3600000, 30000 * (2 ** a.tentativas))),
      } });
    }
    processados += 1;
  }
  return { processados };
}
