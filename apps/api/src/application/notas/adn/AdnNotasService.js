// Q12.B+ rework: captura de NFS-e via ADN Nacional do gov.br/nfse.
//
// Substitui o AdnSyncService legado (que dependia de ADN_BASE_URL/ADN_DFE_PATH —
// vars removidas em Q8.B dead-code cleanup). Agora usa endpoints públicos
// fixos do Padrão Nacional NFS-e e auth mTLS via cert do escritório (SERPRO).
//
// Reuso:
//   - AdnXmlMetadata.parseXmlMetadata() — parser do XML da NFS-e (continua válido)
//   - pfxToTls.extractTlsMaterialFromPfx — extração JS pura do PFX
//
// Estado: PortalSyncState.adnNsuCursor (separado do legado lastCursor).
// Persistência: direto em PortalInvoice + NotaItem (módulo Notas).

import { gunzipSync } from "node:zlib";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { fetchDfeNFSe, AdnNacionalClientError } from "../adn-nacional/AdnNacionalClient.js";
import { parseXmlMetadata, parseNfseEvento } from "../../nfse/AdnXmlMetadata.js";
import { log } from "../../../config.js";
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";
import { ESTADOS } from "../CompetenciaStateMachine.js";

// Q12.B+++: sync inicial pode ter milhares de notas históricas (NSU=0
// significa "desde o começo"). 50 iterações × 50 docs = 2.500 docs por
// ciclo, suficiente pra cobrir até ~1 ano de notas pra empresa ativa.
const MAX_ITERATIONS = 50;
// Q42: tamanho do lote do ADN (até 50 docs por chamada). Sem maxNSU, o fim da varredura é
// sinalizado por "lote incompleto" (items.length < LOTE_MAX). Env-overridável (ADN_LOTE_MAX).
const LOTE_MAX = Math.max(1, Number(process.env.ADN_LOTE_MAX) || 50);
const BACKOFF_MINUTES_ON_ERROR = 15;
// Q12.B+++.10: ADN tem rate limit por requisição (~1 req/s observado).
// Delay entre chamadas pra evitar HTTP 429 dentro do mesmo ciclo.
const DELAY_BETWEEN_REQUESTS_MS = 1100;
// HTTP 429 = backoff menor (15min) pra retomar logo (mesmo cursor preservado).
const BACKOFF_MINUTES_ON_429 = 15;

export class AdnNotasSyncError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// ─── Resolução de cert ──────────────────────────────────────────────────────

async function resolveCertWithFallback(portalClientId) {
  // Q12.B+++: o ADN Contribuinte identifica o contribuinte pelo CERTIFICADO (SAN do ICP-Brasil).
  // O CNPJ que passamos em `fetchDfeNFSe` é só validado — o path é `/DFe/{NSU}` e não carrega
  // CNPJ nenhum. Ou seja: quem consulta é o dono do cert, ponto.
  //
  // ⚠ POR ISSO NÃO EXISTE MAIS FALLBACK PRO CERT DO ESCRITÓRIO.
  // O fallback antigo supunha que o cert do escritório daria 404 no gov.br/nfse ("provavelmente vai
  // dar 404, mas mantém pra não bloquear"). A suposição estava errada: o escritório É cadastrado
  // lá, então o ADN respondia com as notas DO ESCRITÓRIO — e elas eram gravadas debaixo da empresa
  // cliente, como notas DEST (o CNPJ não bate, então caíam em "recebidas"). Nota de uma empresa
  // aparecendo em outra é erro de dado com consequência fiscal, e silencioso.
  //
  // Sem A1 da empresa, a resposta certa é NÃO CONSULTAR e dizer o que falta. É o mesmo caminho que
  // o `ConferenciaAdnService` já seguia.
  // ⚠ NÃO ENGULA O ERRO. Este `.catch` já devolveu "esta empresa não tem certificado A1 cadastrado"
  // para uma empresa que TEM certificado — só que de outro CNPJ, ou com senha que não abre. A
  // mensagem mandava cadastrar um certificado que já estava lá, e o contador ficava girando.
  // Cada causa tem conserto diferente: trocar o arquivo × redigitar a senha × cadastrar o primeiro.
  const r = await resolveCertForCompany({ portalClientId, servico: SERVICOS.NFSE })
    .catch((err) => {
      if (err?.code === "CERT_CNPJ_MISMATCH" || err?.code === "CERT_PASSWORD_DECRYPT_FAILED") {
        throw new AdnNotasSyncError(err.code, err.message);
      }
      return { source: "none" };
    });
  if (r.source === "company_a1") {
    return { pfxBuffer: r.pfxBuffer, password: r.password, via: "company_a1" };
  }

  throw new AdnNotasSyncError("NO_COMPANY_CERT",
    "Esta empresa não tem certificado A1 cadastrado. O ADN identifica o contribuinte pelo próprio "
    + "certificado, então consultar com o do escritório traria as notas DELE, não as desta empresa. "
    + "Vá em Editar Cadastro → Certificado e faça upload do PFX da empresa.");
}

