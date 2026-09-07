import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { arquivoParaTela, SELECT_ARQUIVO } from "../../application/whatsapp/ArquivoWhatsappService.js";

// Mounted after firm authentication. Every query intersects the company in the path.
export function createWhatsappArquivosRouter({ db = prisma, acesso = requireFirmCompanyAccess, log } = {}) {
  const router = Router({ mergeParams: true });
  const base = "/companies/:companyId/whatsapp/arquivos";
  const semEmpresa = { portalClientId: null, mensagem: { conversa: { portalClientId: null, OR: [
    { chaveEscopo: { startsWith: "sem-empresa:" } }, { chaveEscopo: { startsWith: "legado:sem-empresa:" } },
  ] } } };
  const falha = (res, e) => {
    log?.error?.({ code: e?.code }, "Falha no acesso a arquivo WhatsApp");
    return res.status(500).json({ error: "arquivo_indisponivel", message: "Não foi possível acessar o arquivo. Tente novamente." });
  };
  router.get(`${base}/nao-vinculados`, acesso({ minRole: "ACCOUNTANT" }), async (req, res) => {
    if (!["admin", "contador"].includes(String(req.auth?.user?.role || "").toLowerCase())) return res.status(403).json({ error: "forbidden" });
    try {
      let depois = {};
      if (req.query.cursor) {
        const cursor = await db.arquivoWhatsapp.findFirst({ where: { id: String(req.query.cursor), ...semEmpresa }, select: { id: true, recebidoEm: true } });
        if (!cursor) return res.status(400).json({ error: "cursor_invalido" });
        depois = { OR: [{ recebidoEm: { lt: cursor.recebidoEm } }, { recebidoEm: cursor.recebidoEm, id: { lt: cursor.id } }] };
      }
      const rows = await db.arquivoWhatsapp.findMany({ where: { ...semEmpresa, ...depois }, select: {
        ...SELECT_ARQUIVO, mensagem: { select: { conversaId: true, conversa: { select: { telefoneE164: true, nomePerfilProvedor: true } } } },
      }, orderBy: [{ recebidoEm: "desc" }, { id: "desc" }], take: 51 });
      const pagina = rows.slice(0, 50);
      res.set("Cache-Control", "no-store");
      return res.json({ arquivos: pagina.map(a => ({ ...arquivoParaTela(a), podeAbrir: false, podeImportarOfx: false,
        conversaId: a.mensagem?.conversaId, remetente: a.mensagem?.conversa?.nomePerfilProvedor || null, telefone: a.mensagem?.conversa?.telefoneE164 || null,
      })), temMais: rows.length > 50, proximoCursor: rows.length > 50 ? pagina.at(-1).id : null });
    } catch (e) { return falha(res, e); }
  });
  // Explicit assignment of one original; it never moves conversation history.
  router.post(`${base}/:id/vincular`, acesso({ minRole: "ACCOUNTANT" }), async (req, res) => {
    if (!["admin", "contador"].includes(String(req.auth?.user?.role || "").toLowerCase())) return res.status(403).json({ error: "forbidden" });
    if (req.body?.confirmarCompanyId !== req.params.companyId) return res.status(400).json({ error: "confirmacao_empresa_obrigatoria" });
    try {
      const r = await db.arquivoWhatsapp.updateMany({ where: { id: String(req.params.id), ...semEmpresa, expiraEm: { gt: new Date() } }, data: {
        portalClientId: String(req.params.companyId), vinculadoEm: new Date(), vinculadoPorUserId: String(req.auth.user.id),
      } });
      if (r.count !== 1) return res.status(409).json({ error: "arquivo_nao_disponivel_para_vinculo", message: "O arquivo já foi vinculado ou expirou. Atualize a lista." });
      return res.json({ ok: true });
    } catch (e) { return falha(res, e); }
  });
  router.get(base, acesso(), async (req, res) => {
    try {
      const portalClientId = String(req.params.companyId);
      let depois = {};
      if (req.query.cursor) {
        const cursor = await db.arquivoWhatsapp.findFirst({ where: { id: String(req.query.cursor), portalClientId }, select: { id: true, recebidoEm: true } });
        if (!cursor) return res.status(400).json({ error: "cursor_invalido" });
        depois = { OR: [{ recebidoEm: { lt: cursor.recebidoEm } }, { recebidoEm: cursor.recebidoEm, id: { lt: cursor.id } }] };
      }
      const rows = await db.arquivoWhatsapp.findMany({ where: { portalClientId, ...depois }, select: SELECT_ARQUIVO, orderBy: [{ recebidoEm: "desc" }, { id: "desc" }], take: 51 });
      const pagina = rows.slice(0, 50);
      res.set("Cache-Control", "no-store");
      return res.json({ arquivos: pagina.map(a => arquivoParaTela(a)), proximoCursor: rows.length > 50 ? pagina.at(-1).id : null });
    } catch (e) { return falha(res, e); }
  });
  router.get(`${base}/:id/conteudo`, acesso(), async (req, res) => {
    try {
      const arquivo = await db.arquivoWhatsapp.findFirst({ where: {
        id: String(req.params.id), portalClientId: String(req.params.companyId),
      }, select: { ...SELECT_ARQUIVO, conteudo: true } });
      res.set("Cache-Control", "no-store");
      res.set("X-Content-Type-Options", "nosniff");
      if (!arquivo) return res.status(404).json({ error: "arquivo_nao_encontrado" });
      if (new Date(arquivo.expiraEm) <= new Date()) return res.status(410).json({ error: "arquivo_expirado", message: "O prazo de 90 dias deste arquivo terminou." });
      if (arquivo.estado !== "DISPONIVEL" || !arquivo.conteudo) return res.status(409).json({ error: "arquivo_indisponivel", message: "O arquivo ainda não está disponível para abrir." });
      return res.json({ nomeArquivo: arquivo.nomeArquivo, mimeType: arquivo.mimeType, base64: Buffer.from(arquivo.conteudo).toString("base64") });
    } catch (e) { return falha(res, e); }
  });
  // Compatibility endpoint confirms the durable receipt; the client cannot attest an import.
  router.post(`${base}/:id/importado`, acesso({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const where = { id: String(req.params.id), portalClientId: String(req.params.companyId), mimeType: "application/x-ofx" };
      const arquivo = await db.arquivoWhatsapp.findFirst({ where, select: { id: true, importadoEm: true } });
      if (!arquivo) return res.status(404).json({ error: "arquivo_nao_encontrado" });
      const recibo = await db.appSetting.findUnique({ where: { key: `whatsapp_ofx_import:${arquivo.id}` } });
      if (recibo?.value?.companyId !== String(req.params.companyId) || !recibo.value.resultado?.ok || !arquivo.importadoEm) return res.status(409).json({ error: "importacao_nao_confirmada", message: "A importação deste arquivo ainda não foi confirmada." });
      return res.json({ ok: true, importadoEm: arquivo.importadoEm });
    } catch (e) { return falha(res, e); }
  });
  return router;
}
