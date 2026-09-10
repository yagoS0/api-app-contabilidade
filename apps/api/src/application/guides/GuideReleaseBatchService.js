import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { conferirGuiasVencimento } from "./GuideDueBatchService.js";
import { loteAlterado } from "./loteVencimento.js";
import { sendCompanyGuidesEmail } from "./GuideCompanyEmailService.js";
import { destinatariosDeEnvio, destinatarioWhatsapp } from "../whatsapp/ContatoWhatsappService.js";
import { carregarCanal, enviarParaTodosOsDestinatarios, SELECT_GUIA_PARA_ENVIO } from "../whatsapp/EnvioGuiaWhatsappService.js";
import { avaliarLinha } from "../whatsapp/elegibilidadeEnvioGuia.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// O primeiro canal altera emailStatus/updatedAt. A conferência entre canais compara o documento,
// mantendo as travas de empresa, pagamento, conteúdo e vencimento, sem invalidar o próprio envio.
export const assinaturaDocumento = (g) => hash([g.id, g.portalClientId, g.competencia, g.tipo,
  String(g.valor ?? ""), g.vencimento, g.status, g.paymentStatus, g.hash]);
const falha = (err) => ({ ok: false, message: err?.message || "Não foi possível confirmar o envio. Confira o histórico antes de tentar novamente.", error: err?.code });

export function createGuideReleaseBatchService(deps = {}) {
  const db = deps.db || prisma;
  const conferir = deps.conferir || conferirGuiasVencimento;
  const contatos = deps.contatos || destinatariosDeEnvio;
  const destinatario = deps.destinatario || destinatarioWhatsapp;
  const canalAtual = deps.canal || carregarCanal;
  const email = deps.email || sendCompanyGuidesEmail;
  const whatsapp = deps.whatsapp || enviarParaTodosOsDestinatarios;

  async function preparar({ items, permitidas }) {
    if (!Array.isArray(items) || !items.length || items.length > 500) throw loteAlterado();
    const empresas = new Set();
    const ids = new Set();
    for (const item of items) {
      if (!item || !permitidas.includes(item.portalClientId) || empresas.has(item.portalClientId)
        || !item.assinatura || !Array.isArray(item.guideIds) || !item.guideIds.length) throw loteAlterado();
      empresas.add(item.portalClientId);
      for (const id of item.guideIds) { if (ids.has(id)) throw loteAlterado(); ids.add(id); }
    }
    const canal = await canalAtual();
    const linhas = [];
    for (const item of [...items].sort((a, b) => a.portalClientId.localeCompare(b.portalClientId))) {
      const { guias } = await conferir({ ...item, portalClientIds: [item.portalClientId] });
      const destinos = await contatos(item.portalClientId);
      const avaliacao = avaliarLinha({ canal, guide: guias[0], destinatario: await destinatario(item.portalClientId) });
      linhas.push({ ...item, guideIds: [...item.guideIds].sort(), guias,
        email: { disponivel: destinos.emails.length > 0, destinos: [...destinos.emails].sort(),
          mensagem: destinos.emails.length ? null : "Nenhum e-mail cadastrado para receber guias." },
        whatsapp: { disponivel: avaliacao.pode && destinos.telefones.length > 0,
          destinos: destinos.telefones.map((c) => c.telefoneE164).sort(), mensagem: avaliacao.mensagem },
      });
    }
    const assinatura = hash(linhas.map(({ guias, ...linha }) => linha));
    return { assinatura, linhas };
  }

  async function prever(input) {
    const previa = await preparar(input);
    return { ok: true, assinatura: previa.assinatura,
      linhas: previa.linhas.map(({ guias, ...linha }) => linha) };
  }

  async function executar({ assinatura, userId, log, ...input }) {
    const previa = await preparar(input);
    if (!assinatura || assinatura !== previa.assinatura) throw loteAlterado();
    const results = [];
    for (const linha of previa.linhas) {
      const r = { portalClientId: linha.portalClientId, liberadas: 0, email: null, whatsapp: [] };
      results.push(r);
      try {
        // Revalida todos os documentos da empresa antes de qualquer ato nesta empresa.
        await conferir({ ...linha, portalClientIds: [linha.portalClientId] });
        if (linha.email.disponivel) {
          try {
            const out = await email({ portalClientId: linha.portalClientId, mesVencimento: linha.mesVencimento,
              selectedGuideIds: linha.guideIds, assinatura: linha.assinatura });
            r.email = { ...out, ok: out.status === "sent", message: out.status === "sent" ? "E-mail enviado." : "E-mail não enviado. Confira o histórico." };
          } catch (err) {
            r.email = falha(err);
            if (err.code === "CONFERENCIA_DIVERGENTE") throw err;
          }
        } else r.email = { ok: false, message: linha.email.mensagem };

        for (const anterior of linha.guias) {
          const guide = await db.guide.findFirst({ where: { id: anterior.id, portalClientId: linha.portalClientId },
            select: { ...SELECT_GUIA_PARA_ENVIO, liberadaCliente: true } });
          if (!guide || assinaturaDocumento(guide) !== assinaturaDocumento(anterior)) throw loteAlterado();
          if (!guide.liberadaCliente) {
            const upd = await db.guide.updateMany({ where: { id: guide.id, portalClientId: linha.portalClientId,
              updatedAt: guide.updatedAt, status: "PROCESSED", liberadaCliente: false },
              data: { liberadaCliente: true, liberadaEm: new Date(), liberadaPor: userId || null } });
            if (upd.count !== 1) throw loteAlterado();
          }
          r.liberadas += 1;
          // Contatos e autorização podem mudar enquanto os PDFs são enviados por e-mail.
          const canal = await canalAtual();
          const destinos = await contatos(linha.portalClientId);
          const avaliacao = avaliarLinha({ canal, guide, destinatario: await destinatario(linha.portalClientId) });
          const alvos = destinos.telefones.filter((c) => linha.whatsapp.destinos.includes(c.telefoneE164));
          if (!linha.whatsapp.disponivel || !avaliacao.pode || !alvos.length || alvos.length !== linha.whatsapp.destinos.length) {
            r.whatsapp.push({ guideId: guide.id, ok: false, message: avaliacao.mensagem || linha.whatsapp.mensagem || "Os contatos de WhatsApp mudaram. Confira o cadastro." });
            continue;
          }
          try {
            const atual = await db.guide.findFirst({ where: { id: guide.id, portalClientId: linha.portalClientId }, select: SELECT_GUIA_PARA_ENVIO });
            if (!atual || assinaturaDocumento(atual) !== assinaturaDocumento(anterior)) throw loteAlterado();
            // A reserva do transportador é por guia/canal/destinatário. Nunca força reenvio.
            const out = await whatsapp({ guide: atual, destinatarios: alvos, canal, log, reenviar: false });
            r.whatsapp.push({ ...out, guideId: guide.id,
              ...(!out.ok && !out.message ? { message: out.mensagem || "WhatsApp com falha ou resultado pendente. Confira o histórico." } : {}) });
          } catch (err) { r.whatsapp.push({ guideId: guide.id, ...falha(err) }); }
        }
      } catch (err) { r.error = err.code; r.message = err.message; }
      r.ok = r.liberadas === linha.guideIds.length && r.email?.ok === true
        && r.whatsapp.length === linha.guideIds.length && r.whatsapp.every((w) => w.ok && !w.parcial);
    }
    return { ok: true, results };
  }
  return { prever, executar };
}
