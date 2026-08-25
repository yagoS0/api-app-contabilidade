// A LIGAÇÃO DA CONFERÊNCIA DE LANÇAMENTOS COM O BANCO.
//
// ⚠⚠ ESTE É O ÚNICO CAMINHO DE ESCRITA. As regras moram em `lib/estadosDeclarado.js` (o que pode
// acontecer) e `lib/formaDoLancamento.js` (o que o `AccountingEntry` é); este arquivo não as
// reimplementa — ele as consulta e grava o resultado. Duas leituras da mesma pergunta divergem na
// primeira correção, e aqui a divergência sairia como lançamento contábil errado.
//
// ⚠⚠ A TRANSAÇÃO É O PONTO MAIS DELICADO DO MÓDULO. Criar o `AccountingEntry` e mudar o estado do
// declarado é UM ato; apagá-lo e voltar o estado também. Meio caminho deixa ou lançamento órfão
// (dinheiro no razão sem ninguém responsável) ou declarado dizendo `CONTABILIZADO` sem lançamento
// nenhum. Por isso tudo passa por `$transaction`, e há teste com falha injetada no meio.

import { prisma } from "../../infrastructure/db/prisma.js";
import { carregarPlano } from "../accounting/AliquotaPorLancamentosService.js";
// ⚠ REUSADO, não reescrito. `normalizeMatchText` já é "normalizar texto para casar" nesta casa
// (import de Excel). A normalização que o matching da Fase B2 vai precisar é MAIOR — tirar datas,
// números de documento e códigos de autorização —, e quando ela chegar tem de estender ESTA, num
// lugar só. Uma segunda definição faria a gravação e a leitura da mesma chave divergirem, que é
// literalmente o defeito que o cabeçalho daquele arquivo documenta.
import { normalizeMatchText } from "../accounting/excelImport.js";
import { competenciasFechadas, isMonthClosed } from "../accounting/fechamentoContabil.js";
import {
  ESTADO,
  ESTADOS_SEM_LANCAMENTO,
  FRASE_DA_RECUSA,
  ORIGEM_PAGAMENTO,
  TRANSICAO,
  podeTransitar,
} from "./lib/estadosDeclarado.js";
import { montarLancamento } from "./lib/formaDoLancamento.js";

/** Recusas do SERVIÇO — as que dependem do banco, e por isso não cabem na regra pura. */
export const RECUSA_DO_SERVICO = Object.freeze({
  NAO_ENCONTRADO: "declarado_nao_encontrado",
  MES_FECHADO: "mes_fechado",
  LANCAMENTO_JA_APAGADO: "lancamento_ja_apagado",
  SEM_DESCRICAO: "sem_descricao",
  SEM_VALOR: "sem_valor",
  SEM_IDENTIDADE: "sem_identidade",
  ORIGEM_INVALIDA: "origem_invalida",
  PAGAMENTO_SEM_PROCEDENCIA: "pagamento_sem_procedencia",
});

export const FRASE_DO_SERVICO = Object.freeze({
  [RECUSA_DO_SERVICO.NAO_ENCONTRADO]: "Este lançamento não existe nesta empresa.",
  [RECUSA_DO_SERVICO.MES_FECHADO]:
    "A competência está fechada contabilmente. Reabra o mês antes de lançar — reabrir é decisão do contador, e fica registrada.",
  [RECUSA_DO_SERVICO.LANCAMENTO_JA_APAGADO]:
    "O lançamento que este registro apontava não existe mais. Ele foi apagado por fora da fila.",
  [RECUSA_DO_SERVICO.SEM_DESCRICAO]:
    "O lançamento precisa de uma descrição — é ela que vira o histórico no razão.",
  [RECUSA_DO_SERVICO.SEM_VALOR]: "O valor precisa ser um número maior que zero.",
  [RECUSA_DO_SERVICO.SEM_IDENTIDADE]:
    "Falta a impressão digital da origem. Sem ela, importar duas vezes duplicaria a fila.",
  [RECUSA_DO_SERVICO.ORIGEM_INVALIDA]: "Origem desconhecida para um lançamento declarado.",
  [RECUSA_DO_SERVICO.PAGAMENTO_SEM_PROCEDENCIA]:
    "Foi informada uma data de pagamento sem dizer se ela é prova (extrato) ou declaração.",
});

