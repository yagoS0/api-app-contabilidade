/**
 * A SAÍDA AVULSA QUE O CLIENTE PLANEJOU — escrever, listar, decidir e apagar.
 *
 * > Dono, 29/08/2026: *"o cliente pode modificar as saídas, podendo colocar novas saídas, apenas
 * > para visualização deles (…) e essas saídas que o cliente digitar aparece para o contador na aba
 * > de conferência."*
 *
 * ⚠⚠ **ISTO NÃO É CONTABILIDADE, E A DISTINÇÃO É A INVARIANTE Nº 1 DOS DECLARADOS.**
 * `LancamentoDeclarado` em `A_CONFERIR` **exige `dataPagamento`**, porque o lançamento que sai de lá
 * é `D despesa / C caixa` — ele AFIRMA que o dinheiro saiu. Uma saída planejada para o mês que vem
 * não saiu de lugar nenhum. Encaixá-la ali obrigaria a afrouxar a guarda que protege o caixa
 * inteiro, e é por isso que esta tabela existe em vez de reusar aquela.
 *
 * ⚠ **Confirmar aqui NÃO lança nada.** Confirmar põe a linha no FLUXO do cliente; levar ao razão
 * continua sendo o caminho do declarado, com data de pagamento e prova.
 *
 * ⚠ O que se REPETE não mora aqui: vira `SerieRecorrente` com `origem: DECLARADA`
 * (`SerieRecorrenteService.declararSerie`). Esta tabela guarda DATA; aquela guarda CICLO.
 */

import { prisma } from "../../infrastructure/db/prisma.js";
// ⚠⚠ A FORMA DO LANÇAMENTO É A MESMA DO DECLARADO, e isto é reuso, não conveniência: `montarLancamento`
// já carrega TODAS as guardas do razão (conta fora do plano, ambígua, sintética, caixa torto) e a
// invariante `D despesa / C caixa`. Uma segunda forma divergiria na primeira correção, e a que
// ninguém abre é a que erra.
import { montarLancamento } from "../declarados/lib/formaDoLancamento.js";
import { carregarPlano } from "../accounting/AliquotaPorLancamentosService.js";
import { isMonthClosed } from "../accounting/fechamentoContabil.js";
import { competenciaDaData } from "./lib/fluxoDeCaixa.js";

const texto = (v) => String(v ?? "").trim();

/**
 * ⚠ A MESMA GRAMÁTICA DE ESTADO DA SÉRIE DECLARADA, de propósito: as duas caem na mesma fila do
 * contador, e um segundo vocabulário faria a fila falar duas línguas sobre a mesma decisão.
 */
export const ESTADO_DA_SAIDA = Object.freeze({
  PENDENTE: "PENDENTE",
  CONFIRMADA: "CONFIRMADA",
  RECUSADA: "RECUSADA",
  /**
   * ⚠⚠ VIROU LANÇAMENTO CONTÁBIL — decisão do dono, 01/09/2026.
   *
   * > *"alguma coisa só aparecem para o fluxo, não me dando opção de colocar como lançamentos"* …
   * > *"tudo que virar lançamento deve entrar no fluxo, mas nem tudo do fluxo necessariamente deve
   * > ser um lançamento"*.
   *
   * ⚠ Ela NÃO substitui `CONFIRMADA`: confirmar põe a previsão no fluxo, lançar leva ao razão. E a
   * saída lançada **continua no fluxo** — ver `accountingEntryId` no schema.
   */
  LANCADA: "LANCADA",
});

export const RECUSA_DA_SAIDA = Object.freeze({
  DATA_INVALIDA: "data_invalida",
  VALOR_INVALIDO: "valor_invalido",
  SEM_DESCRICAO: "sem_descricao",
  ESTADO_INVALIDO: "estado_invalido",
  SEM_MOTIVO: "sem_motivo",
  NAO_ENCONTRADA: "saida_nao_encontrada",
  JA_DECIDIDA: "saida_ja_decidida",
  INDISPONIVEL: "saidas_indisponiveis",
  /** ⚠ Idempotência: a saída já tem lançamento. Um segundo seria despesa em dobro no razão. */
  JA_LANCADA: "saida_ja_lancada",
  /**
   * ⚠⚠ A DATA AINDA NÃO CHEGOU — e esta é a guarda que protege a invariante do caixa.
   *
   * O lançamento é `D despesa / C caixa` **na data da saída**: ele AFIRMA que o dinheiro saiu
   * naquele dia. Uma saída planejada para o mês que vem não saiu de lugar nenhum, e lançá-la hoje
   * gravaria uma afirmação falsa sobre o caixa — em silêncio, que é o pior modo.
   */
  DATA_FUTURA: "saida_com_data_futura",
  /** O mês está fechado: lançar ali escreveria sem rastro de reabertura. */
  MES_FECHADO: "mes_fechado",
  /** Sem conta de despesa não há lançamento — e o sistema não escolhe uma. */
  SEM_CONTA: "saida_sem_conta",
  /** A recusa da FORMA do lançamento (conta sintética, fora do plano, caixa torto) chega nomeada. */
  FORMA_INVALIDA: "forma_invalida",
});

