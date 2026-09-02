// A NATUREZA DE CADA COISA NA TELA "A LANÇAR" — o que separa uma linha da outra.
//
// > Dono: *"na página A lançar, separe visualmente o que são regras, saídas do cliente, o que é
// > para virar lançamento e o que é para o fluxo."*
//
// ⚠⚠ AS QUATRO NÃO SÃO QUATRO IRMÃS — SÃO DOIS EIXOS DE DOIS, e ler assim é o que faz a separação
// caber na tela sem duplicar linha:
//
//     regras · saídas do cliente   →  QUEM DISSE          (origem)
//     vira lançamento · é só fluxo →  O QUE ACONTECE      (destino)
//
// Uma saída do cliente JÁ É "só fluxo": a mesma linha responde às duas perguntas. Empilhá-las como
// quatro caixas irmãs pediria que ela aparecesse duas vezes — e duas aparições da mesma coisa é
// exatamente a confusão que esta separação existe para desfazer.
//
// ⚠⚠ NADA DISSO É CAMPO NOVO NO BANCO. Não existe coluna que diga "isto é regra / é fluxo": o que
// existe são TABELAS diferentes, e a natureza é derivável de QUAL PAINEL a linha veio. A única
// coisa que vem do dado é a ORIGEM (`LancamentoDeclarado.origem`), que já viaja no serializador
// (`routes/firm/conferencia.js`) e ainda não aparecia em lugar nenhum da tela.
//
// ⚠ A REGRA MORA AQUI, e a tela só liga — mesma disciplina de `conferenciaTela.js` e de
// `circular/lib/estadoGuia.js`.

/**
 * O DESTINO — o que acontece com a linha. Vira SEÇÃO na tela.
 *
 * ⚠ `REGRA` não é origem nem destino: é a CAUSA. Ela merece seção própria justamente por isso —
 * uma regra não vira lançamento nem entra no fluxo; ela decide o que vai acontecer com o que vier
 * depois.
 */
export const NATUREZA = Object.freeze({
  VIRA_LANCAMENTO: "VIRA_LANCAMENTO",
  SO_FLUXO: "SO_FLUXO",
  REGRA: "REGRA",
});

/**
 * ⚠⚠ AS FRASES SÃO AS QUE A TELA JÁ DIZIA — não texto novo.
 *
 * A de `VIRA_LANCAMENTO` é a que o modal de confirmação já mostra ("débito na conta da despesa,
 * crédito no caixa"); a de `SO_FLUXO` é a que `PainelDeSaidasDoCliente` já carrega ("Confirmar aqui
 * não lança nada"). Subir o que já existe, em vez de redigir, é o que impede a tela de passar a
 * afirmar duas coisas diferentes sobre o mesmo ato.
 */
export const SECAO = Object.freeze({
  [NATUREZA.VIRA_LANCAMENTO]: {
    titulo: "Vira lançamento contábil",
    frase: "O que for confirmado aqui cria um lançamento: débito na conta da despesa, crédito no caixa.",
  },
  [NATUREZA.SO_FLUXO]: {
    titulo: "Só entra no fluxo — não lança nada",
    frase: "Confirmar aqui não lança nada: só diz se a previsão fica no fluxo de caixa do cliente.",
  },
  [NATUREZA.REGRA]: {
    titulo: "Regras — o que decide sozinho",
    frase: "Não é lançamento nem fluxo: é a configuração que decide o que vai acontecer com o que chegar depois.",
  },
});

/**
 * ⚠⚠ ISTO É O QUE RESPONDE "saídas do cliente" DENTRO da fila, sem duplicar a linha.
 *
 * `LancamentoDeclarado.origem` existe no model e **não aparecia na tela**. A fila é homogênea por
 * construção (toda linha é um `LancamentoDeclarado`), então a heterogeneidade que o dono quer ver
 * não está na tabela — está neste campo.
 *
 * ⚠ VOCABULÁRIO FECHADO, espelho de `application/declarados/lib/estadosDeclarado.js`. Valor que a
 * tela não conhece devolve `null` e **não vira chip**: um rótulo inventado a partir do valor cru
 * ("EXTRATO_EXCEL_CLIENTE") seria pior que a ausência, e um valor novo no backend tem de aparecer
 * como falta de chip, não como texto de máquina na tela do contador.
 */