/** ⚠ Erro tipado: quem chama traduz o `codigo` em HTTP, e a `frase` já vem pronta para a tela. */
export class DeclaradoRecusado extends Error {
  constructor(codigo, frase) {
    super(codigo);
    this.name = "DeclaradoRecusado";
    this.codigo = codigo;
    this.frase = frase || "";
  }
}

const recusar = (codigo, frase) => {
  throw new DeclaradoRecusado(codigo, frase ?? (FRASE_DO_SERVICO[codigo] || FRASE_DA_RECUSA[codigo] || ""));
};

/**
 * O declarado, escopado pela EMPRESA.
 *
 * ⚠ O `portalClientId` entra no `where`, nunca é conferido depois de ler. Escolher o alvo só pelo
 * id deixa um declarado de outra empresa cair dentro do acesso do chamador — é o furo de
 * multi-tenancy que a F1 do WhatsApp já pagou duas vezes.
 */
async function acharDeclarado(client, portalClientId, declaradoId) {
  const d = await client.lancamentoDeclarado.findFirst({
    where: { id: String(declaradoId), portalClientId: String(portalClientId) },
  });
  if (!d) recusar(RECUSA_DO_SERVICO.NAO_ENCONTRADO);
  return d;
}

/**
 * CRIA UM DECLARADO.
 *
 * ⚠⚠ O `estado` NÃO É PARÂMETRO — ele é DERIVADO da evidência: com data de pagamento nasce
 * `A_CONFERIR`, sem ela nasce `AGUARDANDO_PAGAMENTO`. Deixar quem chama escolher o estado abriria
 * o caminho para uma linha nascer `A_CONFERIR` sem data, e a invariante do caixa seria furada na
 * porta de entrada em vez de na de saída.
 *
 * ⚠⚠ IDEMPOTENTE, E POR "PULAR", NUNCA POR SOBRESCREVER. A varredura de notas roda de novo a cada
 * captura. Um `upsert` reescreveria um declarado que o contador já decidiu — um `RECUSADO` voltaria
 * a `AGUARDANDO_PAGAMENTO` sozinho, apagando a decisão dele. Já existente ⇒ devolve o que está lá,
 * marcado `jaExistia: true`, sem tocar em nada.
 *
 * @param {Date} args.agora ⚠ injetado, como em `aplicarTransicao`.
 */
