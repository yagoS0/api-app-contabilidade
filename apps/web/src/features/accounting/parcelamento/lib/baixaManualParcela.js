// A REGRA DE TELA DA BAIXA POR DECLARAÇÃO — a prestação SEM GUIA (débito automático).
//
// ⚠ AS DUAS FILAS RESPONDEM PERGUNTAS DIFERENTES, e este arquivo existe para que a diferença não
// suma no meio de uma tabela:
//
//   · "Parcelas pagas aguardando lançamento"  → a guia foi PAGA (sinal externo, do SERPRO);
//                                                falta lançar. A tela só repete o documento.
//   · "Prestações vencidas sem guia"          → não há sinal NENHUM. O contador DECLARA que o
//                                                débito saiu da conta, e é essa declaração que
//                                                vira lançamento contábil.
//
// ⚠ JUROS E MULTA SÃO ENTRADA, NÃO DERIVAÇÃO. O servidor recusa (`CONFERENCIA_DIVERGENTE`) todo
// total que não bata com `principal + juros + multa` — ele NÃO deriva o acréscimo por subtração,
// porque foi assim que o encargo já foi reconhecido em dobro no passado. Aqui a conta é feita para
// frente e mostrada antes do clique; o `totalConferido` que sobe é exatamente o número que o
// contador leu.
//
// ⚠ O PRINCIPAL É O VALOR **CONTRATADO**, E AGORA ELE É EDITÁVEL — MAS COMO CONTRATO, NÃO COMO
// "quanto eu paguei". A distinção é o coração desta tela e não pode sumir:
//
//   · **contratado** (`parcelas.valorPrevisto`) — quanto o ACORDO diz que a prestação vale. É ele
//     que a baixa debita do passivo (`D PARC`), que a fila mostra na coluna Principal, e que
//     `sincronizarParcelas` materializou do cabeçalho. Editá-lo altera o CONTRATO: persiste, e é o
//     que a próxima tela mostra. Por isso vai por uma chamada PRÓPRIA
//     (`corrigirValorPrevistoParcela`), com confirmação que diz o que era e o que passa a ser.
//   · **pago** — `principal + juros + multa`, o que saiu da conta (`C CAIXA`). Ele legitimamente
//     difere do contratado, e essa diferença é INFORMAÇÃO (juros, TJLP, atraso), não erro de
//     digitação: ela continua expressa em juros/multa, e nunca é absorvida no principal.
//
// ⚠ Digitar no principal NÃO é "declarar o que paguei a mais". Quem pagou mais declara o acréscimo;
// o principal só muda quando o CONTRATO estava errado — que é o caso de todo contrato criado pelo
// wizard, cujas prestações nascem valendo R$ 0,00 (o valor da parcela é derivado da soma dos
// tributos, e sem guia essa soma é zero).

import { avaliarValor, MENSAGENS_VALOR } from "../../entries/lib/valorFormula.js";
// ⚠ REUSO, NÃO SEGUNDA CÓPIA. `resumoDosNumeros` já resolve "1, 2, 3 e mais 55" para os grupos de
// bloqueio do acordeão; a fila usa a MESMA função, senão o corte de dois blocos que dizem a mesma
// coisa divergiria no primeiro ajuste de limite.
import { resumoDosNumeros } from "./parcelaBusca.js";

const plural = (n, um, muitos) => (Number(n) === 1 ? um : muitos);

/** Duas casas — a coluna é `Decimal(18,2)`; a mesma disciplina de `round2` no backend. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function formatarMoeda(v) {
  return Number.isFinite(Number(v))
    ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

/**
 * Lê um campo de acréscimo (juros ou multa).
 *
 * ⚠ VAZIO É ZERO, E NÃO É ERRO — parcela paga em dia não tem acréscimo nenhum, e é o caso comum do
 * débito automático. `avaliarValor` (a MESMA leitura da célula de valor da aba Lançamentos, com a
 * gramática estrita de separador decimal que impede `1.500` virar 1,50) já separa "vazio" de
 * "inválido"; aqui só se acrescenta a recusa do NEGATIVO, que é a que o servidor também faz
 * (`acrescimo_negativo`).
 */