export const FRASE_DA_RECUSA_DA_SAIDA = Object.freeze({
  [RECUSA_DA_SAIDA.DATA_INVALIDA]: "A data precisa estar no formato AAAA-MM-DD.",
  [RECUSA_DA_SAIDA.VALOR_INVALIDO]: "O valor precisa ser um número maior que zero.",
  [RECUSA_DA_SAIDA.SEM_DESCRICAO]: "Falta dizer do que é esta saída.",
  [RECUSA_DA_SAIDA.ESTADO_INVALIDO]: "Este estado não existe para uma saída planejada.",
  [RECUSA_DA_SAIDA.SEM_MOTIVO]: "Recusar exige dizer por quê.",
  [RECUSA_DA_SAIDA.NAO_ENCONTRADA]: "Esta saída não existe nesta empresa.",
  [RECUSA_DA_SAIDA.JA_DECIDIDA]: "Esta saída já foi decidida pelo seu contador.",
  [RECUSA_DA_SAIDA.INDISPONIVEL]:
    "A tabela de saídas planejadas ainda não existe neste banco. A migration não foi aplicada.",
  [RECUSA_DA_SAIDA.JA_LANCADA]:
    "Esta saída já virou lançamento contábil. Um segundo lançaria a mesma despesa duas vezes.",
  // ⚠ A frase diz a CONSEQUÊNCIA, não só a regra: é ela que impede o contador de achar que o
  // sistema está sendo burocrático com uma data.
  [RECUSA_DA_SAIDA.DATA_FUTURA]:
    "Esta saída ainda não aconteceu. O lançamento afirma que o dinheiro saiu na data dela, e essa "
    + "data ainda não chegou — lance quando ela chegar, ou corrija a data com o cliente.",
  [RECUSA_DA_SAIDA.MES_FECHADO]:
    "A competência desta saída está fechada. Reabra o mês antes de lançar.",
  [RECUSA_DA_SAIDA.SEM_CONTA]: "Escolha a conta de despesa: o sistema não escolhe uma por você.",
  [RECUSA_DA_SAIDA.FORMA_INVALIDA]: "O lançamento não pôde ser montado com esta conta.",
});

export class SaidaRecusada extends Error {
  constructor(codigo, frase) {
    super(codigo);
    this.name = "SaidaRecusada";
    this.codigo = codigo;
    this.frase = frase;
  }
}

/**
 * ⚠ `frase` opcional: ela existe para a recusa da FORMA do lançamento chegar com o texto que
 * `montarLancamento` escreveu (ele nomeia a conta sintética, a ambígua, a que está fora do plano).
 * Substituí-lo por um genérico faria o contador perder o único texto que diz QUAL conta corrigir.
 */
function recusar(codigo, frase = null) {
  throw new SaidaRecusada(codigo, frase || FRASE_DA_RECUSA_DA_SAIDA[codigo] || codigo);
}

/**
 * ⚠ A tabela pode não existir (migration é ato do dono) e o DELEGATE pode não existir (o
 * `prisma generate` não rodou — no Windows ele falha com EPERM se o servidor de dev está de pé).
 * As duas ausências viram a MESMA recusa nomeada, nunca um TypeError.
 */
const tabelaAusente = (e) => e?.code === "P2021";

function modelo(client) {
  const m = client?.saidaAvulsaCliente;
  if (!m?.findMany) recusar(RECUSA_DA_SAIDA.INDISPONIVEL);
  return m;
}

/**
 * ⚠⚠ A DATA É CIVIL, e é lida por PEDAÇO DE STRING — nunca por `new Date("2026-09-10")`.
 *
 * Aquele construtor interpreta a forma `AAAA-MM-DD` como **UTC**, e no fuso de São Paulo ela volta
 * como o dia ANTERIOR na leitura local. É a mesma armadilha que `diasDoMes` e `fmtDateBr` já
 * registram nos dois portais.
 *
 * ⚠ E ele valida de verdade: `2026-02-31` seria aceito por `new Date` (vira 03/03) e é recusado
 * aqui, porque uma data que não existe não pode virar um dia no fluxo.
 */
