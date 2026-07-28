// Documentos societários/cadastrais da empresa: contrato social, cartão CNPJ, inscrições, alvará.
//
// Até aqui só existia lugar para guia e nota fiscal. Contrato social e inscrições viviam em e-mail
// e pasta local, e toda vez que o cliente pedia, alguém garimpava.
//
// O arquivo NÃO vai pro banco: `fileKey` aponta pro MESMO storage das guias
// (`GuideStorageService`, LOCAL/S3/R2). Isso é deliberado — foi um caminho de storage escrito à mão
// que fez os PDFs sumirem a cada deploy no Railway (o processo roda em /app/apps/api, então
// caminho relativo cai FORA do volume montado em /app/storage). Reusando o serviço, herdamos a
// resolução já corrigida em config.js.

import path from "node:path";
import { prisma } from "../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../guides/GuideStorageService.js";

export const TIPOS_DOCUMENTO = [
  "CONTRATO_SOCIAL",
  "CARTAO_CNPJ",
  "INSCRICAO_ESTADUAL",
  "INSCRICAO_MUNICIPAL",
  "ALVARA",
  "PROCURACAO",
  "OUTRO",
];

export const TIPO_DOCUMENTO_LABELS = {
  CONTRATO_SOCIAL: "Contrato social",
  CARTAO_CNPJ: "Cartão CNPJ",
  INSCRICAO_ESTADUAL: "Inscrição estadual",
  INSCRICAO_MUNICIPAL: "Inscrição municipal",
  ALVARA: "Alvará",
  PROCURACAO: "Procuração",
  OUTRO: "Outro",
};

// Documento de empresa é PDF ou imagem digitalizada. Aceitar qualquer coisa aqui significaria
// guardar e depois REDISTRIBUIR por e-mail um arquivo arbitrário enviado pelo navegador.
const MIMES_ACEITOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const TAMANHO_MAX_BYTES = 20 * 1024 * 1024;

export class CompanyDocumentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function slugify(nome) {
  return String(nome || "documento")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "documento";
}

export function listar({ portalClientId }) {
  return prisma.companyDocument.findMany({
    where: { portalClientId },
    orderBy: [{ tipo: "asc" }, { createdAt: "desc" }],
  });
}

export async function adicionar({ portalClientId, tipo, nome, validade, uploadedById, arquivo }) {
  const tipoNorm = String(tipo || "OUTRO").toUpperCase();
  if (!TIPOS_DOCUMENTO.includes(tipoNorm)) {
    throw new CompanyDocumentError("tipo_invalido", `Tipo inválido: ${tipoNorm}`);
  }
  if (!arquivo?.buffer?.length) {
    throw new CompanyDocumentError("arquivo_ausente", "Nenhum arquivo recebido.");
  }
  if (arquivo.buffer.length > TAMANHO_MAX_BYTES) {
    throw new CompanyDocumentError("arquivo_grande", "Arquivo acima de 20 MB.", 413);
  }
  const mime = String(arquivo.mimetype || "").toLowerCase();
  if (!MIMES_ACEITOS.has(mime)) {
    throw new CompanyDocumentError(
      "tipo_arquivo_invalido",
      `Formato não aceito (${mime || "desconhecido"}). Envie PDF ou imagem.`,
    );
  }

  const nomeFinal = String(nome || arquivo.originalname || "documento").trim().slice(0, 200);
  // Cria primeiro pra ter o id na chave — dois arquivos de mesmo nome nunca colidem no storage.
  const doc = await prisma.companyDocument.create({
    data: {
      portalClientId,
      tipo: tipoNorm,
      nome: nomeFinal,
      fileKey: "",
      mimeType: mime,
      bytes: arquivo.buffer.length,
      validade: validade ? new Date(validade) : null,
      uploadedById: uploadedById || null,
    },
  });

  const ext = path.extname(arquivo.originalname || "") || (mime === "application/pdf" ? ".pdf" : "");
  const fileKey = `documentos/${portalClientId}/${doc.id}-${slugify(path.basename(nomeFinal, ext))}${ext}`;

  try {
    await new GuideStorageService().upload({ key: fileKey, buffer: arquivo.buffer, contentType: mime });
  } catch (err) {
    // Sem arquivo no storage o registro é lixo que aparece na lista e falha ao baixar.
    await prisma.companyDocument.delete({ where: { id: doc.id } }).catch(() => {});
    throw err;
  }

  return prisma.companyDocument.update({ where: { id: doc.id }, data: { fileKey } });
}

export async function baixarBuffer({ portalClientId, documentId }) {
  const doc = await prisma.companyDocument.findFirst({ where: { id: documentId, portalClientId } });
  if (!doc) throw new CompanyDocumentError("documento_nao_encontrado", "Documento não encontrado.", 404);
  const buffer = await new GuideStorageService().downloadBuffer({ key: doc.fileKey });
  return { doc, buffer };
}

export async function remover({ portalClientId, documentId }) {
  const doc = await prisma.companyDocument.findFirst({ where: { id: documentId, portalClientId } });
  if (!doc) throw new CompanyDocumentError("documento_nao_encontrado", "Documento não encontrado.", 404);
  // O registro sai mesmo que o arquivo já não exista — ficar preso a um arquivo ausente só deixaria
  // uma linha impossível de remover na tela.
  await prisma.companyDocument.delete({ where: { id: doc.id } });
  return doc;
}
