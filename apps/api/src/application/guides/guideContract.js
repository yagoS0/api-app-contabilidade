export const GUIDE_TYPES = Object.freeze([
  "INSS",
  "FGTS",
  "PIS",
  "COFINS",
  "ISS",
  "SIMPLES",
  "DARF",   // DARF genérico — quando o PDF tem 2+ tributos federais distintos (ex: PIS+COFINS, IRPJ+CSLL)
  "IRPJ",   // tributos das empresas Presumidas (LUCRO_PRESUMIDO ou LUCRO_REAL)
  "CSLL",
  "OUTRA",
]);

export const GUIDE_STATUSES = Object.freeze([
  "PENDING",
  "PROCESSING",
  "PROCESSED",
  "NEEDS_REVIEW",
  "ERROR",
]);

/**
 * A guia é uma PARCELA de parcelamento?
 *
 * ⚠ Existe porque o `tipo` não responde isso. A parcela do Simples é gravada com `tipo:"SIMPLES"`
 * (`CaptureSerproParcelaService`), exatamente como o DAS do mês — o que separa as duas é o
 * `parcelamentoId`, carimbado por `ParcelamentoV2Service`. Quem esquece disso mostra a parcela como
 * se fosse o DAS da competência, e a empresa parece em dia com um DAS que nunca foi gerado (foi o
 * que aconteceu na ERISANGELA, em DUAS telas ao mesmo tempo).
 *
 * Uma parcela de INSS parcelado também cai aqui — por isso o rótulo do destino é "Parcelamento",
 * não "PARC DAS".
 */
export function isGuiaDeParcelamento(guide) {
  return Boolean(guide?.parcelamentoId);
}

/**
 * A MESMA pergunta acima, do lado do banco.
 *
 * ⚠ `isGuiaDeParcelamento` não roda dentro de uma query, então quem precisa filtrar acabava
 * escrevendo `parcelamentoId: { not: null }` (ou `: null`) na mão — foi assim que a regra ficou
 * reimplementada em cada consumidor e as telas começaram a discordar sobre a mesma guia. Estes dois
 * filtros existem para que o `where` também aponte para este arquivo, e não para uma cópia.
 */
export const WHERE_GUIA_DE_PARCELAMENTO = Object.freeze({ parcelamentoId: { not: null } });
export const WHERE_GUIA_SEM_PARCELAMENTO = Object.freeze({ parcelamentoId: null });

/**
 * "Esta guia ainda pode ser enviada?", do lado do banco.
 *
 * ⚠ **`emailStatus` NULL CONTA COMO PENDENTE**, e esquecer isso custou envio silenciosamente não
 * feito. A coluna é `String?` **sem `@default`**: guia que passa por `GuideService` nasce
 * `"PENDING"`, mas a DARF consolidada do Lucro Presumido é criada direto por
 * `LucroPresumidoProvisaoService` e nascia **NULL**.
 *
 * E `IN` do SQL **nunca casa com NULL**. Então `{ in: ["PENDING","ERROR"] }` excluía essa guia dos
 * anexos — enquanto a matriz do envio em lote a INCLUI e a oferece como pendente. O contador
 * clicava, a rota respondia `ok: true, sent: 0`, e a célula continuava "📄 guia". Clicar de novo
 * repetia o nada. **Sucesso reportado sobre trabalho não feito**, que é a pior forma do erro.
 *
 * Eram três leituras da mesma pergunta (o laço automático, a matriz e o envio em lote) e só uma
 * estava errada — exatamente o modo de falha que os filtros acima existem para impedir.
 *
 * @param {Date|null} [retryAntesDe] informado, guia em `ERROR` só entra se `emailNextRetryAt` já
 *   venceu. É a trava do laço AUTOMÁTICO. O envio manual **não** a usa, de propósito: quem clicou
 *   quer agora, e adiar sem dizer por quê seria o mesmo defeito com outra roupa.
 */
export function whereGuiaPendenteDeEnvio(retryAntesDe = null) {
  return {
    OR: [
      { emailStatus: null },
      { emailStatus: "PENDING" },
      retryAntesDe
        ? { emailStatus: "ERROR", emailNextRetryAt: { lte: retryAntesDe } }
        : { emailStatus: "ERROR" },
    ],
  };
}

/**
 * "A ÚLTIMA tentativa de envio desta guia FALHOU?"
 *
 * ⚠ Existe porque `ERROR` é um estado terminal na prática, e ninguém o trata como tal. O worker
 * grava `emailStatus:"ERROR"` + `emailLastError` + **`emailNextRetryAt`**, mas **nada drena esse
 * retry**: o laço automático foi removido na Q55 (`server.js`, "nada roda sozinho"). O campo é
 * escrito e apodrece. A guia fica em `ERROR` até alguém, por acaso, clicar de novo.
 *
 * Por isso a pergunta virou contrato: as telas onde o contador já olha (chip do dashboard, matriz
 * do envio em lote) pintavam `ERROR` **igual a `PENDING`** — âmbar "gerada, falta enviar", que é o
 * estado de quem nunca foi tentado. Falha indistinguível de "ainda não tentei" é ausência fazendo
 * as vezes de resposta.
 *
 * ⚠ **Falhou NÃO impede enviar de novo.** `whereGuiaPendenteDeEnvio()` (acima) continua alcançando
 * a guia em `ERROR` — a distinção é de EXIBIÇÃO, e o caminho de ação é o mesmo botão de sempre.
 */
export function envioDeEmailFalhou(guide) {
  return String(guide?.emailStatus || "").toUpperCase() === "ERROR";
}

/**
 * O que se precisa saber do parcelamento para NOMEAR a guia na tela.
 *
 * ⚠ Sem isto a resposta trazia `parcelamentoId` (coluna escalar da própria guia, sempre presente) e
 * nada mais: a UI sabia que era parcela mas não de qual acordo, caía no `tipo` da guia e imprimia
 * "SIMPLES" — o mesmo rótulo do DAS do mês, que é justamente o que o `parcelamentoId` existe para
 * desfazer. Quem carrega a guia para exibir carrega isto junto.
 */
export const SELECT_PARCELAMENTO_DA_GUIA = Object.freeze({
  id: true,
  tipo: true,
  numeroParcelamento: true,
  label: true,
});

/**
 * Coluna da matriz de guias (tela de envio em lote) para uma guia.
 *
 * Duas traduções, e as duas já foram esquecidas alguma vez:
 * - `SIMPLES` é o `tipo` gravado; a coluna se chama `DAS`;
 * - parcela vai para a coluna `PARC_DAS`, **antes** da tradução acima.
 */
export function colunaMatrizDaGuia(guide) {
  if (isGuiaDeParcelamento(guide)) return "PARC_DAS";
  const tipo = String(guide?.tipo || "").toUpperCase();
  return tipo === "SIMPLES" ? "DAS" : tipo;
}

export function normalizeGuideType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return GUIDE_TYPES.includes(normalized) ? normalized : "OUTRA";
}

export function normalizeCompetencia(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const yyyyMm = raw.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2]}`;

  const mmYyyy = raw.match(/^(\d{2})[\/-](\d{4})$/);
  if (mmYyyy) return `${mmYyyy[2]}-${mmYyyy[1]}`;

  const compact = raw.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  return null;
}

export function fileNameForGuide({ tipo, competencia }) {
  const safeType = normalizeGuideType(tipo);
  const comp = normalizeCompetencia(competencia);
  if (!comp) return `${safeType}.pdf`;
  const [yyyy, mm] = comp.split("-");
  return `${safeType} ${mm}-${yyyy}.pdf`;
}