export function lerAcrescimo(texto) {
  const r = avaliarValor(texto);
  if (!r.ok) return { ok: false, valor: null, erro: r.erro, mensagem: r.mensagem };
  if (r.vazio) return { ok: true, valor: 0, vazio: true };
  if (r.valor < 0) {
    return {
      ok: false, valor: null, erro: "acrescimo_negativo",
      mensagem: "Juros e multa não podem ser negativos — se o valor foi menor, o principal é que muda, e ele vem do contrato.",
    };
  }
  return { ok: true, valor: round2(r.valor) };
}

/**
 * Lê o campo do PRINCIPAL — o valor **contratado** da prestação.
 *
 * ⚠ VAZIO AQUI **É** ERRO, ao contrário de juros e multa. Prestação sem acréscimo é o caso comum;
 * prestação que vale zero não existe — e um principal vazio virando 0 produziria uma baixa que
 * amortiza nada do passivo e credita só o acréscimo no caixa. A mesma gramática estrita de
 * separador decimal (`avaliarValor`) é reusada: aqui um `1.500` lido como 1,50 seria um passivo
 * amortizado 1000× a menos.
 */
export function lerPrincipal(texto) {
  const r = avaliarValor(texto);
  if (!r.ok) return { ok: false, valor: null, erro: r.erro, mensagem: r.mensagem };
  if (r.vazio) {
    return {
      ok: false, valor: null, erro: "sem_valor_previsto",
      mensagem: "Informe o valor contratado desta prestação — o principal não se inventa, "
        + "e é ele que a baixa vai amortizar do passivo.",
    };
  }
  if (r.valor <= 0) {
    return {
      ok: false, valor: null, erro: "valor_invalido",
      mensagem: "O valor contratado da prestação tem de ser maior que zero.",
    };
  }
  return { ok: true, valor: round2(r.valor) };
}

/**
 * A decomposição do que vai ser lançado, montada PARA FRENTE.
 *
 * Devolve sempre a mesma forma. `ok:false` desabilita o envio COM O MOTIVO (nunca sem) — e nunca
 * devolve um total "otimista" com um dos campos ilegível, que é como um número errado chegaria a
 * `totalConferido` e o servidor recusaria depois de o contador já ter confirmado.
 *
 * ⚠ `textoPrincipal` AUSENTE (`undefined`) mantém o comportamento antigo — principal lido direto de
 * `valorPrevisto`, read-only. Presente, ele é a EDIÇÃO do valor contratado, e `principalAlterado`
 * diz que o CONTRATO vai mudar. Os dois números viajam separados de propósito: `principalContratado`
 * é o que está gravado hoje, `principal` é o que vai valer — e é essa dupla que a confirmação
 * repete ("era X, passa a ser Y"). Colapsá-los num campo só apagaria o "era".
 */
export function decomporBaixa({ valorPrevisto, textoPrincipal, textoJuros = "", textoMulta = "" } = {}) {
  const contratado = valorPrevisto != null && Number.isFinite(Number(valorPrevisto))
    ? round2(valorPrevisto)
    : null;
  const editando = textoPrincipal !== undefined;
  const p = editando ? lerPrincipal(textoPrincipal) : { ok: true, valor: contratado };
  const principal = p.valor;
  const j = lerAcrescimo(textoJuros);
  const m = lerAcrescimo(textoMulta);

  const base = {
    principal, juros: j.valor, multa: m.valor,
    principalContratado: contratado,
    // ⚠ Contratado ausente (a prestação nasceu sem valor) com principal digitado TAMBÉM é alteração
    // do contrato: `null → 1.200,00` é o caso do contrato criado pelo wizard, e é o mais comum.
    principalAlterado: Number.isFinite(principal)
      && (contratado == null || Math.abs(principal - contratado) > 0.01),
    erroPrincipal: p.ok ? null : p.mensagem,
    erroJuros: j.ok ? null : j.mensagem,
    erroMulta: m.ok ? null : m.mensagem,
  };

  if (!p.ok) {
    return { ...base, total: null, ok: false, erro: p.erro, mensagem: p.mensagem };
  }
  if (!Number.isFinite(principal) || principal <= 0) {
    return {
      ...base, total: null, ok: false,
      erro: "sem_valor_previsto",
      mensagem: "Esta prestação não tem valor previsto no contrato, e o principal não se inventa. "
        + "Corrija o contrato (valor da parcela) antes de declarar a baixa.",
    };
  }
  if (!j.ok || !m.ok) {
    return { ...base, total: null, ok: false, erro: "acrescimo_invalido", mensagem: j.mensagem || m.mensagem };
  }
  return { ...base, total: round2(principal + j.valor + m.valor), ok: true, erro: null, mensagem: null };
}

