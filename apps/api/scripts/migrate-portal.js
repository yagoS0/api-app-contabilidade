import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { prisma } from "../src/infrastructure/db/prisma.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

function decodeXmlMaybeGzipBase64(value) {
  if (!value) return null;
  const str = String(value);
  if (str.trim().startsWith("<")) return str;
  try {
    const raw = Buffer.from(str, "base64");
    try {
      return gunzipSync(raw).toString("utf-8");
    } catch {
      return raw.toString("utf-8");
    }
  } catch {
    return str;
  }
}

function sha256(text) {
  if (!text) return null;
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function mapPortalInvoiceStatusFromSystem(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return "PENDENTE";
  if (s.includes("cancel")) return "CANCELADA";
  if (s.includes("reject") || s.includes("rejeit")) return "REJEITADA";
  if (s.includes("issued") || s.includes("autoriz") || s.includes("emit")) return "EMITIDA";
  if (s.includes("pending")) return "PENDENTE";
  return "PENDENTE";
}

function mapPortalInvoiceStatusFromAdn({ status, tipoDocumento, tipoEvento, situacao }) {
  const td = String(tipoDocumento || "").toUpperCase();
  const st = String(status || "").toLowerCase();
  const te = String(tipoEvento || "").toUpperCase();
  const si = String(situacao || "").trim().toLowerCase();

  // Eventos
  if (te.includes("E105102")) return "SUBSTITUIDA";
  if (te.includes("E101101")) return "CANCELADA";
  if (td === "EVENTO") {
    if (te.includes("SUBSTIT")) return "SUBSTITUIDA";
    if (te.includes("CANCEL")) return "CANCELADA";
    if (te.includes("REJEIT") || te.includes("REJECT")) return "REJEITADA";
  }

  // Status normalizado existente (adnDocument.status)
  if (st === "cancelled_substitution") return "SUBSTITUIDA";
  if (st === "cancelled") return "CANCELADA";
  if (st === "rejected") return "REJEITADA";
  if (st === "authorized") return "EMITIDA";

  // cStat comum em XML NFS-e
  if (si === "100") return "EMITIDA";
  if (si === "101" || si === "102") return "CANCELADA";

  // situacaoNfse numérico do XML
  if (si === "2") return "CANCELADA";
  if (si === "1") return "EMITIDA";

  // Texto
  if (si.includes("cancel")) return "CANCELADA";
  if (si.includes("substit")) return "SUBSTITUIDA";
  if (si.includes("rejeit") || si.includes("reject")) return "REJEITADA";
  if (si.includes("autoriz") || si.includes("normal")) return "EMITIDA";

  return "PENDENTE";
}

async function findExistingPortalInvoice({ clientId, data }) {
  if (data.idDps) {
    const byIdDps = await prisma.portalInvoice.findUnique({
      where: { clientId_idDps: { clientId, idDps: data.idDps } },
    });
    if (byIdDps) return byIdDps;
  }
  if (data.chaveAcesso) {
    const byChave = await prisma.portalInvoice.findUnique({
      where: { clientId_chaveAcesso: { clientId, chaveAcesso: data.chaveAcesso } },
    });
    if (byChave) return byChave;
  }
  if (data.idNfse) {
    const byIdNfse = await prisma.portalInvoice.findUnique({
      where: { clientId_idNfse: { clientId, idNfse: data.idNfse } },
    });
    if (byIdNfse) return byIdNfse;
  }
  return null;
}

async function upsertPortalInvoiceSafe({ clientId, data }) {
  const existing = await findExistingPortalInvoice({ clientId, data });
  if (existing) {
    await prisma.portalInvoice.update({
      where: { id: existing.id },
      data,
    });
    return { action: "updated", invoiceId: existing.id };
  }

  try {
    const created = await prisma.portalInvoice.create({ data });
    return { action: "created", invoiceId: created.id };
  } catch (err) {
    // Corrida/duplicidade em outra chave única (idNfse/chaveAcesso/idDps): tenta resolver por busca e update.
    if (err?.code === "P2002") {
      const concurrent = await findExistingPortalInvoice({ clientId, data });
      if (concurrent) {
        await prisma.portalInvoice.update({
          where: { id: concurrent.id },
          data,
        });
        return { action: "updated", invoiceId: concurrent.id };
      }
    }
    throw err;
  }
}

async function ensurePortalClientForCompany(company) {
  const cnpj = normalizeCnpj(company.cnpj);
  if (!cnpj) return null;
  const existing = await prisma.portalClient.findFirst({
    where: { companyId: company.id },
  });
  if (existing) return existing;

  return prisma.portalClient.create({
    data: {
      companyId: company.id,
      razao: company.razaoSocial,
      cnpj,
      inscricaoMunicipal: company.inscricaoMunicipal || null,
      uf: null,
      municipio: null,
      integrationSettings: {
        create: {
          provider: "NFSENACIONAL",
          environment: "PROD",
          certCompanyId: company.id,
        },
      },
      syncState: {
        create: {
          lastCursor: BigInt(0),
          state: "OK",
        },
      },
    },
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const batchSize = 200;

  const summary = {
    portalClients: 0,
    portalInvoices: { created: 0, updated: 0, skipped: 0 },
    portalEvents: { created: 0, skipped: 0 },
  };

  // 1) PortalClient from Company
  const companies = await prisma.company.findMany();
  const portalByCompanyId = new Map();
  const portalByCnpj = new Map();

  for (const company of companies) {
    const portal = dryRun ? { id: `dry_${company.id}`, companyId: company.id, cnpj: normalizeCnpj(company.cnpj) } : await ensurePortalClientForCompany(company);
    if (portal) {
      summary.portalClients += 1;
      portalByCompanyId.set(company.id, portal);
      if (portal.cnpj) portalByCnpj.set(portal.cnpj, portal);
    }
  }

  // Sync state seed from AdnSyncState (best-effort)
  if (!dryRun) {
    for (const [cnpj, portal] of portalByCnpj.entries()) {
      const state = await prisma.adnSyncState.findUnique({ where: { cnpj } }).catch(() => null);
      if (!state) continue;
      await prisma.portalSyncState.upsert({
        where: { clientId: portal.id },
        create: {
          clientId: portal.id,
          lastCursor: state.ultimoNSU ?? BigInt(0),
          state: "OK",
          lastSyncAt: null,
        },
        update: {
          lastCursor: state.ultimoNSU ?? BigInt(0),
        },
      });
    }
  }

  // 2) ServiceInvoice -> PortalInvoice
  let svcCursor = null;
  while (true) {
    const items = await prisma.serviceInvoice.findMany({
      ...(svcCursor ? { where: { id: { gt: svcCursor } } } : {}),
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (!items.length) break;

    for (const it of items) {
      const portal = portalByCompanyId.get(it.companyId);
      if (!portal) {
        summary.portalInvoices.skipped += 1;
        continue;
      }

      const data = {
        clientId: portal.id,
        type: "NFSE",
        numero: it.numeroNfse || null,
        serie: it.rpsSerie || null,
        chaveAcesso: it.chaveAcesso || null,
        idNfse: it.numeroNfse || null,
        idDps: it.idDps || null,
        competencia: it.competencia || null,
        issueDate: it.competencia || null,
        status: mapPortalInvoiceStatusFromSystem(it.status),
        total: it.valorServicos,
        emitenteNome: null,
        emitenteDoc: portal.cnpj,
        tomadorNome: it.tomadorNome,
        tomadorDoc: normalizeCnpj(it.tomadorDoc),
        xmlRaw: it.xml || null,
        pdfUrl: it.pdfUrl || null,
        xmlHash: sha256(it.xml || ""),
        lastSyncAt: null,
      };

      if (dryRun) {
        summary.portalInvoices.created += 1;
      } else {
        const result = await upsertPortalInvoiceSafe({
          clientId: portal.id,
          data,
        });
        if (result.action === "created") {
          summary.portalInvoices.created += 1;
        } else {
          summary.portalInvoices.updated += 1;
        }
      }
    }

    svcCursor = items[items.length - 1].id;
  }

  // 3) AdnDocument -> PortalInvoice (+ events)
  let adnCursor = null;
  while (true) {
    const docs = await prisma.adnDocument.findMany({
      ...(adnCursor ? { where: { id: { gt: adnCursor } } } : {}),
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (!docs.length) break;

    for (const doc of docs) {
      const candidates = new Set([
        normalizeCnpj(doc.cnpjPrestador),
        normalizeCnpj(doc.cnpjTomador),
      ]);
      for (const cnpj of candidates) {
        if (!cnpj) continue;
        const portal = portalByCnpj.get(cnpj);
        if (!portal) continue;

        const xmlRaw = doc.xmlPlain || decodeXmlMaybeGzipBase64(doc.xmlBase64Gzip) || null;
        const mappedStatus = mapPortalInvoiceStatusFromAdn({
          status: doc.status,
          tipoDocumento: doc.tipoDocumento,
          tipoEvento: doc.tipoEvento,
          situacao: doc.situacao,
        });

        const invoiceData = {
          clientId: portal.id,
          type: "NFSE",
          numero: doc.numeroNfse || null,
          serie: null,
          chaveAcesso: doc.chaveAcesso || null,
          idNfse: doc.numeroNfse || null,
          idDps: null,
          competencia: doc.competencia || null,
          issueDate: doc.dataEmissao || null,
          status: mappedStatus,
          total: doc.valorServicos || null,
          emitenteNome: doc.prestadorNome || null,
          emitenteDoc: normalizeCnpj(doc.cnpjPrestador) || null,
          tomadorNome: doc.tomadorNome || null,
          tomadorDoc: normalizeCnpj(doc.cnpjTomador) || null,
          xmlRaw,
          pdfUrl: null,
          xmlHash: sha256(xmlRaw || ""),
          lastSyncAt: null,
        };

        if (String(doc.tipoDocumento || "").toUpperCase() === "EVENTO") {
          // Evento: tenta associar à nota via chaveAcesso; cria stub se necessário
          if (!invoiceData.chaveAcesso) {
            summary.portalEvents.skipped += 1;
            continue;
          }

          if (!dryRun) {
            const invResult = await upsertPortalInvoiceSafe({
              clientId: portal.id,
              data: {
                ...invoiceData,
                // evento pode mudar status e xml
                status: invoiceData.status,
                xmlRaw: invoiceData.xmlRaw || undefined,
                xmlHash: invoiceData.xmlHash || undefined,
                issueDate: invoiceData.issueDate || undefined,
                competencia: invoiceData.competencia || undefined,
                total: invoiceData.total || undefined,
                tomadorNome: invoiceData.tomadorNome || undefined,
                tomadorDoc: invoiceData.tomadorDoc || undefined,
                emitenteNome: invoiceData.emitenteNome || undefined,
                emitenteDoc: invoiceData.emitenteDoc || undefined,
              },
            });

            await prisma.portalInvoiceEvent.create({
              data: {
                clientId: portal.id,
                invoiceId: invResult.invoiceId,
                type: invoiceData.status,
                date: doc.dataHoraGeracao || doc.dataEmissao || null,
                protocol: null,
                reason: null,
                payloadRaw: {
                  tipoDocumento: doc.tipoDocumento,
                  tipoEvento: doc.tipoEvento,
                  situacao: doc.situacao,
                  nsu: doc.nsu?.toString?.() ?? String(doc.nsu),
                },
              },
            });
          }
          summary.portalEvents.created += 1;
          continue;
        }

        // Documento NFSe
        if (dryRun) {
          summary.portalInvoices.created += 1;
        } else {
          const result = await upsertPortalInvoiceSafe({
            clientId: portal.id,
            data: invoiceData,
          });
          if (result.action === "updated") {
            summary.portalInvoices.updated += 1;
          } else {
            summary.portalInvoices.created += 1;
          }
        }
      }
    }

    adnCursor = docs[docs.length - 1].id;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, dryRun, summary }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("migrate-portal failed", err);
  process.exit(1);
});

