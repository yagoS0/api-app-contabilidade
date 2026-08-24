// O TIPO DA CONTA À VISTA — o selo que o contador lê antes de escolher a conta.
//
// ## Por que existe (pedido do dono, 24/08/2026)
//
// > *"como temos o plano de contas completo, incluir no sugestor o tipo de conta que estamos
// > selecionando, se é despesa, passivo ou ativo, ou receita"*
//
// É o conserto **na origem** do defeito que ele relatou: o sistema atrelou `1.2.1.06.0003 CSLL` —
// uma conta de **ATIVO**, sob INCENTIVOS FISCAIS — ao crédito de uma provisão de CSLL, onde deveria
// estar `2.1.1.05.0007 CSLL A RECOLHER`. As duas se chamam "CSLL" no plano, e o reduzido (`137` ×
// `256`) não diz nada. Com **ATIVO** escrito ao lado, ninguém escolhe a errada.
//
// ⚠ **O DADO JÁ CHEGAVA.** `GET /chart-of-accounts` não tem `select` — devolve a linha inteira, com
// `tipo` e `codigoCompleto`. Não faltava rota nem coluna: faltava mostrar. É a mesma classe do
// `codigosServicoNacional` e da carga tributária, com a diferença de que aqui o campo já viajava.
//
// ## ⚠⚠ O SELO NÃO USA VERDE, ÂMBAR NEM VERMELHO
//
// Nesta casa essas três cores têm significado fixo: **verde = concluído**, **âmbar = pendência**,
// **vermelho = bloqueia o fechamento**. O tipo da conta não é nenhuma das três — é informação
// neutra. Pintá-lo com a paleta de estado faria "ATIVO" parecer um problema e "RECEITA" parecer uma
// conclusão. Todos os tipos usam o MESMO chip neutro, e quem carrega o significado é a palavra.

/** Os tipos que `ChartOfAccount.tipo` pode ter. Lista FECHADA — espelho do `schema.prisma`. */
export const TIPO_DE_CONTA = Object.freeze({
  ATIVO: "ATIVO",
  PASSIVO: "PASSIVO",
  RECEITA: "RECEITA",
  DESPESA: "DESPESA",
  PATRIMONIO: "PATRIMONIO",
});

const ROTULO = Object.freeze({
  ATIVO: "Ativo",
  PASSIVO: "Passivo",
  RECEITA: "Receita",
  DESPESA: "Despesa",
  PATRIMONIO: "Patrimônio",
});

/**
 * O texto do selo. `null` quando não há tipo — e ⚠ **`null` significa "não mostre selo nenhum"**,
 * nunca um selo dizendo "desconhecido": conta sem tipo é conta que ninguém classificou, e anunciar
 * isso em toda linha vira ruído. É a mesma disciplina do `INDETERMINADO` do motor de verificação,
 * que também não desenha nada.
 */
export function rotuloDoTipo(tipo) {
  const t = String(tipo ?? "").trim().toUpperCase();
  return ROTULO[t] || null;
}

/**
 * O `codigoCompleto` na grafia pontuada (`211050001` ⇒ `2.1.1.05.0001`).
 *
 * ⚠⚠ **ESPELHO de `pontuarCodigoCompleto`** (`apps/api/src/application/accounting/regras/
 * familiaDaConta.js`), amarrado por teste que importa a função do backend e exige o mesmo resultado.
 * Sem o amarre, "espelho" é intenção e não fato.
 *
 * ⚠ É a grafia que o DONO usou ao ditar a regra e a que o balancete do sistema de destino imprime —
 * é por ela que o contador confere uma conta daqui contra o outro sistema, sem traduzir de cabeça.
 * ⚠ Código fora da máscara de 9 dígitos volta **como veio**: comprimento diferente é sinal de plano
 * diferente, e mascará-lo esconderia isso.
 */
export function pontuarCodigoCompleto(codigoCompleto) {
  const cc = String(codigoCompleto ?? "").trim();
  if (!/^\d{9}$/.test(cc)) return cc;
  return `${cc[0]}.${cc[1]}.${cc[2]}.${cc.slice(3, 5)}.${cc.slice(5)}`;
}

/**
 * O que a linha de uma conta mostra além do código e do nome.
 *
 * Devolve `{ tipo, completo }`, os dois já prontos para render e **os dois anuláveis**: a tela
 * renderiza o que existe e cala o que não existe.
 */
export function selosDaConta(conta) {
  return {
    tipo: rotuloDoTipo(conta?.tipo),
    completo: pontuarCodigoCompleto(conta?.codigoCompleto) || null,
  };
}
