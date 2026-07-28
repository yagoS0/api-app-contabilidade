// Envia documentos da empresa (contrato social, cartão CNPJ, inscrições…) por e-mail ao cliente.
//
// Mesmo padrão do envio de guias (`GuideCompanyEmailService`): grava os anexos num tmpdir, manda
// pelo `EmailService` e limpa. O destinatário é resolvido pelo MESMO caminho das guias
// (`resolveCompanyNotificationEmail`) — um segundo lugar decidindo "para quem escrevemos" acabaria
// divergindo do primeiro sem ninguém perceber.
//
// Enviar é ação para FORA: o retorno diz exatamente o que saiu e para quem, em vez de um "ok" liso.

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "../../infrastructure/db/prisma.js";
import { EmailService } from "../../infrastructure/mail/EmailService.js";
import { resolveCompanyNotificationEmail } from "../guides/GuideScheduledEmailService.js";
import { GuideStorageService } from "../guides/GuideStorageService.js";
import { TIPO_DOCUMENTO_LABELS, CompanyDocumentError } from "./CompanyDocumentsService.js";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeTempName(name) {
  return String(name || "documento").replace(/[\\/]+/g, "-");
}

function buildHtml({ razao, documentos }) {
  const itens = documentos
    .map((d) => `<li>${escapeHtml(TIPO_DOCUMENTO_LABELS[d.tipo] || d.tipo)} — ${escapeHtml(d.nome)}</li>`)
    .join("");
  return `
    <p>Olá, ${escapeHtml(razao || "")}.</p>
    <p>Seguem em anexo os documentos solicitados:</p>
    <ul>${itens}</ul>
    <p>Qualquer dúvida, é só responder este e-mail.</p>
  `;
}

export async function enviarDocumentosPorEmail({ portalClientId, documentIds, destinatario }) {
  const ids = [...new Set((documentIds || []).map(String).filter(Boolean))];
  if (!ids.length) {
    throw new CompanyDocumentError("nenhum_documento", "Selecione ao menos um documento.");
  }

  const documentos = await prisma.companyDocument.findMany({
    where: { id: { in: ids }, portalClientId },
  });
  // Isolamento: só envia o que pertence a ESTA empresa. Se algum id ficou de fora, é erro — não
  // enviamos "o que deu", porque o contador acharia que os 3 foram e só 2 saíram.
  if (documentos.length !== ids.length) {
    throw new CompanyDocumentError(
      "documento_nao_encontrado",
      "Algum documento selecionado não existe nesta empresa.",
      404,
    );
  }

  const to = String(destinatario || "").trim().toLowerCase()
    || await resolveCompanyNotificationEmail(portalClientId);
  if (!to) {
    throw new CompanyDocumentError("sem_destinatario", "A empresa não tem e-mail cadastrado para envio.");
  }

  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { razao: true },
  });

  const storage = new GuideStorageService();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-email-"));
  const anexos = [];
  const usados = new Set();

  try {
    for (const doc of documentos) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await storage.downloadBuffer({ key: doc.fileKey });
      if (!buffer?.length) {
        throw new CompanyDocumentError(
          "arquivo_ausente",
          `O arquivo de "${doc.nome}" não está mais no armazenamento.`,
        );
      }
      let nome = safeTempName(doc.nome);
      let i = 2;
      while (usados.has(nome)) nome = safeTempName(`${doc.nome} (${i++})`);
      usados.add(nome);
      const tmpPath = path.join(tmpDir, `${doc.id}-${nome}`);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(tmpPath, buffer);
      anexos.push({ path: tmpPath, filename: nome });
    }

    const assunto = documentos.length === 1
      ? `${TIPO_DOCUMENTO_LABELS[documentos[0].tipo] || "Documento"} — ${portal?.razao || ""}`.trim()
      : `Documentos — ${portal?.razao || ""}`.trim();

    await new EmailService().send({
      to,
      subject: assunto,
      html: buildHtml({ razao: portal?.razao, documentos }),
      attachments: anexos,
    });

    return {
      enviados: documentos.length,
      destinatario: to,
      documentos: documentos.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo })),
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
