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
import { reavaliarAprendizado, sugerirContaParaLote } from "./RegraService.js";
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
  ehProvaDePagamento,
  FRASE_DA_CANDIDATA,
  lerCandidata,
  FRASE_DA_RECUSA,
  ORIGEM,
  ORIGEM_PAGAMENTO,
  TRANSICAO,
  podeTransitar,
} from "./lib/estadosDeclarado.js";
import { montarLancamento } from "./lib/formaDoLancamento.js";
import { casarLote, debitoPagaNota } from "./lib/casamentoPagamento.js";

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
  CASAMENTO_NAO_CONFERE: "casamento_nao_confere",
  /** ⚠ Já lançada: o lançamento dela JÁ é linha do fluxo. Uma previsão ao lado contaria em dobro. */
  JA_LANCADO_NO_FLUXO: "ja_lancado_no_fluxo",
  /** Despesa recusada não vai ao fluxo do cliente — diria o contrário da decisão do contador. */
  RECUSADO_NAO_VAI_AO_FLUXO: "recusado_nao_vai_ao_fluxo",
  /** ⚠ Sem data não há lugar na linha do tempo, e um dia chutado é uma afirmação sobre o caixa. */
  SEM_DATA_PARA_O_FLUXO: "sem_data_para_o_fluxo",
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
  [RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE]:
    "Este débito não confere mais com esta nota. Algo mudou desde que a sugestão apareceu na tela — recarregue e confira.",
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

  // ⚠⚠ A LISTA SAI DE `ORIGEM`, NUNCA ESCRITA À MÃO AQUI. Ela já esteve copiada — três literais ao
  // lado de um vocabulário congelado —, e origem nova aceita pela regra e recusada pelo serviço é a
  // divergência que esta casa já pagou quatro vezes com o filtro de envio de guia. Uma fonte só.
  if (!Object.values(ORIGEM).includes(String(origem))) {
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
  /**
   * ⚠⚠ A CORREÇÃO DA DATA PRESUMIDA — e ela **NÃO é** `vaiContabilizar` (29/08/2026).
   *
   * A linha JÁ ESTÁ `CONTABILIZADO`: o `AccountingEntry` existe, e o que muda é a DATA dele. Cair
   * no ramo de contabilizar criaria um SEGUNDO lançamento para a mesma despesa — a contagem dupla
   * pela porta dos fundos, que é exatamente o que este caminho existe para impedir.
   *
   * ⚠⚠ **O COMENTÁRIO DA MATRIZ AVISOU DISTO ANTES DE ELE EXISTIR:** *"`CONTABILIZADO` fica fora
   * porque lá a data já virou a data do `AccountingEntry` — trocá-la aqui deixaria lançamento e
   * declarado discordando."* O aviso continua inteiro, e é por isso que a atualização do
   * `AccountingEntry` acontece na MESMA transação, logo abaixo. Sem ela, esta transição seria
   * exatamente o defeito que aquele comentário descreve.
   */
  const vaiCorrigirData = transicao === TRANSICAO.CORRIGIR_DATA_PRESUMIDA;
  const criaLancamento = vaiContabilizar && !vaiCorrigirData;

  // 2. As guardas que só o banco sabe.
  if (criaLancamento || vaiDesfazer || vaiCorrigirData) {
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
  if (!criaLancamento && !vaiDesfazer && !vaiCorrigirData) {
    return client.lancamentoDeclarado.update({ where: { id: declarado.id }, data: camposComuns });
  }

  // 4. ⚠⚠ O caminho transacional.
  const plano = criaLancamento ? await carregarPlano(portalClientId, client) : null;

  const atualizado = await client.$transaction(async (tx) => {
    if (criaLancamento) {
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

    /**
     * ⚠⚠ A CORREÇÃO DA DATA — o `AccountingEntry` que JÁ EXISTE é atualizado, e nenhum é criado.
     *
     * É a guarda contra a contagem dupla pela porta dos fundos: a despesa já está no razão, e o que
     * o débito do extrato traz é a data CERTA dela.
     *
     * ⚠ `updateMany` com o `portalClientId` no `where`, e não `update` pelo id: o lançamento pode
     * ter sido apagado por fora (não há FK, de propósito) — `update` estouraria P2025 e a correção
     * falharia inteira, deixando o declarado com a data nova e o razão com a velha. Com
     * `updateMany`, o que houver é atualizado e o declarado se acerta de qualquer jeito.
     */
    if (vaiCorrigirData) {
      if (declarado.accountingEntryId) {
        await tx.accountingEntry.updateMany({
          where: { id: declarado.accountingEntryId, portalClientId: String(portalClientId) },
          // ⚠⚠ SÓ A DATA. Valor, contas e histórico do lançamento não mudam — o que o extrato prova
          // é QUANDO o dinheiro saiu, nunca quanto nem de onde.
          data: { data: veredito.campos.dataPagamento },
        });
      }
      return tx.lancamentoDeclarado.update({ where: { id: declarado.id }, data: camposComuns });
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

  // ⚠⚠ O APRENDIZADO ACONTECE DEPOIS DA TRANSAÇÃO, E FORA DELA — de propósito.
  //
  // Ele é CONSEQUÊNCIA do que o contador decidiu, não parte da decisão. Dentro da `$transaction`,
  // uma falha ao criar a regra desfaria o LANÇAMENTO que ele acabou de confirmar — trocaria uma
  // conveniência por um estrago. Por isso `reavaliarAprendizado` também não lança: ela devolve o
  // que fez, e o que ela não conseguir fazer é assunto dela.
  //
  // ⚠ Roda em CONFIRMAR, AJUSTAR e DESFAZER: as três mudam o histórico do fornecedor. Confirmar e
  // ajustar podem CRIAR a regra; desfazer pode SUSPENDÊ-LA (a base que a sustentava sumiu).
  if (APRENDE_COM.has(transicao) && atualizado?.cnpjFornecedor) {
    // ⚠⚠ O `try/catch` FICA AQUI, no ponto de chamada — e não só dentro de `reavaliarAprendizado`.
    //
    // Achado por auditoria em 25/08/2026: a garantia "o aprendizado não derruba a transição" morava
    // inteira no `catch` de OUTRO módulo, por convenção. Bastava alguém estreitar aquele catch para
    // que uma falha aqui subisse — e, como a `$transaction` JÁ COMMITOU, a rota responderia
    // **500 "não foi possível concluir"** sobre um lançamento que EXISTE. O contador clicaria de
    // novo e ouviria "esta ação não se aplica ao estado atual". Nada seria desfeito, mas o sistema
    // MENTIRIA sobre o desfecho — que é o modo de falha que este módulo inteiro existe para evitar.
    //
    // ⚠ Duas camadas de propósito: esta é a que garante, a de dentro é a que nomeia o motivo.
    try {
      await reavaliarAprendizado({
        portalClientId: String(portalClientId),
        cnpjFornecedor: atualizado.cnpjFornecedor,
        usuarioId,
        agora,
        client,
      });
    } catch {
      // ⚠ O aprendizado é conveniência; a transição é o trabalho. Silêncio aqui é deliberado — e a
      // camada de dentro é quem registra o motivo em `{acao, motivo, erro}`.
    }
  }

  return atualizado;
}

/**
 * ⚠ As transições que mexem no histórico do fornecedor — e portanto no aprendizado.
 *
 * ⚠⚠ `RECUSAR` NÃO ESTÁ AQUI, e a ausência é decisão: recusar uma despesa não diz nada sobre em
 * QUE CONTA o fornecedor deve ser lançado. `confirmacoesQueContam` já ignora tudo que não é
 * `CONTABILIZADO`, então incluí-la só custaria uma varredura para chegar à mesma resposta.
 */
const APRENDE_COM = new Set([TRANSICAO.CONFIRMAR, TRANSICAO.AJUSTAR, TRANSICAO.DESFAZER]);

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

  // ⚠⚠ A SUGESTÃO DE CONTA É DERIVADA NA LEITURA, NUNCA COLUNA. `contaSugerida` existe no model e é
  // gravada quando o declarado NASCE — mas uma regra criada depois disso não a atualizaria, e o
  // contador veria a fila velha sem saber por quê. Precedente de `divergenciaDeFonte.js`.
  //
  // ⚠ UMA busca de regras/memória/plano para a página inteira (`sugerirContaParaLote`), não uma por
  // linha: 229 linhas fariam 687 consultas.
  //
  // ⚠⚠ E ELA NÃO CONTABILIZA NADA — é texto na tela. Quem leva ao razão continua sendo
  // `aplicarTransicao`, com o contador clicando.
  const sugestoes = new Map();
  try {
    const lista = await sugerirContaParaLote({ portalClientId, declarados: itens, client });
    for (const s of lista) sugestoes.set(s.id, s);
  } catch {
    // ⚠ A FILA NUNCA CAI POR CAUSA DA SUGESTÃO. Sem a migration das regras a tabela não existe
    // (P2021), e a fila é o trabalho — a sugestão é conveniência. Ausência aparece como "sem
    // sugestão", que é a resposta honesta.
  }

  return {
    itens: itens.map((d) => ({
      ...d,
      // ⚠ NÃO é coluna: é a resposta de "este botão vai funcionar?", derivada na leitura. Quem
      // RECUSA continua sendo `aplicarTransicao`, que enxerga o estado do momento do clique.
      mesFechado: Boolean(d.competencia && fechadas.has(d.competencia)),
      // ⚠ A PROCEDÊNCIA viaja junto: "uma regra do fornecedor" e "você já lançou assim antes" pedem
      // conferências diferentes, e a tela precisa poder dizer qual é.
      sugestao: sugestoes.get(d.id) || null,
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O CASAMENTO DÉBITO × NOTA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * As sugestões de casamento, DERIVADAS NA LEITURA.
 *
 * ⚠⚠ NÃO É COLUNA, e a decisão tem precedente direto em `divergenciaDeFonte.js`: coluna só é
 * reescrita quando alguém a reescreve, e uma nota RECUSADA depois continuaria sendo sugerida para
 * sempre. Derivado, o palpite envelhece sozinho.
 *
 * ⚠ SÓ LEITURA. Ela não funde nada — quem funde é `fundirPagamentoNaNota`, com o contador tendo
 * confirmado.
 */
export async function sugestoesDePagamento({ portalClientId, client = prisma }) {
  const escopo = { portalClientId: String(portalClientId) };

  const [debitos, notas] = await Promise.all([
    // ⚠ Débito que ainda não foi resolvido nem fundido. `CONTABILIZADO` fica de fora: sugerir
    // fusão sobre despesa já lançada convidaria à contagem dupla pela porta dos fundos.
    client.lancamentoDeclarado.findMany({
      where: { ...escopo, origem: "OFX_CLIENTE", estado: ESTADO.A_CONFERIR, parDeclaradoId: null },
      orderBy: { dataPagamento: "asc" },
    }),
    // ⚠⚠ O CONJUNTO DE CANDIDATAS FOI ALARGADO — decisão do dono, 27/08/2026: *"a prova vence,
    // alargue o casamento"*. Antes ele era só `AGUARDANDO_PAGAMENTO`, e isso era um BURACO:
    //
    // O contador informa o pagamento de uma nota À MÃO → ela vira `A_CONFERIR` e SAI da lista de
    // candidatas. O débito do extrato que a pagou volta `nenhum_candidato`, entra no lote de
    // contabilização como se fosse despesa sem nota, e os DOIS viram lançamento — **despesa em
    // dobro**, exatamente pela porta que este casamento existe para fechar. Achado por dois agentes
    // de verificação, independentemente, em 27/08/2026.
    //
    // ⚠ `CONTABILIZADO` entra também, e por um motivo DIFERENTE: lá não há o que fundir (a data já
    // virou a data do `AccountingEntry`), mas o débito precisa ser RECONHECIDO para não virar um
    // segundo lançamento. Ele volta com `podeFundir: false` e o motivo — ver `casarLote`.
    //
    // ⚠ `RECUSADO` e `FUNDIDO` continuam fora: a primeira não vira despesa nenhuma, e a segunda já
    // é o outro lado de um casamento.
    client.lancamentoDeclarado.findMany({
      where: {
        ...escopo,
        origem: { not: ORIGEM.OFX_CLIENTE },
        estado: { in: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR, ESTADO.CONTABILIZADO] },
      },
      orderBy: { dataDocumento: "asc" },
    }),
  ]);

  // ⚠⚠ A NOTA QUE **JÁ TEM PROVA** SAI DO CONJUNTO, e esta é a guarda que impede o alargamento de
  // virar um defeito novo: uma nota `A_CONFERIR` com `origemPagamento: OFX` já foi fundida com
  // algum débito. Oferecê-la a um SEGUNDO débito trocaria uma evidência por outra em silêncio, e
  // deixaria o primeiro débito sem par, sem ninguém entender por quê.
  //
  // ⚠ A pergunta é `ehProvaDePagamento`, a MESMA da máquina de estados — não uma comparação com
  // `"OFX"` escrita aqui. Duas leituras de "isto é prova?" divergiriam na primeira origem nova.
  const candidatas = notas.filter(
    (n) => n.estado !== ESTADO.A_CONFERIR || !ehProvaDePagamento(n.origemPagamento),
  );

  // ⚠ A LEITURA DA CANDIDATA é acrescentada AQUI, e não dentro de `casarLote`: aquele módulo não
  // conhece estado, de propósito (há varredura provando). Ele responde "este débito paga esta
  // nota?"; o que se FAZ com o resultado é pergunta de estado, e mora em `estadosDeclarado.js`.
  const comLeitura = (c) => {
    if (!c) return c;
    const r = lerCandidata(c.nota);
    return { ...c, leitura: r.leitura, podeFundir: r.podeFundir, fraseDaCandidata: FRASE_DA_CANDIDATA[r.leitura] };
  };
  const linhas = casarLote(debitos, candidatas).map((l) => ({
    ...l,
    sugestao: comLeitura(l.sugestao),
    candidatos: (l.candidatos || []).map(comLeitura),
  }));

  return { linhas, totalDebitos: debitos.length, totalNotas: candidatas.length };
}

/**
 * ⚠⚠ O DÉBITO PREENCHE O PAGAMENTO DA NOTA — e some absorvido. Não nasce lançamento nenhum aqui.
 *
 * A nota sobrevive porque é ela que carrega o fornecedor, a descrição e a conta sugerida; o débito
 * carrega a data e a prova, e vira `FUNDIDO` apontando para ela. **Um registro por despesa**, que é
 * o que torna a contagem dupla impossível.
 */
export async function fundirPagamentoNaNota({
  portalClientId,
  declaradoOfxId,
  declaradoNotaId,
  usuarioId,
  agora,
  client = prisma,
}) {
  const debito = await acharDeclarado(client, portalClientId, declaradoOfxId);
  const nota = await acharDeclarado(client, portalClientId, declaradoNotaId);

  // ⚠⚠ OS DOIS LADOS TÊM DE SER DO TIPO CERTO — achado por auditoria em 25/08/2026, e PROVADO.
  //
  // Sem isto, uma NOTA podia ser fundida dentro de OUTRA NOTA: `FUNDIR` sai de `A_CONFERIR`, e uma
  // nota cujo pagamento o contador informou à mão está exatamente aí. O resultado medido foi **uma
  // despesa real DESAPARECENDO** (a de fevereiro virou `FUNDIDO` dentro da de janeiro) — o inverso
  // da contagem dupla, e igualmente caro.
  //
  // ⚠ E o comentário abaixo ("a nota recebe a PROVA do débito") só é verdade porque o lado que
  // some é obrigatoriamente do extrato: era ele quem trazia `origemPagamento: OFX`. Com uma nota
  // do lado esquerdo, a "prova" copiada era um `DECLARADO_PELO_CONTADOR`.
  if (debito?.origem !== ORIGEM.OFX_CLIENTE) recusar(RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE);
  if (nota?.origem === ORIGEM.OFX_CLIENTE) recusar(RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE);

  // ⚠⚠ A REGRA É RECONFERIDA AQUI, e não só na tela. A sugestão que o contador viu pode ter
  // envelhecido — a nota pode ter sido recusada, o valor ajustado, outro débito fundido nela. Quem
  // decide no instante do clique é o servidor.
  if (!debitoPagaNota(debito, nota).casa) recusar(RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE);

  // ⚠ A nota recebe a PROVA do débito, não uma declaração: `origemPagamento` viaja junto.
  //
  // ⚠⚠ DUAS TRANSIÇÕES, ESCOLHIDAS PELO ESTADO DA NOTA — e a segunda existe por decisão do dono
  // (27/08/2026): *"a prova vence, alargue o casamento"*.
  //
  //   `AGUARDANDO_PAGAMENTO` → `INFORMAR_PAGAMENTO`: a nota não tinha data. É o caso de sempre.
  //   `A_CONFERIR`           → `PROVAR_PAGAMENTO`:   o contador tinha DECLARADO a data à mão, e o
  //                            débito do extrato chegou depois. A prova substitui a afirmação.
  //
  // ⚠ Quem decide se pode continua sendo a máquina de estados: `PROVAR_PAGAMENTO` recusa se o que
  // entra não for prova, e recusa se a nota já tiver prova. Aqui só se escolhe qual pergunta fazer.
  //   `CONTABILIZADO` + `PRESUMIDO_POR_REGRA` → `CORRIGIR_DATA_PRESUMIDA`: a nota foi lançada
  //                            SOZINHA, na data fixa da regra. O extrato traz a data real.
  //
  /**
   * ⚠⚠ A TERCEIRA É A DE 29/08/2026, e ela é o que torna REVERSÍVEL a decisão do dono de lançar
   * numa data que ninguém provou. Sem ela, o débito real chegava e não tinha o que fazer: a nota
   * já estava contabilizada, a data presumida ficava para sempre, e contabilizar o débito à parte
   * seria a mesma despesa duas vezes.
   *
   * ⚠⚠ **A ESCOLHA É POR IGUALDADE EXATA DA ORIGEM**, nunca por `!ehProvaDePagamento`: com a
   * negação, uma nota que o contador contabilizou com data DECLARADA por ele cairia aqui, e a
   * decisão dele seria sobrescrita em silêncio. Essa nota continua em `JA_CONTABILIZADA`, que não
   * funde — e a máquina de estados recusaria de qualquer forma (`DATA_NAO_E_PRESUMIDA`).
   */
  const dataPresumidaPorRegra = nota?.estado === ESTADO.CONTABILIZADO
    && nota?.origemPagamento === ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA;

  const transicaoDaNota = dataPresumidaPorRegra
    ? TRANSICAO.CORRIGIR_DATA_PRESUMIDA
    : nota?.estado === ESTADO.A_CONFERIR
      ? TRANSICAO.PROVAR_PAGAMENTO
      : TRANSICAO.INFORMAR_PAGAMENTO;
  const naNota = podeTransitar(nota, transicaoDaNota, {
    dataPagamento: debito.dataPagamento,
    origemPagamento: debito.origemPagamento,
  });
  if (!naNota.ok) recusar(naNota.motivo, naNota.frase);

  const noDebito = podeTransitar(debito, TRANSICAO.FUNDIR, { parDeclaradoId: nota.id });
  if (!noDebito.ok) recusar(noDebito.motivo, noDebito.frase);

  /**
   * ⚠⚠ MÊS FECHADO RECUSA — e a guarda nasceu junto com a correção da data (29/08/2026).
   *
   * Até aqui a fusão não encostava no razão, e por isso não precisava dela. A correção encosta:
   * ela escreve a data do `AccountingEntry`. Mudar a data de um lançamento que o fechamento já
   * conferiu é escrever num mês fechado sem rastro de reabertura — a mesma recusa que
   * `aplicarTransicao` aplica ao ramo `CORRIGIR_DATA_PRESUMIDA`.
   *
   * ⚠ Ela vale **só** para este ramo: as outras duas transições continuam sem tocar no razão, e
   * exigir mês aberto nelas pararia trabalho que sempre foi legítimo.
   */
  if (dataPresumidaPorRegra && (await isMonthClosed(portalClientId, nota.competencia))) {
    recusar(RECUSA_DO_SERVICO.MES_FECHADO);
  }

  const auditoria = { decididoPor: String(usuarioId || ""), decididoEm: agora };

  // ⚠⚠ AS DUAS ESCRITAS SÃO UM ATO. Meio caminho deixaria o débito absorvido com a nota ainda
  // esperando pagamento — a despesa some da fila e ninguém a acha.
  return client.$transaction(async (tx) => {
    // ⚠⚠ A ESCRITA CARREGA O ESTADO NO `where` — e isto é o que impede a CONTAGEM DUPLA.
    //
    // Achado por auditoria em 25/08/2026, e PROVADO com dois requests concorrentes: a leitura e a
    // reconferência acontecem FORA da transação, então dois cliques fundiam o MESMO débito em DUAS
    // notas. As duas ficavam `A_CONFERIR` com a mesma data e o mesmo `fitId`, e as duas podiam
    // virar lançamento — **a mesma saída de caixa creditada duas vezes**, em silêncio.
    //
    // ⚠ `updateMany` com o estado no `where` + leitura do `count` é a MESMA disciplina da reserva
    // atômica da emissão em lote, que o `apps/api/CLAUDE.md` descreve como *"isto — e não o lock —
    // é o que impede a nota duplicada"*. Sequencialmente a máquina de estados já protegia; só a
    // corrida passava.
    // ⚠⚠ O DÉBITO É ESCRITO PRIMEIRO, E A ORDEM É A PROTEÇÃO — não é arbitrária.
    //
    // O lado do débito tem a pré-condição MAIS RESTRITIVA (`estado` + `parDeclaradoId: null`), e é
    // ele que a corrida disputa: dois cliques querem o MESMO débito. Barrando aqui, o segundo
    // request para **antes de encostar na nota**.
    //
    // ⚠ Invertido (nota primeiro), a proteção passaria a depender do ROLLBACK: a nota já teria
    // sido escrita quando o débito falhasse. Com Postgres o rollback existe e desfaz — mas fazer a
    // correção depender dele é fazer a garantia depender de uma camada que este arquivo não
    // controla. Medido: com a ordem invertida e sem rollback, DUAS notas ficam pagas pelo mesmo
    // débito; com esta ordem, uma só.
    const noDebitoEscrito = await tx.lancamentoDeclarado.updateMany({
      where: {
        id: debito.id,
        portalClientId: String(portalClientId),
        estado: debito.estado,
        // ⚠ Um débito já fundido não se funde de novo, nem que o estado tenha voltado por outro caminho.
        parDeclaradoId: null,
      },
      data: { ...noDebito.campos, estado: noDebito.estado, ...auditoria },
    });
    if (noDebitoEscrito.count !== 1) recusar(RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE);

    const naNotaEscrita = await tx.lancamentoDeclarado.updateMany({
      where: { id: nota.id, portalClientId: String(portalClientId), estado: nota.estado },
      data: {
        ...naNota.campos,
        estado: naNota.estado,
        // ⚠ A procedência do extrato vai junto: é ela que faz a nota deixar de ser palpite.
        ofxImportId: debito.ofxImportId,
        fitId: debito.fitId,
        contaBancariaRef: debito.contaBancariaRef,
        ...auditoria,
      },
    });
    // ⚠ Aqui a recusa DEPENDE do rollback para desfazer o débito — e é o caso raro (a nota mudou
    // entre a leitura e agora). O caso comum, a disputa pelo débito, já foi barrado acima.
    if (naNotaEscrita.count !== 1) recusar(RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE);

    /**
     * ⚠⚠ A DATA DO LANÇAMENTO QUE JÁ EXISTE — e **nenhum lançamento é criado aqui**.
     *
     * É a metade que o comentário da matriz de transições exigia: *"`CONTABILIZADO` fica fora
     * porque lá a data já virou a data do `AccountingEntry` — trocá-la aqui deixaria lançamento e
     * declarado discordando."* Sem esta escrita, na MESMA transação, a correção seria exatamente o
     * defeito que aquele comentário descreve.
     *
     * ⚠ `updateMany` com o `portalClientId` no `where`, nunca `update` pelo id: o lançamento pode
     * ter sido apagado por fora (não há FK, de propósito), e um P2025 aqui derrubaria a fusão
     * inteira — o débito voltaria à fila e seria contabilizado à parte, que é a contagem dupla.
     * ⚠⚠ **SÓ A DATA.** Valor, contas e histórico não mudam: o extrato prova QUANDO o dinheiro
     * saiu, nunca quanto nem de onde.
     */
    if (dataPresumidaPorRegra && nota.accountingEntryId) {
      await tx.accountingEntry.updateMany({
        where: { id: nota.accountingEntryId, portalClientId: String(portalClientId) },
        data: { data: naNota.campos.dataPagamento },
      });
    }

    return tx.lancamentoDeclarado.findFirst({
      where: { id: nota.id, portalClientId: String(portalClientId) },
    });
  });
}

/**
 * ⚠⚠⚠ LIBERAR A DESPESA NO FLUXO — sem lançar nada. Decisão do dono, 01/09/2026.
 *
 * > *"temos um botão fluxo, que apenas libera no fluxo mas não lança"*, e sobre a data:
 * > **"na data da emissão mais o contador pode alterar"**.
 *
 * ⚠⚠ **É O SEGUNDO VERBO DA MESMA LINHA, e a diferença entre os dois é a invariante do caixa:**
 *
 *   · **Lançar** → cria `AccountingEntry` (`D despesa / C caixa`) e AFIRMA que o dinheiro saiu.
 *     Exige `dataPagamento`, que é prova ou declaração.
 *   · **Fluxo**  → só diz *"esta despesa deve sair por volta de tal dia"*. Não toca no razão, e a
 *     linha entra no fluxo do cliente como **PREVISÃO**.
 *
 * A regra do dono, dita por ele: *"tudo que virar lançamento deve entrar no fluxo, mas nem tudo do
 * fluxo necessariamente deve ser um lançamento"*. Este verbo é a segunda metade dela.
 *
 * ⚠ **PRESENÇA DA DATA = LIBERADA.** Não há estado novo — um estado a mais faria a fila ter duas
 * gramáticas para a mesma linha. `data: null` **tira** do fluxo.
 *
 * ⚠⚠ **NADA É INVENTADO QUANDO NÃO HÁ DATA.** Omitindo `data`, cai na **emissão da nota**, que foi a
 * escolha do dono e é um dado que existe. Sem `dataDocumento` a resposta é RECUSA nomeada, nunca
 * "hoje" nem o fim da competência: o fluxo é uma linha do tempo, e um dia chutado ali vira uma
 * afirmação sobre quando a empresa vai ficar sem dinheiro.
 */
export async function liberarDeclaradoNoFluxo({
  portalClientId, declaradoId, data, usuarioId, client = prisma,
}) {
  const declarado = await client.lancamentoDeclarado.findFirst({
    where: { id: String(declaradoId), portalClientId: String(portalClientId) },
    select: { id: true, estado: true, dataDocumento: true, accountingEntryId: true },
  });
  if (!declarado) recusar(RECUSA_DO_SERVICO.NAO_ENCONTRADO);

  // ⚠ Tirar do fluxo é sempre permitido: é desfazer uma previsão, e desfazer não afirma nada.
  const tirando = data === null;

  if (!tirando) {
    /**
     * ⚠⚠ JÁ LANÇADA NÃO SE LIBERA — e a recusa evita CONTAGEM DUPLA, não burocracia.
     *
     * O lançamento dela já é uma linha do fluxo por direito próprio (`FONTE.DESPESA_LANCADA`, como
     * FATO). Uma previsão ao lado somaria o mesmo dinheiro duas vezes na tela do cliente.
     */
    if (declarado.accountingEntryId) recusar(RECUSA_DO_SERVICO.JA_LANCADO_NO_FLUXO);
    // ⚠ Recusada é uma despesa que o contador disse não existir. Pô-la no fluxo do cliente diria o
    // contrário do que ele acabou de decidir.
    if (declarado.estado === ESTADO.RECUSADO) recusar(RECUSA_DO_SERVICO.RECUSADO_NAO_VAI_AO_FLUXO);
  }

  const escolhida = tirando
    ? null
    // ⚠ `undefined` = "não mandei data" ⇒ cai na emissão. `null` = "tire do fluxo". As duas não
    // podem se confundir, e é por isso que a comparação é `=== undefined`, nunca `!data`.
    : (data === undefined ? declarado.dataDocumento : lerDataDoFluxo(data));

  if (!tirando && !escolhida) recusar(RECUSA_DO_SERVICO.SEM_DATA_PARA_O_FLUXO);

  return client.lancamentoDeclarado.update({
    where: { id: declarado.id },
    data: {
      previstoNoFluxoEm: escolhida,
      // ⚠ Quem liberou fica registrado no mesmo campo que as outras decisões desta fila usam — a
      // previsão que o cliente vê saiu de um ato de alguém, e a tela precisa poder dizer de quem.
      decididoPor: String(usuarioId || "") || undefined,
    },
    select: { id: true, previstoNoFluxoEm: true },
  });
}

/**
 * ⚠ A data CIVIL vem como `AAAA-MM-DD` e é montada em UTC, por pedaço — nunca `new Date(texto)`.
 *
 * `new Date("2026-09-18")` já é UTC, mas `new Date("2026-09-18T00:00")` é local: as duas formas
 * chegam de clientes diferentes e uma delas desloca o dia. Montar por pedaço não tem esse ramo.
 */
function lerDataDoFluxo(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}
