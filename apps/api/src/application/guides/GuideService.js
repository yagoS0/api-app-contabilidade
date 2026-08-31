import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { GuideStorageService } from "./GuideStorageService.js";
import {
  fileNameForGuide,
  normalizeCompetencia,
  normalizeGuideType,
  SELECT_PARCELAMENTO_DA_GUIA,
  whereGuiaPendenteDeEnvio,
} from "./guideContract.js";
import { isMonthClosed } from "../accounting/fechamentoContabil.js";
import {
  canGuideConfirmPayment, canGuideRecalculate, isGuideOverdue, vencimentoDaGuia, avisoDeRecalculo,
  especieDoRecalculo,
} from "./GuidePaymentStatusService.js";

/** Para quem esta guia está sendo serializada. ⚠ Lista FECHADA, e o default é o mais estreito. */
export const PUBLICO = Object.freeze({
  CLIENTE: "CLIENTE",
  ESCRITORIO: "ESCRITORIO",
});
import { NAO_TENTADA, lerLinhaDigitavelDoPdf, situacaoDaLinhaDigitavel } from "./lerLinhaDigitavelDoPdf.js";

function normalizeCnpj(value) {
  return String(value || "").replace(/\D+/g, "");
}

export function hashPdf(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function buildStorageKey({ portalClientId, competencia, tipo, originalName }) {
  const comp = normalizeCompetencia(competencia) || "sem-competencia";
  const ext = String(originalName || "").toLowerCase().endsWith(".pdf") ? ".pdf" : ".pdf";
  return `guides/${portalClientId}/${comp}/${normalizeGuideType(tipo)}${ext}`;
}

export function buildUploadSourceFileId(hash) {
  const normalized = String(hash || "").trim();
  return normalized ? `upload:${normalized}` : null;
}

export function getFriendlyGuideMessage({ code, reason }) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const normalizedReason = String(reason || "").trim().toLowerCase();

  if (normalizedCode === "GUIDE_DUPLICATE_HASH" || normalizedReason === "duplicate_hash") {
    return "Esta guia já foi enviada anteriormente e foi identificada como duplicada.";
  }
  if (normalizedReason.includes("company_not_found_by_cnpj")) {
    return "Não encontramos uma empresa cadastrada para o CNPJ extraído desta guia.";
  }
  if (normalizedReason.includes("missing_required_parsed_fields")) {
    return "Não foi possível identificar todos os dados obrigatórios da guia, como competência, valor ou CNPJ.";
  }
  if (
    normalizedCode === "GUIDE_PARSER_NOT_CONFIGURED" ||
    normalizedCode === "PDF_READER_NOT_CONFIGURED"
  ) {
    return "O serviço de leitura de PDF (pdf-reader) não está configurado na API. Defina a variável PDF_READER_URL.";
  }
  if (normalizedCode === "PDF_READER_HTTP_ERROR") {
    return "O serviço de leitura de PDF não respondeu corretamente. Verifique se o pdf-reader está no ar e acessível pela API.";
  }
  if (normalizedCode === "GUIDE_STORAGE_KEY_REQUIRED" || normalizedCode === "GUIDE_STORAGE_BUFFER_REQUIRED") {
    return "A guia foi lida, mas houve uma falha ao preparar o arquivo para armazenamento.";
  }
  if (normalizedCode === "GUIDE_STORAGE_BUCKET_REQUIRED" || normalizedCode === "GUIDE_STORAGE_CREDENTIALS_REQUIRED") {
    return "A guia foi identificada, mas houve falha ao salvar o arquivo no storage.";
  }
  if (normalizedCode === "GUIDE_EMAIL_RECIPIENT_NOT_FOUND" || normalizedReason.includes("guide_email_recipient_not_found")) {
    return "A guia foi processada, mas não encontramos um e-mail válido para envio.";
  }
  if (normalizedCode === "GUIDE_EMAIL_SEND_ERROR" || normalizedReason.includes("smtp")) {
    return "A guia foi processada, mas o e-mail não pôde ser enviado.";
  }
  if (normalizedCode === "GUIDE_NOT_PROCESSED" || normalizedReason === "guide_not_processed") {
    return "A guia foi recebida, mas não conseguimos processá-la automaticamente.";
  }
  if (normalizedCode === "GUIDE_PROCESSING_ERROR") {
    return "Não foi possível concluir o processamento desta guia neste momento.";
  }
  return "Não foi possível identificar esta guia automaticamente.";
}