export function lerDataCivil(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(valor));
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // ⚠ A volta prova que a data existe: 31/02 vira 03/03 e os componentes deixam de bater.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d;
}

/**
 * O cliente acrescenta uma saída ao próprio fluxo. Ela nasce **`PENDENTE`**.
 *
 * ⚠⚠ PENDENTE NÃO ENTRA NO FLUXO. É a mesma trava da série marcada: uma afirmação não vira linha de
 * caixa sozinha. Ela aparece na fila do contador, e só entra depois que ele confirma.
 */
export async function criarSaidaAvulsa({
  portalClientId, data, valor, descricao, usuarioId, client = prisma,
}) {
  const m = modelo(client);

  const dia = lerDataCivil(data);
  if (!dia) recusar(RECUSA_DA_SAIDA.DATA_INVALIDA);

  // ⚠ `Number(null)` é 0 e 0 é FINITO — a guarda é `> 0`, nunca `Number.isFinite` sozinha. Uma saída
  // de zero não é uma saída.
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) recusar(RECUSA_DA_SAIDA.VALOR_INVALIDO);

  const desc = texto(descricao);
  if (!desc) recusar(RECUSA_DA_SAIDA.SEM_DESCRICAO);

  try {
    return await m.create({
      data: {
        portalClientId: String(portalClientId),
        data: dia,
        valor: v,
        descricao: desc,
        estado: ESTADO_DA_SAIDA.PENDENTE,
        criadaPor: texto(usuarioId) || "desconhecido",
      },
    });
  } catch (e) {
    if (tabelaAusente(e)) recusar(RECUSA_DA_SAIDA.INDISPONIVEL);
    throw e;
  }
}

/**
 * O cliente desfaz o que ele mesmo escreveu — **e só enquanto estiver `PENDENTE`**.
 *
 * ⚠⚠ Depois de o contador decidir, apagar seria desfazer a decisão dele pelo lado do cliente. A
 * recusa é nomeada (`JA_DECIDIDA`), para a tela poder dizer o que houve em vez de o botão falhar.
 */
export async function removerSaidaAvulsa({ portalClientId, saidaId, client = prisma }) {
  const m = modelo(client);
  try {
    const atual = await m.findFirst({
      // ⚠ O escopo por empresa vive no `where`, nunca só no id: sem ele, conhecer um id apagaria a
      // saída de OUTRA empresa. É o furo de multi-tenancy que a F1 do WhatsApp já mediu.
      where: { id: String(saidaId), portalClientId: String(portalClientId) },
      select: { id: true, estado: true },
    });
    if (!atual) recusar(RECUSA_DA_SAIDA.NAO_ENCONTRADA);
    if (atual.estado !== ESTADO_DA_SAIDA.PENDENTE) recusar(RECUSA_DA_SAIDA.JA_DECIDIDA);
    await m.delete({ where: { id: atual.id } });
    return { ok: true };
  } catch (e) {
    if (e instanceof SaidaRecusada) throw e;
    if (tabelaAusente(e)) recusar(RECUSA_DA_SAIDA.INDISPONIVEL);
    throw e;
  }
}

/** A fila do contador: o que o cliente escreveu e ninguém decidiu ainda. */
export async function listarSaidasPendentes({ portalClientId, client = prisma }) {
  const m = client?.saidaAvulsaCliente;
  // ⚠ Aqui a ausência devolve LISTA VAZIA + `indisponivel`, e não recusa: esta leitura alimenta a
  // contagem da Conferência, e derrubá-la tiraria da tela também o que o declarado tem a dizer.
  if (!m?.findMany) return { saidas: [], indisponivel: true };
  try {
    const saidas = await m.findMany({
      where: { portalClientId: String(portalClientId), estado: ESTADO_DA_SAIDA.PENDENTE },
      orderBy: { data: "asc" },
    });
    return { saidas, indisponivel: false };
  } catch (e) {
    if (tabelaAusente(e)) return { saidas: [], indisponivel: true };
    throw e;
  }
}

/**
 * O contador decide: confirma (entra no fluxo) ou recusa (com motivo).
 *
 * ⚠⚠ **CONFIRMAR NÃO LANÇA NADA.** Não há `AccountingEntry` neste caminho, e há teste varrendo a
 * fonte para provar. O que se confirma é uma PREVISÃO de caixa do cliente.
 *
 * ⚠ Decidir a mesma saída duas vezes RECUSA. Sem isso, "recusei" e "confirmei" alternariam sem
 * rastro de qual valeu.
 */
