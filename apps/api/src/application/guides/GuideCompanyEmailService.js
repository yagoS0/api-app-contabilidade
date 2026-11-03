import { conferirParcelasParaEnvio, bloqueioEnvioParcela, SELECT_PARCELA_ENVIO } from "./GuiaParcelaEnvioGuard.js";
import { reservarSemEntregaExterna } from './EntregaExternaGuiaService.js';
import { registrarEnvio, marcarEnviando, marcarEnviado, marcarFalhou, marcarIndeterminado, enviosPorGuia } from './EnvioGuiaService.js';
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { prisma } from "../../infrastructure/db/prisma.js";
import { EmailService } from "../../infrastructure/mail/EmailService.js";
import { getGuidePdfBuffer } from "./GuideService.js";
import { guideTypeEmailLabel } from "./guideEmailCopy.js";
import { SEM_DESTINATARIO_DE_GUIA, resolveCompanyNotificationEmails, validarDestinatariosAtuais } from "./GuideScheduledEmailService.js";
import { whereGuiaPendenteDeEnvio } from "./guideContract.js";
import { conferirGuiasVencimento } from "./GuideDueBatchService.js";
import { loteAlterado, periodoVencimento, assinaturaGuias } from "./loteVencimento.js";

async function conferirLedgerEmail(db, ids) {
  const blocked = await db.envioGuia.findFirst({ where: { guideId: { in: ids }, canal: 'EMAIL', status: { in: ['enviando', 'indeterminado', 'enviado', 'entregue', 'lido'] } } });
  if (blocked) throw Object.assign(new Error('Existe envio confirmado ou sem desfecho para estas guias. Confira os destinatários e a tentativa antes de reenviar.'), { code: 'EMAIL_TENTATIVA_EXISTENTE', status: 409 });
}

function safeTempName(name) {
  return String(name || "guia.pdf").replace(/[\\/]+/g, "-");
}