// ─── Decodificação do XML ──────────────────────────────────────────────────

function decodeXml(arquivoXml) {
  // AdnSyncService já tem essa função interna; replicamos pra não exportar tudo.
  // Tenta gunzip primeiro (base64+gzip), cai pra base64 puro se falhar.
  const raw = Buffer.from(arquivoXml, "base64");
  try {
    return gunzipSync(raw).toString("utf-8");
  } catch {
    return raw.toString("utf-8");
  }
}

// ─── Competência fechada → vira pendência (mesmo padrão Dfe) ───────────────

async function isCompetenciaFechada(tx, { portalClientId, competenciaDate }) {
  if (!competenciaDate) return false;
  const d = new Date(competenciaDate);
  const comp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const row = await tx.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia: comp },
    select: { estado: true },
  });
  return row && [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO].includes(row.estado);
}

// ─── Persistência: NFS-e → PortalInvoice ───────────────────────────────────

async function upsertNfseFromItem(tx, { portalClientId, companyCnpj, item, xmlPlain, metadata }) {
  // Chave: do item ADN OU do XML (NFS-e Nacional traz a chave DENTRO do XML, não no item top-level).
  const chaveAcesso = item.ChaveAcesso || item.chaveAcesso || metadata.chaveAcesso || null;
  const idNfse = metadata.numeroNfse || null;
  // Sem NENHUM identificador (nem chave nem número) não dá pra deduplicar — aí sim pula.
  // Antes descartávamos toda NFS-e sem `item.ChaveAcesso` (a maioria!) → nota sumia da apuração.
  if (!chaveAcesso && !idNfse) return { status: "skipped", reason: "sem_identificador" };

  // Papel: EMIT se prestador é a empresa; senão DEST. NFS-e quase sempre EMIT
  // (a empresa só recebe DFe de NFS-e em casos específicos).
  const cnpjEmpresa = String(companyCnpj || "").replace(/\D+/g, "");
  const cnpjPrestador = metadata.cnpjPrestador || "";
  const cnpjTomador = metadata.cnpjTomador || "";
  const papel = cnpjPrestador && cnpjPrestador === cnpjEmpresa ? "EMIT" : "DEST";

  // ── A nota é MESMO desta empresa? ────────────────────────────────────────────────────────
  // Cinturão de segurança independente de como o certificado foi resolvido. Se a empresa não é nem
  // prestadora nem tomadora, o documento não é dela — e gravar assim mesmo é o que fazia as notas
  // do escritório aparecerem na carteira do cliente (como DEST, porque o CNPJ não batia).
  //
  // Isto pega uma classe inteira, não um caso: cert do escritório, A1 errado subido na empresa
  // errada, ou qualquer futura mudança na resolução de certificado. Nenhuma delas avisa sozinha.
  //
  // Só rejeita quando HÁ CNPJ e ele não bate. Metadado sem nenhum dos dois (parser que não achou o
  // campo) não é evidência de nota alheia — aí grava, porque descartar por falta de dado
  // esconderia nota legítima, que é o erro oposto e igualmente caro.
  if (cnpjEmpresa && (cnpjPrestador || cnpjTomador)
      && cnpjPrestador !== cnpjEmpresa && cnpjTomador !== cnpjEmpresa) {
    // ⚠ ESTA RECUSA PRECISA APARECER NO LOG, com os três CNPJs.
    //
    // A guarda está certa em princípio, mas ela é a ÚNICA coisa no fluxo capaz de fazer uma empresa
    // "ficar sem notas mesmo tendo emitido" em silêncio — o documento é lido, contado em
    // `totalDocs`, e descartado sem deixar registro. Do lado de fora isso é indistinguível de "não
    // havia nota".
    //
    // E há dois desfechos opostos que só os CNPJs distinguem:
    //   • prestador = CNPJ do ESCRITÓRIO  → recusa CORRETA (é a nota do escritório, não do cliente);
    //   • prestador = a própria empresa com outro sufixo de filial, ou CPF onde o cadastro tem CNPJ,
    //     ou CNPJ digitado errado no cadastro → recusa INDEVIDA, e a nota legítima some.
    //
    // Sem esta linha não dá para saber qual dos dois aconteceu sem reprocessar tudo.
    log.warn(
      { portalClientId, cnpjEmpresa, cnpjPrestador: cnpjPrestador || null, cnpjTomador: cnpjTomador || null, chaveAcesso, idNfse },
      "[ADN] documento RECUSADO: nem prestador nem tomador é a empresa",
    );
    return {
      status: "rejeitada_outro_cnpj",
      reason: `documento de ${cnpjPrestador || "?"} → ${cnpjTomador || "?"}, empresa é ${cnpjEmpresa}`,
    };
  }

  const competenciaDate = metadata.competencia || metadata.dataEmissao || null;
  const fechada = await isCompetenciaFechada(tx, { portalClientId, competenciaDate });
  const canceladaNoXml = metadata.situacao === "CANCELADA" || metadata.situacao === "2";

  // Dedup: por chaveAcesso quando houver; senão por idNfse (numeroNfse). idNfse só é escrito no
  // fallback sem-chave — evita colisão com nota DEST de mesmo número emitida por outro prestador.
  const where = chaveAcesso
    ? { clientId_chaveAcesso: { clientId: portalClientId, chaveAcesso } }
    : { clientId_idNfse: { clientId: portalClientId, idNfse } };

  // Preserva o cancelamento numa re-captura: nunca rebaixa "cancelada" → "autorizada".
  const existing = await tx.portalInvoice.findUnique({ where, select: { statusEfetivo: true } }).catch(() => null);
  const statusEfetivo = existing?.statusEfetivo === "cancelada" || canceladaNoXml ? "cancelada" : "autorizada";

  const dataToWrite = {
    type: "NFSE",
    numero: metadata.numeroNfse,
    chaveAcesso: chaveAcesso || null,
    ...(chaveAcesso ? {} : { idNfse }),
    competencia: competenciaDate,
    issueDate: metadata.dataEmissao,
    total: metadata.valorServicos,
    emitenteNome: metadata.prestadorNome,
    emitenteDoc: metadata.cnpjPrestador,
    tomadorNome: metadata.tomadorNome,
    tomadorDoc: metadata.cnpjTomador,
    xmlRaw: xmlPlain || null,
    status: canceladaNoXml ? "CANCELADA" : "EMITIDA",
    papel,
    statusEfetivo,
    competenciaPosFechamento: fechada || false,
  };

  if (fechada) {
    const created = await tx.portalInvoice.upsert({
      where,
      create: { clientId: portalClientId, ...dataToWrite },
      update: { competenciaPosFechamento: true, statusEfetivo },
    });
    const comp = competenciaDate
      ? `${new Date(competenciaDate).getUTCFullYear()}-${String(new Date(competenciaDate).getUTCMonth() + 1).padStart(2, "0")}`
      : "?";
    await tx.pendenciaPosFechamento.create({
      data: {
        portalClientId, competencia: comp, notaId: created.id,
        motivo: "nota_retroativa",
        observacoes: `NFS-e ${chaveAcesso || idNfse} chegou para ${comp} (competência já fechada).`,
      },
    }).catch(() => null);
    return { created: created.id, status: "pendencia_criada" };
  }

  const upserted = await tx.portalInvoice.upsert({
    where,
    create: { clientId: portalClientId, ...dataToWrite },
    update: dataToWrite,
    select: { id: true },
  });

  // Q12.C fix: NFS-e Nacional traz 1 serviço por nota — cria/atualiza NotaItem
  // pra alimentar ClassificadorAnexos (LC116 → III/IV/V) e CalculoFiscal.
  if (metadata.codigoServico) {
    await tx.notaItem.deleteMany({ where: { notaId: upserted.id } });
    await tx.notaItem.create({
      data: {
        notaId: upserted.id,
        codigoServico: metadata.codigoServico,
        descricao: metadata.descricaoServico || null,
        valor: Number(metadata.valorServicos || 0),
      },
    });
  }
  return { status: "upserted" };
}

