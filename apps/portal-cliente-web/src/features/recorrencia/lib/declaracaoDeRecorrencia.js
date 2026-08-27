/**
 * O QUE O CLIENTE DECLARA QUE SE REPETE — e o que a tela recusa antes de mandar.
 *
 * > Dono, 25/08/2026: *"o contador deve poder indicar o que é recorrência também, ou o próprio
 * > cliente — 'essa é a taxa anual que pago de Conselho', ou '1.000 que eu pago de jantar todo mês
 * > para meus clientes'."*
 *
 * ⚠⚠ ISTO NÃO ENTRA NO FLUXO SOZINHO. A série nasce **PENDENTE** e só passa a valer depois que o
 * contador confirma — a mesma forma que a nota e o extrato já seguem. A tela diz isso, em texto,
 * antes do botão.
 *
 * ⚠⚠ NENHUMA CONTA APARECE AQUI, e a regra não tem campo para uma. O cliente não tem plano de
 * contas, e esta declaração é sobre **CAIXA**. A conta é sugerida depois, para o contador, como em
 * qualquer outra linha da fila dele.
 *
 * ⚠ A EXTRAÇÃO DE TEXTO LIVRE NÃO EXISTE. O plano previa uma LLM lendo a frase do dono e extraindo
 * `{valor, periodicidade, descrição}` — e **não há nenhuma integração de LLM neste projeto**. Esta
 * tela pergunta os três campos. Aceitar um texto e fingir que foi lido seria pior que perguntar.
 *
 * ⚠ REGRA PURA: nenhuma chamada, nenhum estado de tela. Quem envia é a página; quem decide se a
 * série pode existir continua sendo o servidor.
 */

// ⚠⚠ REUSADO, NÃO REESCRITO. `lerValorDoCampo` é a leitura de moeda que este portal já tem, e o
// motivo de ela existir é o mesmo aqui: `Number(String(v).replace(",", "."))` lê `"1.500,00"` como
// `NaN` e `"1.500"` como `1,5`. Aqui o erro não emite nota, mas põe no fluxo de caixa do cliente um
// número mil vezes menor que o dele — e ninguém confere um número que "parece" certo.
import { lerValorDoCampo } from "../../emitir/lib/valorDaNota";

/** ⚠ Os dois lados, com a MESMA forma do servidor. Vocabulário FECHADO. */
export const LADO = Object.freeze({ RECEITA: "RECEITA", DESPESA: "DESPESA" });

/**
 * ⚠ O MESMO vocabulário de `Obrigacao.periodicidade`, e do detector — não um segundo.
 * A "taxa anual do Conselho" existe por causa deste campo: um desenho que conte MESES quebra nela.
 */
export const PERIODICIDADE = Object.freeze({
  MENSAL: "MENSAL",
  TRIMESTRAL: "TRIMESTRAL",
  ANUAL: "ANUAL",
});

/** Como cada uma se lê para quem não é contador. */
export const ROTULO_DA_PERIODICIDADE = Object.freeze({
  [PERIODICIDADE.MENSAL]: "Todo mês",
  [PERIODICIDADE.TRIMESTRAL]: "A cada três meses",
  [PERIODICIDADE.ANUAL]: "Uma vez por ano",
});

export const ROTULO_DO_LADO = Object.freeze({
  // ⚠ "Dinheiro que sai/entra", não "despesa/receita": o cliente não fala contabilês, e a
  // declaração é sobre CAIXA.
  [LADO.DESPESA]: "Dinheiro que sai",
  [LADO.RECEITA]: "Dinheiro que entra",
});

/** Por que a declaração não pode ser enviada. ⚠ Vocabulário FECHADO — cada um pede outro conserto. */
export const RECUSA = Object.freeze({
  SEM_ROTULO: "sem_rotulo",
  SEM_VALOR: "sem_valor",
  VALOR_ZERO: "valor_zero",
  SEM_PERIODICIDADE: "sem_periodicidade",
  SEM_LADO: "sem_lado",
});

export const FRASE_DA_RECUSA = Object.freeze({
  [RECUSA.SEM_ROTULO]: "Diga o que se repete — é por esse nome que ele vai aparecer para o seu contador.",
  [RECUSA.SEM_VALOR]: "Informe quanto costuma ser.",
  // ⚠⚠ ZERO É UMA RECUSA PRÓPRIA, e não "sem valor": os consertos são diferentes. Quem deixou em
  // branco precisa preencher; quem digitou zero precisa saber que zero não é uma recorrência.
  [RECUSA.VALOR_ZERO]: "O valor precisa ser maior que zero — uma recorrência de R$ 0,00 não diz nada ao fluxo.",
  [RECUSA.SEM_PERIODICIDADE]: "Diga de quanto em quanto tempo isso acontece.",
  [RECUSA.SEM_LADO]: "Diga se é dinheiro que sai ou que entra.",
});

