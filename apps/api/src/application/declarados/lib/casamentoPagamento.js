// O DÉBITO DO EXTRATO CASA COM A NOTA QUE ELE PAGOU?
//
// ## ⚠⚠ O QUE ESTE CASAMENTO FAZ, E O QUE ELE NÃO FAZ
//
// A nota recebida diz **que despesa é** e **de quem**; o débito do extrato diz **quando o dinheiro
// saiu**. Casá-los NÃO cria uma segunda despesa: o débito **preenche o bloco de pagamento** da nota
// que já está na fila, e some absorvido (`FUNDIDO`). É isso que torna a contagem dupla impossível.
//
// ⚠⚠ **ELE NUNCA AUTOMATIZA. NUNCA.** Todo resultado aqui é SUGESTÃO — quem confirma é o contador.
// O motivo é medido, não conservadorismo: **as NF-e recebidas não têm duplicata** (`<cobr><dup>`
// não é lido, não há coluna, e as 49 NF-e da base são resumos sem XML), então **não existe
// vencimento** para ancorar a janela. O casamento se apoia em valor + pista do fornecedor + uma
// janela larga a partir da EMISSÃO — evidência boa o bastante para sugerir e fraca demais para
// decidir sozinha.
//
// ⚠⚠ **AMBIGUIDADE NÃO SE RESOLVE ESCOLHENDO.** Dois candidatos ⇒ nenhum é eleito, e os dois
// aparecem. Casar o pagamento com a nota errada põe a despesa na conta errada, em silêncio — é
// exatamente o defeito que a fila existe para impedir. Mesma disciplina do `AMBIGUO` do vínculo de
// telefone e do "nunca o primeiro da lista" do código de serviço.
//
// ⚠ **OS NÚMEROS ABAIXO SÃO HEURÍSTICA, NÃO NORMA.** Nenhuma regra fiscal os define; eles saem do
// que um extrato bancário brasileiro parece. Estão nomeados e num lugar só justamente para poderem
// ser ajustados com dado real — e o fato de só SUGERIREM é o que torna o ajuste barato.
//
// ⚠ ESTE MÓDULO É PURO: sem prisma, sem relógio, sem I/O.

/** Por que este débito se parece com esta nota. ⚠ Vocabulário FECHADO — vai para a tela. */
export const PISTA = Object.freeze({
  /** O CNPJ do fornecedor aparece nos dígitos do memo do banco. A pista mais forte. */
  CNPJ_NO_MEMO: "CNPJ_NO_MEMO",
  /** Uma palavra distintiva do nome do emitente aparece no memo. */
  NOME_NO_MEMO: "NOME_NO_MEMO",
});

export const FRASE_DA_PISTA = Object.freeze({
  [PISTA.CNPJ_NO_MEMO]: "O CNPJ do fornecedor aparece na descrição do banco.",
  [PISTA.NOME_NO_MEMO]: "O nome do fornecedor aparece na descrição do banco.",
});

/**
 * ⚠ TOLERÂNCIA DE VALOR — CENTAVOS, não percentual.
 *
 * O débito de uma nota é o valor da nota. Uma tolerância percentual casaria uma nota de R$ 10.000
 * com um débito de R$ 9.800, que é outra coisa. Os 5 centavos cobrem arredondamento, e nada mais.
 */
export const TOLERANCIA_VALOR = 0.05;

/** ⚠ A mesma tolerância, em CENTAVOS INTEIROS — é assim que ela é comparada. Ver `debitoPagaNota`. */
export const TOLERANCIA_EM_CENTAVOS = 5;

/**
 * ⚠⚠ A JANELA — larga de propósito, e é a fraqueza declarada deste casamento.
 *
 * Sem duplicata não há vencimento, então não há como saber quando aquela nota **deveria** ser paga.
 * A janela cobre o que um prazo comercial brasileiro costuma ser (à vista até 90 dias), e os 5 dias
 * para trás cobrem o serviço pago adiantado, com a nota emitida depois.
 *
 * ⚠ Larga assim, ela vai trazer falso positivo. Por isso o casamento exige TAMBÉM valor e pista do
 * fornecedor, e por isso ele só sugere.
 */
export const DIAS_ANTES_DA_EMISSAO = 5;
export const DIAS_DEPOIS_DA_EMISSAO = 90;

/**
 * ⚠⚠ PALAVRAS QUE NÃO IDENTIFICAM NINGUÉM.
 *
 * "SERVICOS", "LTDA" e "COMERCIO" aparecem em metade das razões sociais do país. Sem esta lista,
 * um débito com a palavra "SERVICOS" no memo casaria com toda nota de toda empresa de serviço —
 * e a tela ficaria cheia de sugestões erradas, que é pior que nenhuma sugestão.
 *
 * ⚠ Lista FECHADA e curta de propósito: cada palavra acrescentada aqui deixa de identificar um
 * fornecedor que talvez se chame só assim.
 */