// Trata um item TipoDocumento="EVENTO" do ADN (documento separado da nota). O cancelamento de
// NFS-e Nacional chega aqui — não muda o XML da nota (que fica cStat=100). Loga SEMPRE o XML cru
// (pra validar a estrutura do evento contra dado real) e, se for cancelamento, marca a nota pela
// chave. Idempotente e reversível (botão manual). Conservador: só marca com sinal de cancelamento.
async function applyNfseEvento(tx, { portalClientId, item, xmlPlain }) {
  const evt = parseNfseEvento(xmlPlain);
  const chave = item.ChaveAcesso || item.chaveAcesso || evt.chave || null;
  // Log cru do evento — é assim que capturamos a estrutura real (tpEvento etc.) sem precisar exportar.
  log?.info?.({
    portalClientId, chave, tpEvento: evt.tpEvento, descricao: evt.descricao,
    isCancelamento: evt.isCancelamento, xmlPreview: String(xmlPlain || "").slice(0, 800),
  }, "ADN evento recebido");
  if (!chave) return { status: "evento_sem_chave" };
  if (!evt.isCancelamento) return { status: "evento_ignorado" };
  // Marca a nota como cancelada (se já existir no banco). Preserva a semântica das listagens/apuração.
  const r = await tx.portalInvoice.updateMany({
    where: { clientId: portalClientId, chaveAcesso: chave },
    data: { statusEfetivo: "cancelada", status: "CANCELADA" },
  });
  return { status: r.count > 0 ? "evento_cancelou" : "evento_nota_ausente" };
}

