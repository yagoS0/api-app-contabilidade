// A MÁQUINA DE ESTADOS DO LANÇAMENTO DECLARADO.
//
// ## O que é um "declarado"
//
// Um fato de despesa que ainda NÃO é lançamento contábil. Ele nasce de três lugares — uma nota
// recebida, o cliente digitando no portal, ou um débito do extrato — e só vira `AccountingEntry`
// quando o contador confirma.
//
// ## ⚠⚠ A REGRA QUE ORGANIZA TUDO: UM REGISTRO POR DESPESA
//
// A nota e o pagamento são duas FACES do mesmo registro, nunca dois registros. A nota diz **que
// despesa é** e **de quem**; o pagamento diz **quando o dinheiro saiu**. É isso que torna a
// contagem dupla impossível por construção, em vez de ser uma regra que alguém pode furar.
//
// ## ⚠⚠ E A INVARIANTE MAIS CARA: SEM DATA DE PAGAMENTO NÃO SE LANÇA
//
// Medido em produção (`scripts/diag-forma-despesa.mjs`, 24/08/2026): **155 de 155** lançamentos
// `tipo: "DESPESA"` desta casa são `1D / 1C` com o crédito na conta de **CAIXA**. Ou seja, o
// lançamento de despesa aqui **AFIRMA A SAÍDA DO DINHEIRO**.
//
// A nota recebida não sabe quando o dinheiro saiu. Lançá-la na data de emissão mentiria sobre o
// caixa em toda despesa a prazo — e mentiria em silêncio, que é o pior modo. Por isso
// `AGUARDANDO_PAGAMENTO` existe: é a resposta honesta enquanto a data não for conhecida.
//
// ⚠ **`AGUARDANDO_PAGAMENTO` NÃO É PRISÃO** — decisão do dono, 24/08/2026: *"o contador pode
// decidir colocar aquela nota como despesa naquele momento, mesmo sem comprovante."* Ele confirma
// direto de lá, informando a data; o que se grava é que a data foi **declarada**, não provada
// (`ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR`). Mesma disciplina da baixa manual de parcela, que já
// grava `origemBaixa: "MANUAL"` e escreve "(declarado)" no histórico.
//
// ⚠ ESTE MÓDULO É PURO. Nenhum import de prisma, nenhuma data do relógio, nenhum I/O. Quem liga
// isto ao banco é `DeclaradoService.js` — mesma separação de `familiaDaConta.js` × `MotorRegras.js`.

/** Os estados. Lista FECHADA — estado que não está aqui não existe. */
export const ESTADO = Object.freeze({
  /** A despesa é conhecida; a data em que o dinheiro saiu, não. ⚠ NUNCA vira lançamento assim. */
  AGUARDANDO_PAGAMENTO: "AGUARDANDO_PAGAMENTO",
  /** Tem tudo que o lançamento precisa. Espera a palavra do contador. */
  A_CONFERIR: "A_CONFERIR",
  /** Virou `AccountingEntry`. */
  CONTABILIZADO: "CONTABILIZADO",
  /** O contador disse que isto não é despesa desta empresa. ⚠ Reversível — ver `REABRIR`. */
  RECUSADO: "RECUSADO",
  /** Era a mesma despesa que outro declarado. ⚠ O produtor disto chega na Fase B2. */
  FUNDIDO: "FUNDIDO",
});

/** De onde o declarado nasceu. */
export const ORIGEM = Object.freeze({
  NOTA_RECEBIDA: "NOTA_RECEBIDA",
  CLIENTE_MANUAL: "CLIENTE_MANUAL",
  OFX_CLIENTE: "OFX_CLIENTE",
});

/**
 * ⚠⚠ DE ONDE VEIO A DATA DO PAGAMENTO — prova × declaração.
 *
 * Não é detalhe de auditoria: é a diferença entre "o banco mostra o débito" e "o contador afirma
 * que pagou". Quando a via do extrato existir para uma despesa já declarada, o contador precisa
 * saber qual das duas ele está olhando.
 */
