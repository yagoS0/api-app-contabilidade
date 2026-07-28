// Robustez NFS-e/ADN — Camada 2: conferência de contagem por CHAVE contra o ADN, antes do fechamento.
// Compara o CONJUNTO de chaves que temos (EMIT/autorizada da competência, mesma população do
// faturamento) com o CONJUNTO autoritativo do ADN (scan read-only por NSU, sem mover cursor nem
// gravar nota). Divergência (ADN tem chave que nós não temos) grava conferenciaStatus="divergente"
// no snapshot — e o salvarFechamento TRAVA. É a detecção automática do "28 vs 27".
//
// Além de contar, a conferência CORRIGE um caso: nota que o cliente cancelou no sistema NACIONAL
// (NFS-e Nacional, via ADN) e que aqui continuou "autorizada". O ADN é a autoridade — enquanto não
// marcarmos, ela soma no faturamento e a apuração sai A MAIOR, sem nada indicar. Só corrige com
// evidência explícita de cancelamento (situação da nota ou evento); nunca por ausência no scan.
//
// Municípios ainda fora do ADN / empresa sem cert próprio → "nao_conferivel" (NÃO trava).
// O scan é sob demanda (uma vez por competência), não a cada save. Prod-only (precisa de cert + ADN):
// a lógica de diff é pura e testável offline; o scan em si roda no ambiente do escritório.

import zlib from "zlib";
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe } from "../../adn-nacional/AdnNacionalClient.js";
import { parseXmlMetadata, parseNfseEvento } from "../../../nfse/AdnXmlMetadata.js";
import { resolveCertForCompany, SERVICOS } from "../../CertResolver.js";

const LOTE_MAX = Number(process.env.ADN_LOTE_MAX) || 50;
const DELAY_MS = Number(process.env.ADN_DELAY_MS) || 1100;
const MAX_ITER = Number(process.env.CONFERENCIA_MAX_ITER) || 400; // teto de segurança (~20k docs)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeXml(arquivoXml) {
  const buf = Buffer.from(arquivoXml, "base64");
  try { return zlib.gunzipSync(buf).toString("utf8"); } catch { return buf.toString("utf8"); }
}

function rangeMes(competencia) {
  const [y, m] = String(competencia).split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

function mesUTC(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// (a) Nosso conjunto: mesma where-clause do faturamento (clientId, EMIT, autorizada, competência).
export async function getNossoConjunto({ portalClientId, competencia }) {
  const { gte, lt } = rangeMes(competencia);
  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: String(portalClientId), papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
    select: { chaveAcesso: true, idNfse: true },
  });
  const chaves = new Set();
  for (const n of notas) {
    const k = n.chaveAcesso || n.idNfse;
    if (k) chaves.add(String(k));
  }
  return chaves;
}

// (c) Diff puro (testável offline). Faltantes = ADN tem e nós não (o "28 vs 27").
export function diffConjuntos(nosso, autoritativo) {
  const faltantes = [...autoritativo].filter((k) => !nosso.has(k));
  const extras = [...nosso].filter((k) => !autoritativo.has(k));
  return { faltantes, extras, ok: faltantes.length === 0 };
}

// (b) Scan read-only do ADN: percorre por NSU sem mover cursor nem gravar nada. Coleta chaves NFS-e
// por competência, o CNPJ prestador (pra filtrar EMIT) e o conjunto de canceladas (nota e eventos).
export async function scanAdnAutoritativo({ portalClientId, env = "prod" }) {
  let cert;
  try { cert = await resolveCertForCompany({ portalClientId, servico: SERVICOS.NFSE }); }
  catch { return { disponivel: false, motivo: "NO_COMPANY_CERT" }; }
  if (!cert?.pfxBuffer) return { disponivel: false, motivo: "NO_COMPANY_CERT" };

  const portal = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
  const cnpj = String(portal?.cnpj || "").replace(/\D+/g, "");
  if (cnpj.length !== 14) return { disponivel: false, motivo: "CNPJ_INVALIDO" };

  const porCompetencia = new Map(); // comp -> Set<chave>
  const canceladas = new Set();
  const chavePrestador = new Map(); // chave -> cnpjPrestador (14 dígitos)
  let nsu = 0n;
  let iteracoes = 0;
  let alcancouFim = false;

  try {
    while (iteracoes < MAX_ITER) {
      iteracoes++;
      // eslint-disable-next-line no-await-in-loop
      const batch = await fetchDfeNFSe({
        cnpj, ultNSU: nsu.toString(), pfxBuffer: cert.pfxBuffer, password: cert.password, env, autoDiscover: false,
      });
      const items = batch?.items || [];
      if (batch?.status === "NENHUM_DOCUMENTO_LOCALIZADO" || items.length === 0) { alcancouFim = true; break; }

      let maxNsu = nsu;
      for (const item of items) {
        const nsuRaw = item.NSU || item.nsu;
        if (nsuRaw) { const n = BigInt(nsuRaw); if (n > maxNsu) maxNsu = n; }
        const arquivo = item.ArquivoXml || item.arquivoXml;
        if (!arquivo) continue;
        const xml = decodeXml(arquivo);
        const tipo = String(item.TipoDocumento || item.tipoDocumento || "").toUpperCase();

        if (tipo === "EVENTO") {
          const ev = parseNfseEvento(xml);
          if (ev?.isCancelamento && ev.chave) canceladas.add(String(ev.chave));
          continue;
        }

        const meta = parseXmlMetadata(xml);
        const chave = meta.chaveAcesso ? String(meta.chaveAcesso) : (item.ChaveAcesso ? String(item.ChaveAcesso) : null);
        if (!chave) continue;
        const comp = mesUTC(meta.competencia || meta.dataEmissao);
        if (!comp) continue;

        const sit = String(meta.situacao || "").toUpperCase();
        if (sit === "CANCELADA" || sit === "2") canceladas.add(chave);
        if (meta.cnpjPrestador) chavePrestador.set(chave, String(meta.cnpjPrestador).replace(/\D+/g, ""));
        if (!porCompetencia.has(comp)) porCompetencia.set(comp, new Set());
        porCompetencia.get(comp).add(chave);
      }

      if (items.length < LOTE_MAX) { alcancouFim = true; break; }
      nsu = maxNsu + 1n;
      // eslint-disable-next-line no-await-in-loop
      await sleep(DELAY_MS);
    }
  } catch (err) {
    return { disponivel: false, motivo: err?.code || err?.message || "ADN_SCAN_FAILED" };
  }

  return { disponivel: true, porCompetencia, canceladas, chavePrestador, cnpj, via: cert.source, iteracoes, alcancouFim };
}

