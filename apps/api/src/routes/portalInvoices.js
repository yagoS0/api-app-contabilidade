import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import { prisma } from "../infrastructure/db/prisma.js";
import { decimalToNumber, dateToIso } from "../utils/serializers.js";
import { parseDate } from "../utils/date.js";
import { parseXmlMetadata } from "../application/nfse/AdnXmlMetadata.js";
// ⚠ O import de XML usa A MESMA ingestão da captura automática. Ver o cabeçalho de `ingestaoNfse.js`:
// a segunda implementação que morava aqui criava linha duplicada para nota que a captura já tinha.
import { upsertNfseFromItem } from "../application/notas/ingestaoNfse.js";
import { ensurePortalClientAccess } from "./middlewares/portalAccess.js";
// ⚠ A NOTA QUE NÓS EMITIMOS E QUE O ADN AINDA NÃO TROUXE. Ver o cabeçalho daquele arquivo para a
// chave de deduplicação e para o porquê de a união ser na LEITURA e não uma gravação em
// `PortalInvoice`. Ligado SÓ na montagem do `/client` — ver `INCLUIR_EMITIDAS` abaixo.
import { lerEmitidasNaoConfirmadas } from "../application/notas/notasEmitidasNaoConfirmadas.js";
// ⚠ O LOTE DE DANFSe — ver `GET /danfse/bulk`, abaixo. O serviço gera os PDFs chamando, nota a
// nota, o MESMO `gerarDanfseDaNota` da porta individual; nada de PDF é escrito aqui.
import {
  LOTE_MAXIMO,
  NOME_DO_RELATORIO,
  gerarLoteDanfse,
  textoDoRelatorio,
} from "../application/nfse/danfse/loteDanfseDoPortal.js";

function normalizeDoc(value) {
  return String(value || "").replace(/\D+/g, "") || null;
}