export const ORIGEM_PAGAMENTO = Object.freeze({
  /** O débito apareceu no extrato. Prova. */
  OFX: "OFX",
  /** O contador informou. ⚠ Declaração, não prova — e a tela tem de dizer isso. */
  DECLARADO_PELO_CONTADOR: "DECLARADO_PELO_CONTADOR",
  /** O cliente lançou pelo portal, informando a data. Declaração. */
  CLIENTE: "CLIENTE",
});

/** Os atos. Lista FECHADA. */
export const TRANSICAO = Object.freeze({
  INFORMAR_PAGAMENTO: "INFORMAR_PAGAMENTO",
  CONFIRMAR: "CONFIRMAR",
  AJUSTAR: "AJUSTAR",
  RECUSAR: "RECUSAR",
  REABRIR: "REABRIR",
  FUNDIR: "FUNDIR",
  DESFAZER: "DESFAZER",
});

/**
 * Os motivos de recusa. ⚠ Vocabulário FECHADO, e cada um aponta um conserto DIFERENTE — recusa
 * genérica ("não pode") manda o contador adivinhar o que fazer.
 */
export const RECUSA = Object.freeze({
  ESTADO_DESCONHECIDO: "estado_desconhecido",
  TRANSICAO_DESCONHECIDA: "transicao_desconhecida",
  TRANSICAO_INVALIDA_NESTE_ESTADO: "transicao_invalida_neste_estado",
  /** ⚠⚠ A invariante mais cara do módulo. */
  SEM_DATA_DE_PAGAMENTO: "sem_data_de_pagamento",
  DATA_DE_PAGAMENTO_INVALIDA: "data_de_pagamento_invalida",
  ORIGEM_DE_PAGAMENTO_INVALIDA: "origem_de_pagamento_invalida",
  SEM_CONTA: "sem_conta",
  SEM_MOTIVO: "sem_motivo",
  SEM_PAR: "sem_par",
  VALOR_AJUSTADO_INVALIDO: "valor_ajustado_invalido",
});

/** A frase de cada recusa, para a tela não escrever a sua. */
export const FRASE_DA_RECUSA = Object.freeze({
  [RECUSA.ESTADO_DESCONHECIDO]: "Este lançamento está num estado que o sistema não conhece.",
  [RECUSA.TRANSICAO_DESCONHECIDA]: "Esta ação não existe.",
  [RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO]: "Esta ação não se aplica ao estado atual do lançamento.",
  [RECUSA.SEM_DATA_DE_PAGAMENTO]:
    "Informe a data em que o dinheiro saiu da conta. O lançamento de despesa desta casa credita o caixa, então ele afirma a saída — sem a data, essa afirmação não pode ser feita.",
  [RECUSA.DATA_DE_PAGAMENTO_INVALIDA]: "A data do pagamento não é uma data válida.",
  [RECUSA.ORIGEM_DE_PAGAMENTO_INVALIDA]: "Não foi dito se a data do pagamento é prova ou declaração.",
  [RECUSA.SEM_CONTA]: "Escolha a conta contábil da despesa.",
  [RECUSA.SEM_MOTIVO]: "Diga por que este lançamento está sendo recusado.",
  [RECUSA.SEM_PAR]: "A fusão precisa apontar qual é o outro lançamento.",
  [RECUSA.VALOR_AJUSTADO_INVALIDO]: "O valor ajustado precisa ser um número maior que zero.",
});

/**
 * Onde cada ato pode acontecer. ⚠ Mapa de INCLUSÃO: estado que não está na lista de uma transição
 * a recusa por construção, e estado NOVO nasce bloqueado em vez de nascer permitido.
 */