// Nome do PDF anexado = NOME DA GUIA (tipo + competência), sem o caminho de origem —
// o `sourcePath` do SERPRO vinha como "SERPRO PGDAS-D 2026-05" e virava o nome do anexo.
// `usedNames` (Set) desambigua nomes repetidos no mesmo e-mail (ex.: 2 guias do mesmo tipo).
function guidePdfFilename(guide, usedNames) {
  const label = guide.parcelamentoId ? `Parcelamento${guide.numeroParcela ? ` parcela ${guide.numeroParcela}` : ""}` : guideTypeEmailLabel(guide.tipo);
  const nice = label === "pagamento" ? "Guia" : label; // OUTRA (DARF/LP) → "Guia"
  const comp = guide.competencia ? ` ${guide.competencia}` : "";
  const base = `${nice}${comp}`;
  let name = safeTempName(`${base}.pdf`);
  if (usedNames) {
    let i = 2;
    while (usedNames.has(name)) name = safeTempName(`${base} (${i++}).pdf`);
    usedNames.add(name);
  }
  return name;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml({ razao, competencia, typeLabels }) {
  const razaoSafe = escapeHtml(razao);
  const compSafe = escapeHtml(competencia);
  const unique = [...new Set(typeLabels)];
  const labelsSafe = unique.map((l) => escapeHtml(l)).join(", ");
  const intro =
    unique.length === 1
      ? `<p>Aqui está sua guia de <strong>${escapeHtml(unique[0])}</strong> (competência <strong>${compSafe}</strong>).</p>`
      : `<p>Seguem em anexo as guias: <strong>${labelsSafe}</strong> — competência <strong>${compSafe}</strong>.</p>`;
  return `
    <!doctype html>
    <html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px">
    <p>Olá, <strong>${razaoSafe}</strong>,</p>
    ${intro}
    <p>Os PDFs estão em anexo.</p>
    <p style="margin-top:1.5em">Um abraço,<br><strong>Equipe Altan Contabilidade</strong></p>
    </body></html>
  `;
}

export async function sendLatestGuidesEmailByCompany({ portalClientId, to, maxFilesPerRun: maxFiles }) {
  const maxFilesPerRunRaw = Number(maxFiles || 0);
  const maxFilesPerRun =
    Number.isFinite(maxFilesPerRunRaw) && maxFilesPerRunRaw > 0
      ? Math.min(Math.floor(maxFilesPerRunRaw), 100)
      : null;
  const startedAt = Date.now();
  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { id: true, razao: true, cnpj: true },
  });
  if (!portal?.id) {
    const err = new Error("portal_company_not_found");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }
  to = await validarDestinatariosAtuais(portal.id, to);

  const candidatos = await prisma.guide.findMany({
    include: { parcelamento: SELECT_PARCELA_ENVIO.parcelamento, parcela: SELECT_PARCELA_ENVIO.parcela },
    where: {
      portalClientId: portal.id,
      status: "PROCESSED",
      NOT: {
        OR: [{ emailStatus: "SENT" }, { emailStatus: "SENDING" }],
      },
    },
    orderBy: [{ competencia: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  const bloqueadas = candidatos.filter(bloqueioEnvioParcela).map(g => bloqueioEnvioParcela(g));
  const entregas = await enviosPorGuia(candidatos.map(g => g.id));
  const pendingAll = candidatos.filter(g => !bloqueioEnvioParcela(g) && !(entregas.get(g.id) || []).some(e => e.entregaExterna));
  if (!pendingAll.length && bloqueadas.length) throw Object.assign(new Error(bloqueadas[0].message), bloqueadas[0], { bloqueadas });
  if (!pendingAll.length) {
    return {
      companyId: portal.id,
      to,
      competencia: null,
      totalFound: 0,
      sentNow: 0,
      alreadySent: 0,
      status: "nothing_to_send",
      durationMs: Date.now() - startedAt,
    };
  }

  const latestCompetencia = pendingAll[0]?.competencia || null;
  const pendingGuides = latestCompetencia
    ? pendingAll.filter((g) => g.competencia === latestCompetencia)
    : pendingAll;
  const toSend = maxFilesPerRun ? pendingGuides.slice(0, maxFilesPerRun) : pendingGuides;
  const toSendIds = toSend.map((g) => g.id);

  await reservarSemEntregaExterna(prisma, toSend, async tx => { await conferirLedgerEmail(tx, toSendIds); const r = await tx.guide.updateMany({
    where: { id: { in: toSendIds }, ...whereGuiaPendenteDeEnvio() },
    data: {
      emailStatus: "SENDING",
      emailLastError: null,
      emailNextRetryAt: null,
      emailAttempts: { increment: 1 },
    },
  }); if (r.count !== toSendIds.length) throw loteAlterado(); });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "guides-email-"));
  const attachments = [];
  let attachmentsBytes = 0;
  const usedNames = new Set();
  const email = new EmailService();

  try {
    for (const guide of toSend) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await getGuidePdfBuffer(guide);
      if (!buffer?.length) {
        throw new Error(`guide_pdf_missing:${guide.id}`);
      }
      attachmentsBytes += Number(buffer.length || 0);
      const name = guidePdfFilename(guide, usedNames);
      const tmpPath = path.join(tmpDir, `${guide.id}-${name}`);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(tmpPath, buffer);
      attachments.push({ path: tmpPath, filename: name });
    }

    const typeLabels = toSend.map((g) => guideTypeEmailLabel(g.tipo));
    const uniqueLabels = [...new Set(typeLabels)];
    const subject =
      uniqueLabels.length === 1
        ? `Sua guia de ${uniqueLabels[0]} — ${latestCompetencia || "—"}`
        : `Suas guias — ${latestCompetencia || "—"}`;
    const html = buildEmailHtml({
      razao: portal.razao,
      competencia: latestCompetencia || "—",
      typeLabels,
    });
    // Os anexos podem demorar a carregar. Um contato removido nesse intervalo não recebe.
    to = await validarDestinatariosAtuais(portal.id, to);
    await conferirParcelasParaEnvio(toSend);
    await email.send({ to, subject, html, attachments });

    const sentAt = new Date();
    await prisma.guide.updateMany({
      where: { id: { in: toSendIds } },
      data: {
        emailStatus: "SENT",
        emailSentAt: sentAt,
        emailLastError: null,
        emailNextRetryAt: null,
      },
    });

    return {
      companyId: portal.id,
      to,
      competencia: latestCompetencia,
      totalFound: pendingGuides.length,
      sentNow: toSend.length,
      alreadySent: 0,
      pendingToSend: pendingGuides.length,
      remainingAfterRun: Math.max(pendingGuides.length - toSend.length, 0),
      bloqueadas,
      maxFilesPerRun: maxFilesPerRun || null,
      attachmentsCount: toSend.length,
      attachmentsBytes,
      durationMs: Date.now() - startedAt,
      status: "sent",
    };
  } catch (err) {
    await prisma.guide.updateMany({
      where: { id: { in: toSendIds } },
      data: {
        emailStatus: "ERROR",
        emailLastError: err?.message || "guide_email_send_failed",
      },
    });
    const sendErr = new Error(err?.message || "guide_email_send_failed");
    sendErr.code = err?.code || "GUIDE_EMAIL_SEND_FAILED";
    sendErr.meta = {
      companyId: portal.id,
      to,
      maxFilesPerRun: maxFilesPerRun || null,
      attachmentsCount: toSend.length,
      attachmentsBytes,
      durationMs: Date.now() - startedAt,
    };
    throw sendErr;
  } finally {
    try {
      await Promise.all(
        attachments.map(async (item) => {
          if (item?.path && fssync.existsSync(item.path)) {
            await fs.unlink(item.path);
          }
        })
      );
      if (tmpDir && fssync.existsSync(tmpDir)) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // noop
    }
  }
}

