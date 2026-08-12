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
// ⚠ A PERSISTÊNCIA DA NFS-e NÃO MORA MAIS AQUI. `upsertNfseFromItem` foi extraída para
// `../ingestaoNfse.js` porque o import manual de XML (`routes/portalInvoices.js`) tinha uma segunda
// implementação da mesma regra, e as duas discordavam na chave de deduplicação — o import criava
// uma linha nova para a nota que a captura já tinha. Ler o cabeçalho de lá antes de mexer.
import { upsertNfseFromItem } from "../ingestaoNfse.js";

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

// ─── Persistência: NFS-e → PortalInvoice ───────────────────────────────────
// Mora em `../ingestaoNfse.js`, compartilhada com o import manual de XML.

// Trata um item TipoDocumento="EVENTO" do ADN (documento separado da nota). O cancelamento de
// NFS-e Nacional chega aqui — não muda o XML da nota (que fica cStat=100).
//
// ⚠ ANTES, ESTA FUNÇÃO APLICAVA O EVENTO E O DESTRUÍA NO MESMO INSTANTE.
//
// Ela escrevia exatamente duas colunas (`statusEfetivo`/`status`) e devolvia um contador. A data
// do fato, o motivo, a sequência e — no e105102 — a CHAVE DA NOTA SUBSTITUTA só existiam no
// `log.info` abaixo, que envelhece e some. Medido em produção em 10/08/2026: **556 NFS-e marcadas
// canceladas e 0 linhas em `PortalInvoiceEvent`** — de nenhuma delas se sabe quando, por quê, nem
// se foi cancelamento simples ou substituição.
//
// Aquele passado não volta (o XML do evento nunca foi gravado; só relendo o ADN por NSU). Daqui
// para frente o fato fica registrado ANTES de virar rótulo.
//
// ⚠ E O RÓTULO CONTINUA SENDO `cancelada` NOS DOIS TIPOS — de propósito, não por preguiça.
// `statusEfetivo` é campo de DINHEIRO: receita filtra `= "autorizada"`, exclusão filtra
// `= "cancelada"`. Um terceiro valor ("substituida") não casa com nenhum dos dois — a nota
// reapareceria na aba, entraria no total do resumo e continuaria fora do faturamento. A distinção
// entre cancelada e substituída mora no EVENTO (`type`/`chaveSubstituta`) e no VÍNCULO
// (`PortalInvoice.chaveSubstituida`), e quem a compõe para a tela é `notas/cicloNota.js`.
async function applyNfseEvento(tx, { portalClientId, item, xmlPlain }) {
  const evt = parseNfseEvento(xmlPlain);
  const chave = item.ChaveAcesso || item.chaveAcesso || evt.chave || null;
  // Log cru do evento — segue útil para ver estrutura nova antes de ela ter coluna.
  log?.info?.({
    portalClientId, chave, tpEvento: evt.tpEvento, tipo: evt.tipo, descricao: evt.descricao,
    chaveSubstituta: evt.chaveSubstituta, isCancelamento: evt.isCancelamento,
    xmlPreview: String(xmlPlain || "").slice(0, 800),
  }, "ADN evento recebido");
  if (!chave) return { status: "evento_sem_chave" };
  if (!evt.isCancelamento) return { status: "evento_ignorado" };

  // A nota tem de existir: `PortalInvoiceEvent.invoiceId` é FK obrigatória.
  // ⚠ Na prática o ADN entrega a nota antes do evento dela (o NSU da emissão é menor que o do
  // cancelamento), e não observamos o caso contrário. Quando ele acontecer, o evento é CONTADO
  // (`evento_nota_ausente`) e perdido — é o buraco que só o ledger da Fase 1 fecha, porque lá
  // `eventos` é chaveado por `chaveAcesso` e não exige que a nota exista.
  const nota = await tx.portalInvoice.findFirst({
    where: { clientId: portalClientId, chaveAcesso: chave },
    select: { id: true },
  });
  if (!nota) return { status: "evento_nota_ausente" };

  // O FATO PRIMEIRO, o rótulo depois. Se a escrita do evento falhar, é melhor não ter marcado a
  // nota do que ter o rótulo sem a história — a transação inteira volta e a próxima captura tenta
  // de novo (o cursor só avança com o lote persistido).
  const tipo = evt.tipo || "cancelamento";
  const nSeqEvento = Number.isFinite(evt.nSeqEvento) ? evt.nSeqEvento : 1;

  // Idempotente: recaptura ou cursor recuado não podem duplicar o mesmo fato. A unicidade
  // (invoiceId, type, nSeqEvento) é a mesma chave de idempotência do ledger da Fase 1.
  const jaTem = await tx.portalInvoiceEvent.findFirst({
    where: { invoiceId: nota.id, type: tipo, nSeqEvento },
    select: { id: true },
  });
  if (!jaTem) {
    await tx.portalInvoiceEvent.create({
      data: {
        clientId: portalClientId,
        invoiceId: nota.id,
        type: tipo,
        tpEvento: evt.tpEvento || null,
        nSeqEvento,
        date: evt.dhEvento || null,
        reason: evt.xMotivo || evt.descricao || null,
        chaveSubstituta: evt.chaveSubstituta || null,
        // O XML cru vai junto: é a prova, e é o que permitiria reconstruir qualquer campo que
        // ainda não tenha coluna — exatamente o que faltou para os 556 cancelamentos anteriores.
        payloadRaw: {
          tpEvento: evt.tpEvento, tipo, nSeqEvento,
          cMotivo: evt.cMotivo, xMotivo: evt.xMotivo, descricao: evt.descricao,
          chaveSubstituta: evt.chaveSubstituta,
          dhEvento: evt.dhEvento ? new Date(evt.dhEvento).toISOString() : null,
          xml: xmlPlain || null,
        },
      },
    });
  }

  await tx.portalInvoice.update({
    where: { id: nota.id },
    data: { statusEfetivo: "cancelada", status: "CANCELADA" },
  });
  return { status: tipo === "canc_por_substituicao" ? "evento_substituiu" : "evento_cancelou" };
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

  // ⚠ MARCA A TENTATIVA ANTES DE CONSULTAR — "olhei" é diferente de "recebi".
  // `adnLastSyncAt` só é gravado quando vem documento (dentro de `persistCursor`). Com o cursor
  // travado, a empresa era varrida todo dia e o campo continuava velho: no diagnóstico ela parecia
  // abandonada, e "empresa quieta" ficava indistinguível de "captura quebrada". Best-effort — não
  // vale abortar uma captura boa porque o carimbo falhou.
  await prisma.portalSyncState.upsert({
    where: { clientId: portalClientId },
    create: { clientId: portalClientId, adnLastAttemptAt: new Date() },
    update: { adnLastAttemptAt: new Date() },
  }).catch(() => null);

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

    // ⚠ CONSULTA QUE DEU CERTO APAGA O ERRO ANTERIOR — MESMO QUE NÃO VENHA NENHUMA NOTA.
    //
    // Quem zerava `adnLastError` era só `persistCursor`, e ele só roda quando VEM DOCUMENTO. Uma
    // empresa quieta (o caso normal: `NENHUM_DOCUMENTO_LOCALIZADO` → `break` na linha ~348) saía
    // daqui com `ok:true` sem encostar no campo. Resultado: um erro de UM dia ficava gravado para
    // SEMPRE e a aba Notas o exibia em toda visita, em toda empresa — o defeito parecia estar
    // acontecendo agora, quando na verdade era um eco.
    //
    // Medido em produção (10/08/2026): 13 empresas exibindo `[HTTP_429]` gravado em 09/08 entre
    // 15:01 e 16:08, com o backoff de 15 min JÁ EXPIRADO havia 19h e consultas bem-sucedidas
    // (`adnLastAttemptAt` de 30 min antes) que não limparam nada. O contador via "todas as empresas
    // com erro" enquanto a captura estava funcionando.
    //
    // É o mesmo princípio da Situação Fiscal: o estado na tela tem de ser o estado de AGORA. Erro
    // que sobrevive à consulta que o desmentiu é informação falsa, não histórico.
    await prisma.portalSyncState
      .updateMany({
        where: { clientId: portalClientId },
        data: { adnLastError: null, adnBackoffUntil: null },
      })
      .catch(() => null);

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