function formatCompetencia(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function serializeInvoice(inv) {
  return {
    invoiceId: inv.id,
    type: inv.type,
    numero: inv.numero || null,
    competencia: formatCompetencia(inv.competencia),
    issueDate: dateToIso(inv.issueDate),
    status: inv.status,
    total: decimalToNumber(inv.total),
    emitente: { nome: inv.emitenteNome || null, cnpj: inv.emitenteDoc || null },
    tomador: { nome: inv.tomadorNome || null, cnpjCpf: inv.tomadorDoc || null },
    updatedAt: dateToIso(inv.updatedAt),
    hasXml: Boolean(inv.xmlRaw),
    hasPdf: Boolean(inv.pdfUrl),
    // ⚠⚠ A DESCRIÇÃO DO SERVIÇO — e ela sai de COLUNA, não de XML parseado na listagem.
    //
    // Pedido do dono (19/08/2026): reaproveitar uma nota deve trazer também a descrição. A dúvida
    // que travava isso era se o texto só existia dentro do `xmlRaw` — parsear XML a cada linha de
    // cada página seria caro e foi por isso que a pergunta subiu antes de construir.
    //
    // ⚠ MEDIDO, NÃO SUPOSTO: `PortalInvoice.xDescServ` é coluna (`schema.prisma`), escrita pelo
    // extrator de campos fiscais (`application/nfse/camposFiscaisNfse.js`), que lê **por caminho**
    // (`.../serv/cServ/xDescServ`, NT 008 §2.4.5) e é o ÚNICO escritor dela. Zero parsing aqui.
    //
    // ⚠ NULO É RESPOSTA. Nota antiga, anterior ao backfill, ou nota cujo XML não trouxe o campo,
    // sai `null` — e a tela trata como "a descrição não veio", que é o que ela já fazia.
    descricao: inv.xDescServ || null,
    // ⚠⚠ QUEM EMITIU: `EMIT` = a empresa; `DEST` = ela RECEBEU a nota.
    //
    // Pedido do dono (20/08/2026): *"as notas recebidas não devem ter opção de emitir elas, nem
    // cancelar. Nota recebida foi emitida PARA NÓS — não temos controle sobre esse tipo de nota."*
    //
    // ⚠ SEM ESTE CAMPO A TELA NÃO TINHA COMO SABER. `podeReaproveitar` já recusava nota recebida,
    // mas por DEDUÇÃO (comparando o CNPJ do tomador com o da empresa) — porque `papel` não chegava.
    // A dedução funciona e continua no lugar; o campo a torna direta, e é o mesmo dado que o
    // servidor usa na guarda do cancelamento. ⚠ Coluna fora de um `select`/serializer volta
    // `undefined` **sem erro nenhum** — foi assim que `codigosServicoNacional` ficou invisível.
    //
    // ⚠ A TELA É CONVENIÊNCIA; A GARANTIA É O SERVIDOR. Quem recusa cancelar nota recebida é
    // `POST /client/companies/:id/notas/:notaId/cancelar`, mesmo que ninguém olhe este campo.
    papel: inv.papel || null,
    // ⚠ ESTE CAMPO É O ESTADO, e ele é o que sobrevive a uma auditoria. `true` = a nota veio da
    // projeção do ADN (`PortalInvoice`), que é o sistema nacional confirmando que ela existe.
    // `false` = a linha é da NOSSA emissão (`ServiceInvoice`) e o ADN ainda não a devolveu — o
    // `invoiceId` dela é um `ServiceInvoice.id`, então as sub-rotas de `/invoices/:id` (xml, pdf,
    // eventos, DANFSe) NÃO a encontram, e é por isso que `hasXml`/`hasPdf` saem `false`.
    // Ver `application/notas/notasEmitidasNaoConfirmadas.js`.
    confirmadaPeloAdn: true,
  };
}

/**
 * Uma linha de `ServiceInvoice` (nossa emissão) no MESMO contrato da listagem.
 *
 * ⚠ `status: "EMITIDA"` é o vocabulário de `PortalInvoice`, e é o certo: a nota FOI emitida — o que
 * falta é a confirmação do ADN, e quem diz isso é `confirmadaPeloAdn`, não o status. Inventar um
 * status novo aqui (`"PENDENTE"`, `"AGUARDANDO"`) faria a tela pintá-la como rascunho ou como
 * erro, e ela não é nem um nem outro.
 *
 * ⚠ `issueDate` sai de `createdAt` — o instante em que a linha foi criada É o da emissão (a reserva
 * de numeração e o envio acontecem na mesma chamada). Quando o ADN devolver a nota, a data passa a
 * ser a do documento, que é a autoridade.
 */
function serializeEmitidaNaoConfirmada(si, { emitenteNome, emitenteDoc }) {
  return {
    invoiceId: si.id,
    type: "NFSE",
    numero: si.numeroNfse || null,
    competencia: formatCompetencia(si.competencia),
    issueDate: dateToIso(si.createdAt),
    status: "EMITIDA",
    total: decimalToNumber(si.valorServicos),
    emitente: { nome: emitenteNome || null, cnpj: emitenteDoc || null },
    tomador: { nome: si.tomadorNome || null, cnpjCpf: si.tomadorDoc || null },
    updatedAt: dateToIso(si.updatedAt),
    // ⚠ NÃO É "não temos o XML": é "não há rota que o sirva por este id". `ServiceInvoice.xml`
    // guarda o que o provedor devolveu (ou a DPS crua), e `/invoices/:id/xml` lê `PortalInvoice`.
    // Dizer `true` ofereceria um download que responde 404.
    hasXml: false,
    hasPdf: false,
    // ⚠ A NOSSA emissão não tem `xDescServ`: aquela coluna é do extrator, que lê o XML que o
    // sistema nacional devolve — e ele ainda não devolveu. A descrição que ORIGINOU esta nota está
    // em `NotaItem`, que pertence à `PortalInvoice` que ainda não existe. `null` é a resposta certa.
    descricao: null,
    // ⚠ A NOSSA emissão é, por definição, EMITIDA por nós — ela nasce de `NfseService.issue`.
    // Cravar aqui não é suposição: é o que a linha significa.
    papel: "EMIT",
    confirmadaPeloAdn: false,
  };
}

function buildWhereFilters({
  clientId,
  clientCnpj,
  direcao,
  from,
  to,
  competencia,
  status,
  type,
  search,
  incluirCanceladas,
}) {
  const where = { clientId: String(clientId) };
  const and = [];

  // Direção padrão: apenas notas emitidas pelo cliente.
  if (clientCnpj) {
    const normalizedDirection = String(direcao || "emitidas").toLowerCase();
    if (normalizedDirection === "emitidas") {
      and.push({ emitenteDoc: clientCnpj });
    } else if (normalizedDirection === "recebidas") {
      and.push({ tomadorDoc: clientCnpj });
    } else if (normalizedDirection === "todas") {
      and.push({
        OR: [{ emitenteDoc: clientCnpj }, { tomadorDoc: clientCnpj }],
      });
    }
  }

  if (type) and.push({ type: String(type).toUpperCase() });
  if (status) and.push({ status: String(status).toUpperCase() });

  if (competencia) {
    const match = String(competencia).match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      and.push({ competencia: { gte: start, lt: end } });
    }
  }

  if (from || to) {
    and.push({
      issueDate: {
        ...(from ? { gte: parseDate(from) } : {}),
        ...(to ? { lte: parseDate(to) } : {}),
      },
    });
  }

  const q = String(search || "").trim();
  if (q) {
    const doc = normalizeDoc(q);
    and.push({
      OR: [
        { numero: { contains: q, mode: "insensitive" } },
        ...(doc ? [{ tomadorDoc: { contains: doc } }, { emitenteDoc: { contains: doc } }] : []),
        { tomadorNome: { contains: q, mode: "insensitive" } },
        { emitenteNome: { contains: q, mode: "insensitive" } },
        { chaveAcesso: { contains: q, mode: "insensitive" } },
        { idDps: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  // Esconde notas CANCELADAS por padrão (não devem aparecer nem somar) — a menos que peça explícito.
  if (!incluirCanceladas) {
    and.push({ OR: [{ statusEfetivo: null }, { statusEfetivo: { not: "cancelada" } }] });
  }

  if (and.length) where.AND = and;
  return where;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A UNIÃO NA LEITURA — as notas que nós emitimos e que o ADN ainda não devolveu
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ POR QUE ESTE BLOCO MORA AQUI, COLADO EM `buildWhereFilters`. Ele é o GÊMEO dela: o mesmo
// filtro, em memória, sobre linhas que não estão no banco de `PortalInvoice`. Escrevê-lo noutro
// arquivo é como as duas metades divergiriam — a lista mostraria a nota emitida no mês errado, ou
// a esconderia num filtro que o SQL honra e o JS não. Quem mexer numa mexe na outra.
//
// ⚠ FILTRO QUE ESTE GÊMEO NÃO SABE HONRAR ⇒ A LINHA NÃO ENTRA (`filtroAlcancavel`). Fail-closed é
// o certo aqui: pôr a nota num recorte que ela pode não pertencer é mostrar dado errado; deixá-la
// de fora repete, no máximo, o comportamento de hoje (ela aparece quando o ADN a trouxer).

/** `true` quando o recorte pedido é inteiramente reproduzível sobre uma linha de `ServiceInvoice`. */
function filtroAlcancavel({ direcao }) {
  // "recebidas" é o único recorte em que a nossa emissão NÃO cabe por definição: ela é sempre
  // emitida pela própria empresa. Não é "não sei honrar" — é "não pertence".
  return String(direcao || "emitidas").toLowerCase() !== "recebidas";
}

/** O mesmo recorte de `buildWhereFilters`, aplicado a UMA linha de `ServiceInvoice`. */
function emitidaPassaNoFiltro(si, { competencia, from, to, status, type, search, clientCnpj, emitenteNome }) {
  // `type`: a emissão do portal é sempre NFS-e.
  if (type && String(type).toUpperCase() !== "NFSE") return false;
  // `status`: a linha nossa entra como EMITIDA (ver `serializeEmitidaNaoConfirmada`).
  if (status && String(status).toUpperCase() !== "EMITIDA") return false;

  if (competencia && /^\d{4}-\d{2}$/.test(String(competencia))) {
    if (formatCompetencia(si.competencia) !== String(competencia)) return false;
  }

  // ⚠ A data comparada é a MESMA que sai em `issueDate` (`createdAt`) — comparar por um campo e
  // exibir outro faria a nota sumir de um intervalo que a mostra.
  const data = si.createdAt ? new Date(si.createdAt) : null;
  if (from) {
    const ini = parseDate(from);
    if (!data || (ini && data < ini)) return false;
  }
  if (to) {
    const fim = parseDate(to);
    if (!data || (fim && data > fim)) return false;
  }

  const q = String(search || "").trim();
  if (q) {
    const doc = normalizeDoc(q);
    const alvo = [si.numeroNfse, si.tomadorNome, emitenteNome, si.chaveAcesso]
      .map((v) => String(v ?? "").toLowerCase());
    const docs = [normalizeDoc(si.tomadorDoc), normalizeDoc(clientCnpj)].filter(Boolean);
    const achou = alvo.some((v) => v && v.includes(q.toLowerCase()))
      || (doc && docs.some((d) => d.includes(doc)));
    if (!achou) return false;
  }

  // `incluirCanceladas` não se aplica: a linha nossa nunca é cancelada (o que é cancelado ganha
  // evento e vira `PortalInvoice`).
  return true;
}

/** O valor pelo qual a lista está ordenada, para uma linha já SERIALIZADA (dos dois lados). */
function chaveDeOrdenacao(linha, sortKey) {
  return String((sortKey === "issueDate" ? linha.issueDate : linha.updatedAt) || "");
}

/**
 * Intercala duas listas JÁ ordenadas pela mesma chave, preservando a ordem.
 * ⚠ Empate mantém a linha do ADN à frente: quando a nota é confirmada no mesmo instante, a
 * confirmada é a que vale.
 */
function intercalar(doAdn, nossas, sortKey, ordem) {
  const sinal = ordem === "asc" ? 1 : -1;
  const out = [];
  let i = 0;
  let j = 0;
  while (i < doAdn.length && j < nossas.length) {
    const a = chaveDeOrdenacao(doAdn[i], sortKey);
    const b = chaveDeOrdenacao(nossas[j], sortKey);
    if (a === b || sinal * a.localeCompare(b) <= 0) out.push(doAdn[i++]);
    else out.push(nossas[j++]);
  }
  while (i < doAdn.length) out.push(doAdn[i++]);
  while (j < nossas.length) out.push(nossas[j++]);
  return out;
}

/**
 * @param {Object} opts
 * @param {boolean} [opts.incluirEmitidasNaoConfirmadas=false] — junta à lista as notas que NÓS
 *   emitimos e que o ADN ainda não devolveu.
 *
 *   ⚠ **É OPT-IN, E SÓ O `/client` O LIGA.** Este router é montado em TRÊS lugares
 *   (`routes/client/index.js`, `routes/firm/index.js` e `server.js`), e o pedido do dono é sobre a
 *   tela do CLIENTE — *"as notas que aparecem para o cliente…"*. Ligar por default mudaria em
 *   silêncio o que o escritório vê em duas outras portas, uma delas legada, sem ninguém ter pedido.
 */
export function createPortalInvoicesRouter({ ensureAuthorized, log, incluirEmitidasNaoConfirmadas = false }) {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  // GET /clients/:clientId/invoices
  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const {
      direcao,
      from,
      to,
      competencia,
      status,
      type,
      search,
      sort,
      order,
      page,
      limit,
    } = req.query || {};

    const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const sortField = String(sort || "updatedAt");
    const sortKey = sortField === "issueDate" ? "issueDate" : "updatedAt";
    const sortOrderRaw = String(order || "desc").toLowerCase();
    if (!["asc", "desc"].includes(sortOrderRaw)) {
      return res.status(400).json({ error: "order_invalid", allowed: ["asc", "desc"] });
    }
    const sortOrder = sortOrderRaw;

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const portalClient = await prisma.portalClient.findUnique({
        where: { id: String(clientId) },
        select: { cnpj: true, razao: true, companyId: true },
      });
      const clientCnpj = normalizeDoc(portalClient?.cnpj);

      const invoiceDirection = String(direcao || "emitidas").toLowerCase();
      if (!["emitidas", "recebidas", "todas"].includes(invoiceDirection)) {
        return res.status(400).json({ error: "direcao_invalid" });
      }
      const where = buildWhereFilters({
        clientId,
        clientCnpj,
        direcao: invoiceDirection,
        from,
        to,
        competencia,
        status,
        type,
        search,
        incluirCanceladas: String(req.query.incluirCanceladas || "") === "1",
      });

      // ── As nossas emissões ainda não confirmadas ────────────────────────────────────────────
      //
      // ⚠ ELAS SÃO BUSCADAS POR INTEIRO, NÃO POR PÁGINA — e podem ser, porque o conjunto é
      // "emitidas e ainda não capturadas", que numa carteira saudável é zero ou poucas unidades
      // (a captura roda de hora em hora). O teto está em `TETO_EMITIDAS`.
      let nossas = [];
      if (incluirEmitidasNaoConfirmadas && portalClient?.companyId && filtroAlcancavel({ direcao: invoiceDirection })) {
        const cruas = await lerEmitidasNaoConfirmadas({
          legacyCompanyId: portalClient.companyId,
          portalClientId: String(clientId),
        });
        nossas = cruas
          .filter((si) => emitidaPassaNoFiltro(si, {
            competencia, from, to, status, type, search,
            clientCnpj, emitenteNome: portalClient?.razao,
          }))
          .map((si) => serializeEmitidaNaoConfirmada(si, {
            emitenteNome: portalClient?.razao,
            emitenteDoc: clientCnpj,
          }))
          .sort((a, b) => {
            const cmp = chaveDeOrdenacao(a, sortKey).localeCompare(chaveDeOrdenacao(b, sortKey));
            return sortOrder === "asc" ? cmp : -cmp;
          });
      }

      // ⚠ A JANELA DO BANCO É ALARGADA PELO TAMANHO DO CONJUNTO NOSSO, e a conta é exata.
      // Chamando `n = nossas.length`, `P` a lista do ADN e `M = intercalar(P, nossas)`: buscando
      // `P` a partir de `max(0, skip - n)` até `skip + take`, e intercalando essa fatia com TODAS
      // as nossas, os elementos a partir do índice local `skip - inicioP` são exatamente
      // `M[skip .. skip+take)`. (No máximo `n` linhas nossas podem se antepor à fatia, e
      // `inicioP + n ≤ skip` sempre que `skip ≥ n`; quando `skip < n`, `inicioP = 0` e a fatia já
      // é o prefixo verdadeiro.) Sem isso, a página 2 pularia tantas notas quantas fossem as nossas.
      const inicioP = Math.max(0, skip - nossas.length);
      const tamanhoP = skip + take - inicioP;

      const [items, total, totals, sync] = await prisma.$transaction([
        prisma.portalInvoice.findMany({
          where,
          orderBy: { [sortKey]: sortOrder },
          skip: inicioP,
          take: tamanhoP,
        }),
        prisma.portalInvoice.count({ where }),
        prisma.portalInvoice.aggregate({
          where,
          _sum: { total: true },
        }),
        prisma.portalSyncState.findUnique({ where: { clientId: String(clientId) } }),
      ]);

      const janela = intercalar(items.map(serializeInvoice), nossas, sortKey, sortOrder);
      const data = janela.slice(skip - inicioP, skip - inicioP + take);

      // ⚠ OS TOTAIS CONTAM AS NOSSAS. A nota emitida existe e vale o que vale; deixá-la fora do
      // "Valor total" faria o card e a tabela discordarem sobre a mesma competência — que é o
      // defeito que este projeto já pagou em "somar a coluna da página daria outro número".
      const totalGeral = total + nossas.length;
      const sumFiltered = (decimalToNumber(totals?._sum?.total) || 0)
        + nossas.reduce((acc, n) => acc + (n.total || 0), 0);
      const pageAmount = data.reduce((acc, item) => acc + (item.total || 0), 0);

      return res.json({
        data,
        page: pageNum,
        limit: take,
        total: totalGeral,
        summary: {
          totalInvoices: totalGeral,
          totalAmount: sumFiltered || 0,
          pageAmount,
        },
        sync: sync
          ? {
              lastSyncAt: dateToIso(sync.lastSyncAt),
              state: sync.state,
              stale: !sync.lastSyncAt || sync.state !== "OK",
              canSync: !sync.lockUntil || new Date(sync.lockUntil).getTime() <= Date.now(),
            }
          : { lastSyncAt: null, state: "OK", stale: true, canSync: true },
      });
    } catch (err) {
      log.error({ err, clientId }, "Falha ao listar invoices do portal");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/:invoiceId
  router.get("/:invoiceId", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const inv = await prisma.portalInvoice.findFirst({
        where: { id: String(invoiceId), clientId: String(clientId) },
      });
      if (!inv) return res.status(404).json({ error: "not_found" });
      const sync = await prisma.portalSyncState.findUnique({ where: { clientId: String(clientId) } });
      return res.json({
        invoiceId: inv.id,
        type: inv.type,
        numero: inv.numero || null,
        competencia: formatCompetencia(inv.competencia),
        issueDate: dateToIso(inv.issueDate),
        status: inv.status,
        total: decimalToNumber(inv.total),
        emitente: { nome: inv.emitenteNome || null, cnpj: inv.emitenteDoc || null, im: null },
        tomador: { nome: inv.tomadorNome || null, cnpjCpf: inv.tomadorDoc || null, im: null },
        items: [],
        taxes: null,
        storage: { xml: Boolean(inv.xmlRaw), pdf: Boolean(inv.pdfUrl) },
        sync: {
          lastSyncAt: dateToIso(sync?.lastSyncAt),
          stale: !sync?.lastSyncAt || sync?.state !== "OK",
        },
      });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao buscar invoice detalhe");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/:invoiceId/xml (attachment)
  router.get("/:invoiceId/xml", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const inv = await prisma.portalInvoice.findFirst({
      where: { id: String(invoiceId), clientId: String(clientId) },
      select: { xmlRaw: true, id: true },
    });
    if (!inv?.xmlRaw) return res.status(404).json({ error: "XML_NOT_FOUND" });
    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename=\"invoice-${inv.id}.xml\"`);
    return res.status(200).send(inv.xmlRaw);
  });

  // GET /clients/:clientId/invoices/:invoiceId/xml/raw
  router.get("/:invoiceId/xml/raw", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const inv = await prisma.portalInvoice.findFirst({
      where: { id: String(invoiceId), clientId: String(clientId) },
      select: { xmlRaw: true },
    });
    if (!inv?.xmlRaw) return res.status(404).json({ error: "XML_NOT_FOUND" });
    return res.json({ xml: inv.xmlRaw });
  });

  // GET /clients/:clientId/invoices/xml/bulk?competencia=YYYY-MM&direcao=emitidas|recebidas|todas...
  // Retorna ZIP em stream com todos os XMLs filtrados.
  router.get("/xml/bulk", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const {
      direcao,
      from,
      to,
      competencia,
      status,
      type,
      search,
      limit,
    } = req.query || {};

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;

      const portalClient = await prisma.portalClient.findUnique({
        where: { id: String(clientId) },
        select: { cnpj: true },
      });
      const clientCnpj = normalizeDoc(portalClient?.cnpj);

      const invoiceDirection = String(direcao || "emitidas").toLowerCase();
      if (!["emitidas", "recebidas", "todas"].includes(invoiceDirection)) {
        return res.status(400).json({ error: "direcao_invalid" });
      }

      // Q8.A.8: limite reduzido de 5000 → 500 para evitar DoS (carregar 5000 invoices custa caro).
      // Quem precisar de mais paginação deve quebrar em chamadas menores.
      const maxItems = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const where = buildWhereFilters({
        clientId,
        clientCnpj,
        direcao: invoiceDirection,
        from,
        to,
        competencia,
        status,
        type,
        search,
      });
      where.xmlRaw = { not: null };

      const invoices = await prisma.portalInvoice.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: maxItems,
        select: {
          id: true,
          numero: true,
          chaveAcesso: true,
          issueDate: true,
          xmlRaw: true,
        },
      });

      if (!invoices.length) {
        return res.status(404).json({ error: "XML_NOT_FOUND", message: "Nenhum XML encontrado para o filtro." });
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const comp = safeFilePart(competencia || "all");
      const filename = `xmls-${safeFilePart(clientId)}-${comp}-${stamp}.zip`;

      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename=\"${filename}\"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        log.error({ err, clientId }, "Falha ao gerar zip de XMLs");
        if (!res.headersSent) {
          res.status(500).json({ error: "zip_generation_failed" });
        } else {
          res.end();
        }
      });

      archive.pipe(res);

      for (const inv of invoices) {
        if (!inv.xmlRaw) continue;
        const n = safeFilePart(inv.numero || "");
        const ch = safeFilePart(inv.chaveAcesso || "");
        const date = inv.issueDate ? safeFilePart(dateToIso(inv.issueDate)?.slice(0, 10)) : "";
        const base = n || ch || safeFilePart(inv.id);
        const entryName = `${base}${date ? `_${date}` : ""}.xml`;
        archive.append(inv.xmlRaw, { name: entryName });
      }

      await archive.finalize();
    } catch (err) {
      log.error({ err, clientId }, "Falha no bulk download de XML");
      if (!res.headersSent) {
        return res.status(500).json({ error: "internal_error" });
      }
      return res.end();
    }
  });

  // ── O DANFSe EM LOTE ────────────────────────────────────────────────────────────────────────
  //
  // > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote, com o nome dos
  // > arquivos sendo o CNPJ da empresa + um número"* — e, na sequência, *"quero o download no
  // > portal do cliente, e fazer o download dos DANFSe e não do XML."*
  //
  // GET /clients/:clientId/invoices/danfse/bulk?competencia=YYYY-MM&direcao=...
  //
  // ⚠ ELE MORA AQUI, COLADO NO `/xml/bulk`, E NÃO NUMA ROTA PRÓPRIA DO `/client`, por uma razão
  // que vale mais que a simetria: **o zip precisa conter exatamente as notas que a tela mostra**, e
  // quem decide isso é `buildWhereFilters` — a MESMA função da listagem, que é privada deste
  // módulo. Um lote com o próprio filtro discordaria da tela no primeiro ajuste, e a pessoa veria
  // 50 linhas e receberia 43 PDFs sem nada dizendo por quê. (O mesmo argumento do gêmeo
  // `emitidaPassaNoFiltro`, logo acima.)
  //
  // ⚠ ESCOPO POR EMPRESA É LEI, e ele é resolvido DUAS vezes: aqui, por `ensurePortalClientAccess`
  // + `where.clientId`, e de novo dentro de `gerarDanfseDaNota`, que busca cada nota por
  // `{ id, clientId }`. **Nenhuma lista de ids vem do cliente** — o que chega são filtros.
  //
  // ⚠ SÍNCRONO, EM STREAMING, COM TETO. O porquê (e as medições que o decidiram) está no cabeçalho
  // de `application/nfse/danfse/loteDanfseDoPortal.js`. O teto é conferido com `count()` ANTES de
  // qualquer byte sair, porque depois do primeiro byte do zip não há mais como responder um erro.
  router.get("/danfse/bulk", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const { direcao, from, to, competencia, status, search } = req.query || {};

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;

      const portalClient = await prisma.portalClient.findUnique({
        where: { id: String(clientId) },
        select: { cnpj: true, razao: true, companyId: true },
      });
      const clientCnpj = normalizeDoc(portalClient?.cnpj);

      const invoiceDirection = String(direcao || "emitidas").toLowerCase();
      if (!["emitidas", "recebidas", "todas"].includes(invoiceDirection)) {
        return res.status(400).json({ error: "direcao_invalid" });
      }

      // ⚠ O MESMO `where` DA LISTAGEM — inclusive `incluirCanceladas`, que por padrão esconde as
      // canceladas. Divergir daqui é divergir da tela.
      const where = buildWhereFilters({
        clientId,
        clientCnpj,
        direcao: invoiceDirection,
        from,
        to,
        competencia,
        status,
        type: undefined, // ⚠ NF-e NÃO é filtrada no SQL — ela entra e sai NOMEADA no relatório.
        search,
        incluirCanceladas: String(req.query.incluirCanceladas || "") === "1",
      });

      const encontradas = await prisma.portalInvoice.count({ where });
      if (!encontradas) {
        return res.status(404).json({
          error: "lote_vazio",
          message: "Nenhuma nota encontrada para este filtro.",
        });
      }
      if (encontradas > LOTE_MAXIMO) {
        // ⚠ RECUSA NOMEADA, ANTES DE COMEÇAR — e não o navegador caindo no meio do download.
        return res.status(400).json({
          error: "lote_muito_grande",
          // ⚠ A SAÍDA TEM DE EXISTIR NA TELA DE QUEM LÊ. "Escolha um filtro mais estreito" é
          // resposta enquanto houver filtro a estreitar — e no portal do cliente o único é a
          // competência. Quem JÁ está numa competência e ainda estoura o teto não tem para onde
          // ir, e por isso a segunda saída (baixar nota a nota, pelo botão da linha, que existe
          // desde 19/08) é nomeada junto: recusa sem caminho é beco sem saída.
          message:
            `Este filtro encontrou ${encontradas} notas, e o download em lote gera no máximo `
            + `${LOTE_MAXIMO} DANFSe por vez (cada um é um PDF gerado na hora, não um arquivo `
            + `guardado). Escolha uma competência mais estreita, ou baixe as notas uma a uma pelo `
            + `botão "Baixar DANFSe" de cada linha.`,
          encontradas,
          maximo: LOTE_MAXIMO,
        });
      }

      const notas = await prisma.portalInvoice.findMany({
        where,
        // ⚠ Ordem pelo NÚMERO da nota — é o que nomeia os arquivos, e o zip sai em ordem legível.
        orderBy: [{ numero: "asc" }, { issueDate: "asc" }],
        take: LOTE_MAXIMO,
        // ⚠ `xmlRaw` NÃO entra: quem o lê é `gerarDanfseDaNota`, nota a nota. Trazer 200 XMLs para
        // a memória aqui só para descartá-los seria pagar duas vezes pelo mesmo dado.
        select: { id: true, type: true, numero: true, chaveAcesso: true, emitenteDoc: true },
      });

      // ⚠⚠ AS NOSSAS EMISSÕES AINDA NÃO CONFIRMADAS entram no RELATÓRIO, não no zip. Elas
      // aparecem na tela do cliente (união na leitura — ver `notasEmitidasNaoConfirmadas.js`), mas
      // vivem em `ServiceInvoice`, e a rota do DANFSe lê `PortalInvoice`: não há XML do sistema
      // nacional de onde gerar. Sem esta linha, quem vê 12 notas na tela receberia 11 PDFs e teria
      // de descobrir a ausência contando arquivos — que é exatamente o que o relatório impede.
      const naoConfirmadas = [];
      if (
        incluirEmitidasNaoConfirmadas
        && portalClient?.companyId
        && filtroAlcancavel({ direcao: invoiceDirection })
      ) {
        const cruas = await lerEmitidasNaoConfirmadas({
          legacyCompanyId: portalClient.companyId,
          portalClientId: String(clientId),
        });
        for (const si of cruas) {
          if (!emitidaPassaNoFiltro(si, {
            competencia, from, to, status, type: undefined, search,
            clientCnpj, emitenteNome: portalClient?.razao,
          })) continue;
          naoConfirmadas.push({
            nota: { id: si.id, numero: si.numeroNfse, chaveAcesso: si.chaveAcesso },
            motivo:
              "esta nota foi emitida por aqui e o sistema nacional ainda não a devolveu — o DANFSe "
              + "é gerado a partir do XML que vem de lá",
          });
        }
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const comp = safeFilePart(competencia || "todas");
      const filename = `danfse-${safeFilePart(clientCnpj || clientId)}-${comp}-${stamp}.zip`;

      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename="${filename}"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        log.error({ err, clientId }, "Falha ao gerar zip de DANFSe");
        if (!res.headersSent) res.status(500).json({ error: "zip_generation_failed" });
        else res.end();
      });
      archive.pipe(res);

      const { geradas, falhas, colisoes } = await gerarLoteDanfse({
        notas,
        portalClientId: String(clientId),
        cnpjDaEmpresa: clientCnpj,
        archive,
      });

      // ⚠ O RELATÓRIO ENTRA POR ÚLTIMO porque só agora se sabe o que falhou — e isso funciona
      // mesmo em streaming: o índice do zip é escrito no `finalize`.
      archive.append(
        textoDoRelatorio({
          empresa: portalClient?.razao,
          cnpj: clientCnpj,
          competencia,
          direcao: invoiceDirection,
          geradas,
          falhas: [...falhas, ...naoConfirmadas],
          colisoes,
        }),
        { name: NOME_DO_RELATORIO }
      );

      await archive.finalize();
      log.info(
        { clientId, geradas, falhas: falhas.length + naoConfirmadas.length },
        "danfse-lote: concluído"
      );
    } catch (err) {
      log.error({ err, clientId }, "Falha no download em lote de DANFSe");
      if (!res.headersSent) {
        return res.status(500).json({ error: "internal_error" });
      }
      return res.end();
    }
  });

  // POST /clients/:clientId/invoices/:invoiceId/reparse
  router.post("/:invoiceId/reparse", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const inv = await prisma.portalInvoice.findFirst({
        where: { id: String(invoiceId), clientId: String(clientId) },
      });
      if (!inv) return res.status(404).json({ error: "not_found" });
      if (!inv.xmlRaw) return res.status(404).json({ error: "XML_NOT_FOUND" });

      // Por enquanto apenas NFSe (usa parser já existente)
      const meta = parseXmlMetadata(inv.xmlRaw);
      const updatedFields = [];
      const update = {};
      if (meta?.tomadorNome && meta.tomadorNome !== inv.tomadorNome) {
        update.tomadorNome = meta.tomadorNome;
        updatedFields.push("tomador.nome");
      }
      if (meta?.cnpjTomador && meta.cnpjTomador !== inv.tomadorDoc) {
        update.tomadorDoc = meta.cnpjTomador;
        updatedFields.push("tomador.doc");
      }
      if (meta?.cnpjPrestador && meta.cnpjPrestador !== inv.emitenteDoc) {
        update.emitenteDoc = meta.cnpjPrestador;
        updatedFields.push("emitente.doc");
      }
      if (meta?.prestadorNome && meta.prestadorNome !== inv.emitenteNome) {
        update.emitenteNome = meta.prestadorNome;
        updatedFields.push("emitente.nome");
      }
      if (meta?.competencia && dateToIso(meta.competencia) !== dateToIso(inv.competencia)) {
        update.competencia = meta.competencia;
        updatedFields.push("competencia");
      }
      if (meta?.dataEmissao && dateToIso(meta.dataEmissao) !== dateToIso(inv.issueDate)) {
        update.issueDate = meta.dataEmissao;
        updatedFields.push("issueDate");
      }
      if (meta?.numeroNfse && meta.numeroNfse !== inv.numero) {
        update.numero = meta.numeroNfse;
        updatedFields.push("numero");
      }
      if (Object.keys(update).length) {
        await prisma.portalInvoice.update({ where: { id: inv.id }, data: update });
      }
      return res.json({ ok: true, updatedFields });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao reparse invoice");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/:invoiceId/pdf
  router.get("/:invoiceId/pdf", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const inv = await prisma.portalInvoice.findFirst({
      where: { id: String(invoiceId), clientId: String(clientId) },
      select: { pdfUrl: true },
    });
    if (!inv?.pdfUrl) return res.status(404).json({ error: "PDF_NOT_FOUND" });
    return res.redirect(inv.pdfUrl);
  });

  // GET /clients/:clientId/invoices/:invoiceId/events
  router.get("/:invoiceId/events", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const items = await prisma.portalInvoiceEvent.findMany({
        where: { clientId: String(clientId), invoiceId: String(invoiceId) },
        orderBy: { date: "desc" },
      });
      return res.json({
        data: items.map((e) => ({
          type: e.type,
          date: dateToIso(e.date),
          protocol: e.protocol || null,
          reason: e.reason || null,
        })),
      });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao listar eventos");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /clients/:clientId/invoices/import/xml (upload)
  router.post("/import/xml", upload.array("files", 50), async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files_required" });
    }

    // CNPJ da empresa — usado p/ verificar titularidade e derivar papel EMIT/DEST
    // (mesmo tratamento do caminho automático em AdnNotasService.upsertNfseFromItem).
    const portalClient = await prisma.portalClient.findUnique({
      where: { id: String(clientId) },
      select: { cnpj: true },
    });
    const companyCnpj = normalizeDoc(portalClient?.cnpj);

    let created = 0;
    let updated = 0;
    let duplicates = 0;
    let rejeitadas = 0;
    const errors = [];

    for (const file of files) {
      try {
        const xml = file.buffer?.toString("utf-8") || "";
        if (!xml.trim().startsWith("<")) {
          errors.push({ file: file.originalname, reason: "invalid_xml" });
          continue;
        }
        const meta = parseXmlMetadata(xml);
        const prestadorDoc = normalizeDoc(meta?.cnpjPrestador);
        const tomadorDoc = normalizeDoc(meta?.cnpjTomador);

        // Verificação de titularidade: a nota tem que pertencer à empresa (emitente OU tomador).
        // Se o CNPJ da empresa não bate com nenhum dos dois, rejeita (não importa nota de terceiro).
        if (!companyCnpj || (prestadorDoc !== companyCnpj && tomadorDoc !== companyCnpj)) {
          rejeitadas += 1;
          errors.push({ file: file.originalname, reason: "nota_nao_pertence" });
          continue;
        }

        // ⚠ LINHA LEGADA SEM CHAVE — deixada para o dono decidir, nunca duplicada aqui.
        //
        // Enquanto o import tinha implementação própria, ele gravava `chaveAcesso: null` e
        // `idNfse = numeroNfse`. Essas linhas continuam na base. Agora que a ingestão é uma só e
        // dedupica pela CHAVE quando o XML tem chave, importar de novo o mesmo XML criaria uma
        // SEGUNDA linha ao lado da legada — exatamente a duplicata que este conserto existe para
        // parar de produzir.
        //
        // Não adotamos a linha antiga (carimbar a chave nela é escrita sobre nota fiscal, e a
        // decisão do que fazer com as duplicatas existentes é do contador) e não criamos a nova:
        // contamos como duplicata e dizemos qual linha está no caminho. O inventário completo sai
        // em `scripts/diag-notas-duplicadas.mjs`.
        //
        // O casamento exige CHAVE no XML + mesmo número + MESMO PRESTADOR: número de NFS-e se
        // repete entre prestadores, e recusar por número solto barraria import legítimo.
        const chaveDoXml = meta?.chaveAcesso || null;
        if (chaveDoXml && meta?.numeroNfse) {
          const legado = await prisma.portalInvoice.findFirst({
            where: {
              clientId: String(clientId),
              idNfse: String(meta.numeroNfse),
              chaveAcesso: null,
            },
            select: { id: true, emitenteDoc: true },
          });
          if (legado && normalizeDoc(legado.emitenteDoc) === prestadorDoc) {
            duplicates += 1;
            errors.push({
              file: file.originalname,
              reason: "duplicata_legado_sem_chave",
              invoiceId: legado.id,
            });
            continue;
          }
        }

        // ⚠ A PERSISTÊNCIA É A MESMA DA CAPTURA — `application/notas/ingestaoNfse.js`.
        //
        // Aqui existia uma segunda implementação, escrita à mão, que gravava `chaveAcesso: null`
        // fixo e dedupicava por `clientId_idNfse`. A captura faz o oposto de propósito (chave
        // quando há chave, `idNfse` só no fallback sem-chave), então o upsert do import NUNCA
        // encontrava a linha da captura: nascia uma segunda linha da mesma nota, as duas
        // `papel:"EMIT"`/`autorizada`, e o faturamento somava a nota duas vezes. Pior, a
        // conferência do ADN (`getNossoConjunto`, que usa `chaveAcesso || idNfse`) passava a
        // acusar `divergente` falso e a TRAVAR o fechamento.
        //
        // A titularidade acima (`nota_nao_pertence`) continua sendo do import e é mais estrita que
        // a guarda de dentro: aqui o arquivo vem de uma pessoa, e metadado sem CNPJ nenhum é
        // recusado. Uma transação por arquivo: nota e itens entram juntos ou não entram.
        const r = await prisma.$transaction(async (tx) => upsertNfseFromItem(tx, {
          portalClientId: String(clientId),
          companyCnpj,
          item: null,
          xmlPlain: xml,
          metadata: meta || {},
        }));

        if (r.status === "rejeitada_outro_cnpj") {
          rejeitadas += 1;
          errors.push({ file: file.originalname, reason: "nota_nao_pertence" });
        } else if (r.status === "skipped") {
          errors.push({ file: file.originalname, reason: r.reason || "sem_identificador" });
        } else if (r.existia) {
          updated += 1;
        } else {
          created += 1;
        }
      } catch (err) {
        errors.push({ file: file.originalname, reason: "import_failed" });
        log.warn({ err }, "Falha ao importar XML");
      }
    }

    return res.json({ created, updated, duplicates, rejeitadas, errors });
  });

  return router;
}