function getExtractedHash(extracted) {
  if (!extracted || typeof extracted !== "object") return null;
  return String(extracted.uploadHash || extracted.hash || "").trim() || null;
}

export function buildCompanyFolderName({ razao, cnpj }) {
  const cleanRazao = String(razao || "EMPRESA")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ");
  const digits = normalizeCnpj(cnpj);
  return `${cleanRazao} - ${digits}`;
}

export async function findPortalClientByCnpj(cnpj) {
  const digits = normalizeCnpj(cnpj);
  if (!digits) return null;
  return prisma.portalClient.findFirst({
    where: { cnpj: digits },
    select: { id: true, razao: true, cnpj: true, companyId: true },
  });
}

/** PDF da guia: coluna `pdfBytes` no banco ou storage legado (S3/R2/local). */
export async function getGuidePdfBuffer(guide) {
  if (!guide) return null;
  const raw = guide.pdfBytes;
  if (raw != null && raw.length) {
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  }
  if (guide.storageKey) {
    const storage = GuideStorageService.create();
    return storage.downloadBuffer({ key: guide.storageKey });
  }
  return null;
}

export async function listGuidesByCompany({
  portalClientId,
  competencia,
  status,
  page = 1,
  limit = 25,
  // Portal Cliente (#3.1): quando true, retorna SÓ guias liberadas ao cliente (usado pelo /client).
  apenasLiberadas = false,
  /**
   * ⚠⚠ QUEM VAI LER ESTA LISTA — e desde 30/08/2026 isso muda o VALOR mostrado.
   *
   * O default é o público MAIS ESTREITO, como em `toGuideResponse` e pelo mesmo motivo: chamador
   * novo que esquecer o parâmetro perde o enriquecimento do contador (visível e barato de
   * consertar), em vez de mostrar material de trabalho dele ao cliente.
   */
  publico = PUBLICO.CLIENTE,
}) {
  const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;
  const where = {
    portalClientId: String(portalClientId),
    ...(competencia ? { competencia: normalizeCompetencia(competencia) } : {}),
    ...(status ? { status: String(status).toUpperCase() } : {}),
    ...(apenasLiberadas ? { liberadaCliente: true } : {}),
  };
  const [rawItems, total] = await prisma.$transaction([
    prisma.guide.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      // Q24: traz a relação de parcelamento pra rotular a guia como parcelamento (não "DAS").
      include: { parcelamento: { select: SELECT_PARCELAMENTO_DA_GUIA } },
    }),
    prisma.guide.count({ where }),
  ]);

  /**
   * ⚠⚠ O ENRIQUECIMENTO DO DAS — e ele tem DUAS exclusões, as duas conquistadas por defeito.
   *
   * Para guias do SIMPLES, o valor MOSTRADO ao contador é o do extrato PGDAS-D
   * (`CompanyMonthlyCircular.dasTotal`, imutável após a 1ª captura), não o do PDF de cobrança —
   * que pode ter sido recalculado pelo SERPRO com juros e multa. O valor de cobrança fica em
   * `valorRecalculado`, para o badge "↻".
   *
   * ## ⚠⚠ EXCLUSÃO 1 — A PARCELA DE PARCELAMENTO NÃO É DAS (30/08/2026)
   *
   * > Dono, com o print na tela: *"há um bug entre o valor da parcela e o do Simples Nacional (…)
   * > aparece como se o parcelamento fosse uma retificada do Simples Nacional, o que não é verdade;
   * > o único valor que deveria aparecer ali é o de 323,83."*
   *
   * ⚠⚠ **A PARCELA É GRAVADA COMO `tipo: "SIMPLES"`, IDÊNTICA AO DAS** — só `parcelamentoId` as
   * separa. Sem esta exclusão ela pegava o `dasTotal` do mês e a tela mostrava o DAS no lugar da
   * parcela, com o badge "↻" e um `title` afirmando *"guia recalculada pelo SERPRO"*: uma afirmação
   * falsa sobre documento fiscal, e ela chegava ao CLIENTE.
   *
   * ⚠ Medido antes do conserto: 3 parcelas, **todas liberadas ao cliente** — ERISANGELA 06 e
   * 07/2026 (R$ 323,83 aparecendo como R$ 1.441,25 e R$ 1.437,15) e ALESSANDRO NIGRO 07/2026
   * (R$ 332,65 como R$ 1.954,87).
   *
   * ⚠ A regra JÁ EXISTIA nesta casa e este ponto é que não a seguia: `rotuloGuia` diz, com todas as
   * letras, que **o parcelamento decide ANTES do tipo** — senão a parcela apareceria como o DAS.
   *
   * ## ⚠⚠ EXCLUSÃO 2 — O CLIENTE PRECISA SABER QUANTO PAGAR
   *
   * O enriquecimento nasceu para a tela do CONTADOR (a frase original dizia isso: *"o valor mostrado
   * ao contador"*), e o cliente passou a ler a mesma lista quando a aba de guias abriu, em
   * 30/08/2026. Para ele a pergunta é outra: **quanto eu pago?** — e a resposta é o valor da GUIA,
   * não o do extrato, que numa guia recalculada é MENOR do que ele deve.
   *
   * ⚠ Mas o extrato **continua preenchendo o vazio**: guia sem valor lido do PDF (medido: 36 na
   * carteira, quase todas com `valor: 0,00`) mostraria `R$ 0,00` ao cliente, que é afirmar que ele
   * não deve nada. Ali o extrato é o único número que existe, e ele É o DAS do mês.
   * ⚠⚠ E o cliente **não recebe `valorRecalculado`**: os dois valores em conflito são material de
   * trabalho do contador. É a mesma regra que a linha digitável já segue neste projeto — *"o cliente
   * não vê os dois valores da divergência"*.
   */
  const ehParcela = (g) => Boolean(g?.parcelamentoId);
  const ehDasDoMes = (g) => String(g?.tipo || "").toUpperCase() === "SIMPLES" && !ehParcela(g);
  const paraOEscritorio = String(publico).toUpperCase() === PUBLICO.ESCRITORIO;

  const simplesCompetencias = [
    ...new Set(rawItems.filter((g) => ehDasDoMes(g) && g.competencia).map((g) => g.competencia)),
  ];
  let circularByComp = new Map();
  if (simplesCompetencias.length > 0) {
    const circulars = await prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: String(portalClientId), competencia: { in: simplesCompetencias } },
      select: { competencia: true, dasTotal: true },
    });
    circularByComp = new Map(circulars.map((c) => [c.competencia, c]));
  }
  const items = rawItems.map((g) => {
    // ⚠⚠ A PARCELA SAI AQUI, antes de qualquer conta. O valor dela é o dela.
    if (!ehDasDoMes(g)) return g;
    const circ = circularByComp.get(g.competencia);
    const extratoValor = circ?.dasTotal != null ? Number(circ.dasTotal) : null;
    const guideOriginal = g.valorOriginal != null ? Number(g.valorOriginal) : null;
    const valorOriginal = extratoValor != null ? extratoValor : guideOriginal;
    const valorAtual = g.valor != null ? Number(g.valor) : null;
    if (valorOriginal == null) return g; // sem fonte de truth; mantém o valor do PDF

    if (!paraOEscritorio) {
      // ⚠⚠ CLIENTE: o valor da GUIA vence — é o que ele paga. O extrato só preenche o VAZIO, e
      // "vazio" inclui o zero: `R$ 0,00` numa guia afirma que não se deve nada.
      // ⚠ Sem `valorRecalculado`: os dois valores em conflito são do contador.
      const temValorProprio = valorAtual != null && Math.abs(valorAtual) > 0.009;
      return temValorProprio ? g : { ...g, valor: valorOriginal };
    }

    const recalculado = valorAtual != null && Math.abs(valorAtual - valorOriginal) > 0.01;
    return {
      ...g,
      // Sobrescreve o valor exibido para o original do extrato; valorRecalculado fica disponível pra badge
      valor: valorOriginal,
      valorRecalculado: recalculado ? valorAtual : null,
    };
  });

  return { items, total, page: pageNum, limit: take };
}