export async function decidirSaidaAvulsa({
  portalClientId, saidaId, estado, motivoRecusa = null, usuarioId, agora = new Date(), client = prisma,
}) {
  const m = modelo(client);
  if (estado !== ESTADO_DA_SAIDA.CONFIRMADA && estado !== ESTADO_DA_SAIDA.RECUSADA) {
    recusar(RECUSA_DA_SAIDA.ESTADO_INVALIDO);
  }
  const motivo = texto(motivoRecusa);
  // ⚠ Ausência nunca é resposta: recusar exige dizer por quê, como em `LancamentoDeclarado`.
  if (estado === ESTADO_DA_SAIDA.RECUSADA && !motivo) recusar(RECUSA_DA_SAIDA.SEM_MOTIVO);

  try {
    const atual = await m.findFirst({
      where: { id: String(saidaId), portalClientId: String(portalClientId) },
      select: { id: true, estado: true },
    });
    if (!atual) recusar(RECUSA_DA_SAIDA.NAO_ENCONTRADA);
    if (atual.estado !== ESTADO_DA_SAIDA.PENDENTE) recusar(RECUSA_DA_SAIDA.JA_DECIDIDA);

    return await m.update({
      where: { id: atual.id },
      data: {
        estado,
        // ⚠ Confirmar LIMPA o motivo: um motivo de recusa pendurado numa linha confirmada seria
        // história contando o contrário do estado.
        motivoRecusa: estado === ESTADO_DA_SAIDA.RECUSADA ? motivo : null,
        decididaPor: texto(usuarioId) || null,
        decididaEm: agora,
      },
    });
  } catch (e) {
    if (e instanceof SaidaRecusada) throw e;
    if (tabelaAusente(e)) recusar(RECUSA_DA_SAIDA.INDISPONIVEL);
    throw e;
  }
}

/**
 * ⚠⚠⚠ A SAÍDA DO CLIENTE VIRA LANÇAMENTO CONTÁBIL — decisão do dono, 01/09/2026.
 *
 * > *"alguma coisa só aparecem para o fluxo, não me dando opção de colocar como lançamentos"*, e,
 * > perguntado entre mandar para a fila ou lançar direto: **"vira lançamento contábil direto"**.
 *
 * ⚠⚠ **EU RECOMENDEI A FILA E ELE ESCOLHEU O DIRETO; o que fica aqui é a CONSEQUÊNCIA**, para
 * ninguém a redescobrir. O lançamento é `D despesa / C caixa` na data que o CLIENTE informou — ou
 * seja, ele afirma que o dinheiro saiu naquele dia com base na palavra do cliente, sem comprovante.
 * Isso não é inédito nesta casa (`DECLARADO_PELO_CONTADOR` já é declaração, não prova), mas ali
 * quem declara é o contador; aqui a origem é o cliente.
 *
 * ⚠ **O QUE TORNA A DECISÃO SEGURA, e é o que não pode ser removido:**
 *   1. `DATA_FUTURA` recusa — previsão do mês que vem não virou saída de caixa nenhuma;
 *   2. `MES_FECHADO` recusa — a mesma guarda do declarado;
 *   3. `accountingEntryId` torna o ato idempotente — dois cliques não viram duas despesas;
 *   4. a CONTA é escolhida por quem clica; o sistema não elege nenhuma.
 *
 * ⚠⚠ **A SAÍDA NÃO SAI DO FLUXO.** Medido: o fluxo lê `accountingEntry` só de `tipo: "FOLHA"`, então
 * despesa lançada não o alimenta. Tirá-la daqui a faria SUMIR da tela do cliente — o oposto da regra
 * do dono. Ela fica, com estado `LANCADA`.
 *
 * ⚠ A FORMA é `montarLancamento`, a MESMA do declarado. A saída é traduzida para a forma que ela
 * espera; nenhuma regra de razão é reescrita aqui.
 */