const PALAVRAS_SEM_IDENTIDADE = new Set([
  "LTDA", "ME", "EPP", "EIRELI", "SA", "S", "A", "CIA", "COMPANHIA",
  "COMERCIO", "COMERCIAL", "INDUSTRIA", "INDUSTRIAL", "SERVICOS", "SERVICO",
  "EMPRESA", "EMPREENDIMENTOS", "PARTICIPACOES", "HOLDING", "GRUPO",
  "DO", "DA", "DE", "DOS", "DAS", "E", "EM",
  "BRASIL", "NACIONAL", "SOCIEDADE", "ASSOCIADOS", "CONSULTORIA",
]);

/** ⚠ CPF tem 11, CNPJ tem 14. Abaixo disso não é documento — ver a guarda em `debitoPagaNota`. */
const MINIMO_DE_DIGITOS_DO_DOCUMENTO = 11;

/** ⚠ Mínimo de 4 letras: com 3, siglas como "TEC" casariam com meia lista de fornecedores. */
const MINIMO_DE_LETRAS = 4;

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");

/** Maiúsculas, sem acento, pontuação virando espaço. ⚠ Só para COMPARAR — nada é gravado assim. */
function normalizar(texto) {
  return String(texto ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * As palavras do nome do fornecedor que de fato o identificam.
 * ⚠ Exportada porque a ausência dela é uma resposta: fornecedor cujo nome é só ruído corporativo
 * **não pode** ser casado pelo nome, e quem chama precisa saber disso em vez de achar que não casou.
 */
export function palavrasQueIdentificam(nome) {
  return normalizar(nome)
    .split(" ")
    .filter((p) => p.length >= MINIMO_DE_LETRAS && !PALAVRAS_SEM_IDENTIDADE.has(p));
}

const ehData = (v) => v instanceof Date && !Number.isNaN(v.getTime());
const somarDias = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

/**
 * Este débito pode ser o pagamento desta nota?
 *
 * @param {object} debito declarado de origem `OFX_CLIENTE` (tem `valor`, `dataPagamento`, `descricaoOriginal`)
 * @param {object} nota   declarado de origem `NOTA_RECEBIDA` em `AGUARDANDO_PAGAMENTO`
 * @returns {{casa: boolean, pista: string|null, palavra: string|null}}
 */
export function debitoPagaNota(debito, nota) {
  const naoCasa = { casa: false, pista: null, palavra: null };

  // ⚠⚠ A COMPARAÇÃO É EM CENTAVOS INTEIROS — achado por auditoria em 25/08/2026, e MEDIDO.
  //
  // `Math.abs(1500 - 1500.05)` é `0.049999999999954525` (passa) e `Math.abs(1500.10 - 1500.15)` é
  // `0.0500000000001819` (NÃO passa). A mesma diferença de cinco centavos casava ou não conforme
  // os centavos do valor — e o teste "cinco centavos passam" só era verde por sorte da fixture.
  //
  // ⚠ `valor` é `Decimal(18,2)` no banco: dinheiro é inteiro de centavos, e comparar em double é o
  // erro clássico. `Math.round` antes da subtração elimina a classe inteira.
  const centavos = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const cDebito = centavos(debito?.valor);
  const cNota = centavos(nota?.valor);
  if (cDebito === null || cNota === null) return naoCasa;
  if (Math.abs(cDebito - cNota) > TOLERANCIA_EM_CENTAVOS) return naoCasa;

  const pago = debito?.dataPagamento;
  const emitida = nota?.dataDocumento;
  if (!ehData(pago) || !ehData(emitida)) return naoCasa;
  if (pago < somarDias(emitida, -DIAS_ANTES_DA_EMISSAO)) return naoCasa;
  if (pago > somarDias(emitida, DIAS_DEPOIS_DA_EMISSAO)) return naoCasa;

  // ⚠⚠ VALOR + DATA NÃO BASTAM. Duas notas do mesmo valor no mesmo mês são comuns (mensalidade,
  // assinatura), e casar por elas poria a despesa no fornecedor errado. A pista do fornecedor é
  // OBRIGATÓRIA.
  const memo = normalizar(debito?.descricaoOriginal);
  if (!memo) return naoCasa;

  // ⚠⚠ O CNPJ PRECISA TER DÍGITOS SUFICIENTES PARA IDENTIFICAR — achado por auditoria, e medido:
  // com `cnpjFornecedor` truncado para `"90"`, o memo "TARIFA MENSAL PACOTE 90" casava com a pista
  // **mais forte** do sistema, a que curto-circuita a checagem de nome e aparece na tela como
  // *"O CNPJ do fornecedor aparece na descrição do banco"*. Casamento por acaso, vendido como
  // identidade.
  //
  // ⚠ 11 é o CPF; o CNPJ tem 14. Aceitar os dois porque `emitenteDoc` de nota de pessoa física
  // traz CPF — abaixo disso não é documento, é fragmento.
  const cnpj = soDigitos(nota?.cnpjFornecedor);
  if (cnpj.length >= MINIMO_DE_DIGITOS_DO_DOCUMENTO && soDigitos(debito?.descricaoOriginal).includes(cnpj)) {
    return { casa: true, pista: PISTA.CNPJ_NO_MEMO, palavra: null };
  }

  for (const palavra of palavrasQueIdentificam(nota?.descricaoOriginal)) {
    // ⚠ Fronteira de palavra, não `includes` cru: sem ela "CASA" casaria dentro de "CASADO", e o
    // memo de um banco é cheio de palavras coladas.
    if (new RegExp(`\\b${palavra}\\b`).test(memo)) {
      return { casa: true, pista: PISTA.NOME_NO_MEMO, palavra };
    }
  }

  return naoCasa;
}

/** ⚠ Por que um débito ficou sem sugestão — para a tela poder DIZER, em vez de só não mostrar nada. */
export const SEM_CASAMENTO = Object.freeze({
  NENHUM_CANDIDATO: "nenhum_candidato",
  AMBIGUO: "ambiguo",
});

export const FRASE_DO_SEM_CASAMENTO = Object.freeze({
  [SEM_CASAMENTO.NENHUM_CANDIDATO]:
    "Nenhuma nota recebida em aberto se parece com este débito. Ele pode ser uma despesa sem nota, ou a nota ainda não chegou.",
  [SEM_CASAMENTO.AMBIGUO]:
    "Mais de uma nota se parece com este débito. O sistema não escolhe entre elas — confira qual é a certa.",
});

/**
 * A sugestão para UM débito, contra as notas que esperam pagamento.
 *
 * ⚠⚠ Devolve `sugestao` só quando há EXATAMENTE UM candidato. Com dois ou mais, `sugestao` é `null`
 * e os dois voltam em `candidatos` — o contador escolhe. Escolher por ele poria a despesa na conta
 * errada, em silêncio.
 *
 * @returns {{sugestao: object|null, candidatos: Array, motivo: string|null, frase: string}}
 */
export function casarDebitoComNotas(debito, notas) {
  const candidatos = [];
  for (const nota of notas || []) {
    const r = debitoPagaNota(debito, nota);
    if (r.casa) candidatos.push({ nota, pista: r.pista, palavra: r.palavra, frase: FRASE_DA_PISTA[r.pista] });
  }

  if (candidatos.length === 1) {
    return { sugestao: candidatos[0], candidatos, motivo: null, frase: "" };
  }
  const motivo = candidatos.length ? SEM_CASAMENTO.AMBIGUO : SEM_CASAMENTO.NENHUM_CANDIDATO;
  return { sugestao: null, candidatos, motivo, frase: FRASE_DO_SEM_CASAMENTO[motivo] };
}

/**
 * As sugestões de um LOTE de débitos.
 *
 * ⚠⚠ UMA NOTA NÃO PODE SER SUGERIDA A DOIS DÉBITOS. Ela foi paga uma vez; oferecê-la duas vezes
 * convidaria o contador a fundir as duas e a nota sumiria de uma delas depois do fato — com o
 * segundo débito voltando a parecer despesa sem nota, e ninguém entendendo por quê. Nota disputada
 * por dois débitos vira **ambígua para os dois**, e nenhum recebe sugestão.
 */
export function casarLote(debitos, notas) {
  const bruto = (debitos || []).map((debito) => ({ debito, ...casarDebitoComNotas(debito, notas) }));

  const quantosQuerem = new Map();
  for (const r of bruto) {
    if (!r.sugestao) continue;
    const id = r.sugestao.nota?.id;
    quantosQuerem.set(id, (quantosQuerem.get(id) || 0) + 1);
  }

  return bruto.map((r) => {
    if (r.sugestao && quantosQuerem.get(r.sugestao.nota?.id) > 1) {
      return {
        ...r,
        sugestao: null,
        motivo: SEM_CASAMENTO.AMBIGUO,
        frase: FRASE_DO_SEM_CASAMENTO[SEM_CASAMENTO.AMBIGUO],
      };
    }
    return r;
  });
}