/**
 * O que será GRAVADO no razão, linha a linha — o espelho de `linhasPagamento` no backend.
 *
 * ⚠ ESTA É A PARTE QUE FAZ O ATO DE CONSEQUÊNCIA SER CONFERÍVEL. A baixa grava até quatro
 * lançamentos e amortiza passivo; um botão que só diz "Dar baixa" esconde qual conta vai ser
 * debitada por quanto. Componente zerado NÃO gera lançamento — igual ao backend, que pula
 * `valor <= 0` — e por isso ele também não aparece aqui: a prévia mostraria uma linha que não vai
 * existir.
 */
export function lancamentosPrevistos(decomposicao) {
  if (!decomposicao?.ok) return [];
  const { principal, juros, multa, total } = decomposicao;
  const linhas = [
    { papel: "PARC", lado: "D", valor: principal, o_que: "Parcelamento a pagar", efeito: "amortiza o passivo" },
  ];
  if (juros > 0) linhas.push({ papel: "JUROS", lado: "D", valor: juros, o_que: "Juros", efeito: "despesa do mês do pagamento" });
  if (multa > 0) linhas.push({ papel: "MULTA", lado: "D", valor: multa, o_que: "Multa", efeito: "despesa do mês do pagamento" });
  linhas.push({ papel: "CAIXA", lado: "C", valor: total, o_que: "Caixa/banco", efeito: "o dinheiro que saiu da conta" });
  return linhas;
}

/**
 * As recusas do servidor, cada uma com a SAÍDA que o contador precisa.
 *
 * ⚠ Toda guarda de `gerarPagamentoParcelaManual` está aqui. Recusa que chega à tela como código
 * cru (`provisao_inexistente`) é recusa que o contador não sabe resolver — e as duas primeiras têm
 * outro caminho aberto, que precisa ser DITO, não deduzido.
 */
export const MOTIVOS_BAIXA_MANUAL = Object.freeze({
  parcela_tem_guia: "Esta prestação ganhou uma guia (a captura do SERPRO pode tê-la trazido agora). "
    + "A baixa dela é pela guia, na fila “Parcelas pagas aguardando lançamento” — lá a composição vem "
    + "do documento, em vez de ser declarada.",
  parcela_ja_baixada: "Esta prestação já foi baixada. Se a baixa estiver errada, desfaça-a pelo estorno "
    + "(no lançamento) — ela volta para esta fila.",
  provisao_inexistente: "O parcelamento não tem a provisão de abertura, então não há passivo a amortizar. "
    + "Lance a adesão antes.",
  // ⚠ ESTE TEXTO MUDOU, E TINHA DE MUDAR. Ele mandava "corrigir o valor da parcela no contrato" —
  // um caminho NOMEADO e INEXISTENTE: não havia rota nenhuma que o fizesse, e a prestação ficava
  // não baixável para sempre. Hoje a correção existe, e é aqui mesmo, no campo Principal.
  sem_valor_previsto: "A prestação nasceu sem valor no contrato (é o que acontece quando o contrato "
    + "é criado sem guia). Informe o valor contratado no campo Principal — ele passa a valer para "
    + "esta prestação em todas as telas.",
  valor_invalido: "O valor contratado da prestação tem de ser maior que zero.",
  acrescimo_negativo: "Juros e multa não podem ser negativos.",
  data_invalida: "A data do pagamento não foi entendida.",
  parcela_not_found: "Prestação não encontrada — a lista pode estar desatualizada. Recarregue a fila.",
  parcelamento_not_found: "Parcelamento não encontrado.",
  MES_FECHADO: "A competência da data do pagamento está FECHADA. Reabra o mês, ou lance a baixa na "
    + "competência correta — o mês fechado já foi reportado, e mudá-lo sem reabrir não deixa rastro.",
  CONFERENCIA_OBRIGATORIA: "O servidor exige o total conferido. Confira os valores e tente de novo.",
  CONFERENCIA_DIVERGENTE: "O total que o servidor calcula não é o que foi conferido nesta tela — "
    + "alguém pode ter mudado o valor da prestação no contrato. Recarregue a fila e confira de novo.",
});