export async function lancarSaidaAvulsa({
  portalClientId, saidaId, contaDespesa, usuarioId, agora = new Date(), client = prisma,
}) {
  const m = modelo(client);
  const conta = texto(contaDespesa);
  // ⚠ Antes de qualquer ida ao banco: sem conta não há o que montar, e o sistema não escolhe uma.
  if (!conta) recusar(RECUSA_DA_SAIDA.SEM_CONTA);

  let atual;
  try {
    atual = await m.findFirst({
      where: { id: String(saidaId), portalClientId: String(portalClientId) },
      select: { id: true, estado: true, data: true, valor: true, descricao: true, accountingEntryId: true },
    });
  } catch (e) {
    if (tabelaAusente(e)) recusar(RECUSA_DA_SAIDA.INDISPONIVEL);
    throw e;
  }
  if (!atual) recusar(RECUSA_DA_SAIDA.NAO_ENCONTRADA);
  // ⚠ A idempotência vem ANTES do estado: uma linha já lançada tem de dizer "já lançada", nunca
  // "estado inválido" — consertos diferentes, e o segundo mandaria procurar defeito onde não há.
  if (atual.accountingEntryId) recusar(RECUSA_DA_SAIDA.JA_LANCADA);
  if (atual.estado !== ESTADO_DA_SAIDA.PENDENTE && atual.estado !== ESTADO_DA_SAIDA.CONFIRMADA) {
    recusar(RECUSA_DA_SAIDA.ESTADO_INVALIDO);
  }

  /**
   * ⚠⚠ A DATA FUTURA RECUSA, e a comparação é por DIA CIVIL, não por instante.
   *
   * `data` é `@db.Date` (sem hora) e `agora` tem hora: comparar os dois crus recusaria uma saída de
   * HOJE em qualquer horário depois da meia-noite UTC. O que se pergunta é *"este dia já chegou?"*.
   */
  const diaDaSaida = String(atual.data instanceof Date ? atual.data.toISOString().slice(0, 10) : atual.data || "");
  const hoje = new Date(agora.getTime()).toISOString().slice(0, 10);
  if (!diaDaSaida) recusar(RECUSA_DA_SAIDA.DATA_INVALIDA);
  if (diaDaSaida > hoje) recusar(RECUSA_DA_SAIDA.DATA_FUTURA);

  const competencia = competenciaDaData(atual.data);
  if (await isMonthClosed(String(portalClientId), competencia)) recusar(RECUSA_DA_SAIDA.MES_FECHADO);

  const plano = await carregarPlano(String(portalClientId), client);
  /**
   * ⚠⚠ A TRADUÇÃO PARA A FORMA DO DECLARADO — e cada campo tem um porquê:
   *   `dataPagamento`  ← a data da saída. É ela que o lançamento AFIRMA.
   *   `descricaoOriginal` ← a descrição do cliente, crua. O histórico do razão desta casa é o texto
   *                         de origem, nunca uma frase montada (medido nos 130 lançamentos do Excel).
   *   `contaAplicada`  ← a conta que quem clicou escolheu.
   * ⚠ `valorAjustado` fica AUSENTE de propósito: não existe ajuste de valor neste caminho, e mandar
   * `null` explicitamente seria dizer que houve um e foi apagado.
   */
  const forma = montarLancamento({
    // ⚠⚠ SEM ISTO O LANÇAMENTO NASCE SEM EMPRESA. `montarLancamento` lê `declarado.portalClientId`
    // e o copia para o `entry` — omiti-lo criaria a despesa com `portalClientId: undefined`. É a
    // guarda de multi-tenancy do módulo inteiro, e ela vem do PATH, nunca do corpo do pedido.
    portalClientId: String(portalClientId),
    competencia,
    dataPagamento: atual.data,
    descricaoOriginal: atual.descricao,
    valor: atual.valor,
    contaAplicada: conta,
  }, plano);
  if (!forma.ok) recusar(RECUSA_DA_SAIDA.FORMA_INVALIDA, forma.frase || null);

  /**
   * ⚠⚠ NA MESMA TRANSAÇÃO. Fora dela, um erro entre as duas escritas deixaria o lançamento no razão
   * com a saída dizendo que nunca foi lançada — e o próximo clique criaria o segundo.
   */
  return client.$transaction(async (tx) => {
    const entry = await tx.accountingEntry.create({ data: forma.entry, select: { id: true } });
    return tx.saidaAvulsaCliente.update({
      where: { id: atual.id },
      data: {
        estado: ESTADO_DA_SAIDA.LANCADA,
        accountingEntryId: entry.id,
        // ⚠ Lançar TAMBÉM é decidir: sem isto, uma saída lançada ficaria sem autor e sem data da
        // decisão, e a fila do contador não saberia dizer quem a tirou de lá.
        decididaPor: texto(usuarioId) || null,
        decididaEm: agora,
        // ⚠ Motivo de recusa pendurado numa linha lançada seria história contando o contrário.
        motivoRecusa: null,
      },
    });
  });
}
