import { prisma } from "../../infrastructure/db/prisma.js";
import { SELECT_PARCELAMENTO_DA_GUIA } from "./guideContract.js";

// ⚠⚠ AS REGRAS PURAS SAÍRAM DAQUI EM 27/08/2026 e moram em `lib/recalculoDaGuia.js`.
//
// Elas sempre foram puras — `isGuideOverdue` decide se o SERPRO recebe `GERARDASCOBRANCA17` (DAS de
// cobrança, COM juros e multa) ou `GERARDAS12` —, mas viviam neste arquivo, que carrega o Prisma no
// topo. Resultado: nenhuma delas tinha um único teste, numa decisão que muda o valor a pagar.
//
// ⚠ A REEXPORTAÇÃO NÃO É COSMÉTICA: os cinco importadores (`GuideService`, `routes/firm/index.js`,
// `accountingEntries`, `SerproPaymentConfirmationService`, `SerproPgdasDeclaracaoService`) seguem
// importando daqui, sem uma linha de mudança. Trocar os imports em cinco arquivos junto com a
// extração misturaria refatoração e mudança de comportamento na mesma leitura.
export {
  getGuideDueDate,
  vencimentoDaGuia,
  isGuidePaid,
  isGuideOverdue,
  canGuideConfirmPayment,
  canGuideRecalculate,
  especieDoRecalculo,
  ESPECIE_RECALCULO,
  avisoDeRecalculo,
  leituraDosAcrescimos,
  ACRESCIMOS,
  PREFIXO_DARF_LP,
  traduzirRecusaParaCliente,
} from "./lib/recalculoDaGuia.js";

async function updateGuidePaymentStatus(guideId, data) {
  return prisma.guide.update({
    where: { id: String(guideId) },
    data,
    // A guia atualizada volta para a tela e substitui a linha da listagem. Sem o parcelamento junto,
    // confirmar o pagamento de uma PARCELA rebaixava o rótulo dela para o do DAS do mês — a linha
    // mudava de nome no clique, sem que nada tivesse mudado no banco.
    include: { parcelamento: { select: SELECT_PARCELAMENTO_DA_GUIA } },
  });
}

/**
 * ⚠⚠ `pagoEm` É O DIA EM QUE O DINHEIRO SAIU, E ELE PASSOU A SER PARÂMETRO EM 30/08/2026.
 *
 * > Dono: *"ao clicar em confirmar pagamento, o pagamento foi posto no dia 30 de agosto mesmo não
 * > sendo verdade."*
 *
 * Isto gravava `new Date()` — o instante do CLIQUE. E `paymentConfirmedAt` não é isso: é dele que
 * `FluxoDeCaixaService.linhasDasGuias` tira o **mês** e o **dia** da linha do fluxo.
 *
 * ⚠⚠ **E OS DOIS CHAMADORES JÁ TINHAM A DATA CERTA NA MÃO.** Em `routes/firm/index.js` havia uma
 * variável `dataPagamentoReal` — *"a da arrecadação quando confiável"* — **calculada e nunca
 * usada**; em `routes/firm/accountingEntries.js` é a `dataPagamento` que o contador digitou para
 * gerar a baixa. Medido antes do conserto: das 20 guias pagas com comprovante do SERPRO guardado,
 * **20 divergiam** da data real de arrecadação (`scripts/diag-data-do-pagamento.mjs`).
 *
 * ⚠⚠ **`pagoEm` NULO GRAVA `null`, e isso é deliberado.** Sem comprovante e sem data digitada,
 * ninguém sabe quando o dinheiro saiu — e a guia entra em `semMes` no fluxo, que é "pago, dia
 * desconhecido". Carimbar o relógio para "não deixar o campo vazio" foi exatamente o que produziu
 * as 20 datas erradas.
 *
 * @param {{guideId: string, userId: string, pagoEm?: Date|null}} p
 */
export async function markGuidePaidManual({ guideId, userId, pagoEm = null }) {
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "MANUAL",
    paymentConfirmedAt: pagoEm instanceof Date ? pagoEm : null,
    paymentConfirmedByUserId: String(userId),
    serproLastCheckResult: "MANUAL_CONFIRMED",
  });
}

/**
 * ⚠⚠ O CLIENTE CONFIRMA QUE PAGOU (decisão do dono, 27/08/2026).
 *
 * *"O cliente confirmar deve ser como a confirmação da consulta de pagamento"* — ou seja: marca a
 * guia e **para aí**. Quem faz a baixa contábil continua sendo o contador, pela Circular. A guarda
 * que garante isso é `pagamentoAlcancaOContabil`, em `GuideToProvisionService`.
 *
 * ⚠⚠ A AFIRMAÇÃO DO CLIENTE VAI EM COLUNAS PRÓPRIAS (`clienteConfirmouEm` /
 * `clienteConfirmouPorUserId`), e não nas de confirmação manual. Quando o SERPRO depois localizar o
 * comprovante, `markGuidePaidBySerpro` **zera** `paymentConfirmedAt`/`paymentConfirmedByUserId` —
 * corretamente, porque lá elas descrevem uma confirmação MANUAL que deixou de valer. Guardar a
 * afirmação do cliente ali a apagaria, e com ela o registro de quem disse o quê.
 *
 * ⚠ SEM COMPROVANTE (decisão do dono): o cliente confirma sem anexar. `comprovantePdfFileId` NÃO é
 * tocado — a prova continua vindo do SERPRO quando a consulta de pagamento rodar.
 */