/**
 * O código da recusa, venha ele por onde vier.
 *
 * ⚠ A ROTA RESPONDE DE DUAS FORMAS, e ignorar uma delas apagaria metade dos motivos:
 *   · guardas de negócio → `{ ok:false, skipped:true, motivo:"parcela_tem_guia" }` (404/409/422/400)
 *   · exceções nomeadas  → `{ ok:false, error:"CONFERENCIA_DIVERGENTE", message }` (400/409)
 * O `request` do `realApi` só promove `payload.error` a `err.code`; o `motivo` fica no `payload`.
 */
export function codigoDaRecusa(err) {
  return err?.code || err?.payload?.motivo || err?.payload?.error || err?.motivo || err?.error || null;
}

/**
 * As recusas da CORREÇÃO DO VALOR CONTRATADO — outra rota, outros desfechos.
 *
 * ⚠ ELAS NÃO SÃO AS DA BAIXA, e por isso não reusam `MOTIVOS_BAIXA_MANUAL`: os mesmos códigos
 * (`parcela_tem_guia`, `parcela_ja_baixada`) significam coisas diferentes aqui. Na baixa,
 * "tem guia" manda o contador para a outra fila; na correção, ele quer dizer que o valor vem do
 * DOCUMENTO e não se digita. Reusar o texto mandaria o contador para uma fila que não resolve o
 * problema dele.
 */
export const MOTIVOS_CORRECAO_VALOR = Object.freeze({
  parcela_tem_guia: "Esta prestação tem guia — o valor dela vem do documento, não se digita. "
    + "Corrija a guia (ou recapture o comprovante) em vez do contrato.",
  parcela_ja_baixada: "Esta prestação já foi baixada, e o lançamento dela foi gravado com o valor "
    + "antigo. Mudar o contrato agora deixaria o razão e o cadastro discordando: estorne a baixa "
    + "(no lançamento), corrija o valor e lance de novo.",
  parcela_not_found: "Prestação não encontrada — a lista pode estar desatualizada. Recarregue a fila.",
  valor_invalido: "O valor contratado da prestação tem de ser maior que zero.",
  CONFERENCIA_OBRIGATORIA: "O servidor exige saber qual era o valor anterior. Recarregue a fila e "
    + "tente de novo.",
  CONFERENCIA_DIVERGENTE: "O valor que está gravado no contrato não é o que esta tela mostrou — "
    + "alguém pode tê-lo mudado. Recarregue a fila e confira antes de alterar.",
});

export function explicarRecusaCorrecao(codigo, mensagemDoServidor) {
  const conhecido = MOTIVOS_CORRECAO_VALOR[codigo];
  if (conhecido) return conhecido;
  const texto = String(mensagemDoServidor || "").trim();
  if (texto && /\s/.test(texto)) return texto;
  return "O servidor recusou a alteração do valor e não disse por quê.";
}

