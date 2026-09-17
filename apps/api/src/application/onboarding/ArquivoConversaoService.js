import crypto from "node:crypto";
import { decryptSecret } from "../../utils/crypto.js";
import { GuideStorageService } from "../guides/GuideStorageService.js";
import { gerarPropostaPdf, propostaParaCliente } from "./PropostaComercialPdf.js";
import { gerarContratoPdf } from "./ContratoComercialPdf.js";
import { OnboardingError } from "./OnboardingService.js";

const hash = valor => crypto.createHash("sha256").update(valor).digest("hex");
const assinatura = documentos => documentos.map(d => `${d.id}:${d.sha256}`).sort().join("|");

// Os arquivos são preparados ANTES da transação. Uma falha no cofre/storage não pode deixar
// uma empresa criada sem documentos. Chaves pelo conteúdo tornam a preparação repetível.
// Se a transação falhar, só os objetos preparados ficam no storage, sem documentos visíveis;
// as fontes cifradas continuam intactas e a próxima tentativa pode reaproveitá-las.
export async function prepararArquivoConversao({ db, onboardingId, proposta, contrato, storage = new GuideStorageService(), decifrar = decryptSecret }) {
  const fontes = await db.documentoOnboarding.findMany({ where: { onboardingId }, orderBy: { id: "asc" } });
  const documentos = [];
  async function guardar(origem, nome, buffer, uploadedById, createdAt) {
    const id = `onboarding-${hash(`${onboardingId}:${origem}`).slice(0, 32)}`;
    const fileKey = `documentos/onboarding/${id}-${hash(buffer)}.pdf`;
    await storage.upload({ key: fileKey, buffer, contentType: "application/pdf" });
    documentos.push({ id, nome, tipo: "OUTRO", fileKey, mimeType: "application/pdf", bytes: buffer.length, uploadedById, createdAt });
  }
  try {
    if (contrato && !fontes.some(f => f.id === contrato.documentoAssinadoId)) throw Error("Contrato assinado sem documento de origem.");
    for (const fonte of fontes) {
      const plain = await decifrar(fonte.conteudoCifrado);
      const buffer = Buffer.from(plain || "", "base64");
      if (!plain || hash(buffer) !== fonte.sha256 || buffer.subarray(0, 5).toString() !== "%PDF-") throw Error("Documento original indisponível ou divergente.");
      await guardar(`recebido:${fonte.id}`, fonte.nome, buffer, fonte.criadoPor, fonte.createdAt);
    }
    if (proposta) await guardar(`proposta:${proposta.id}`, `Proposta aceita - versão ${proposta.versao}.pdf`, await gerarPropostaPdf(propostaParaCliente(proposta)), proposta.aprovadoPor || null, proposta.createdAt);
    if (contrato) await guardar(`contrato:${contrato.id}`, "Contrato de serviços - minuta emitida.pdf", await gerarContratoPdf(contrato), contrato.aprovadoPor || null, contrato.createdAt);
  } catch (cause) {
    const erro = new OnboardingError("arquivo_conversao_indisponivel", "Não foi possível arquivar todos os documentos. A empresa não foi criada. Confira os arquivos e tente novamente.", 503);
    erro.cause = cause; throw erro;
  }
  return { documentos, fontes: assinatura(fontes) };
}

export async function conferirFontesDoArquivo(tx, onboardingId, arquivo) {
  const atuais = await tx.documentoOnboarding.findMany({ where: { onboardingId }, select: { id: true, sha256: true } });
  if (assinatura(atuais) !== arquivo.fontes) throw new OnboardingError("documentos_alterados", "Os documentos mudaram durante a conversão. Recarregue e tente novamente.", 409);
}