const ORIGENS_VALIDAS = Object.freeze({
  [TRANSICAO.INFORMAR_PAGAMENTO]: [ESTADO.AGUARDANDO_PAGAMENTO],
  // ⚠ CONFIRMAR aceita `AGUARDANDO_PAGAMENTO` de propósito: é o "lançar agora, mesmo sem
  // comprovante" que o dono pediu. Ele não afrouxa a invariante — quem confirma de lá tem de
  // mandar a data no mesmo ato, e a recusa é a mesma.
  [TRANSICAO.CONFIRMAR]: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR],
  [TRANSICAO.AJUSTAR]: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR],
  [TRANSICAO.RECUSAR]: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR],
  // ⚠ REABRIR existe para RECUSADO não ser beco sem saída. Recusar por engano uma nota deixaria a
  // despesa dela inalcançável para sempre, em silêncio — e esta casa já pagou por becos assim.
  [TRANSICAO.REABRIR]: [ESTADO.RECUSADO],
  [TRANSICAO.FUNDIR]: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR],
  [TRANSICAO.DESFAZER]: [ESTADO.CONTABILIZADO],
});

const ehData = (v) => v instanceof Date && !Number.isNaN(v.getTime());

const recusa = (motivo) => ({ ok: false, motivo, frase: FRASE_DA_RECUSA[motivo] || "", estado: null, campos: null });
const aceita = (estado, campos) => ({ ok: true, motivo: null, frase: null, estado, campos: campos || {} });

/**
 * A data do pagamento DEPOIS deste ato: a que o ato traz vence a que já estava.
 *
 * ⚠ `undefined` = "não mexer"; a distinção entre não vir e vir nulo é a mesma disciplina do
 * `PATCH` da empresa (`undefined` não mexe, `null` apaga).
 */
function pagamentoResultante(declarado, dados) {
  const trouxe = Object.prototype.hasOwnProperty.call(dados || {}, "dataPagamento");
  return {
    data: trouxe ? dados.dataPagamento : declarado?.dataPagamento ?? null,
    origem: trouxe ? dados?.origemPagamento ?? null : declarado?.origemPagamento ?? null,
    trouxe,
  };
}

/** Confere o bloco de pagamento resultante. Devolve `null` quando está bom. */
function conferirPagamento(pag) {
  if (pag.data === null || pag.data === undefined) return RECUSA.SEM_DATA_DE_PAGAMENTO;
  if (!ehData(pag.data)) return RECUSA.DATA_DE_PAGAMENTO_INVALIDA;
  if (!Object.values(ORIGEM_PAGAMENTO).includes(pag.origem)) return RECUSA.ORIGEM_DE_PAGAMENTO_INVALIDA;
  return null;
}

/**
 * A pergunta única do módulo: **este ato pode acontecer sobre este declarado?**
 *
 * Devolve `{ ok, motivo, frase, estado, campos }` — `estado` é o estado DEPOIS, e `campos` são as
 * colunas que a transição escreve, prontas para o `update`. ⚠ Ele NÃO escreve nada: quem grava é o
 * serviço, dentro da transação que também cria o `AccountingEntry`.
 *
 * @param {{estado: string, dataPagamento?: Date|null, origemPagamento?: string|null, contaSugerida?: string|null, contaAplicada?: string|null}} declarado
 * @param {string} transicao um valor de `TRANSICAO`
 * @param {object} [dados] o que o ato traz (data, conta, motivo, par, valor)
 */