const texto = (v) => String(v ?? "").trim();

/**
 * ⚠⚠ O QUE FALTA PARA ENVIAR — todas as faltas de uma vez, nunca uma por vez.
 *
 * Devolver só a primeira faria o cliente descobrir os campos obrigatórios um clique de cada vez, que
 * é a forma mais cansativa possível de preencher um formulário curto.
 */
export function faltasDaDeclaracao(campos) {
  const faltas = [];
  if (!Object.values(LADO).includes(campos?.lado)) faltas.push(RECUSA.SEM_LADO);
  if (!texto(campos?.rotulo)) faltas.push(RECUSA.SEM_ROTULO);
  if (!Object.values(PERIODICIDADE).includes(campos?.periodicidade)) faltas.push(RECUSA.SEM_PERIODICIDADE);

  // ⚠⚠ `lerValorDoCampo` devolve `null` para campo vazio e um NÚMERO para o mascarado. Não se usa
  // `Number()` aqui: `Number("1.500,00")` é `NaN` e `Number("1.500")` é `1,5` — o erro de ordem de
  // grandeza que aquele módulo existe para impedir.
  const valor = lerValorDoCampo(campos?.valor);
  if (valor == null) faltas.push(RECUSA.SEM_VALOR);
  // ⚠ `Number(null)` é `0` e `0` é finito — por isso a guarda é `> 0`, e por isso zero tem recusa
  // própria em vez de cair em "sem valor".
  else if (!(valor > 0)) faltas.push(RECUSA.VALOR_ZERO);

  return faltas;
}

/** ⚠ Pode enviar? É a MESMA pergunta de `faltasDaDeclaracao` — não uma segunda leitura. */
export function podeEnviar(campos) {
  return faltasDaDeclaracao(campos).length === 0;
}

/**
 * O corpo que vai ao servidor.
 *
 * ⚠⚠ `chave` NÃO VIAJA. Quem canoniza é o servidor (`chaveDaDescricao`), num lugar só — mandar uma
 * chave daqui abriria uma segunda canonização, e a segunda diverge da primeira na primeira correção.
 * Sem `chave`, a rota usa o `rotulo`, que é o que a pessoa escreveu.
 *
 * ⚠⚠ E NENHUM ESTADO VIAJA. A série nasce PENDENTE por construção do servidor; deixar a tela mandar
 * `estado` abriria o caminho para o cliente pôr a própria declaração no fluxo.
 */
export function corpoDaDeclaracao(campos) {
  return {
    lado: campos?.lado,
    rotulo: texto(campos?.rotulo),
    periodicidade: campos?.periodicidade,
    valor: lerValorDoCampo(campos?.valor),
  };
}

/**
 * ⚠⚠ O QUE A TELA DIZ DEPOIS DE ENVIAR — e os dois desfechos NÃO se parecem.
 *
 * `jaDecidida` quer dizer que o contador já resolveu esta série, e a declaração **não a tocou**.
 * Devolver "pronto, registramos" nos dois casos faria o cliente achar que mudou algo que não mudou.
 */
export function leituraDoEnvio(resposta, campos) {
  const nome = texto(campos?.rotulo) || texto(resposta?.serie?.rotulo);
  if (resposta?.jaDecidida) {
    return {
      tom: "aviso",
      titulo: "Seu contador já tinha decidido sobre isto",
      frase: `"${nome}" já foi analisada pelo seu contador, então esta declaração não mudou nada. `
        + "Se o valor mudou, fale com ele.",
    };
  }
  return {
    tom: "ok",
    titulo: "Anotado",
    // ⚠⚠ A CONSEQUÊNCIA DITA: nada entra no fluxo sem o contador. Sem esta frase o cliente acha que
    // acabou de mexer no próprio fluxo de caixa.
    frase: `"${nome}" foi enviada ao seu contador. Ela só passa a contar no fluxo de caixa depois `
      + "que ele confirmar.",
  };
}

/**
 * ⚠ EXEMPLOS, não valores padrão. Eles ficam no `placeholder` — preencher os campos por conta
 * própria faria o cliente enviar o exemplo achando que era dele.
 */
export const EXEMPLOS = Object.freeze([
  "Anuidade do Conselho",
  "Jantar com clientes",
  "Aluguel da sala",
  "Assinatura do sistema",
]);