export async function criarDeclarado({
  portalClientId,
  origem,
  tipo = "SAIDA",
  valor,
  competencia = null,
  descricaoOriginal,
  detalheServico = null,
  dataDocumento = null,
  cnpjFornecedor = null,
  notaRecebidaId = null,
  dataPagamento = null,
  origemPagamento = null,
  // ⚠ Só o caminho do OFX os preenche. `contaBancariaRef` faz parte da IDENTIDADE da transação:
  // sem ela, duas contas da mesma empresa com o mesmo valor no mesmo dia são indistinguíveis.
  ofxImportId = null,
  fitId = null,
  contaBancariaRef = null,
  contaSugerida = null,
  hashDedupe,
  criadoPor,
  // ⚠ Injetado, como em `aplicarTransicao`. Ausente, o default do banco responde.
  agora = null,
  client = prisma,
}) {
  const descricao = String(descricaoOriginal || "").trim();
  if (!descricao) recusar(RECUSA_DO_SERVICO.SEM_DESCRICAO);

  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) recusar(RECUSA_DO_SERVICO.SEM_VALOR);

  const chave = String(hashDedupe || "").trim();
  if (!chave) recusar(RECUSA_DO_SERVICO.SEM_IDENTIDADE);

  if (!["NOTA_RECEBIDA", "CLIENTE_MANUAL", "OFX_CLIENTE"].includes(String(origem))) {
    recusar(RECUSA_DO_SERVICO.ORIGEM_INVALIDA);
  }

  const temPagamento = dataPagamento instanceof Date && !Number.isNaN(dataPagamento.getTime());
  // ⚠ Data sem procedência recusa aqui também: prova e declaração não podem virar a mesma coisa
  // por omissão de quem chamou, nem na criação.
  if (temPagamento && !Object.values(ORIGEM_PAGAMENTO).includes(origemPagamento)) {
    recusar(RECUSA_DO_SERVICO.PAGAMENTO_SEM_PROCEDENCIA);
  }

  const dados = {
    portalClientId: String(portalClientId),
    origem: String(origem),
    estado: temPagamento ? ESTADO.A_CONFERIR : ESTADO.AGUARDANDO_PAGAMENTO,
    tipo: String(tipo),
    valor: v,
    competencia: competencia ? String(competencia) : null,
    descricaoOriginal: descricao,
    // ⚠ O ORIGINAL FICA INTOCADO. A normalização é ÍNDICE, nunca substituto — é o mesmo cuidado que
    // `AccountingEntry.descricaoImportacao` existe para garantir.
    descricaoNormalizada: normalizeMatchText(descricao),
    detalheServico: detalheServico ? String(detalheServico) : null,
    dataDocumento: dataDocumento instanceof Date && !Number.isNaN(dataDocumento.getTime()) ? dataDocumento : null,
    cnpjFornecedor: cnpjFornecedor ? String(cnpjFornecedor).replace(/\D+/g, "") || null : null,
    notaRecebidaId: notaRecebidaId ? String(notaRecebidaId) : null,
    dataPagamento: temPagamento ? dataPagamento : null,
    origemPagamento: temPagamento ? origemPagamento : null,
    ofxImportId: ofxImportId ? String(ofxImportId) : null,
    fitId: fitId ? String(fitId) : null,
    contaBancariaRef: contaBancariaRef ? String(contaBancariaRef) : null,
    contaSugerida: contaSugerida ? String(contaSugerida) : null,
    hashDedupe: chave,
    criadoPor: String(criadoPor || ""),
    ...(agora instanceof Date && !Number.isNaN(agora.getTime()) ? { criadoEm: agora } : {}),
  };

  try {
    const criado = await client.lancamentoDeclarado.create({ data: dados });
    return { declarado: criado, jaExistia: false };
  } catch (e) {
    // ⚠ P2002 = o `@@unique(portalClientId, hashDedupe)` mordeu. É o desfecho NORMAL de rodar a
    // varredura duas vezes, não um erro — e é o backstop atômico contra a corrida entre duas
    // varreduras simultâneas, que um `findFirst` antes do `create` não cobriria.
    if (e?.code !== "P2002") throw e;
    const existente = await client.lancamentoDeclarado.findFirst({
      where: { portalClientId: String(portalClientId), hashDedupe: chave },
    });
    return { declarado: existente, jaExistia: true };
  }
}

/**
 * APLICA UMA TRANSIÇÃO. É por aqui que tudo passa.
 *
 * @param {object} args
 * @param {string} args.portalClientId
 * @param {string} args.declaradoId
 * @param {string} args.transicao um valor de `TRANSICAO`
 * @param {object} [args.dados] o que o ato traz (dataPagamento, contaAplicada, motivoRecusa…)
 * @param {string} args.usuarioId quem está decidindo
 * @param {Date} args.agora ⚠ INJETADO. Este serviço não lê o relógio: `decididoEm` é auditoria e
 *   precisa ser a mesma instância em toda a transação, e teste não pode depender de `Date.now()`.
 */