export const ORIGEM_NA_TELA = Object.freeze({
  NOTA_RECEBIDA: { rotulo: "nota recebida", titulo: "Nasceu de uma nota fiscal recebida pela empresa." },
  /**
   * ⚠ ESTA ORIGEM AINDA NÃO TEM ESCRITOR (medido em 01/09/2026): ela está declarada no `ORIGEM` do
   * backend e **nenhum serviço a grava** — o único produtor de declarado do cliente hoje é o import
   * de extrato. O chip fica pronto porque o vocabulário é fechado e vem de lá; ele simplesmente não
   * aparece enquanto ninguém escrever a linha. Ausência é a resposta certa, não um chip inventado.
   */
  CLIENTE_MANUAL: { rotulo: "do cliente", titulo: "O cliente digitou esta despesa no portal dele." },
  // ⚠ `veioDeExtrato` NÃO é decoração: é o que responde "esta linha PODE ter nota?". Débito de
  // extrato nunca teve documento vinculado, e dizer "a nota não está mais na base" sobre ele
  // afirmaria que existiu uma nota que nunca existiu. Ver `conferenciaTela.leituraDoDocumento`.
  OFX_CLIENTE: {
    rotulo: "extrato (OFX)",
    titulo: "Veio do extrato bancário em OFX que o cliente enviou.",
    veioDeExtrato: true,
  },
  // ⚠ Origem PRÓPRIA, e não "OFX": a planilha teve as colunas mapeadas por alguém, e é isso que o
  // contador precisa poder conferir. O backend já as separa pelo mesmo motivo.
  EXTRATO_EXCEL_CLIENTE: {
    rotulo: "extrato (planilha)",
    titulo: "Veio da planilha de extrato que o cliente enviou.",
    veioDeExtrato: true,
  },
});

/**
 * ⚠⚠ ESTA LINHA NASCEU DE UM EXTRATO? Então ela nunca teve nota — e isso NÃO é o mesmo que
 * "a nota sumiu".
 *
 * Origem desconhecida devolve `false`: na dúvida, a tela cai na leitura que fala da NOTA, que é o
 * caminho de sempre. Afirmar "veio do extrato" sobre uma origem que a tela não conhece seria
 * inventar a procedência da despesa.
 */
export function veioDeExtrato(item) {
  return origemDaLinha(item)?.veioDeExtrato === true;
}

/** O chip de origem de uma linha da fila, ou `null` quando não há o que dizer. */
export function origemDaLinha(item) {
  const chave = item?.origem;
  if (!chave) return null;
  return ORIGEM_NA_TELA[chave] || null;
}

/**
 * OS BLOCOS DESTA TELA — a lista é FECHADA e é o inventário do que está empilhado nela hoje.
 *
 * ⚠ São SEIS painéis mais a fila, e não cinco: `PainelDeMexidasDoCliente` entrou em 31/08/2026 e
 * fica fácil de esquecer porque ele é o único que **não pede nada** ("é CIÊNCIA, não tarefa", diz o
 * cabeçalho dele). Esquecê-lo aqui o deixaria solto entre duas seções, que é exatamente o estado
 * que esta entrega desfaz.
 */
export const BLOCO = Object.freeze({
  CASAMENTOS: "CASAMENTOS",
  RECORRENCIAS: "RECORRENCIAS",
  SAIDAS_DO_CLIENTE: "SAIDAS_DO_CLIENTE",
  MEXIDAS_DO_CLIENTE: "MEXIDAS_DO_CLIENTE",
  REGRAS: "REGRAS",
  FILA: "FILA",
});

