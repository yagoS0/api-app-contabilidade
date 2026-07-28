// Documentos e anotações da empresa.
// Mount: /firm/companies/:companyId/{documentos,anotacoes}
//
// Os dois moram no mesmo router porque ocupam o mesmo lugar na UI (grupo "Cadastro") e são pequenos
// — separar em dois arquivos seria só cerimônia.

import { Router } from "express";
import multer from "multer";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  listar as listarDocumentos,
  adicionar as adicionarDocumento,
  baixarBuffer,
  remover as removerDocumento,
  TIPOS_DOCUMENTO,
  TIPO_DOCUMENTO_LABELS,
  TAMANHO_MAX_BYTES,
  CompanyDocumentError,
} from "../../application/companies/CompanyDocumentsService.js";
import { enviarDocumentosPorEmail } from "../../application/companies/CompanyDocumentsEmailService.js";
import {
  listar as listarNotas,
  criar as criarNota,
  atualizar as atualizarNota,
  remover as removerNota,
  IMPORTANCIAS,
  CompanyNoteError,
} from "../../application/companies/CompanyNotesService.js";

export function createCompanyDocumentsRouter({ log } = {}) {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANHO_MAX_BYTES } });

  // Erro de domínio traz `status`/`code` próprios; o resto vira 500 sem vazar stack.
  function falhar(res, err, contexto) {
    const conhecido = err instanceof CompanyDocumentError || err instanceof CompanyNoteError;
    if (!conhecido) log?.error?.({ err: err?.message || err, ...contexto }, "Falha em documentos/anotações");
    return res
      .status(conhecido ? err.status : 500)
      .json({ ok: false, error: conhecido ? err.code : "erro_interno", message: conhecido ? err.message : "Erro interno." });
  }

  const pcId = (req) => String(req.params.companyId);

  // ── Documentos ────────────────────────────────────────────────────────────────────────────
  router.get("/documentos", requireFirmCompanyAccess({ minRole: "STAFF" }), async (req, res) => {
    try {
      const documentos = await listarDocumentos({ portalClientId: pcId(req) });
      return res.json({ ok: true, documentos, tipos: TIPOS_DOCUMENTO, tipoLabels: TIPO_DOCUMENTO_LABELS });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.post(
    "/documentos",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("arquivo"),
    async (req, res) => {
      try {
        const doc = await adicionarDocumento({
          portalClientId: pcId(req),
          tipo: req.body?.tipo,
          nome: req.body?.nome,
          validade: req.body?.validade || null,
          uploadedById: req.auth?.user?.id || null,
          arquivo: req.file,
        });
        return res.status(201).json({ ok: true, documento: doc });
      } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
    },
  );

  router.get("/documentos/:documentId/download", requireFirmCompanyAccess({ minRole: "STAFF" }), async (req, res) => {
    try {
      const { doc, buffer } = await baixarBuffer({
        portalClientId: pcId(req),
        documentId: String(req.params.documentId),
      });
      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.nome)}"`);
      return res.send(buffer);
    } catch (err) {
      // ENOENT aqui é o sintoma clássico de storage efêmero: o registro existe, o arquivo não.
      if (err?.code === "ENOENT" || /ENOENT/.test(String(err?.message || ""))) {
        return res.status(410).json({
          ok: false, error: "arquivo_ausente",
          message: "O arquivo não está mais no armazenamento. Envie o documento novamente.",
        });
      }
      return falhar(res, err, { companyId: pcId(req) });
    }
  });

  router.delete("/documentos/:documentId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const doc = await removerDocumento({ portalClientId: pcId(req), documentId: String(req.params.documentId) });
      return res.json({ ok: true, removido: { id: doc.id, nome: doc.nome } });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  // Envio ao cliente: ação para FORA. O retorno diz o que saiu e para quem — nunca um "ok" liso.
  router.post("/documentos/enviar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const resultado = await enviarDocumentosPorEmail({
        portalClientId: pcId(req),
        documentIds: req.body?.documentIds,
        destinatario: req.body?.destinatario,
      });
      log?.info?.({ companyId: pcId(req), ...resultado }, "Documentos enviados ao cliente");
      return res.json({ ok: true, ...resultado });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  // ── Anotações ─────────────────────────────────────────────────────────────────────────────
  router.get("/anotacoes", requireFirmCompanyAccess({ minRole: "STAFF" }), async (req, res) => {
    try {
      const anotacoes = await listarNotas({
        portalClientId: pcId(req),
        ordenarPor: String(req.query?.ordenarPor || "data"),
      });
      return res.json({ ok: true, anotacoes, importancias: IMPORTANCIAS });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.post("/anotacoes", requireFirmCompanyAccess({ minRole: "STAFF" }), async (req, res) => {
    try {
      const anotacao = await criarNota({
        portalClientId: pcId(req),
        texto: req.body?.texto,
        importancia: req.body?.importancia,
        fixada: req.body?.fixada === true,
        autorId: req.auth?.user?.id || null,
      });
      return res.status(201).json({ ok: true, anotacao });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.patch("/anotacoes/:noteId", requireFirmCompanyAccess({ minRole: "STAFF" }), async (req, res) => {
    try {
      const anotacao = await atualizarNota({
        portalClientId: pcId(req),
        noteId: String(req.params.noteId),
        texto: req.body?.texto,
        importancia: req.body?.importancia,
        fixada: req.body?.fixada,
      });
      return res.json({ ok: true, anotacao });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.delete("/anotacoes/:noteId", requireFirmCompanyAccess({ minRole: "STAFF" }), async (req, res) => {
    try {
      const anotacao = await removerNota({ portalClientId: pcId(req), noteId: String(req.params.noteId) });
      return res.json({ ok: true, removida: { id: anotacao.id } });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  return router;
}
