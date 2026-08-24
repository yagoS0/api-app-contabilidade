// A NOTA RECEBIDA VIRA UM DECLARADO DE DESPESA.
//
// > Pedido do dono (24/08/2026): *"as notas são informações de despesas, devemos poder usar as
// > notas recebidas para gerar lançamento."*
//
// ## ⚠⚠ ELA NÃO VIRA LANÇAMENTO — VIRA UM DECLARADO ESPERANDO O PAGAMENTO
//
// Medido: os 155 lançamentos `tipo: "DESPESA"` desta casa são `1D / 1C` creditando **CAIXA**. O
// lançamento de despesa aqui AFIRMA A SAÍDA DO DINHEIRO, e a nota **não sabe quando o dinheiro
// saiu**. Então ela entra em `AGUARDANDO_PAGAMENTO`, dizendo *que* despesa é e *de quem*; quem diz
// *quando* é o pagamento — o débito do extrato, ou a data que o contador informar.
//
// ## ⚠⚠ NADA É INVENTADO
//
// Nota sem valor, sem data ou sem emitente **NÃO VIRA DESPESA**. Ela volta com o motivo nomeado e
// entra no relatório da varredura. Fabricar despesa a partir de documento incompleto é a coisa mais
// cara que este módulo poderia fazer, e ela seria invisível.
//
// ⚠ ESTE MÓDULO É PURO. Não consulta banco, não lê o relógio e não escreve nada.

/** ⚠ Vocabulário FECHADO. Cada motivo é uma linha do relatório, e cada um pede conserto diferente. */
export const NAO_VIRA = Object.freeze({
  NAO_E_RECEBIDA: "nao_e_recebida",
  CANCELADA: "cancelada",
  SUBSTITUIDA: "substituida",
  SEM_VALOR: "sem_valor",
  SEM_DATA: "sem_data",
  SEM_EMITENTE: "sem_emitente",
  ANTES_DA_DATA_PISO: "antes_da_data_piso",
});

export const FRASE_DO_NAO_VIRA = Object.freeze({
  [NAO_VIRA.NAO_E_RECEBIDA]: "Esta nota foi emitida pela empresa, não recebida por ela.",
  [NAO_VIRA.CANCELADA]: "A nota está cancelada.",
  [NAO_VIRA.SUBSTITUIDA]: "A nota foi substituída por outra.",
  [NAO_VIRA.SEM_VALOR]: "A nota não tem valor. Sem ele não há despesa a declarar.",
  [NAO_VIRA.SEM_DATA]: "A nota não tem data de emissão.",
  [NAO_VIRA.SEM_EMITENTE]:
    "A nota não diz quem a emitiu. O nome do fornecedor é o histórico do lançamento; sem ele não há o que escrever no razão.",
  [NAO_VIRA.ANTES_DA_DATA_PISO]: "A nota é anterior à data a partir da qual a fila foi ligada.",
});

/** A situação que impede. ⚠ Vem de `derivarCiclo`, nunca de `statusEfetivo` lido cru. */
const SITUACAO_QUE_IMPEDE = Object.freeze({
  cancelada: NAO_VIRA.CANCELADA,
  substituida: NAO_VIRA.SUBSTITUIDA,
});

const naoVira = (motivo) => ({ ok: false, motivo, frase: FRASE_DO_NAO_VIRA[motivo] || "", dados: null });

/**
 * ⚠⚠ AS DUAS COMPETÊNCIAS NÃO TÊM O MESMO TIPO, e confundi-las é silencioso.
 *
 * `PortalInvoice.competencia` é **DateTime**; `LancamentoDeclarado.competencia` e
 * `AccountingEntry.competencia` são **String "AAAA-MM"**. Um `String(nota.competencia)` gravaria
 * `"Wed Jul 01 2026..."` — que passa no Prisma (a coluna é texto), passa no `create`, e só aparece
 * como lançamento que nenhum filtro de competência encontra.
 *
 * ⚠ A fatia é da ISO em UTC, o mesmo critério de `utils/dataCivil.js`: converter para o fuso do
 * processo faria a nota do dia 1º cair no mês anterior.
 */
function competenciaDaNota(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 7);
}

/**
 * ⚠⚠ A IMPRESSÃO DIGITAL DA NOTA. É ela que faz rodar a varredura duas vezes não duplicar a fila —
 * e "rodei de novo" é o caso NORMAL aqui, porque a captura de notas roda sozinha.
 *
 * ⚠ Sai do `PortalInvoice.id`, não da chave de acesso: 100% das linhas têm id, e as NF-e recebidas
 * são resumos que podem chegar sem chave.
 */
export const hashDaNota = (notaId) => `NOTA:${String(notaId || "").trim()}`;

/**
 * @param {object} nota linha de `PortalInvoice`
 * @param {object} opcoes
 * @param {string} [opcoes.situacao] o `situacao` de `derivarCiclo` — ⚠ obrigatório na prática
 * @param {Date}   [opcoes.dataPiso] ⚠ notas anteriores a esta data ficam FORA
 * @param {string} [opcoes.contaSugerida] `codigoCompleto` que o aprendizado sugeriu (Fase C)
 */