export function explicarRecusa(codigo, mensagemDoServidor) {
  const conhecido = MOTIVOS_BAIXA_MANUAL[codigo];
  if (conhecido) return conhecido;
  // ⚠ Mensagem do servidor só quando ela é FRASE. Vários códigos do projeto chegam com a mensagem
  // igual ao código (`serpro_pagtoweb_disabled`) — exibi-la crua poria um identificador no lugar do
  // motivo. Sem espaço em branco = não é frase.
  const texto = String(mensagemDoServidor || "").trim();
  if (texto && /\s/.test(texto)) return texto;
  return "O servidor recusou a baixa e não disse por quê.";
}

/**
 * A confirmação REPETE OS DADOS — quem, quanto, em qual competência, e o que será gravado.
 *
 * ⚠ E diz que é DECLARAÇÃO. O dado gravado é `origemBaixa: "MANUAL"` e o histórico sai com
 * "(declarado)": quando a via SERPRO existir, ela gravará outra coisa. O contador precisa saber
 * qual das duas ele está fazendo — é a única diferença entre "a Receita provou" e "eu afirmei".
 */
export function textoDaConfirmacao({ linha, decomposicao, dataPagamento, consequencia = null }) {
  const n = linha?.numeroParcela ?? "?";
  const de = linha?.parcelamento?.numParcelas ?? "?";
  const contrato = linha?.parcelamento?.label || "este contrato";
  const comp = linha?.competencia ? ` (competência ${linha.competencia})` : "";
  const quando = dataPagamento
    ? new Date(`${dataPagamento}T12:00:00`).toLocaleDateString("pt-BR")
    : "hoje";
  const partes = [
    `Declarar o pagamento da prestação ${n} de ${de} — ${contrato}${comp}.`,
    "",
  ];

  // ⚠ A ALTERAÇÃO DO CONTRATO É UM SEGUNDO ATO, E ELE VEM PRIMEIRO NA CONFIRMAÇÃO — dizendo o que
  // ERA e o que PASSA A SER. É a exigência do "ato de consequência": alterar `valorPrevisto` não
  // muda só esta baixa, muda o que toda tela vai mostrar sobre esta prestação daqui em diante.
  if (decomposicao?.principalAlterado) {
    const antes = decomposicao.principalContratado == null
      ? "sem valor (a prestação nasceu sem valor no contrato)"
      : formatarMoeda(decomposicao.principalContratado);
    partes.push(
      "⚠ ISTO ALTERA O CONTRATO, e não só esta baixa:",
      `   valor contratado da prestação ${n}: ${antes} → ${formatarMoeda(decomposicao.principal)}`,
      "   O novo valor passa a ser o que todas as telas mostram desta prestação, e é ele que a",
      "   baixa vai amortizar do passivo do parcelamento. As demais prestações NÃO são tocadas.",
    );
    // ⚠ A CONSEQUÊNCIA VAI NA CONFIRMAÇÃO, não só na tela. Ela é o número que diz se o passivo do
    // parcelamento fecha — e é decisão do contador, não bloqueio: aparece para ele saber, não
    // para impedi-lo.
    if (consequencia && Number.isFinite(Number(consequencia.soma))) {
      partes.push(
        `   As ${consequencia.prestacoes ?? "?"} prestações que ainda amortizam passam a somar `
        + `${formatarMoeda(consequencia.soma)}`
        + (consequencia.provisionado == null
          ? " (não há provisão de abertura registrada para comparar)."
          : `, contra ${formatarMoeda(consequencia.provisionado)} de principal provisionado na adesão`
            + `${Math.abs(consequencia.diferenca) <= 0.01
              ? " — fecham." : ` — sobra ${formatarMoeda(consequencia.diferenca)} de diferença.`}`),
      );
    }
    partes.push("");
  }

  partes.push(
    `Principal (valor contratado): ${formatarMoeda(decomposicao?.principal)}`,
    `Juros (declarado por você): ${formatarMoeda(decomposicao?.juros)}`,
    `Multa (declarada por você): ${formatarMoeda(decomposicao?.multa)}`,
    `TOTAL PAGO: ${formatarMoeda(decomposicao?.total)}`,
    `Data do pagamento: ${quando}`,
    "",
    "Isto GRAVA lançamentos contábeis (principal, juros e multa separados) e amortiza o passivo do",
    "parcelamento. É uma DECLARAÇÃO sua, não um comprovante: fica registrada como baixa MANUAL e o",
    "histórico sai com \"(declarado)\".",
    "",
    "Confirmar?",
  );
  return partes.join("\n");
}