/**
 * ⚠⚠ DOIS FATOS, DUAS DATAS — e eles estavam colapsados num só até 30/08/2026.
 *
 *  - `clienteConfirmouEm` é **quando ele clicou**. Continua sendo `agora`, e está certo.
 *  - `paymentConfirmedAt` é **quando o dinheiro saiu**, e só o cliente sabe. Vem por `pagoEm`.
 *
 * ⚠ O comentário antigo justificava o carimbo assim: *"deixá-lo nulo faria a linha aparecer paga
 * sem data"*. Era verdade e era o defeito — preencher um campo para ele não ficar vazio é fabricar
 * um fato, e este aqui decide em que dia o dinheiro aparece no fluxo do cliente.
 *
 * @param {{guideId: string, userId: string, pagoEm: Date}} p
 */
export async function markGuidePaidByCliente({ guideId, userId, pagoEm }) {
  const agora = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "CLIENTE",
    clienteConfirmouEm: agora,
    clienteConfirmouPorUserId: userId ? String(userId) : null,
    // ⚠⚠ A DATA DO PAGAMENTO É A INFORMADA, NUNCA `agora`. O que distingue esta confirmação de
    // uma prova continua sendo a PROCEDÊNCIA (`paymentStatusSource: "CLIENTE"`), e não a data.
    paymentConfirmedAt: pagoEm instanceof Date ? pagoEm : null,
    paymentConfirmedByUserId: userId ? String(userId) : null,
    serproLastCheckResult: "CLIENTE_CONFIRMOU",
  });
}

export async function markGuidePaidBySerpro({ guideId }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastCheckResult: "NOT_FOUND",
    paymentConfirmedAt: null,
    paymentConfirmedByUserId: null,
  });
}

// Q40: pagamento confirmado pelo comprovante oficial (PAGTOWEB/COMPARRECADACAO).
// Diferente de markGuidePaidBySerpro (que usa a heurística "sem débito = pago"): aqui o
// SERPRO devolveu o comprovante de arrecadação, então gravamos paymentConfirmedAt + o PDF.
export async function markGuidePaidByComprovante({ guideId, comprovantePdfFileId = null }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "PAID",
    paymentStatusSource: "SERPRO",
    paymentConfirmedAt: now,
    paymentConfirmedByUserId: null,
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: "COMPROVANTE_FOUND",
    ...(comprovantePdfFileId ? { comprovantePdfFileId } : {}),
  });
}

export async function markGuideOverdueBySerpro({ guideId }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "OVERDUE",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: "FOUND",
  });
}

/**
 * Guia continua EM ABERTO depois de uma consulta ao SERPRO.
 *
 * ⚠⚠ `checkResult` EXISTE PORQUE DUAS COISAS MUITO DIFERENTES CHAMAM ESTA FUNÇÃO, e até 20/08/2026
 * as duas gravavam a MESMA palavra — `"FOUND"`:
 *
 *   · o índice do PGDAS-D respondeu sobre a declaração e disse que o DAS **não consta pago**.
 *     Aí a Receita respondeu de fato, e `"FOUND"` descreve o que aconteceu;
 *   · o PAGTOWEB **não localizou** o comprovante. Aí não houve resposta nenhuma sobre o pagamento —
 *     e gravar `"FOUND"` registra, no banco e na tela, que o SERPRO ENCONTROU algo. Ele não
 *     encontrou. O contador lê esse valor cru na confirmação do próximo clique
 *     (`parcelaBusca.js`: "⚠ Esta guia já foi consultada em … (FOUND)").
 *
 * ⚠ AUSÊNCIA NÃO É PROVA DE NÃO-PAGAMENTO. Comprovante não localizado pode ser atraso de
 * processamento na Receita, número de documento errado, ou documento de outro tipo. Por isso a
 * distinção fica no REGISTRO — o `paymentStatus` continua `OPEN`, que é o estado em que a guia já
 * estava, e nada aqui marca inadimplência.
 */
export async function markGuideOpenBySerpro({ guideId, checkResult = "FOUND" }) {
  const now = new Date();
  return updateGuidePaymentStatus(guideId, {
    paymentStatus: "OPEN",
    paymentStatusSource: "SERPRO",
    serproLastCheckedAt: now,
    serproLastSeenAt: now,
    serproLastCheckResult: checkResult,
  });
}

/** O que se grava quando o PAGTOWEB não localizou o comprovante. Vocabulário do mock desde sempre. */
export const CHECK_RESULT_NAO_LOCALIZADO = "NAO_LOCALIZADO";