export function notaViraDeclarado(nota, opcoes = {}) {
  // ⚠ SÓ NOTA RECEBIDA. A emitida é receita da empresa, não despesa — e o dono já separou as duas
  // espécies na tela justamente para elas não se misturarem.
  if (String(nota?.papel || "").toUpperCase() !== "DEST") return naoVira(NAO_VIRA.NAO_E_RECEBIDA);

  // ⚠⚠ A SITUAÇÃO VEM DE `derivarCiclo`, e o que ela acrescenta a `statusEfetivo` é REAL: aquela
  // coluna só guarda `autorizada|cancelada`, então **substituição não cabe nela**. O ciclo separa
  // as duas por três evidências (o evento, a chave da substituta no evento, ou outra nota da base
  // declarando substituir esta — a que salva os casos em que o evento se perdeu).
  //
  // ⚠ Para ESTA regra as duas impedem igual — mas o motivo que volta ao relatório é diferente, e é
  // o que o contador lê. A lista e o detalhe da nota já divergiram uma vez exatamente aqui:
  // "substituída" numa tela e "cancelada" na outra, sobre a MESMA nota.
  const impede = SITUACAO_QUE_IMPEDE[String(opcoes.situacao || "").toLowerCase()];
  if (impede) return naoVira(impede);

  const valor = Number(nota?.total);
  if (!Number.isFinite(valor) || valor <= 0) return naoVira(NAO_VIRA.SEM_VALOR);

  // ⚠⚠ `new Date(null)` É `1970-01-01T00:00:00.000Z` — uma data VÁLIDA. Sem esta guarda, nota sem
  // emissão viraria despesa datada de 1970: ela ordenaria a fila inteira e abriria uma janela de
  // meio século no casamento com o pagamento. Mesma família de `Number.isFinite(Number(null))`,
  // que já mordeu este projeto. (`new Date(undefined)` e `new Date("banana")` são inválidas e
  // seriam pegas; `null` é a única que passa.)
  const bruta = nota?.issueDate;
  if (bruta === null || bruta === undefined || bruta === "") return naoVira(NAO_VIRA.SEM_DATA);
  const emissao = bruta instanceof Date ? bruta : new Date(bruta);
  if (Number.isNaN(emissao.getTime())) return naoVira(NAO_VIRA.SEM_DATA);

  // ⚠⚠ A DATA-PISO É OBRIGATÓRIA NA PRÁTICA. São 1.897 NFS-e recebidas na base: sem piso, a
  // primeira varredura produz 1.897 linhas de fila de uma vez — e isso não é fila, é muro.
  if (opcoes.dataPiso instanceof Date && emissao < opcoes.dataPiso) {
    return naoVira(NAO_VIRA.ANTES_DA_DATA_PISO);
  }

  // ⚠ O NOME DO EMITENTE É O HISTÓRICO, e isso é MEDIDO: os 130 lançamentos vindos do Excel gravam
  // exatamente o nome do fornecedor ("KODA BEAR", "GOOGLE CLOUD BRASIL…"). O `xDescServ` é mais
  // rico, mas trocar o formato do histórico mudaria o que o razão mostra.
  const nome = String(nota?.emitenteNome || "").trim();
  if (!nome) return naoVira(NAO_VIRA.SEM_EMITENTE);

  return {
    ok: true,
    motivo: null,
    frase: "",
    dados: {
      origem: "NOTA_RECEBIDA",
      tipo: "SAIDA",
      valor,
      // ⚠ Pode ser NULA, e fica nula. Deduzi-la da EMISSÃO seria o sistema decidindo em qual
      // apuração a despesa entra — a mesma recusa que a auditoria de notas já aplica.
      competencia: competenciaDaNota(nota?.competencia),
      descricaoOriginal: nome,
      // ⚠ Detalhe para a TELA. As NF-e recebidas são resumos e não têm `xDescServ`: fica nulo, e
      // nulo aqui quer dizer "o documento não traz", nunca "não olhamos".
      detalheServico: nota?.xDescServ ? String(nota.xDescServ) : null,
      dataDocumento: emissao,
      cnpjFornecedor: nota?.emitenteDoc ? String(nota.emitenteDoc) : null,
      notaRecebidaId: String(nota.id),
      hashDedupe: hashDaNota(nota.id),
      contaSugerida: opcoes.contaSugerida || null,
      // ⚠⚠ NÃO HÁ `dataPagamento`, e a ausência é o ponto: é ela que faz o declarado nascer em
      // `AGUARDANDO_PAGAMENTO` e nunca virar lançamento sozinho.
    },
  };
}

/**
 * Roda a regra sobre um lote e SEPARA — nunca esconde o que ficou de fora.
 *
 * ⚠ O que não virou despesa volta AGRUPADO POR MOTIVO. Uma varredura que só dissesse "criei 12"
 * faria as outras 1.885 desaparecerem sem ninguém saber por quê, e "não veio nada" ficaria
 * indistinguível de "deu erro" — o defeito que este projeto já documenta no lote de captura.
 */
export function separarNotas(notas, resolverOpcoes) {
  const viram = [];
  const foraPorMotivo = new Map();

  for (const nota of notas || []) {
    const r = notaViraDeclarado(nota, resolverOpcoes ? resolverOpcoes(nota) : {});
    if (r.ok) {
      viram.push({ nota, dados: r.dados });
      continue;
    }
    if (!foraPorMotivo.has(r.motivo)) foraPorMotivo.set(r.motivo, { motivo: r.motivo, frase: r.frase, n: 0, exemplos: [] });
    const g = foraPorMotivo.get(r.motivo);
    g.n += 1;
    // ⚠ Amostra pequena: o relatório é para ler, e uma lista de 1.885 ids não é lida por ninguém.
    if (g.exemplos.length < 5) g.exemplos.push(String(nota?.id || ""));
  }

  return {
    viram,
    // ⚠ Do motivo mais frequente para o menos — é a ordem em que alguém consegue agir.
    fora: [...foraPorMotivo.values()].sort((a, b) => b.n - a.n),
  };
}