/**
 * Envia 1 e-mail por empresa com TODAS as guias pendentes da competência informada.
 *
 * Variante de `sendLatestGuidesEmailByCompany` que aceita competência explícita
 * (em vez de inferir a "última"). Usado pela página "Envio de e-mails em lote".
 *
 * - Busca todas as guides PROCESSED dessa competência com emailStatus PENDING ou ERROR.
 * - Resolve destinatários via `resolveCompanyNotificationEmails` — ⚠ SÓ os cadastrados em
 *   Configuração de envio (05/09/2026). Sem nenhum, a guia NÃO sai e a recusa é nomeada.
 * - Anexa cada PDF como anexo separado.
 * - Após envio bem-sucedido, marca todas como SENT.
 * - Em falha, marca como ERROR + emailLastError.
 *
 * @param {{ portalClientId: string, competencia: string }} params
 * @returns {Promise<object>} status + counts
 */
export async function sendCompanyGuidesEmail({ portalClientId, competencia, mesVencimento, selectedGuideIds, assinatura }) {
  const startedAt = Date.now();
  if (!portalClientId) {
    const err = new Error("portal_client_id_required");
    err.code = "PORTAL_CLIENT_ID_REQUIRED";
    throw err;
  }
  if (!mesVencimento && !/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    const err = new Error("competencia_invalida");
    err.code = "COMPETENCIA_INVALIDA";
    throw err;
  }

  const portal = await prisma.portalClient.findUnique({
    where: { id: String(portalClientId) },
    select: { id: true, razao: true, cnpj: true },
  });
  if (!portal?.id) {
    const err = new Error("portal_company_not_found");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }

  // ⚠ TODOS os destinatários cadastrados (05/09/2026), não mais um só. A vírgula é o separador do
  // cabeçalho `To:` (RFC 5322) e vale nos dois transportes (Gmail API e SMTP).
  const destinos = await resolveCompanyNotificationEmails(portal.id);
  const to = destinos.join(", ");
  if (!to) {
    // ⚠ Só destinatário CADASTRADO envia guia (05/09/2026) — a frase é a mesma das outras portas.
    const err = new Error(SEM_DESTINATARIO_DE_GUIA.motivo);
    err.code = "COMPANY_EMAIL_NOT_FOUND";
    throw err;
  }

  // Guias da competência que ainda podem ser enviadas.
  //
  // ⚠ A regra vem do `guideContract`, e o `emailStatus` NULL entra. Aqui estava escrito
  // `{ in: ["PENDING","ERROR"] }`, e `IN` do SQL não casa com NULL: a DARF consolidada do Lucro
  // Presumido — a única guia que nasce sem `emailStatus` — era oferecida pela matriz do lote e
  // depois excluída dos anexos, com a rota respondendo `ok: true, sent: 0`.
  //
  // Sem `retryAntesDe`: envio manual não espera janela de retry. Quem clicou quer agora.
  if (mesVencimento) {
    if (!assinatura) throw loteAlterado();
    await conferirGuiasVencimento({ portalClientIds: [portal.id], mesVencimento, guideIds: selectedGuideIds, assinatura });
  }
  const guides = await prisma.guide.findMany({
    include: { parcelamento: SELECT_PARCELA_ENVIO.parcelamento, parcela: SELECT_PARCELA_ENVIO.parcela },
    where: {
      portalClientId: portal.id,
      ...(mesVencimento ? { vencimento: periodoVencimento(mesVencimento), id: { in: selectedGuideIds },
        AND: [{ OR: [{ paymentStatus: null }, { paymentStatus: { not: "PAID" } }] }] } : { competencia }),
      status: "PROCESSED",
      ...whereGuiaPendenteDeEnvio(),
    },
    orderBy: { updatedAt: "asc" },
  });
  if (!guides.length) {
    return {
      companyId: portal.id,
      to,
      competencia,
      totalFound: 0,
      sentNow: 0,
      status: "nothing_to_send",
      durationMs: Date.now() - startedAt,
    };
  }

  // Marca como SENDING antes de tentar enviar (evita race com outros workers).
  if (mesVencimento && assinaturaGuias(guides) !== assinatura) throw loteAlterado();
  await conferirParcelasParaEnvio(guides, { atualizar: false });
  const guideIds = guides.map((g) => g.id);
  const reservaEm = new Date();
  const reservar = (db) => db.guide.updateMany({
    where: { id: { in: guideIds }, AND: [whereGuiaPendenteDeEnvio(),
      { OR: [{ paymentStatus: null }, { paymentStatus: { not: "PAID" } }] },
      { OR: guides.map((g) => ({ id: g.id, updatedAt: g.updatedAt })) }] },
    data: { emailStatus: "SENDING", emailLastError: null, emailNextRetryAt: null, emailAttempts: { increment: 1 }, ...(mesVencimento ? { updatedAt: reservaEm } : {}) },
  });
  if (mesVencimento) {
    if (guides.length !== selectedGuideIds.length) throw loteAlterado();
    await reservarSemEntregaExterna(prisma, guides, async (tx) => {
      await conferirLedgerEmail(tx, guideIds);
      const r = await reservar(tx);
      if (r.count !== guideIds.length) throw loteAlterado();
    });
  } else await reservarSemEntregaExterna(prisma, guides, async tx => { await conferirLedgerEmail(tx, guideIds); const r = await reservar(tx); if (r.count !== guideIds.length) throw loteAlterado(); });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "guides-batch-email-"));
  const attachments = [];
  let attachmentsBytes = 0;
  const usedNames = new Set();
  const email = new EmailService();

  try {
    for (const guide of guides) {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await getGuidePdfBuffer(guide);
      if (!buffer?.length) {
        throw new Error(`guide_pdf_missing:${guide.id}`);
      }
      attachmentsBytes += Number(buffer.length || 0);
      const name = guidePdfFilename(guide, usedNames);
      const tmpPath = path.join(tmpDir, `${guide.id}-${name}`);
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(tmpPath, buffer);
      attachments.push({ path: tmpPath, filename: name });
    }

    const typeLabels = guides.map((g) => guideTypeEmailLabel(g.tipo));
    const uniqueLabels = [...new Set(typeLabels)];
    const subject = mesVencimento ? `Guias com vencimento em ${mesVencimento}` : uniqueLabels.length === 1
      ? `Sua guia de ${uniqueLabels[0]} — ${competencia}`
      : `Suas guias — ${competencia}`;
    const html = mesVencimento
      ? `<p>Olá, ${escapeHtml(portal.razao)}.</p><p>Seguem as guias com vencimento em ${escapeHtml(mesVencimento)}:</p><ul>${guides.map((g) => `<li>${escapeHtml(g.parcelamentoId ? "Parcelamento" : guideTypeEmailLabel(g.tipo))} — competência/referência ${escapeHtml(g.competencia)} — vencimento ${escapeHtml(new Date(g.vencimento).toISOString().slice(0, 10))}</li>`).join("")}</ul><p>Os PDFs estão em anexo.</p>`
      : buildEmailHtml({ razao: portal.razao, competencia, typeLabels });
    await validarDestinatariosAtuais(portal.id, to);
    if (mesVencimento) {
      const atuais = await prisma.guide.findMany({ where: { id: { in: guideIds }, portalClientId: portal.id },
        select: { id: true, paymentStatus: true, status: true, vencimento: true, hash: true, valor: true, competencia: true, updatedAt: true } });
      if (atuais.length !== guides.length || atuais.some((g) => g.paymentStatus === "PAID" || g.status !== "PROCESSED"
        || new Date(g.updatedAt).getTime() !== reservaEm.getTime()
        || new Date(g.vencimento).toISOString().slice(0, 7) !== mesVencimento
        || g.hash !== guides.find((x) => x.id === g.id)?.hash
        || String(g.valor) !== String(guides.find((x) => x.id === g.id)?.valor)
        || g.competencia !== guides.find((x) => x.id === g.id)?.competencia)) throw loteAlterado();
    }
    await conferirParcelasParaEnvio(guides);
    await email.send({ to, subject, html, attachments });

    const sentAt = new Date();
    await prisma.guide.updateMany({
      where: { id: { in: guideIds } },
      data: { emailStatus: "SENT", emailSentAt: sentAt, emailLastError: null, emailNextRetryAt: null },
    });

    return {
      companyId: portal.id,
      to,
      competencia,
      totalFound: guides.length,
      sentNow: guides.length,
      attachmentsCount: guides.length,
      attachmentsBytes,
      durationMs: Date.now() - startedAt,
      status: "sent",
    };
  } catch (err) {
    await prisma.guide.updateMany({
      where: { id: { in: guideIds } },
      data: { emailStatus: "ERROR", emailLastError: err?.message || "guide_email_send_failed" },
    });
    const sendErr = new Error(err?.message || "guide_email_send_failed");
    sendErr.code = err?.code || "GUIDE_EMAIL_SEND_FAILED";
    sendErr.meta = { companyId: portal.id, to, competencia, attachmentsCount: guides.length, durationMs: Date.now() - startedAt };
    throw sendErr;
  } finally {
    try {
      await Promise.all(attachments.map(async (item) => {
        if (item?.path && fssync.existsSync(item.path)) await fs.unlink(item.path);
      }));
      if (tmpDir && fssync.existsSync(tmpDir)) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // noop
    }
  }
}