// ─── Cursor + backoff ──────────────────────────────────────────────────────

async function persistCursor(tx, { clientId, newCursor }) {
  await tx.portalSyncState.upsert({
    where: { clientId },
    create: { clientId, adnNsuCursor: newCursor, adnLastSyncAt: new Date(), adnLastError: null },
    update: { adnNsuCursor: newCursor, adnLastSyncAt: new Date(), adnLastError: null },
  });
}

async function setBackoff({ clientId, errorMsg, minutes }) {
  const mins = Number.isFinite(minutes) ? minutes : BACKOFF_MINUTES_ON_ERROR;
  const backoffUntil = new Date(Date.now() + mins * 60 * 1000);
  await prisma.portalSyncState.upsert({
    where: { clientId },
    create: { clientId, adnBackoffUntil: backoffUntil, adnLastError: errorMsg },
    update: { adnBackoffUntil: backoffUntil, adnLastError: errorMsg },
  }).catch(() => null);
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Captura NFS-e via ADN Nacional (gov.br/nfse) pra UMA empresa.
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {"prod"|"hom"} [opts.env="prod"]
 */
export async function syncAdnNotasForCompany({ portalClientId, env = "prod" }) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { id: true, razao: true, cnpj: true, status: true },
  });
  if (!portal) throw new AdnNotasSyncError("PORTAL_CLIENT_NOT_FOUND", "Empresa não encontrada");
  if (portal.status === "SUSPENSA") throw new AdnNotasSyncError("COMPANY_SUSPENDED", "Empresa suspensa");

  const state = await prisma.portalSyncState.findUnique({ where: { clientId: portalClientId } });
  if (state?.adnBackoffUntil && new Date(state.adnBackoffUntil) > new Date()) {
    return { ok: false, reason: "backoff_active", backoffUntil: state.adnBackoffUntil };
  }

  let cert;
  try {
    cert = await resolveCertWithFallback(portalClientId);
  } catch (err) {
    return { ok: false, reason: err.code || "cert_error", message: err.message };
  }

  const companyCnpj = String(portal.cnpj || "").replace(/\D+/g, "");
  let cursor = BigInt(state?.adnNsuCursor ?? 0);
  const byStatus = { upserted: 0, pendencia_criada: 0, skipped: 0 };
  let totalDocs = 0;
  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // Q12.B+++.10: delay entre chamadas pra evitar 429 (a partir da 2ª)
      if (iterations > 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, DELAY_BETWEEN_REQUESTS_MS));
      }

      const r = await fetchDfeNFSe({
        cnpj: companyCnpj,
        ultNSU: cursor.toString(),
        pfxBuffer: cert.pfxBuffer,
        password: cert.password,
        env,
        // Q12.B+++: na 1ª iteração com cursor=0, ativa autodescoberta (tenta NSU=0 e NSU=1)
        autoDiscover: cursor === 0n && iterations === 1,
      });
      const status = r.status;
      const items = r.items || [];

      if (status === "REJEICAO") {
        throw new AdnNotasSyncError("ADN_REJEICAO", `ADN rejeitou: ${JSON.stringify(r.errors || {})}`);
      }
      if (status === "NENHUM_DOCUMENTO_LOCALIZADO" || items.length === 0) {
        break;
      }

      let maxNsuThisIter = cursor;
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          totalDocs++;
          const nsuRaw = item.NSU || item.nsu;
          if (nsuRaw) {
            const n = BigInt(nsuRaw);
            if (n > maxNsuThisIter) maxNsuThisIter = n;
          }
          const arquivoXml = item.ArquivoXml || item.arquivoXml;
          if (!arquivoXml) { byStatus.skipped++; continue; }

          const xmlPlain = decodeXml(arquivoXml);
          // Ramifica por tipo: EVENTO (cancelamento etc.) vs NFSE (a nota). Antes tudo virava nota
          // e o evento de cancelamento se perdia (a nota continuava "autorizada").
          const tipoDoc = String(item.TipoDocumento || item.tipoDocumento || "").toUpperCase();
          if (tipoDoc === "EVENTO") {
            const r = await applyNfseEvento(tx, { portalClientId, item, xmlPlain });
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
            continue;
          }
          const metadata = parseXmlMetadata(xmlPlain);
          const r = await upsertNfseFromItem(tx, { portalClientId, companyCnpj, item, xmlPlain, metadata });
          byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        }
        // ⚠ O CURSOR GUARDA O ÚLTIMO NSU QUE JÁ TEMOS — NÃO o "próximo a buscar".
        //
        // `ultNSU` quer dizer "último NSU recebido", e o ADN devolve os documentos POSTERIORES a
        // ele (exclusivo). Aqui se guardava `maxNSU + 1` e se enviava isso como `ultNSU`, ou seja,
        // pedia-se sempre "depois do próximo" — e o documento exatamente naquele NSU nunca voltava.
        //
        // Medido contra o ADN de produção (ARAUJO BARRETO, 04/08/2026), com 7 documentos no banco
        // e cursor em 8:
        //     ultNSU=6 -> DOCUMENTOS_LOCALIZADOS, NSUs 7 e 8
        //     ultNSU=7 -> DOCUMENTOS_LOCALIZADOS, NSU 8
        //     ultNSU=8 -> NENHUM_DOCUMENTO_LOCALIZADO
        // A nota de 07/07 estava no NSU 8 e era pulada em toda consulta, sem erro nenhum: a
        // resposta era um `NENHUM_DOCUMENTO_LOCALIZADO` legítimo. Por isso o sintoma era "a empresa
        // ficou sem notas mesmo tendo emitido", e nada aparecia em log ou em `adnLastError`.
        //
        // Efeito acumulado: como cada varredura recomeçava do cursor inflado, o PRIMEIRO documento
        // de cada nova rodada era perdido — não só um por empresa.
        await persistCursor(tx, { clientId: portalClientId, newCursor: maxNsuThisIter });
      });

      // Nenhum item trouxe NSU utilizável → o cursor não anda, e insistir seria buscar o mesmo lote
      // até estourar MAX_ITERATIONS. Antes o `+1` mascarava isso avançando às cegas (e pulando
      // documento). Parar é honesto: a próxima execução tenta de novo do mesmo ponto.
      if (maxNsuThisIter === cursor) break;
      cursor = maxNsuThisIter;

      // Q42: sem maxNSU no ADN, o fim é o lote INCOMPLETO (< 50). Enquanto vier lote cheio,
      // continua puxando os próximos 50. Isso substitui a varredura 1-em-1.
      if (items.length < LOTE_MAX) break;
    }

    return {
      ok: true, cnpj: companyCnpj, certVia: cert.via,
      iterations, totalDocs, byStatus,
      newCursor: cursor.toString(),
    };
  } catch (err) {
    const code = err?.code || "ADN_SYNC_FAILED";
    const msg = err?.message || String(err);
    // Se ESTA run já capturou notas antes do erro, é sucesso parcial — não mostra "erro" nem seta
    // backoff longo (as notas entraram; o resto vem na próxima). Só o cursor foi persistido a cada lote.
    if (totalDocs > 0) {
      await prisma.portalSyncState
        .updateMany({ where: { clientId: portalClientId }, data: { adnLastSyncAt: new Date(), adnLastError: null, adnBackoffUntil: null } })
        .catch(() => null);
      return { ok: true, cnpj: companyCnpj, certVia: cert.via, iterations, totalDocs, byStatus, newCursor: cursor.toString(), warning: `${code}: ${msg}` };
    }
    // Q12.B+++.10: backoff curto pra 429 (retoma em 15min do mesmo cursor)
    const minutes = code === "HTTP_429" ? BACKOFF_MINUTES_ON_429 : BACKOFF_MINUTES_ON_ERROR;
    await setBackoff({ clientId: portalClientId, errorMsg: `[${code}] ${msg}`.slice(0, 500), minutes });
    // Importante: cursor JÁ FOI persistido a cada iteração bem-sucedida.
    // Próximo ciclo retoma do mesmo ponto sem perder progresso.
    return { ok: false, reason: code, message: msg, iterations, totalDocs };
  }
}