/**
 * ⚠⚠ LÁPIDE — `LANCADOS_POR_REGRA` SAIU DESTA TELA em 01/09/2026 (dono: *"vão para uma sub aba de
 * lançamentos automáticos"*).
 *
 * Ele ERA um bloco de «Vira lançamento contábil» aqui; hoje é a aba própria
 * `lancamentosAutomaticos`, com as colunas que o dono pediu. O nome fica registrado para que
 * ninguém o reintroduza nesta lista achando que ficou esquecido — e para que quem procurar o
 * extrato saiba onde ele foi parar.
 */
export const BLOCO_QUE_MUDOU_DE_TELA = Object.freeze({
  LANCADOS_POR_REGRA: "lancamentosAutomaticos",
});

/**
 * ⚠⚠ ESTE MAPA É A ESPECIFICAÇÃO DA TELA, e o teste de ligação confere o DOM contra ele.
 *
 * A tela monta as três seções em JSX à mão — os painéis recebem props diferentes, e uma renderização
 * dirigida por dados aqui seria a abstração prematura que a casa recusa. O que impede as duas de
 * divergirem não é uma indireção: é `conferenciaSeparadaPorNatureza.test.jsx`, que lê ESTE mapa e
 * exige que cada painel esteja sob o título que ele manda.
 *
 * ⚠⚠ AGRUPAR REORDENOU A TELA, e dizer o contrário seria mentira: os painéis do fluxo estavam
 * INTERCALADOS entre os que lançam (casamentos · recorrências · saídas · mexidas · lançados por
 * regra · regras · fila), então não havia como emoldurá-los sem mover. O que se preservou foi cada
 * argumento de ordem já escrito na tela: casamentos continua ACIMA da fila, o extrato do que entrou
 * sem clique continua ANTES das regras, as mexidas continuam DEPOIS das filas de decisão, e as
 * regras continuam por último. ⚠ Uma quarta afirmação — *"as regras vêm depois da fila"* — era
 * FALSA no DOM antes desta entrega e passou a ser verdadeira com o agrupamento.
 */
const NATUREZA_DO_BLOCO = Object.freeze({
  // Vira lançamento: casar um débito ao seu documento, e a fila.
  // ⚠ `LANCADOS_POR_REGRA` saiu — ver a lápide acima.
  [BLOCO.CASAMENTOS]: NATUREZA.VIRA_LANCAMENTO,
  [BLOCO.FILA]: NATUREZA.VIRA_LANCAMENTO,

  // ⚠ RECORRÊNCIA É FLUXO, e isso foi medido, não suposto: o painel dela diz de si mesmo que
  // *"NÃO DECIDE NADA"* e que existe para o fluxo futuro ("uma aproximação de 130 no fluxo"). Ela
  // não tem conta, não tem débito e não tem crédito.
  [BLOCO.RECORRENCIAS]: NATUREZA.SO_FLUXO,
  [BLOCO.SAIDAS_DO_CLIENTE]: NATUREZA.SO_FLUXO,
  // ⚠ Ciência, não tarefa — mas ciência SOBRE O FLUXO: é o cliente mexendo em previsão dele. Ela
  // não vira lançamento nem é regra, e sem seção ficaria órfã.
  [BLOCO.MEXIDAS_DO_CLIENTE]: NATUREZA.SO_FLUXO,

  [BLOCO.REGRAS]: NATUREZA.REGRA,
});

/**
 * A que seção um bloco pertence. Bloco desconhecido devolve `null` — nunca cai numa seção por
 * omissão, porque cair em «Vira lançamento contábil» sem ninguém ter decidido isso é a afirmação
 * mais cara que esta tela pode fazer.
 */
export function natureza(bloco) {
  return NATUREZA_DO_BLOCO[bloco] || null;
}

/** As três seções, na ordem em que a tela as empilha. */
export const SECOES_NA_ORDEM = Object.freeze([
  NATUREZA.VIRA_LANCAMENTO,
  NATUREZA.SO_FLUXO,
  NATUREZA.REGRA,
]);