export async function aplicarTransicao({
  portalClientId,
  declaradoId,
  transicao,
  dados = {},
  usuarioId,
  agora,
  client = prisma,
}) {
  const declarado = await acharDeclarado(client, portalClientId, declaradoId);

  // 1. A REGRA PURA decide. ⚠ Ela vem primeiro: não faz sentido consultar fechamento de mês para
  //    uma transição que o estado já recusa.
  const veredito = podeTransitar(declarado, transicao, dados);
  if (!veredito.ok) recusar(veredito.motivo, veredito.frase);

  const vaiContabilizar = veredito.estado === ESTADO.CONTABILIZADO;
  const vaiDesfazer = transicao === TRANSICAO.DESFAZER;

  // 2. As guardas que só o banco sabe.
  if (vaiContabilizar || vaiDesfazer) {
    // ⚠ Mês fechado recusa nos DOIS sentidos. Lançar num mês fechado escreveria sem rastro de
    // reabertura; DESFAZER apagaria um lançamento que o fechamento já conferiu.
    if (await isMonthClosed(portalClientId, declarado.competencia)) {
      recusar(RECUSA_DO_SERVICO.MES_FECHADO);
    }
  }

  const camposComuns = {
    ...veredito.campos,
    estado: veredito.estado,
    decididoPor: String(usuarioId || ""),
    decididoEm: agora,
  };

  // 3. O caminho simples: nada a criar nem a apagar no razão.
  if (!vaiContabilizar && !vaiDesfazer) {
    return client.lancamentoDeclarado.update({ where: { id: declarado.id }, data: camposComuns });
  }

  // 4. ⚠⚠ O caminho transacional.
  const plano = vaiContabilizar ? await carregarPlano(portalClientId, client) : null;

  return client.$transaction(async (tx) => {
    if (vaiContabilizar) {
      // ⚠ A FORMA é montada sobre o declarado JÁ com a transição aplicada — senão a conta escolhida
      // no próprio ato (e o valor ajustado) não chegariam ao lançamento.
      const forma = montarLancamento({ ...declarado, ...veredito.campos }, plano);
      if (!forma.ok) recusar(forma.motivo, forma.frase);

      const entry = await tx.accountingEntry.create({ data: forma.entry, select: { id: true } });
      return tx.lancamentoDeclarado.update({
        where: { id: declarado.id },
        data: { ...camposComuns, accountingEntryId: entry.id },
      });
    }

    // DESFAZER.
    // ⚠ `deleteMany`, não `delete`: o lançamento pode ter sido apagado por fora (não há FK, de
    // propósito). `delete` estouraria P2025 e o declarado ficaria preso em CONTABILIZADO para
    // sempre — apontando para nada. Com `deleteMany` a contagem nos diz o que houve, e o declarado
    // se solta de qualquer jeito, que é o desfecho útil.
    if (declarado.accountingEntryId) {
      await tx.accountingEntry.deleteMany({
        where: { id: declarado.accountingEntryId, portalClientId: String(portalClientId) },
      });
    }
    return tx.lancamentoDeclarado.update({ where: { id: declarado.id }, data: camposComuns });
  });
}

/**
 * ⚠⚠ O RECORTE QUE ALCANÇA A COMPETÊNCIA NULA.
 *
 * `where.competencia = "2026-07"` não casa com `NULL` em SQL — então a nota que chegou sem
 * competência ficaria **inalcançável pela tela**, invisível para sempre. É literalmente o defeito
 * que a auditoria de notas já pagou e consertou (*"a consulta que fabricava buraco"*): lá a nota
 * sem competência não chegava nem à regra, e nem aparecia em "fora desta conferência".
 *
 * ⚠ A saída NÃO é atribuí-la a um mês — isso seria decidir em qual apuração a despesa entra. É dar
 * a ela um recorte PRÓPRIO e nomeado.
 */
export const COMPETENCIA_AUSENTE = "sem-competencia";

/**
 * A FILA. ⚠ Pagina desde o dia 1: a varredura de notas pode produzir centenas de linhas de uma vez
 * (1.897 NFS-e recebidas na base), e lista sem página é a tela que trava justamente na empresa que
 * mais precisa dela.
 */
export async function listarFila({
  portalClientId,
  estados,
  competencia,
  pagina = 1,
  porPagina = 50,
  client = prisma,
}) {
  const escopo = { portalClientId: String(portalClientId) };
  if (competencia === COMPETENCIA_AUSENTE) escopo.competencia = null;
  else if (competencia) escopo.competencia = String(competencia);

  const where = { ...escopo };
  if (Array.isArray(estados) && estados.length) where.estado = { in: estados.map(String) };

  const take = Math.min(Math.max(Number(porPagina) || 50, 1), 200);
  const skip = (Math.max(Number(pagina) || 1, 1) - 1) * take;

  const [itens, total, contagem] = await Promise.all([
    client.lancamentoDeclarado.findMany({
      where,
      // ⚠ Da mais antiga para a mais nova: a fila é trabalho a fazer, e o que espera há mais tempo
      // é o que mais precisa de resposta.
      orderBy: [{ dataDocumento: "asc" }, { criadoEm: "asc" }],
      skip,
      take,
      include: {
        anexos: { select: { id: true, url: true, nomeArquivo: true, mimeType: true } },
        // ⚠ O NÚMERO DA NOTA. O contador confere a fila contra o documento **pelo número**; sem ele
        // ele teria de cruzar CNPJ + data + valor para achar o papel. ⚠ `notaRecebida` pode ser
        // nula mesmo em `origem: NOTA_RECEBIDA` — a FK é `SetNull`, e nota apagada não apaga a
        // despesa.
        notaRecebida: { select: { numero: true, serie: true, chaveAcesso: true, type: true } },
      },
    }),
    client.lancamentoDeclarado.count({ where }),
    // ⚠⚠ O RESUMO IGNORA O FILTRO DE ESTADO, de propósito — contá-lo com o filtro aplicado daria
    // sempre o tamanho da própria página filtrada, e a pergunta que ele responde é a oposta:
    // "quanto trabalho existe, e de que tipo?". Ele RESPEITA a competência, que é o recorte.
    client.lancamentoDeclarado.groupBy({ by: ["estado"], where: escopo, _count: { _all: true } }),
  ]);

  // ⚠ Contagem sai de `groupBy`, NUNCA de `itens.length`: lista truncada como total mentiria
  // exatamente na empresa em que o problema é grande. Mesma disciplina da auditoria de notas.
  const porEstado = {};
  for (const e of Object.values(ESTADO)) porEstado[e] = 0;
  for (const g of contagem || []) porEstado[g.estado] = g._count?._all ?? 0;

  // Pré-voo do mês fechado: UMA query para a página inteira, em vez de uma por linha.
  const fechadas = await competenciasFechadas(
    portalClientId,
    itens.map((d) => d.competencia),
    client,
  );

  return {
    itens: itens.map((d) => ({
      ...d,
      // ⚠ NÃO é coluna: é a resposta de "este botão vai funcionar?", derivada na leitura. Quem
      // RECUSA continua sendo `aplicarTransicao`, que enxerga o estado do momento do clique.
      mesFechado: Boolean(d.competencia && fechadas.has(d.competencia)),
    })),
    total,
    porEstado,
    pagina: Math.max(Number(pagina) || 1, 1),
    porPagina: take,
  };
}

