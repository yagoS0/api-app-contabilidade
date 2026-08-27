// PEDIR UMA GUIA ATUALIZADA — o que esta tela pode oferecer, e o que ela é obrigada a dizer antes.
//
// ⚠⚠ ESTE É O PRIMEIRO BOTÃO DO PORTAL DO CLIENTE QUE GASTA DINHEIRO DO ESCRITÓRIO. Cada clique é
// uma chamada PAGA ao SERPRO, contra o teto mensal da carteira inteira — um cliente insistindo
// consome o orçamento de todas as outras empresas.
//
// ⚠⚠ ELA NÃO É A PERMISSÃO. Quem decide é o servidor, a cada pedido: guia liberada, guia vencida,
// guia recalculável. Esta regra existe para a tela não oferecer um botão que vai voltar recusado —
// a mesma disciplina já escrita para a flag de emissão do cliente.

/**
 * O botão aparece?
 *
 * ⚠ TRÊS condições, e a do meio é a decisão do dono (27/08/2026: *"só guia vencida, com aviso"*).
 * Guia em aberto não tem por que ser regerada pelo cliente: o valor seria o mesmo, e o gasto, não.
 *
 * ⚠⚠ `vencida` e `canRecalculate` vêm PRONTOS do backend — a tela não os deriva. Derivar "vencida"
 * aqui exigiria repetir a regra que decide entre a guia com juros e a sem (e que, no servidor,
 * ainda trata o vencimento ESTIMADO). Duas leituras dariam telas que discordam sobre a mesma guia.
 *
 * ⚠ Contrato ANTIGO (sem os campos) NÃO oferece — ausência de campo não é permissão.
 */
export function podePedirGuiaAtualizada(guia) {
  return guia?.canRecalculate === true
    && guia?.vencida === true
    && Boolean(guia?.avisoDeRecalculo?.texto);
}

/**
 * ⚠⚠ O AVISO VEM PRONTO DO SERVIDOR, E A TELA NÃO ESCREVE O SEU.
 *
 * Ele diz que a Receita gera uma guia NOVA, com juros e multa, e que o valor a pagar será maior —
 * e é a versão do CLIENTE, sem teto, custo por chamada nem o nome do fornecedor (isso é orçamento
 * interno do escritório). Reescrevê-lo aqui criaria uma segunda frase sobre o mesmo ato, e as duas
 * divergiriam na primeira correção.
 */
export function avisoAntesDePedir(guia) {
  const aviso = guia?.avisoDeRecalculo;
  if (!podePedirGuiaAtualizada(guia)) return null;
  return {
    titulo: aviso.titulo,
    texto: aviso.texto,
    // ⚠ O rótulo do botão de confirmação NOMEIA o ato, e não é "OK": quem confirma precisa saber o
    // que está confirmando mesmo sem reler a caixa.
    rotuloConfirmar: "Pedir guia atualizada",
  };
}

/**
 * ⚠ O QUE FAZER DEPOIS DE UMA RECUSA — e "tentar de novo" não é sempre a resposta.
 *
 * Teto estourado só o escritório resolve; repetição em pouco tempo passa sozinha. O servidor já
 * separa os dois em `podeTentarDeNovo`; aqui isso vira ou não um botão.
 */
export function leituraDaRecusa(resposta) {
  if (!resposta) return null;
  return {
    texto: resposta.message || "Não foi possível pedir a guia atualizada agora.",
    // ⚠ `=== true`: ausência do campo NÃO vira "pode tentar" — oferecer repetição contra um teto
    // estourado gasta a paciência do cliente e não resolve nada.
    podeTentarDeNovo: resposta.podeTentarDeNovo === true,
  };
}

/**
 * ⚠⚠ A GUIA NOVA VEIO SEM JUROS E MULTA? — e isto vai para o CLIENTE também.
 *
 * Não está confirmado que o serviço da Receita gere a DARF do Presumido com acréscimos quando ela
 * está vencida. Quem vai pagar precisa saber disso ANTES de pagar: uma guia a menor faz o cliente
 * pagar errado e continuar devendo a diferença.
 *
 * ⚠ As três respostas do servidor viram DUAS aqui — "vieram" não precisa de aviso; "não vieram" e
 * "não deu para ler" precisam, e o texto de cada uma já vem pronto.
 */
export function avisoDosAcrescimos(acrescimos) {
  if (!acrescimos || acrescimos.estado === "presentes") return null;
  return {
    titulo: "Confira esta guia antes de pagar",
    texto: acrescimos.texto,
    tom: "atencao",
  };
}