// Internal automatic entry point. Exact documents and destinations are immutable intent data;
// no HTTP request can supply the callback. Manual entry points retain their explicit retry policy.
export async function enviarGuiasExatasDoCiclo({ portalClientId, guides, destinos, beforeDispatch, releaseActorId = null }, deps = {}) {
  const db = deps.db || prisma, email = deps.email || new EmailService();
  const pdf = deps.pdf || getGuidePdfBuffer, validateTo = deps.validateTo || validarDestinatariosAtuais;
  if (!guides?.length || !destinos?.length || typeof beforeDispatch !== 'function' || guides.some(g => g.portalClientId !== portalClientId)) throw loteAlterado();
  const ids = guides.map(g => g.id), reservations = [];
  await beforeDispatch({ stage: 'prepare' });
  await reservarSemEntregaExterna(db, guides, async tx => {
    const locked = await tx.guide.updateMany({ where: { id: { in: ids }, portalClientId, status: 'PROCESSED',
      AND: [whereGuiaPendenteDeEnvio(), { OR: [{ paymentStatus: null }, { paymentStatus: { not: 'PAID' } }] }] },
      data: { emailStatus: 'SENDING', emailAttempts: { increment: 1 }, emailNextRetryAt: null, liberadaCliente: true, liberadaEm: new Date(), liberadaPor: releaseActorId } });
    if (locked.count !== ids.length) throw loteAlterado();
    for (const guide of guides) for (const destino of destinos) {
      // Any earlier attempt requires explicit review, including a failed one.
      if (await tx.envioGuia.findFirst({ where: { guideId: guide.id, canal: 'EMAIL', destino } })) throw loteAlterado();
      const { envio } = await registrarEnvio({ guideId: guide.id, canal: 'EMAIL', destino, tx });
      const reservation = await marcarEnviando(envio.id, tx);
      if (!reservation.reservado) throw loteAlterado();
      reservations.push({ envioId: envio.id, tentativaId: reservation.tentativaId, guideId: guide.id, destino });
    }
  });
  let dispatched = false;
  try {
    const used = new Set(), attachments = [];
    for (const guide of guides) {
      const buffer = await pdf(guide);
      if (!buffer?.length) throw Object.assign(new Error('PDF da guia indisponível.'), { code: 'GUIA_SEM_PDF' });
      attachments.push({ filename: guidePdfFilename(guide, used), content: buffer });
    }
    const to = destinos.join(', ');
    const result = await email.send({ to, subject: 'Guias para pagamento',
      html: '<p>Seguem as guias disponíveis em anexo. Confira cada documento e seu vencimento.</p>', attachments,
      beforeDispatch: async () => {
        await validateTo(portalClientId, to);
        await conferirParcelasParaEnvio(guides, { client: db });
        await beforeDispatch({ stage: 'dispatch' });
        dispatched = true;
      } });
    const address = value => String(typeof value === 'object' ? value?.address || '' : value || '').trim().toLowerCase();
    const accepted = new Set((result?.accepted || []).map(address)), rejected = new Set((result?.rejected || []).map(address));
    const outcomes = destinos.map(destination => ({ destination, status: result?.id || accepted.has(address(destination)) ? 'SENT' : rejected.has(address(destination)) ? 'REVIEW' : 'UNCERTAIN' }));
    for (const r of reservations) {
      const status = outcomes.find(o => o.destination === r.destino).status;
      if (status === 'SENT') await marcarEnviado({ ...r, providerMessageId: null }, db);
      else if (status === 'REVIEW') await marcarFalhou({ ...r, codigo: 'EMAIL_DESTINO_RECUSADO', mensagemUsuario: 'Provedor recusou este destinatário. Confira antes de reenviar.' }, db);
      else await marcarIndeterminado({ ...r, mensagemUsuario: 'Provedor não confirmou este destinatário. Confira antes de repetir.' }, db);
    }
    const complete = outcomes.every(o => o.status === 'SENT');
    await db.guide.updateMany({ where: { id: { in: ids }, portalClientId, emailStatus: 'SENDING' }, data: { emailStatus: complete ? 'SENT' : 'ERROR', emailSentAt: complete ? new Date() : null, emailLastError: complete ? null : 'Aceite parcial ou incerto; confira os destinatários.' } });
    return { status: complete ? 'sent' : 'partial', outcomes, reservations, providerReference: result?.id || result?.messageId || null };
  } catch (error) {
    for (const r of reservations) {
      if (dispatched) await marcarIndeterminado({ ...r, mensagemUsuario: 'Confira o envio antes de tentar novamente.' }, db);
      else await marcarFalhou({ ...r, codigo: error.code || 'ENVIO_INTERROMPIDO', mensagemUsuario: 'Envio interrompido antes do transporte. Confira a configuração.' }, db);
    }
    await db.guide.updateMany({ where: { id: { in: ids }, portalClientId, emailStatus: 'SENDING' }, data: { emailStatus: 'ERROR', emailLastError: dispatched ? 'Resultado incerto; conferir antes de repetir.' : 'Envio interrompido; conferir configuração.' } });
    throw Object.assign(error, { dispatched });
  }
}