// (d) Orquestra: confere uma competência contra o ADN e GRAVA o resultado no snapshot (pra o
// salvarFechamento poder travar). Retorna { status, resultado }.
export async function conferirCompetencia({ portalClientId, competencia, env = "prod" }) {
  const nosso = await getNossoConjunto({ portalClientId, competencia });
  const scan = await scanAdnAutoritativo({ portalClientId, env });

  let status;
  let resultado;
  if (!scan.disponivel) {
    status = "nao_conferivel";
    resultado = { motivo: scan.motivo, nossoTotal: nosso.size, adnTotal: null, faltantes: [], extras: [], env };
  } else {
    // Conjunto autoritativo da competência: EMIT do próprio CNPJ, não canceladas.
    const compSet = scan.porCompetencia.get(competencia) || new Set();
    const autoritativo = new Set();
    for (const chave of compSet) {
      if (scan.canceladas.has(chave)) continue;
      const prest = scan.chavePrestador.get(chave);
      if (prest && scan.cnpj && prest !== scan.cnpj) continue; // só onde a empresa é a prestadora (EMIT)
      autoritativo.add(chave);
    }
    const { faltantes, extras, ok } = diffConjuntos(nosso, autoritativo);

    // CANCELADA PELO CLIENTE no NFS-e Nacional: nota que temos como "autorizada" e que o ADN
    // (autoridade nacional, não a prefeitura) diz estar CANCELADA
    // (pela situação da própria nota ou por evento de cancelamento). Enquanto continuar
    // "autorizada" aqui, ela entra no faturamento e a apuração sai A MAIOR — silenciosamente.
    //
    // Só marcamos as chaves que estão explicitamente em `scan.canceladas`. As demais `extras`
    // (temos, o ADN não trouxe) ficam intocadas: podem ser limite de varredura, e cancelar por
    // AUSÊNCIA de evidência seria inventar um cancelamento que talvez não exista.
    const canceladasNoAdn = extras.filter((chave) => scan.canceladas.has(chave));
    let marcadasCanceladas = 0;
    if (canceladasNoAdn.length) {
      const r = await prisma.portalInvoice.updateMany({
        where: {
          clientId: String(portalClientId),
          statusEfetivo: "autorizada",
          OR: [{ chaveAcesso: { in: canceladasNoAdn } }, { idNfse: { in: canceladasNoAdn } }],
        },
        data: { statusEfetivo: "cancelada", status: "CANCELADA" },
      });
      marcadasCanceladas = r.count;
    }

    status = ok ? "ok" : "divergente";
    resultado = {
      nossoTotal: nosso.size, adnTotal: autoritativo.size, faltantes, extras,
      // O que o ADN provou estar cancelado e nós corrigimos nesta passada.
      canceladasNoAdn, marcadasCanceladas,
      via: scan.via, env, alcancouFim: scan.alcancouFim, iteracoes: scan.iteracoes,
    };
  }

  const snap = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (snap) {
    await prisma.apuracaoSnapshot.update({
      where: { id: snap.id },
      data: { conferenciaStatus: status, conferenciaResultado: resultado, conferidaEm: new Date() },
    });
  }
  return { status, resultado, persistido: Boolean(snap) };
}