export function podeTransitar(declarado, transicao, dados = {}) {
  const estadoAtual = declarado?.estado;
  if (!Object.values(ESTADO).includes(estadoAtual)) return recusa(RECUSA.ESTADO_DESCONHECIDO);

  const permitidos = ORIGENS_VALIDAS[transicao];
  if (!permitidos) return recusa(RECUSA.TRANSICAO_DESCONHECIDA);
  if (!permitidos.includes(estadoAtual)) return recusa(RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO);

  switch (transicao) {
    case TRANSICAO.INFORMAR_PAGAMENTO: {
      const pag = pagamentoResultante(declarado, dados);
      const erro = conferirPagamento(pag);
      if (erro) return recusa(erro);
      return aceita(ESTADO.A_CONFERIR, { dataPagamento: pag.data, origemPagamento: pag.origem });
    }

    case TRANSICAO.CONFIRMAR:
    case TRANSICAO.AJUSTAR: {
      // ⚠⚠ A INVARIANTE: sem data de pagamento não se contabiliza, venha de onde vier.
      const pag = pagamentoResultante(declarado, dados);
      const erro = conferirPagamento(pag);
      if (erro) return recusa(erro);

      // ⚠ A conta do ato vence a sugerida — mas a sugerida SOZINHA basta: confirmar é justamente
      // dizer "a sugestão está certa". Vazia nos dois lados, recusa.
      const conta = String(dados?.contaAplicada ?? declarado?.contaSugerida ?? "").trim();
      if (!conta) return recusa(RECUSA.SEM_CONTA);

      const campos = {
        dataPagamento: pag.data,
        origemPagamento: pag.origem,
        contaAplicada: conta,
      };

      if (transicao === TRANSICAO.AJUSTAR) {
        const v = Number(dados?.valorAjustado);
        if (!Number.isFinite(v) || v <= 0) return recusa(RECUSA.VALOR_AJUSTADO_INVALIDO);
        campos.valorAjustado = v;
      }
      return aceita(ESTADO.CONTABILIZADO, campos);
    }

    case TRANSICAO.RECUSAR: {
      // ⚠ Ausência nunca é resposta: recusa sem motivo apaga a informação de por que aquela nota
      // não virou despesa, que é exatamente o que alguém vai querer saber daqui a três meses.
      const motivo = String(dados?.motivoRecusa || "").trim();
      if (!motivo) return recusa(RECUSA.SEM_MOTIVO);
      return aceita(ESTADO.RECUSADO, { motivoRecusa: motivo });
    }

    case TRANSICAO.REABRIR: {
      // ⚠ Volta para onde a EVIDÊNCIA manda, não para um estado fixo: com data de pagamento ele
      // está pronto para conferência; sem ela, continua esperando o pagamento.
      const temPagamento = ehData(declarado?.dataPagamento);
      return aceita(temPagamento ? ESTADO.A_CONFERIR : ESTADO.AGUARDANDO_PAGAMENTO, { motivoRecusa: null });
    }

    case TRANSICAO.FUNDIR: {
      const par = String(dados?.parDeclaradoId || "").trim();
      if (!par) return recusa(RECUSA.SEM_PAR);
      return aceita(ESTADO.FUNDIDO, { parDeclaradoId: par });
    }

    case TRANSICAO.DESFAZER: {
      // ⚠ Desfazer o LANÇAMENTO não é desfazer a DECLARAÇÃO DA DATA. Quem declarou a data continua
      // tendo declarado; ela fica à vista e editável. Por isso volta a `A_CONFERIR` — em
      // `CONTABILIZADO` a data existe sempre, pela invariante acima.
      return aceita(ESTADO.A_CONFERIR, { accountingEntryId: null, regraId: null });
    }

    default:
      return recusa(RECUSA.TRANSICAO_DESCONHECIDA);
  }
}

/**
 * ⚠ Um declarado pode virar `AccountingEntry`?
 *
 * A mesma pergunta da invariante, isolada para a VARREDURA poder fazê-la sobre o banco inteiro sem
 * simular uma transição. Duas leituras da mesma regra divergiriam na primeira correção — por isso
 * ela chama `podeTransitar`, e não reimplementa.
 */
export function podeVirarLancamento(declarado) {
  return podeTransitar(declarado, TRANSICAO.CONFIRMAR).ok;
}

/** Os estados em que o declarado ainda espera alguma coisa de alguém. */
export const ESTADOS_VIVOS = Object.freeze([ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR]);

/** ⚠ Os estados em que existir um `AccountingEntry` vinculado é DEFEITO. Alimenta a varredura. */
export const ESTADOS_SEM_LANCAMENTO = Object.freeze([
  ESTADO.AGUARDANDO_PAGAMENTO,
  ESTADO.A_CONFERIR,
  ESTADO.RECUSADO,
  ESTADO.FUNDIDO,
]);