/**
 * Rótulo da situação da linha. `VENCIDA` e `VENCE_HOJE` vêm do servidor — a tela não recalcula.
 *
 * ⚠ `fundo` VEM DAQUI, e é o par `-surface` do token. O estado virou BADGE curto (texto colorido
 * solto no meio da linha some no meio dos outros textos), e badge precisa de fundo. Derivá-lo no
 * componente reporia o truque `${cor}22`, que quebra em silêncio com `var()`.
 */
export function rotuloDaSituacao(situacao) {
  return situacao === "VENCE_HOJE"
    ? {
      texto: "Vence hoje",
      cor: "var(--state-neutral)",
      fundo: "var(--state-neutral-surface)",
      titulo: "O vencimento contratado é hoje — ainda dá tempo.",
    }
    : {
      texto: "Vencida",
      cor: "var(--state-warn)",
      fundo: "var(--state-warn-surface)",
      titulo: "O vencimento contratado já passou.",
    };
}

/**
 * O RÓTULO CURTO DO BLOQUEIO — o que cabe DENTRO da linha da tabela.
 *
 * ⚠ ELE NÃO SUBSTITUI O MOTIVO, ele o ancora. O parágrafo inteiro (`MOTIVOS_BAIXA_MANUAL`) continua
 * existindo e continua VISÍVEL — uma vez, no banner do grupo, e no `title` do botão. O que sai da
 * linha é a repetição: num contrato criado pelo wizard TODAS as prestações trazem o mesmo
 * `sem_valor_previsto`, e o mesmo parágrafo em N linhas não se lê, vira textura. É a lição de
 * `agruparBloqueios` no acordeão, aplicada à fila.
 */
export const ROTULOS_BLOQUEIO = Object.freeze({
  sem_valor_previsto: "Sem valor",
  provisao_inexistente: "Sem provisão",
  parcela_tem_guia: "Tem guia",
  parcela_ja_baixada: "Já baixada",
  parcela_not_found: "Não encontrada",
  parcelamento_not_found: "Contrato ausente",
});

export function rotuloDoBloqueio(motivo) {
  if (!motivo) return null;
  return ROTULOS_BLOQUEIO[motivo] || "Bloqueada";
}

/**
 * ⚠ OS DOIS BLOQUEIOS NÃO SÃO O MESMO, E TRATÁ-LOS IGUAL FECHA A ÚNICA SAÍDA.
 *
 * `sem_valor_previsto` se resolve NESTA tela (o valor contratado é do contador, e informá-lo é a
 * ação); `provisao_inexistente` se resolve em OUTRA (lançar a adesão). Só o primeiro habilita ação
 * — em lote, no banner, e individual, no botão da linha.
 */
export function corrigivelNaTela(motivo) {
  return motivo === "sem_valor_previsto";
}

/**
 * AS PENDÊNCIAS DA FILA, AGRUPADAS POR MOTIVO **E POR CONTRATO**.
 *
 * ⚠ POR QUE POR CONTRATO, e não só por motivo: os dois motivos que a fila devolve hoje são fatos do
 * CONTRATO, não da prestação. "O parcelamento não tem provisão de abertura" e "as prestações
 * nasceram sem valor" valem para o acordo inteiro — e a ação em lote que o dono pediu ("3 prestações
 * do contrato X estão sem valor" + Informar valor) só faz sentido dentro de um contrato: aplicar um
 * valor a prestações de acordos diferentes seria reescrever dois contratos num clique.
 *
 * ⚠ ISTO NÃO ESCONDE NADA. Nenhuma linha sai da tabela, nenhum motivo some: cada linha continua
 * listada, com o rótulo curto e o `title` inteiro, e o parágrafo aparece UMA vez por grupo, dizendo
 * em quantas prestações vale e quais são. Some a repetição — a mesma fronteira de `agruparBloqueios`.
 *
 * ⚠ A ORDEM NÃO É ARBITRÁRIA: grupo com AÇÃO disponível vem primeiro. O contador que abre a fila com
 * seis prestações sem valor e duas sem provisão pode resolver as seis; mandá-lo ler primeiro o
 * bloqueio que ele não resolve aqui é enterrar a saída.
 */