export async function listPendingGuidesReport({
  portalClientId,
  portalClientIds,
  competencia,
  emailStatus,
  page = 1,
  limit = 25,
}) {
  const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;
  const normalizedCompetencia = normalizeCompetencia(competencia);
  const normalizedEmailStatus = emailStatus ? String(emailStatus).toUpperCase() : null;
  // ⚠ A QUARTA CÓPIA DA MESMA PERGUNTA — e ela ficou para trás.
  //
  // `{ OR: [PENDING, ERROR, SENDING] }` tinha exatamente o defeito que o commit a61649d0 corrigiu
  // no worker e no envio em lote: **não alcança `emailStatus: null`**, e a DARF consolidada do
  // Lucro Presumido nasce NULL (`LucroPresumidoProvisaoService`, coluna `String?` sem `@default`).
  // Resultado: a única página do sistema que mostra o MOTIVO da falha de envio nunca listou as
  // guias do LP. Aqui o `IN` nem era o culpado — a lista foi escrita à mão, o que é a mesma coisa.
  //
  // A regra vem do `guideContract`. `SENDING` entra POR CIMA dela, e só nesta tela: as outras
  // consultas excluem `SENDING` de propósito (pegá-la duplicaria o e-mail em voo), mas aqui a
  // pergunta é de DIAGNÓSTICO — uma guia presa em `SENDING` por um processo morto é invisível para
  // todo o resto do sistema, e este é o único lugar onde ela pode aparecer.
  const pendingEmailFilter = normalizedEmailStatus
    ? { emailStatus: normalizedEmailStatus }
    : { OR: [...whereGuiaPendenteDeEnvio().OR, { emailStatus: "SENDING" }] };
  const where = {
    status: "PROCESSED",
    ...(portalClientId ? { portalClientId: String(portalClientId) } : {}),
    ...(Array.isArray(portalClientIds) && portalClientIds.length
      ? { portalClientId: { in: portalClientIds.map((id) => String(id)) } }
      : {}),
    ...(normalizedCompetencia ? { competencia: normalizedCompetencia } : {}),
    ...pendingEmailFilter,
  };
  const [items, total] = await prisma.$transaction([
    prisma.guide.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        portalClient: {
          select: {
            id: true,
            razao: true,
            cnpj: true,
          },
        },
        // A parcela é `tipo:"SIMPLES"` como o DAS do mês: sem o parcelamento, esta listagem
        // apresentava as duas com o mesmo nome.
        parcelamento: { select: SELECT_PARCELAMENTO_DA_GUIA },
      },
    }),
    prisma.guide.count({ where }),
  ]);
  return { items, total, page: pageNum, limit: take };
}