/**
 * ⚠⚠ A VARREDURA DAS INVARIANTES — "o banco está dizendo alguma coisa impossível?"
 *
 * SOMENTE LEITURA. Ela existe porque as invariantes deste módulo não são todas exprimíveis em
 * constraint: `CONTABILIZADO` implica lançamento vivo, e nenhum outro estado pode ter um. Sem
 * varredura, a violação aparece meses depois como número errado no razão.
 */
export async function varrerInvariantes({ portalClientId, client = prisma } = {}) {
  const where = portalClientId ? { portalClientId: String(portalClientId) } : {};

  const [semLancamento, comLancamento] = await Promise.all([
    // 1. Estado não-contabilizado apontando para um lançamento.
    client.lancamentoDeclarado.findMany({
      where: { ...where, estado: { in: [...ESTADOS_SEM_LANCAMENTO] }, accountingEntryId: { not: null } },
      select: { id: true, estado: true, accountingEntryId: true, portalClientId: true },
    }),
    // 2. CONTABILIZADO sem lançamento, e 3. A_CONFERIR sem data de pagamento.
    client.lancamentoDeclarado.findMany({
      where: { ...where, estado: ESTADO.CONTABILIZADO },
      select: { id: true, accountingEntryId: true, portalClientId: true },
    }),
  ]);

  const semDataDePagamento = await client.lancamentoDeclarado.findMany({
    where: {
      ...where,
      estado: { in: [ESTADO.A_CONFERIR, ESTADO.CONTABILIZADO] },
      dataPagamento: null,
    },
    select: { id: true, estado: true, portalClientId: true },
  });

  const semPonteiro = comLancamento.filter((d) => !d.accountingEntryId);

  // ⚠ Ponteiro pendurado: o lançamento foi apagado por fora. Como não há FK (de propósito), o id
  // fica — e é exatamente por isso que dá para detectar. Com `SET NULL` isto seria invisível.
  const ids = comLancamento.map((d) => d.accountingEntryId).filter(Boolean);
  const vivos = ids.length
    ? new Set(
        (await client.accountingEntry.findMany({ where: { id: { in: ids } }, select: { id: true } }))
          .map((e) => e.id),
      )
    : new Set();
  const ponteiroPendurado = comLancamento.filter((d) => d.accountingEntryId && !vivos.has(d.accountingEntryId));

  return {
    ok:
      !semLancamento.length &&
      !semPonteiro.length &&
      !ponteiroPendurado.length &&
      !semDataDePagamento.length,
    lancamentoForaDeContabilizado: semLancamento,
    contabilizadoSemLancamento: semPonteiro,
    ponteiroPendurado,
    // ⚠⚠ A invariante mais cara: um destes é um lançamento afirmando saída de caixa sem data.
    semDataDePagamento,
  };
}