export function agruparBloqueiosDaFila(parcelas) {
  const porGrupo = new Map();
  for (const p of Array.isArray(parcelas) ? parcelas : []) {
    const motivo = p?.motivoBloqueio;
    if (!motivo) continue;
    const parcelamentoId = p.parcelamentoId ?? p.parcelamento?.id ?? null;
    const chave = `${motivo}::${parcelamentoId ?? "sem-contrato"}`;
    if (!porGrupo.has(chave)) {
      porGrupo.set(chave, {
        chave,
        motivo,
        rotulo: rotuloDoBloqueio(motivo),
        // ⚠ O texto sai de `explicarRecusa`, a MESMA fonte do `title` do botão e da recusa do
        // servidor. Duas redações do mesmo bloqueio é como a tela passa a discordar de si mesma.
        texto: explicarRecusa(motivo),
        corrigivelNaTela: corrigivelNaTela(motivo),
        parcelamentoId,
        label: p.parcelamento?.label || null,
        numeros: [],
        parcelas: [],
      });
    }
    const g = porGrupo.get(chave);
    g.numeros.push(p.numeroParcela ?? null);
    g.parcelas.push(p);
  }
  return [...porGrupo.values()]
    .map((g) => ({ ...g, quantidade: g.parcelas.length, listaDeNumeros: resumoDosNumeros(g.numeros) }))
    .sort((a, b) => Number(b.corrigivelNaTela) - Number(a.corrigivelNaTela));
}

/**
 * O TÍTULO DO BANNER DO GRUPO — a frase que o dono escreveu, com os números reais.
 *
 * ⚠ SEM O NOME DO CONTRATO ELE MENTE por omissão: numa empresa com dois acordos, "3 prestações estão
 * sem valor" não diz de qual, e a ação em lote passa a parecer que vale para a fila inteira.
 */
export function tituloDoGrupo(grupo) {
  if (!grupo) return "";
  const n = grupo.quantidade;
  const contrato = grupo.label ? `do contrato ${grupo.label}` : "desta fila";
  const sujeito = `${n} ${plural(n, "prestação", "prestações")} ${contrato}`;
  return grupo.motivo === "sem_valor_previsto"
    ? `${sujeito} ${plural(n, "está", "estão")} sem valor`
    : `${sujeito}: ${grupo.rotulo}`;
}

/**
 * O PLANO DO LOTE — qual valor vai para cada prestação, e por quê.
 *
 * ⚠ LOTE NÃO PODE SER CAIXA-PRETA. O dono pediu "aplicando às 3 com possibilidade de editar
 * individualmente", e é essa possibilidade que exige que o plano seja um DADO, não um efeito: cada
 * linha diz de onde veio o número (o valor de todas, ou o que foi digitado nela) e o que ela valia
 * antes. Sem isso, "apliquei 1.200 em 3 prestações" é uma afirmação que a tela não consegue exibir
 * linha a linha, e o contador confirma no escuro.
 *
 * ⚠ UMA LINHA ILEGÍVEL NÃO DERRUBA O LOTE INTEIRO — ela sai dele, NOMEADA. Recusar tudo por causa de
 * um campo forçaria a apagar o que já estava certo; aplicar mesmo assim gravaria um valor que
 * ninguém leu. O gate é: só sobe o que é legível, e a tela diz quantas ficaram de fora.
 *
 * ⚠ `valorAnterior` VIAJA JUNTO porque a rota o EXIGE (`valorAnteriorConferido`, 400
 * `CONFERENCIA_OBRIGATORIA` sem ele) — é a conferência do "era" que impede reescrever um contrato a
 * partir de um antes que a tela nunca mostrou. `0` e ausente são coisas diferentes e continuam
 * diferentes aqui: a prestação do wizard nasce com `valorPrevisto: 0`, e é isso que sobe.
 */