/**
 * ⚠⚠ ESTE SERIALIZER SERVE OS DOIS PORTAIS. `routes/client/index.js` o usa para a listagem do
 * CLIENTE e `routes/firm/index.js` para a do ESCRITÓRIO — e isso não é óbvio olhando qualquer um
 * dos dois arquivos.
 *
 * ⚠⚠ POR ISSO `publico` DEFAULTA PARA `"CLIENTE"`, o público MAIS ESTREITO. O aviso de recálculo
 * diz, para o escritório, *"cada recálculo é uma chamada PAGA ao SERPRO, contra o teto mensal do
 * escritório"* — orçamento interno que não é assunto do cliente. Com o default no lado largo, um
 * chamador novo que esquecesse o parâmetro VAZARIA; com o default no estreito, ele perde a frase do
 * custo, que é visível e barato de consertar. Falha para o lado seguro.
 */
export function toGuideResponse(item, { publico = PUBLICO.CLIENTE } = {}) {
  const now = new Date();
  return {
    guideId: item.id,
    companyId: item.portalClientId,
    competencia: item.competencia || null,
    tipo: item.tipo,
    valor: item.valor ? Number(item.valor) : null,
    valorRecalculado: item.valorRecalculado != null ? Number(item.valorRecalculado) : null,
    vencimento: item.vencimento ? new Date(item.vencimento).toISOString() : null,
    status: item.status,
    emailStatus: item.emailStatus || null,
    emailLastError: item.emailLastError || null,
    paymentStatus: item.paymentStatus || "OPEN",
    paymentStatusSource: item.paymentStatusSource || null,
    paymentConfirmedAt: item.paymentConfirmedAt ? new Date(item.paymentConfirmedAt).toISOString() : null,
    serproLastCheckedAt: item.serproLastCheckedAt ? new Date(item.serproLastCheckedAt).toISOString() : null,
    serproLastCheckResult: item.serproLastCheckResult || null,
    serproService: item.serproService || null,
    canConfirmPayment: canGuideConfirmPayment(item),
    canRecalculate: canGuideRecalculate(item, now),
    // ⚠ A ESPÉCIE desce pronta: `tipo: "OUTRA"` + SERPRO é a DARF do LP **e** a guia de INSS, e
    // uma leitura por tipo na tela mandaria uma para o caminho da outra.
    especieRecalculo: especieDoRecalculo(item),
    // ⚠⚠ A TELA NÃO SABIA O QUE ERA "VENCIDA" — medido: zero ocorrências de `isGuideOverdue` no
    // front, e `OVERDUE` só num mapa de rótulo. O contador clicava em Recalcular sem saber que ia
    // receber uma guia NOVA, com juros e multa. O veredito é do BACKEND (é ele que escolhe entre
    // `GERARDASCOBRANCA17` e `GERARDAS12`) e desce pronto — a tela não o recalcula.
    vencida: isGuideOverdue(item, now),
    // ⚠⚠ E A DATA PODE SER DERIVADA: sem `Guide.vencimento`, a regra assume o dia 20 do mês
    // seguinte. Sem esta marca a tela diria "venceu em 20/07" sobre uma data que ninguém registrou.
    vencimentoEstimado: vencimentoDaGuia(item, now).derivado,
    // ⚠ O texto do aviso vem PRONTO daqui, e os dois portais leem o mesmo. Escrito em cada tela,
    // eles divergiriam na primeira correção — e este é o aviso que precede um gasto e um valor maior.
    avisoDeRecalculo: avisoDeRecalculo({ guide: item, now, ehCliente: publico !== PUBLICO.ESCRITORIO }),
    /**
     * ⚠⚠ SE O CONTADOR JÁ LIBEROU ESTA GUIA (30/08/2026).
     *
     * Ele desce porque a lista do cliente **parou de filtrar** por este campo (dono: *"INSS e
     * parcelamento não aparecem"*), enquanto **download, recálculo e confirmação continuam
     * exigindo `true`**. Sem o campo na resposta, a tela ofereceria um botão "Baixar PDF" que
     * responde 404 — e botão impossível é pior que ausência, regra escrita desta casa.
     *
     * ⚠ `Boolean(...)`, nunca o valor cru: a coluna é anulável, e `null` na tela cairia em
     * "não liberada" por coerção — que é o que se quer, mas por acidente. Aqui é por decisão.
     * ⚠ O ESCRITÓRIO já lia este estado por outro caminho; o que muda é ele existir no contrato
     * do CLIENTE.
     */
    liberadaCliente: Boolean(item.liberadaCliente),
    // Q24: vínculo de parcelamento (pra UI rotular a guia como parcelamento, não "DAS").
    parcelamentoId: item.parcelamentoId || null,
    numeroParcela: item.numeroParcela != null ? Number(item.numeroParcela) : null,
    // ⚠ Sem o TOTAL, "parcela 3" não diz se o acordo está no começo ou acabando — que é a única
    // leitura útil do número. O campo já era gravado (`ParcelamentoV2Service`) e só não saía daqui.
    quantidadeParcelas: item.quantidadeParcelas != null ? Number(item.quantidadeParcelas) : null,
    anoMesParcela: item.anoMesParcela || null,
    baixada: Boolean(item.baixada),
    parcelaEstado: item.parcelaEstado || null, // Q28 Fase 3
    parcelamentoLabel: item.parcelamento?.label || null,
    parcelamentoTipo: item.parcelamento?.tipo || null,
    parcelamentoNumero: item.parcelamento?.numeroParcelamento || null,
    // C5: composição por tributo. O Lucro Presumido vem como UMA DARF consolidada (`tipo:"OUTRA"`,
    // não pode ser split), e a UI rotula a guia pelos impostos contidos ("PIS · COFINS") em vez de
    // "OUTRA" — mas só consegue se a composição chegar aqui. Expomos SÓ a composição (não o
    // `extracted` inteiro, que carrega rawPayload da integração).
    extracted: Array.isArray(item.extracted?.composicao)
      ? { composicao: item.extracted.composicao }
      : null,
    // LINHA DIGITÁVEL — o número que o cliente digita no banco para pagar.
    //
    // ⚠ A AUSÊNCIA É RESPOSTA, E TEM TRÊS SIGNIFICADOS DIFERENTES. Por isso `linhaDigitavel: null`
    // sozinho não serve de contrato: `linhaDigitavelSituacao` é que diz se ninguém tentou ler, se o
    // documento não traz linha legível, ou se lemos e o número DISCORDA da guia. As três pedem
    // frases diferentes na tela, e a terceira precisa chegar com os dois valores.
    //
    // ⚠ Vai nos 48 DÍGITOS LIMPOS, sem máscara: é o que se digita no banco. A máscara é decisão de
    // apresentação e mora no front — mandá-la daqui obrigaria cada tela a desfazer a formatação
    // antes de copiar, que é exatamente onde um dígito se perde.
    linhaDigitavel: item.linhaDigitavel || null,
    linhaDigitavelSituacao: situacaoDaLinhaDigitavel(item),
    linhaDigitavelMotivo: item.linhaDigitavelMotivo || null,
    // Centavos INTEIROS, não reais: valor monetário não atravessa a rede como float.
    linhaDigitavelValorLidoCentavos:
      item.linhaDigitavelValorLidoCentavos != null ? Number(item.linhaDigitavelValorLidoCentavos) : null,
    linhaDigitavelLidaEm: item.linhaDigitavelLidaEm ? new Date(item.linhaDigitavelLidaEm).toISOString() : null,
    // Portal Cliente (#3.1): liberação ao cliente (selo no contador + gate no /client).
    liberadaCliente: Boolean(item.liberadaCliente),
    liberadaEm: item.liberadaEm ? new Date(item.liberadaEm).toISOString() : null,
    // Auditoria do "sem movimento" (status VAZIO). Sai no contrato porque a tela mostra quem
    // afirmou e quando — marcar vazio é declaração fiscal, e declaração sem autor não se audita.
    vazioEm: item.vazioEm ? new Date(item.vazioEm).toISOString() : null,
    vazioPor: item.vazioPor || null,
    vazioMotivo: item.vazioMotivo || null,
    createdAt: item.createdAt?.toISOString?.() || null,
    updatedAt: item.updatedAt?.toISOString?.() || null,
  };
}

