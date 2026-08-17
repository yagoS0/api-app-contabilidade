import { Buffer } from "node:buffer";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { parseTributosPgdas, tributosPorTributoParaColuna } from "./parseTributosPgdas.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import { generateEntriesFromCircular, FONTE_VALOR_EXTRATO } from "../../accounting/AccountingEntryGeneratorService.js";
// As duas travas de "sem faturamento" vivem no service, não na rota — é o que impede este caminho
// automático de afirmar algo que o caminho manual recusaria.
import { marcarSemFaturamento } from "../../accounting/semFaturamento.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";
import { markGuideOpenBySerpro, markGuidePaidBySerpro } from "../../guides/GuidePaymentStatusService.js";
import { capturePgdasGuideForCompany } from "./CaptureSerproGuidesService.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";
import { SerproPgdasdService, SERPRO_PGDASD_SERVICE_NORMAL } from "./SerproPgdasdService.js";

const SERPRO_PGDASD_SERVICE_DECLARACAO = "CONSULTIMADECREC14";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeCompetenciaAaaamm(value) {
  const normalized = normalizeCompetencia(value);
  if (!normalized) return null;
  return normalized.replace("-", "");
}

function validateCompetenciaAaaamm(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    const err = new Error("Competência deve estar no formato AAAAMM.");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  const month = Number(normalized.slice(4, 6));
  if (month < 1 || month > 12) {
    const err = new Error("Mês da competência inválido.");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  return normalized;
}

function parseDecimal(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseNestedJsonString(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function searchValueDeep(input, matcher) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = searchValueDeep(item, matcher);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof input === "string") {
    const parsed = parseNestedJsonString(input);
    if (parsed) return searchValueDeep(parsed, matcher);
    return null;
  }
  if (typeof input !== "object") return null;

  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    if (typeof value === "string") {
      const parsed = parseNestedJsonString(value);
      if (parsed != null) {
        const nestedFound = searchValueDeep(parsed, matcher);
        if (nestedFound != null) return nestedFound;
      }
    }
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function buildConsultarDeclaracaoPayload({ companyCnpj, competenciaAaaamm, contratanteCnpj }) {
  return {
    contratante: { numero: contratanteCnpj, tipo: 2 },
    autorPedidoDados: { numero: contratanteCnpj, tipo: 2 },
    contribuinte: { numero: onlyDigits(companyCnpj), tipo: 2 },
    pedidoDados: {
      idSistema: "PGDASD",
      idServico: SERPRO_PGDASD_SERVICE_DECLARACAO,
      versaoSistema: "1.0",
      dados: JSON.stringify({ periodoApuracao: competenciaAaaamm }),
    },
  };
}

function parseCompactDateTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}-03:00`);
}

function parseSerproJsonField(responseData) {
  const rawDados = typeof responseData?.dados === "string" ? responseData.dados.trim() : "";
  if (!rawDados) return null;
  try {
    return JSON.parse(rawDados);
  } catch {
    return null;
  }
}

function findDasIndexNode(input) {
  const node = searchValueDeep(input, (key, value) => /indice.*das/i.test(String(key || "")) && value && typeof value === "object");
  if (node && typeof node === "object") return node;
  return null;
}

function parseDasIndexResponse(responseData) {
  const dados = parseSerproJsonField(responseData);
  const indiceDas = findDasIndexNode(dados) || findDasIndexNode(responseData);
  if (!indiceDas) return null;
  const numeroDocumento = String(indiceDas.numeroDas || indiceDas.numeroDocumento || "").trim() || null;
  const dasPagoRaw = indiceDas.dasPago;
  const dasPago = dasPagoRaw === true || String(dasPagoRaw || "").trim().toLowerCase() === "true";
  const dataHoraEmissaoDas = parseCompactDateTime(indiceDas.dataHoraEmissaoDas || indiceDas.dataEmissaoDas || "");
  return {
    numeroDocumento,
    dasPago,
    dataHoraEmissaoDas: dataHoraEmissaoDas ? dataHoraEmissaoDas.toISOString() : null,
    rawDados: dados,
  };
}

/**
 * Q46: resolve o índice do DAS de uma competência (número do documento de arrecadação + dasPago)
 * via CONSDECLARACAO13. Usado pela confirmação de pagamento para obter o numeroDocumento CORRETO
 * (não o heurístico do GERARDAS) e o sinal autoritativo de pagamento (`dasPago`). Chamada barata
 * (/Consultar); NÃO gera lançamentos. Prefira o valor já gravado em companyMonthlyCircular.
 * @returns {Promise<{numeroDocumento: string|null, dasPago: boolean, dataHoraEmissaoDas: string|null}|null>}
 */
export async function consultarDasIndexPorCompetencia({ portalClientId, competencia, contribuinteCnpj = null, contratanteCnpj = null }) {
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  let cnpj = onlyDigits(contribuinteCnpj);
  if (cnpj.length !== 14 && portalClientId) {
    const portal = await prisma.portalClient.findUnique({
      where: { id: String(portalClientId) }, select: { cnpj: true },
    });
    cnpj = onlyDigits(portal?.cnpj);
  }
  if (cnpj.length !== 14) {
    const err = new Error("contribuinte_cnpj_invalido");
    err.code = "SERPRO_INVALID_CONTRIBUINTE_CNPJ";
    throw err;
  }
  const pgdasService = new SerproPgdasdService();
  const resp = await pgdasService.consultarDeclaracaoIndice({
    contratanteCnpj: procuradorCnpj, contribuinteCnpj: cnpj, periodoApuracao: competencia,
  });
  return parseDasIndexResponse(resp);
}

/**
 * Grava a repartição por tributo do extrato em `ApuracaoSnapshot.tributosPorTributo`.
 *
 * ⚠ **ATUALIZA, NUNCA CRIA — e isso não é preguiça.** `ApuracaoSnapshot` tem `rbt12` e
 * `receitaPorTipo` NOT NULL (mais `idempotencyKey` @unique): criar uma linha só para pendurar esta
 * marca exigiria inventar dado fiscal num registro auditável. É a mesma razão pela qual a marca de
 * "empresa zerada" não virou coluna de snapshot (ver `apps/api/CLAUDE.md`), e a mesma disciplina de
 * `RbtExtratoService.gravarPeriodosAceitos`: *"sem linha no cache não há o que anexar (…) não criar
 * aqui evita inventar um RBT12"*. Sem snapshot, a repartição fica só no `metadata` da circular,
 * de onde o backfill a recupera quando o snapshot passar a existir.
 *
 * ⚠ **NÃO TOCA EM NENHUMA COLUNA DO MOTOR** (`dasCalculadoLocal`, `receitaPorAnexo`,
 * `aliquotaEfetivaPorAnexo`, `vigenciaAliquota`) nem nas três colunas de DAS. Esta é uma coluna de
 * LEITURA: nada aqui declara, calcula alíquota ou parte lançamento.
 *
 * **Best-effort de propósito:** quando o código chega aqui o extrato já foi capturado e gravado.
 * Falhar em anexar um dado de auditoria não pode desfazer a captura — o backfill recupera depois.
 */
async function gravarTributosNoSnapshot({ portalClientId, competencia, tributosPorTributo }) {
  // `null` = não houve repartição confiável (sem linha, contagem estranha ou soma que não fecha).
  // Não se apaga o que já estava lá por causa de um extrato que não deu para ler.
  if (!tributosPorTributo) return { gravado: false, motivo: "SEM_REPARTICAO" };
  try {
    const r = await prisma.apuracaoSnapshot.updateMany({
      where: { portalClientId: String(portalClientId), competencia: String(competencia) },
      data: { tributosPorTributo },
    });
    return r.count > 0
      ? { gravado: true, motivo: null }
      : { gravado: false, motivo: "SEM_SNAPSHOT" };
  } catch (error) {
    return { gravado: false, motivo: "ERRO", erro: error?.message || String(error) };
  }
}

async function tryEnsureDasGuideRecord(params) {
  try {
    const guide = await ensureDasGuideRecord(params);
    return { guide, error: null };
  } catch (error) {
    return {
      guide: null,
      error: {
        code: error?.code || "SERPRO_PGDASD_GUIDE_FETCH_FAILED",
        message: error?.message || "Falha ao baixar guia DAS no SERPRO.",
      },
    };
  }
}

async function ensureDasGuideRecord({ portalClientId, competencia, contratanteCnpj, dasIndex }) {
  let guide = await prisma.guide.findFirst({
    where: {
      portalClientId,
      competencia,
      tipo: "SIMPLES",
      source: "SERPRO",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!guide) {
    const captured = await capturePgdasGuideForCompany({
      portalClientId,
      competencia,
      contratanteCnpj,
      serviceId: SERPRO_PGDASD_SERVICE_NORMAL,
    });
    guide = await prisma.guide.findUnique({ where: { id: captured.guide.guideId } });
  }

  if (!guide) return null;

  if (dasIndex?.dasPago) {
    await markGuidePaidBySerpro({ guideId: guide.id });
  } else {
    await markGuideOpenBySerpro({ guideId: guide.id });
  }

  return prisma.guide.findUnique({ where: { id: guide.id } });
}

function parseSerproDados(responseData) {
  const rawDados = typeof responseData?.dados === "string" ? responseData.dados.trim() : "";
  if (!rawDados) {
    const notFoundMessage = Array.isArray(responseData?.mensagens)
      ? responseData.mensagens.find((item) => /não há declaração transmitida para o período informado/i.test(String(item?.texto || "")))
      : null;
    if (notFoundMessage) {
      return {
        notFound: true,
        message: String(notFoundMessage.texto || "").trim(),
      };
    }
    const err = new Error("SERPRO não retornou o campo dados.");
    err.code = "SERPRO_PGDASD_DADOS_NOT_FOUND";
    throw err;
  }
  try {
    return JSON.parse(rawDados);
  } catch {
    const err = new Error("Falha ao interpretar o campo dados do SERPRO.");
    err.code = "SERPRO_PGDASD_DADOS_INVALID";
    throw err;
  }
}

function pickPdfPayload(file) {
  if (!file || typeof file !== "object") return null;
  const nomeArquivo = String(file.nomeArquivo || file.filename || file.name || "").trim() || null;
  const pdf = String(file.pdf || file.PDFByteArrayBase64 || file.base64 || "").trim() || null;
  if (!pdf) return null;
  return { nomeArquivo, pdf };
}

function decodeBase64Pdf(value, code) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) {
    const err = new Error(code.toLowerCase());
    err.code = code;
    throw err;
  }
  return buffer;
}

async function saveBase64Pdf({ companyId, competencia, type, filename, base64 }) {
  const buffer = decodeBase64Pdf(base64, "SERPRO_PGDASD_PDF_INVALID");
  const key = `serpro/pgdas/${companyId}/${competencia}/${type}-${Date.now()}-${String(filename || "documento.pdf").replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
  const storage = GuideStorageService.create();
  const uploaded = await storage.upload({ key, buffer, contentType: "application/pdf" });
  return {
    id: uploaded.key,
    storageKey: uploaded.key,
    url: uploaded.url,
    buffer,
  };
}

function extractMoneyFromTextByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const parsed = parseDecimal(match[1]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

/**
 * Normaliza texto para matching robusto (lowercase + sem acentos + espaços únicos).
 * Usado por `classifyAtividade`.
 */
function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos combinantes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifica a descrição de uma atividade do PGDAS-D em:
 *  - servico (Anexo III/IV/V — não separa por sub-tipo)
 *  - venda (sub: sem_st | com_st — separadas para fins contábeis)
 *  - outro (locação, exportação, etc.)
 */
function classifyAtividade(descricao) {
  const norm = normalizeForMatch(descricao);
  if (/prestacao\s+de\s+servicos?/i.test(norm)) {
    return { categoria: "servico", subcategoria: null };
  }
  const isVenda =
    /revenda\s+de\s+mercadorias?/i.test(norm)
    || /venda\s+de\s+mercadorias\s+industrializadas?/i.test(norm);
  if (isVenda) {
    // Distingue venda COM ST × SEM ST pela descrição:
    //   "...com substituição tributária..."  → com_st
    //   "...sem substituição tributária..."  → sem_st (default conservador)
    //   "...substituído tributário..."        → com_st (variação do PDF da Receita)
    const hasComST = /com\s+substituicao\s+tributaria/i.test(norm)
      || /substituido\s+tributario/i.test(norm);
    const subcategoria = hasComST ? "com_st" : "sem_st";
    return { categoria: "venda", subcategoria };
  }
  return { categoria: "outro", subcategoria: null };
}

/**
 * Itera TODOS os blocos "Valor do Débito por Tributo para a Atividade" do extrato PGDAS-D
 * e soma as receitas por categoria/sub-categoria.
 *
 * Cada bloco segue o formato:
 *   Valor do Débito por Tributo para a Atividade (R$):
 *   <descrição da atividade — pode ter quebras de linha>
 *   Receita Bruta Informada: R$ <valor>
 *   IRPJ CSLL COFINS PIS/Pasep INSS/CPP ICMS IPI ISS Total
 *   <valores>
 *   Parcela 1: R$ <valor>
 *
 * Suporta as 3 variações reais documentadas em PDFs SOLUCLEAN/GARDEN BRASA/PRO-FACILITIES.
 */
function parseAtividadesPgdas(text) {
  const HEADER_RE = /Valor\s+do\s+D[ée]bito\s+por\s+Tributo\s+para\s+a\s+Atividade\s*\(R\$\)\s*:/gi;
  const matches = [...String(text || "").matchAll(HEADER_RE)];
  const empty = {
    receitaServicos: 0,
    receitaVendas: 0,
    receitaVendasSemST: 0,
    receitaVendasComST: 0,
    receitaOutros: 0,
    atividades: [],
  };
  if (matches.length === 0) return empty;

  const atividades = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(text.length, start + 2000);
    const bloco = text.slice(start, end);

    // Descrição = entre o cabeçalho do bloco e "Receita Bruta Informada: R$ <valor>"
    const descMatch = bloco.match(/^([\s\S]*?)Receita\s+Bruta\s+Informada\s*:?\s*R\$\s*([\d.]+,\d{2})/i);
    if (!descMatch) continue;
    const descricao = String(descMatch[1] || "").trim().replace(/\s+/g, " ");
    const receita = parseDecimal(descMatch[2]) ?? 0;
    if (!receita) continue;

    const { categoria, subcategoria } = classifyAtividade(descricao);
    atividades.push({ descricao, receita, categoria, subcategoria });
  }

  let receitaServicos = 0;
  let receitaVendasSemST = 0;
  let receitaVendasComST = 0;
  let receitaOutros = 0;
  for (const a of atividades) {
    if (a.categoria === "servico") {
      receitaServicos += a.receita;
    } else if (a.categoria === "venda") {
      if (a.subcategoria === "com_st") receitaVendasComST += a.receita;
      else receitaVendasSemST += a.receita;
    } else {
      receitaOutros += a.receita;
    }
  }
  const receitaVendas = receitaVendasSemST + receitaVendasComST;
  return { receitaServicos, receitaVendas, receitaVendasSemST, receitaVendasComST, receitaOutros, atividades };
}

async function parsePgdasDeclarationPdf(buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const pdfData = await pdfParse(buffer);
  const rawText = String(pdfData?.text || "");

  // 1) Receita Bruta total — vem do header (seção 2.1 Discriminativo de Receitas)
  const receitaBruta = extractMoneyFromTextByPatterns(rawText, [
    /Receita Bruta do PA \(RPA\) - Compet[êe]ncia\s+(\d+[\d.]*,\d{2})\s+\d+[\d.]*,\d{2}\s+\d+[\d.]*,\d{2}/i,
    /Receita\s+Bruta\s+do\s+PA[^\d]{0,40}(\d+[\d.]*,\d{2})/i,
    /Receita Bruta Informada:\s*R\$\s*(\d+[\d.]*,\d{2})/i,
    /receita\s+bruta[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /total\s+de\s+receitas?[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /receita\s+total[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
  ]);

  // 2) Imposto apurado (total do DAS) — MESMA regra de sempre ("o último valor da linha de
  //    tributos"), agora lida por `parseTributosPgdas`, que devolve na mesma passada os OITO
  //    valores que esta função descartava (`values[values.length - 1]` jogava fora o resto).
  //
  //    ⚠ UMA LEITURA SÓ, DUAS EXIGÊNCIAS. O `total` não depende da soma fechar — é o número que já
  //    está em produção e que foi conferido contra a guia real (medido 17/08/2026: bate com o
  //    `dasTotal` gravado em 82/82 extratos). A `reparticao` exige 9 valores E a soma. Amarrar o
  //    total à autoverificação seria regressão: um extrato de leiaute novo perderia o `dasTotal`
  //    que hoje ele acerta.
  const leituraTributos = parseTributosPgdas(rawText);
  let impostoApurado = leituraTributos.total;
  if (impostoApurado == null) {
    impostoApurado = extractMoneyFromTextByPatterns(rawText, [
      /Principal\s*\d+[\d.]*,\d{2}\s*Multa\s*\d+[\d.]*,\d{2}\s*Juros\s*\d+[\d.]*,\d{2}\s*Total\s*(\d+[\d.]*,\d{2})/i,
    ]);
  }
  if (impostoApurado == null) {
    impostoApurado = extractMoneyFromTextByPatterns(rawText, [
      /Valor\s+Total\s+do\s+Documento\s*\n\s*(\d+[\d.]*,\d{2})/i,
      /Valor\s+Total\s+do\s+Documento\s+(\d+[\d.]*,\d{2})/i,
    ]);
  }
  if (impostoApurado == null) {
    const totaisMatch = rawText.match(/^Totais\s+([\d.,]+)/im);
    if (totaisMatch?.[1]) {
      const values = totaisMatch[1].match(/\d+(?:\.\d{3})*,\d{2}/g);
      if (values && values.length > 0) impostoApurado = parseDecimal(values[values.length - 1]);
    }
  }

  // 3) NOVO: iteração de blocos de atividade com classificação serviço/venda(sem_st/com_st)/outro
  const {
    receitaServicos,
    receitaVendas,
    receitaVendasSemST,
    receitaVendasComST,
    receitaOutros,
    atividades,
  } = parseAtividadesPgdas(rawText);

  // ⚠ A REPARTIÇÃO É DADO DE LEITURA/AUDITORIA — ela NÃO parte o DAS.
  // Regra escrita do dono: "a guia do Simples vem desmembrada nos impostos, porém contabilizamos
  // junto, como DAS Simples Nacional". Nada aqui vira lançamento, provisão ou alíquota; quem
  // consome é a coluna `ApuracaoSnapshot.tributosPorTributo`, que existia e estava morta.
  const tributosPorTributo = tributosPorTributoParaColuna(leituraTributos);

  return {
    receitaBruta,
    impostoApurado,
    tributosPorTributo,      // { fonte, lidoEm, total, somaConfere, ordemVerificada, tributos } | null
    tributosMotivo: leituraTributos.motivo, // por que NÃO houve repartição (vocabulário fechado)
    receitaServicos,         // agregado de todos os blocos de Prestação de Serviços
    receitaVendas,           // soma total de vendas (= semST + comST), mantido para compat
    receitaVendasSemST,      // vendas sem substituição tributária
    receitaVendasComST,      // vendas com substituição tributária (ICMS-ST)
    receitaOutros,           // locação, exportação, etc. (não vai pra serviços nem vendas)
    atividades,              // [{ descricao, receita, categoria, subcategoria }] — auditoria
    rawText,
  };
}

async function findOrCreateCircular({ portalClientId, competencia }) {
  const now = new Date();
  return prisma.companyMonthlyCircular.upsert({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    create: {
      portalClientId,
      competencia,
      receitaServicos: 0,
      receitaVendas: 0,
      receitaStatus: "PENDING",
      dasStatus: "PENDING",
      serproSyncStatus: "RUNNING",
      serproLastSyncAt: now,
      serproLastError: null,
    },
    update: {
      serproSyncStatus: "RUNNING",
      serproLastSyncAt: now,
      serproLastError: null,
    },
  });
}

export async function syncPgdasByCompetencia({ portalClientId, competencia, contratanteCnpj }) {
  const normalizedPortalClientId = String(portalClientId || "").trim();
  const competenciaStorage = normalizeCompetencia(competencia);
  const competenciaAaaamm = validateCompetenciaAaaamm(normalizeCompetenciaAaaamm(competencia));

  if (!normalizedPortalClientId) {
    const err = new Error("Empresa não encontrada.");
    err.code = "PORTAL_COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!competenciaStorage) {
    const err = new Error("Competência inválida.");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }

  const company = await prisma.portalClient.findUnique({
    where: { id: normalizedPortalClientId },
    select: { id: true, cnpj: true, razao: true },
  });
  if (!company) {
    const err = new Error("Empresa não encontrada.");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }
  if (!onlyDigits(company.cnpj)) {
    const err = new Error("Empresa sem CNPJ cadastrado.");
    err.code = "SERPRO_INVALID_CONTRIBUINTE_CNPJ";
    throw err;
  }

  const circular = await findOrCreateCircular({ portalClientId: company.id, competencia: competenciaStorage });

  try {
    const runtime = await getResolvedSerproCredentials();
    const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
    if (!procuradorCnpj || procuradorCnpj.length !== 14) {
      const err = new Error("serpro_procurador_cnpj_not_configured");
      err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
      throw err;
    }

    const pgdasService = new SerproPgdasdService();
    const declarationIndexResponse = await pgdasService.consultarDeclaracaoIndice({
      contratanteCnpj: procuradorCnpj,
      contribuinteCnpj: company.cnpj,
      periodoApuracao: competenciaStorage,
    });
    const dasIndex = parseDasIndexResponse(declarationIndexResponse);

    const client = new SerproHttpClient();
    const response = await client.post(
      "/Consultar",
      buildConsultarDeclaracaoPayload({
        companyCnpj: company.cnpj,
        competenciaAaaamm,
        contratanteCnpj: procuradorCnpj,
      })
    );

    const dados = parseSerproDados(response);

    if (dados?.notFound) {
      const updated = await prisma.companyMonthlyCircular.update({
        where: { id: circular.id },
        data: {
          receitaStatus: "NOT_FOUND",
          dasNumeroDocumento: dasIndex?.numeroDocumento || null,
          dasPago: dasIndex?.dasPago ?? null,
          dasDataEmissao: dasIndex?.dataHoraEmissaoDas ? new Date(dasIndex.dataHoraEmissaoDas) : null,
          dasStatus: dasIndex?.numeroDocumento ? (dasIndex.dasPago ? "SUCCESS_PAID" : "SUCCESS_OPEN") : "NOT_FOUND",
          serproSyncStatus: "NOT_FOUND",
          serproLastSyncAt: new Date(),
          serproLastError: null,
          metadata: {
            ...(circular.metadata && typeof circular.metadata === "object" ? circular.metadata : {}),
            integrationSource: "SERPRO_PGDASD_DECLARACAO",
            sistema: "PGDASD",
            servico: SERPRO_PGDASD_SERVICE_DECLARACAO,
            declarationIndexResponse,
            dasIndex,
            rawPayload: response,
            dados,
          },
        },
      });
      const guideResult = dasIndex?.numeroDocumento
        ? await tryEnsureDasGuideRecord({
            portalClientId: company.id,
            competencia: competenciaStorage,
            contratanteCnpj: procuradorCnpj,
            dasIndex,
          })
        : { guide: null, error: null };
      return { company, circular: updated, guide: guideResult.guide, guideFetchError: guideResult.error, accounting: { ok: true, generatedEntries: [] }, dados, dasIndex };
    }

    const declaracaoPayload = pickPdfPayload(dados?.declaracao);
    const reciboPayload = pickPdfPayload(dados?.recibo);

    if (!declaracaoPayload?.pdf) {
      const updated = await prisma.companyMonthlyCircular.update({
        where: { id: circular.id },
        data: {
          receitaStatus: "NOT_FOUND",
          dasStatus: "NOT_FOUND",
          serproSyncStatus: "NOT_FOUND",
          serproLastSyncAt: new Date(),
          metadata: {
            ...(circular.metadata && typeof circular.metadata === "object" ? circular.metadata : {}),
            integrationSource: "SERPRO_PGDASD_DECLARACAO",
            sistema: "PGDASD",
            servico: SERPRO_PGDASD_SERVICE_DECLARACAO,
            rawPayload: response,
            dados,
          },
        },
      });
      return { company, circular: updated, accounting: { ok: true, generatedEntries: [] }, dados };
    }

    const declaracaoFile = await saveBase64Pdf({
      companyId: company.id,
      competencia: competenciaStorage,
      type: "PGDAS_DECLARACAO",
      filename: declaracaoPayload.nomeArquivo || `pgdas-declaracao-${competenciaAaaamm}.pdf`,
      base64: declaracaoPayload.pdf,
    });

    const reciboFile = reciboPayload?.pdf
      ? await saveBase64Pdf({
          companyId: company.id,
          competencia: competenciaStorage,
          type: "PGDAS_RECIBO",
          filename: reciboPayload.nomeArquivo || `pgdas-recibo-${competenciaAaaamm}.pdf`,
          base64: reciboPayload.pdf,
        })
      : null;

    const parsedPgdas = await parsePgdasDeclarationPdf(declaracaoFile.buffer);
    const receitaBruta = parsedPgdas.receitaBruta ?? null;
    const dasTotal = parsedPgdas.impostoApurado ?? null;
    const receitaServicos = parsedPgdas.receitaServicos || 0;
    const receitaVendas = parsedPgdas.receitaVendas || 0;
    const receitaVendasSemST = parsedPgdas.receitaVendasSemST || 0;
    const receitaVendasComST = parsedPgdas.receitaVendasComST || 0;
    const receitaOutros = parsedPgdas.receitaOutros || 0;

    // Validação de consistência: soma das atividades deve bater com o header.
    // Warn (não bloqueia) quando diverge — pode indicar bloco perdido pelo parser.
    if (receitaBruta != null) {
      const soma = receitaServicos + receitaVendas + receitaOutros;
      const diff = Math.abs(receitaBruta - soma);
      if (diff > 0.02) {
        // (log pode não estar definido no escopo deste service; usa console.warn como fallback seguro)
        // eslint-disable-next-line no-console
        console.warn("[PGDAS-D] divergência entre Receita Bruta do header e soma das atividades", {
          portalClientId: company.id, competencia: competenciaStorage,
          receitaBruta, soma, diff, atividades: parsedPgdas.atividades,
        });
      }
    }

    const updated = await prisma.companyMonthlyCircular.update({
      where: { id: circular.id },
      data: {
        receitaBruta,
        receitaServicos,
        receitaVendas,
        receitaVendasSemST,
        receitaVendasComST,
        dasTotal,
        dasNumeroDocumento: dasIndex?.numeroDocumento || null,
        dasPago: dasIndex?.dasPago ?? null,
        dasDataEmissao: dasIndex?.dataHoraEmissaoDas ? new Date(dasIndex.dataHoraEmissaoDas) : null,
        pgdasNumeroDeclaracao: dados.numeroDeclaracao ? String(dados.numeroDeclaracao) : null,
        pgdasDeclaracaoFileId: declaracaoFile.id,
        pgdasDeclaracaoFileUrl: declaracaoFile.url,
        pgdasReciboFileId: reciboFile?.id || null,
        pgdasReciboFileUrl: reciboFile?.url || null,
        receitaStatus: receitaBruta ? "SUCCESS" : "NOT_FOUND",
        dasStatus: dasIndex?.numeroDocumento ? (dasIndex.dasPago ? "SUCCESS_PAID" : "SUCCESS_OPEN") : dasTotal ? "SUCCESS" : "NOT_FOUND",
        serproSyncStatus: "SUCCESS",
        serproLastSyncAt: new Date(),
        serproLastError: null,
        metadata: {
          ...(circular.metadata && typeof circular.metadata === "object" ? circular.metadata : {}),
          integrationSource: "SERPRO_PGDASD_DECLARACAO",
          sistema: "PGDASD",
          servico: SERPRO_PGDASD_SERVICE_DECLARACAO,
          declarationIndexResponse,
          dasIndex,
          rawPayload: response,
          dados,
          parsedPgdas,
        },
      },
    });

    await gravarTributosNoSnapshot({
      portalClientId: company.id,
      competencia: competenciaStorage,
      tributosPorTributo: parsedPgdas.tributosPorTributo,
    });

    const guideResult = dasIndex?.numeroDocumento
      ? await tryEnsureDasGuideRecord({
          portalClientId: company.id,
          competencia: competenciaStorage,
          contratanteCnpj: procuradorCnpj,
          dasIndex,
        })
      : { guide: null, error: null };

    const finalCircular = guideResult.error
      ? await prisma.companyMonthlyCircular.update({
          where: { id: updated.id },
          data: {
            metadata: {
              ...(updated.metadata && typeof updated.metadata === "object" ? updated.metadata : {}),
              guideFetchError: guideResult.error,
            },
          },
        })
      : updated;

    // ⚠ `fonteValor: EXTRATO` — o `dasTotal` acima saiu do PDF da DECLARAÇÃO (imposto APURADO),
    // não do documento de arrecadação. Numa RETIFICADORA é este caminho que traz o imposto novo, e
    // ele é a verdade declarada à Receita: as linhas do lançamento têm de acompanhar. Sem isto a
    // guarda de recálculo do `AccountingEntryGeneratorService` congelava o imposto no valor
    // anterior enquanto a receita — que não passa pela guarda — era atualizada.
    const accounting = await generateEntriesFromCircular({
      portalClientId: company.id,
      competencia: competenciaStorage,
      now: new Date(),
      fonteValor: FONTE_VALOR_EXTRATO,
    });

    // ─── DECLARAÇÃO ZERADA MARCA O MÊS ────────────────────────────────────────────────────────
    //
    // `generateEntriesFromCircular` só gera evento quando o valor é > 0. Numa declaração zerada ele
    // devolve zero lançamento — e a aba Lançamentos fica IDÊNTICA a "ninguém buscou nada". O extrato
    // foi sincronizado, o PDF foi salvo, e a tela não sabia dizer se o mês estava zerado ou parado.
    //
    // A declaração transmitida à Receita é a prova mais forte que existe de que o mês não teve
    // receita — mais forte que o checkbox do contador. Por isso `semFaturamentoPor: null`: quem
    // afirma aqui não é uma pessoa, é a declaração.
    //
    // ⚠ Só vale para o zerado TRANSMITIDO. O caminho `NOT_FOUND` (nenhuma declaração no período)
    // não passa por aqui de propósito — ali não existe declaração, e não há o que afirmar.
    const declaracaoZerada = !(Number(receitaBruta) > 0) && !(Number(dasTotal) > 0);
    let semFaturamento = null;
    if (declaracaoZerada) {
      // A recusa é RETORNO, não exceção: se houver nota emitida, a marcação não acontece e a
      // captura segue normal. O chip de guia já tem o estado `conflito` para essa situação — a tela
      // avisa, o sistema não afirma.
      semFaturamento = await marcarSemFaturamento({
        portalClientId: company.id,
        competencia: competenciaStorage,
        ok: true,
        userId: null,
        origem: "extrato_pgdas_zerado",
      }).catch((err) => ({ ok: false, error: "erro", message: err?.message }));

      if (!semFaturamento.ok) {
        // eslint-disable-next-line no-console
        console.warn("[PGDAS-D] extrato zerado NÃO marcou o mês como sem faturamento", {
          portalClientId: company.id, competencia: competenciaStorage, motivo: semFaturamento.error,
        });
        await prisma.companyMonthlyCircular.update({
          where: { id: finalCircular.id },
          data: {
            metadata: {
              ...(finalCircular.metadata && typeof finalCircular.metadata === "object" ? finalCircular.metadata : {}),
              semFaturamentoRecusado: { erro: semFaturamento.error, mensagem: semFaturamento.message, em: new Date().toISOString() },
            },
          },
        }).catch(() => null);
      }
    }

    return {
      company,
      circular: finalCircular,
      guide: guideResult.guide,
      guideFetchError: guideResult.error,
      accounting,
      semFaturamento,
      dados,
      dasIndex,
      files: {
        declaracaoFileId: declaracaoFile.id,
        reciboFileId: reciboFile?.id || null,
      },
    };
  } catch (error) {
    await prisma.companyMonthlyCircular.update({
      where: { id: circular.id },
      data: {
        serproSyncStatus: "ERROR",
        serproLastError: error?.message || "Erro ao sincronizar PGDAS-D.",
        serproLastSyncAt: new Date(),
      },
    });
    throw error;
  }
}