export function planoDoLoteDeValor({ parcelas, textoPadrao = "", overrides = {} } = {}) {
  const padrao = lerPrincipal(textoPadrao);
  const linhas = (Array.isArray(parcelas) ? parcelas : []).map((p) => {
    const texto = overrides[p.parcelaId];
    const individual = texto !== undefined && String(texto).trim() !== "";
    const leitura = individual ? lerPrincipal(texto) : padrao;
    return {
      parcelaId: p.parcelaId,
      numeroParcela: p.numeroParcela ?? null,
      competencia: p.competencia || null,
      vencimento: p.vencimento || null,
      // ⚠ `?? null` e não `|| null`: `0` é um valor CONFERIDO (o contrato diz zero), e trocá-lo por
      // `null` mandaria "não havia valor" para uma rota que confere exatamente essa diferença.
      valorAnterior: p.valorPrevisto ?? null,
      origem: individual ? "individual" : "padrao",
      texto: individual ? String(texto) : String(textoPadrao || ""),
      valor: leitura.ok ? leitura.valor : null,
      erro: leitura.ok ? null : leitura.mensagem,
    };
  });
  const validas = linhas.filter((l) => l.erro == null);
  const invalidas = linhas.filter((l) => l.erro != null);
  return {
    linhas,
    validas,
    invalidas,
    total: round2(validas.reduce((s, l) => s + l.valor, 0)),
    ok: validas.length > 0,
    // ⚠ DESABILITADO SEMPRE COM O MOTIVO — o projeto proíbe o contrário, e aqui o motivo mais comum
    // (o campo "valor de todas" ainda vazio) é impossível de adivinhar olhando a lista.
    mensagem: validas.length
      ? null
      : (invalidas[0]?.erro
        || "Informe o valor contratado — ele vale para todas as prestações listadas, e cada uma pode ser editada."),
  };
}

/**
 * A confirmação do LOTE — repetindo prestação por prestação o que era e o que passa a ser.
 *
 * ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS, e em lote isso é mais exigente, não menos:
 * são N contratos-linha reescritos de uma vez. A lista sai inteira de propósito — cortá-la em
 * "e mais 5" aqui esconderia justamente as que o contador não olhou.
 */
export function textoDaConfirmacaoDoLote(plano, label) {
  const n = plano?.validas?.length || 0;
  const partes = [
    `Informar o valor contratado de ${n} ${plural(n, "prestação", "prestações")}`
    + `${label ? ` — ${label}` : ""}.`,
    "",
    "⚠ ISTO ALTERA O CONTRATO, e não lança baixa nenhuma:",
  ];
  for (const l of plano?.validas || []) {
    const antes = l.valorAnterior == null || Number(l.valorAnterior) === 0
      ? "sem valor"
      : formatarMoeda(l.valorAnterior);
    partes.push(
      `   prestação ${l.numeroParcela ?? "?"}`
      + `${l.competencia ? ` (competência ${l.competencia})` : ""}: ${antes} → ${formatarMoeda(l.valor)}`,
    );
  }
  if (plano?.invalidas?.length) {
    const fora = plano.invalidas.map((l) => l.numeroParcela ?? "?").join(", ");
    partes.push("", `Ficam de fora (valor ilegível): ${fora}. Elas continuam sem valor.`);
  }
  partes.push(
    "",
    "O novo valor passa a ser o que todas as telas mostram destas prestações, e é ele que a baixa vai",
    "amortizar do passivo. A baixa NÃO é lançada aqui — depois disto elas ficam prontas para declarar.",
    "",
    "Confirmar?",
  );
  return partes.join("\n");
}

export { MENSAGENS_VALOR, resumoDosNumeros };