export function toPendingGuideReportItem(item) {
  return {
    guideId: item.id,
    companyId: item.portalClientId || null,
    companyName: item.portalClient?.razao || null,
    cnpj: item.portalClient?.cnpj || item.cnpj || null,
    tipo: item.tipo || null,
    competencia: item.competencia || null,
    valor: item.valor ? Number(item.valor) : null,
    vencimento: item.vencimento ? new Date(item.vencimento).toISOString() : null,
    status: item.status || null,
    // Mesmos campos de parcelamento do `toGuideResponse`: as duas listagens usam o MESMO helper de
    // rótulo no front, e um contrato pela metade faria a parcela voltar a se chamar "SIMPLES" aqui.
    parcelamentoId: item.parcelamentoId || null,
    numeroParcela: item.numeroParcela != null ? Number(item.numeroParcela) : null,
    quantidadeParcelas: item.quantidadeParcelas != null ? Number(item.quantidadeParcelas) : null,
    parcelamentoTipo: item.parcelamento?.tipo || null,
    parcelamentoNumero: item.parcelamento?.numeroParcelamento || null,
    emailStatus: item.emailStatus || null,
    emailAttempts: Number(item.emailAttempts || 0),
    emailLastError: item.emailLastError || null,
    updatedAt: item.updatedAt?.toISOString?.() || null,
  };
}

export function toUnidentifiedGuideResponse(item) {
  const extracted = item?.extracted && typeof item.extracted === "object" ? item.extracted : {};
  const firstError =
    Array.isArray(item?.errors) && item.errors.length && item.errors[0] && typeof item.errors[0] === "object"
      ? item.errors[0]
      : null;
  const code = firstError?.code || "GUIDE_NOT_PROCESSED";
  const reason = firstError?.reason || item?.status || "guide_not_processed";
  return {
    guideId: item.id,
    fileName: item.sourcePath || null,
    hash: getExtractedHash(extracted),
    cnpj: item.cnpj || null,
    competencia: item.competencia || null,
    tipo: item.tipo || null,
    valor: item.valor ? Number(item.valor) : null,
    vencimento: item.vencimento ? new Date(item.vencimento).toISOString() : null,
    status: item.status || null,
    code,
    reason,
    message: firstError?.message || getFriendlyGuideMessage({ code, reason }),
    rawTextSample: extracted.rawTextSample || null,
    fields: extracted.fields && typeof extracted.fields === "object" ? extracted.fields : {},
    createdAt: item.createdAt?.toISOString?.() || null,
    updatedAt: item.updatedAt?.toISOString?.() || null,
  };
}

export async function createOrUpdateGuideFromProcessing({
  existingGuideId = null,
  portalClientId,
  legacyCompanyId,
  parsed,
  source,
  sourceFileId,
  sourcePath,
  driveInboxFolderId,
  driveFinalFolderId,
  driveFinalFileId,
  storageProvider,
  storageKey,
  storageUrl,
  pdfBytes: pdfBytesInput,
  hash,
  status,
  errors,
  extracted,
  paymentStatus,
  paymentStatusSource,
  paymentConfirmedAt,
  paymentConfirmedByUserId,
  serproLastCheckedAt,
  serproLastCheckResult,
  serproLastSeenAt,
  serproService,
  // Override do email status. Valores aceitos:
  //   - "PRESERVE": mantém o emailStatus atual da guia (lê do existing antes de update).
  //                 Útil em re-fetches silenciosos (não quer reenviar).
  //   - "PENDING" (string): força reset para PENDING (causa reenvio pelo email worker).
  //   - undefined (default): comportamento legado — sempre PENDING para PROCESSED, null caso contrário.
  emailStatusOverride,
}) {
  // Q18: bloqueia upload/registro MANUAL de guia em mês fechado (fechamento contábil).
  // Não afeta a captura automática do SERPRO (source="SERPRO").
  const _compGuard = normalizeCompetencia(parsed?.competencia);
  if (
    String(source || "").toUpperCase() !== "SERPRO"
    && portalClientId && _compGuard
    && (await isMonthClosed(portalClientId, _compGuard))
  ) {
    const err = new Error("Mês fechado — reabra a empresa para subir guias desta competência.");
    err.code = "MES_FECHADO";
    throw err;
  }

  const hasDbPdf =
    pdfBytesInput !== undefined &&
    Buffer.isBuffer(pdfBytesInput) &&
    pdfBytesInput.length > 0;

  // Se "PRESERVE", busca o emailStatus atual da guia para manter o estado de envio
  let preservedEmail = null;
  if (emailStatusOverride === "PRESERVE" && existingGuideId) {
    const current = await prisma.guide.findUnique({
      where: { id: String(existingGuideId) },
      select: { emailStatus: true, emailSentAt: true, emailAttempts: true, emailLastError: true, emailNextRetryAt: true },
    });
    preservedEmail = current || null;
  }

  let resolvedEmailStatus;
  if (emailStatusOverride === "PRESERVE" && preservedEmail) {
    resolvedEmailStatus = preservedEmail.emailStatus;
  } else if (typeof emailStatusOverride === "string" && emailStatusOverride !== "PRESERVE") {
    resolvedEmailStatus = emailStatusOverride;
  } else {
    resolvedEmailStatus = status === "PROCESSED" ? "PENDING" : null;
  }

  const data = {
    portalClientId: portalClientId ? String(portalClientId) : null,
    legacyCompanyId: legacyCompanyId ? String(legacyCompanyId) : null,
    competencia: normalizeCompetencia(parsed?.competencia),
    tipo: normalizeGuideType(parsed?.tipo),
    valor: Number.isFinite(Number(parsed?.valor)) ? Number(parsed.valor) : null,
    vencimento: parsed?.vencimento ? new Date(parsed.vencimento) : null,
    cnpj: normalizeCnpj(parsed?.cnpj),
    source: source || "UPLOAD",
    sourceFileId: sourceFileId || null,
    sourcePath: sourcePath || null,
    driveInboxFolderId: driveInboxFolderId || null,
    driveFinalFolderId: driveFinalFolderId || null,
    driveFinalFileId: driveFinalFileId || null,
    // Hash só é persistido para guias finalizadas em PROCESSED.
    hash: status === "PROCESSED" ? hash || null : null,
    status: status || "PENDING",
    emailStatus: resolvedEmailStatus,
    emailAttempts: preservedEmail ? preservedEmail.emailAttempts : 0,
    emailLastError: preservedEmail ? preservedEmail.emailLastError : null,
    emailSentAt: preservedEmail ? preservedEmail.emailSentAt : null,
    emailNextRetryAt: preservedEmail ? preservedEmail.emailNextRetryAt : null,
    errors: errors || [],
    extracted: extracted || parsed || {},
    paymentStatus: paymentStatus || "OPEN",
    paymentStatusSource: paymentStatusSource || null,
    paymentConfirmedAt: paymentConfirmedAt || null,
    paymentConfirmedByUserId: paymentConfirmedByUserId ? String(paymentConfirmedByUserId) : null,
    serproLastCheckedAt: serproLastCheckedAt || null,
    serproLastCheckResult: serproLastCheckResult || null,
    serproLastSeenAt: serproLastSeenAt || null,
    serproService: serproService || null,
  };

  if (pdfBytesInput !== undefined) {
    data.pdfBytes = hasDbPdf ? pdfBytesInput : null;
    if (hasDbPdf) {
      data.storageProvider = "DATABASE";
      data.storageKey = null;
      data.storageUrl = null;
    } else {
      data.storageProvider = storageProvider || null;
      data.storageKey = storageKey || null;
      data.storageUrl = storageUrl || null;
    }
  } else if (!existingGuideId) {
    data.storageProvider = storageProvider || null;
    data.storageKey = storageKey || null;
    data.storageUrl = storageUrl || null;
  }

  // LINHA DIGITÁVEL — lida AQUI, no funil, e não na leitura da tela.
  //
  // POR QUE NESTE PONTO, e não em outro:
  //   • Este é o ÚNICO funil por onde passa guia COM PDF: os três caminhos de upload
  //     (`GuideUploadService`) e os três de captura SERPRO (`CaptureSerproGuidesService`,
  //     `CaptureSerproParcelaService`, `SerproDctfwebService`) todos desembocam aqui.
  //   • O PDF JÁ ESTÁ EM MEMÓRIA — acabou de ser recebido ou baixado. Ler na tela obrigaria a
  //     buscar o BYTEA e reparsear o PDF a cada request de listagem.
  //   • A conferência de valor usa `data.valor`, o MESMO número gravado nesta operação. Não existe
  //     janela entre conferir e gravar: o par (linha, valor) nasce coerente por construção. Ler
  //     depois abriria a possibilidade de conferir contra um valor que já mudou.
  //
  // ⚠ Só mexe nas colunas quando o PDF é tocado. `pdfBytesInput === undefined` significa "esta
  // operação não fala do arquivo" (confirmação de pagamento, liberação, e-mail) — e sobrescrever a
  // leitura ali apagaria um número válido por causa de um update que nada tem a ver com ele.
  if (pdfBytesInput !== undefined) {
    if (hasDbPdf) {
      Object.assign(
        data,
        await lerLinhaDigitavelDoPdf(pdfBytesInput, { valorTotal: data.valor, vencimento: data.vencimento }),
      );
    } else {
      // O PDF saiu. Manter a leitura antiga descreveria um arquivo que não está mais aqui.
      Object.assign(data, NAO_TENTADA);
    }
  }

  let savedGuide;
  if (existingGuideId) {
    // valorOriginal NÃO é incluído no update — preservado da 1ª captura mesmo se SERPRO recalcular.
    savedGuide = await prisma.guide.update({
      where: { id: String(existingGuideId) },
      data,
    });
  } else {
    // Na criação, valorOriginal = valor (mesmo número da 1ª captura, imutável depois).
    savedGuide = await prisma.guide.create({
      data: {
        ...data,
        valorOriginal: data.valor,
      },
    });
  }

  // Hook Q5: toda guia PROCESSED gera AccountingEntry tipo=PROVISAO (best-effort, não bloqueante).
  // INSS e SIMPLES são pulados pelo service (decisões do usuário).
  if (savedGuide?.status === "PROCESSED" && savedGuide?.portalClientId) {
    try {
      const { generateProvisionsFromGuide } = await import("../accounting/GuideToProvisionService.js");
      await generateProvisionsFromGuide({ guideId: savedGuide.id });
    } catch (provErr) {
      // Não derruba o fluxo principal — gerar entry é melhoria, não pré-requisito.
      // eslint-disable-next-line no-console
      console.warn("[GuideToProvision] Falha ao gerar provisão a partir da guia", savedGuide.id, provErr?.message || provErr);
    }
  }

  return savedGuide;
}

export function buildGuideFinalFileName(parsed) {
  return fileNameForGuide({
    tipo: parsed?.tipo,
    competencia: normalizeCompetencia(parsed?.competencia),
  });
}
