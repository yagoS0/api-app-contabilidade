// PEDIR UMA GUIA ATUALIZADA — o que esta tela pode oferecer, e o que ela é obrigada a dizer antes.
//
// ⚠⚠ ESTE É O PRIMEIRO BOTÃO DO PORTAL DO CLIENTE QUE GASTA DINHEIRO DO ESCRITÓRIO. Cada clique é
// uma chamada PAGA ao SERPRO, contra o teto mensal da carteira inteira — um cliente insistindo
// consome o orçamento de todas as outras empresas.
//
// ⚠⚠ ELA NÃO É A PERMISSÃO. Quem decide é o servidor, a cada pedido: guia liberada, guia vencida,
// guia recalculável. Esta regra existe para a tela não oferecer um botão que vai voltar recusado —
// a mesma disciplina já escrita para a flag de emissão do cliente.
//
// ## ⚠⚠ A GUIA APARECE MESMO SEM ESTAR LIBERADA — E NENHUMA AÇÃO ABRE JUNTO (30/08/2026)
//
// > Dono: *"arruma a aba de guias, INSS e parcelamento não aparecem"*.
//
// A lista do cliente parou de filtrar por `liberadaCliente`. ⚠⚠ **A RAZÃO É DESTA ABA, e não de
// nenhuma outra** — dono, no mesmo dia: *"a aba de guias é aba de guias, o fluxo é o fluxo."* Uma
// aba chamada Guias que esconde a maior parte das guias da empresa está errada por conta própria:
// medido em produção, a ERISANGELA via **7 de 17**, e a carteira inteira tem **24 liberadas contra
// 232 não liberadas**. `liberadaCliente` marca que o contador ENVIOU a guia — nunca que ela existe.
//
// ⚠⚠ **MAS AS TRÊS ROTAS DE AÇÃO CONTINUAM EXIGINDO `liberadaCliente: true`** — download,
// recálculo e confirmação de pagamento, cada uma no seu próprio `where`. Então a tela **tem** de
// saber disso: um "Baixar PDF" que responde 404 é pior que a ausência dele, e é a regra escrita
// desta casa (*botão impossível não some e diz por quê*).
//
// ⚠ `canRecalculate` e `canConfirmPayment` **NÃO olham a liberação** no servidor (eles saem de
// `canGuideRecalculate`/`canGuideConfirmPayment`, que só leem o estado da guia). Antes isso era
// inofensivo, porque a guia não liberada nem chegava na tela. Hoje chega — e sem esta guarda os
// dois botões apareceriam para ela.

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
/**
 * ⚠⚠ O CONTADOR JÁ LIBEROU ESTA GUIA? — a ÚNICA leitura do campo nesta tela.
 *
 * ⚠ `=== true`, nunca truthy nem `!== false`: contrato antigo (sem o campo) responde
 * `undefined`, e **ausência não é permissão**. Falha fechado — a guia aparece na lista e as ações
 * não, que é exatamente o que o servidor faria.
 */
export function liberadaAoCliente(guia) {
  return guia?.liberadaCliente === true;
}

/**
 * O "Baixar PDF" funciona?
 *
 * ⚠ O download refaz a checagem (`liberadaCliente: true` no `where`) e devolve **404**. Oferecer o
 * botão mesmo assim daria um clique que não faz nada e um erro genérico que não explica nada.
 */
export function podeBaixarPdf(guia) {
  return liberadaAoCliente(guia);
}

/**
 * ⚠⚠ O QUE A TELA DIZ NO LUGAR DA AÇÃO — e ela diz o CONSERTO, não só a recusa.
 *
 * ⚠ A frase não culpa nem alarma: a guia existe, o valor está à vista, e o que falta é um passo
 * do contador. É o mesmo molde da situação fiscal (*"fale com o seu contador"*) e o oposto de
 * sumir com a linha, que faria o cliente concluir que a dívida não existe.
 * ⚠⚠ **E ELA NÃO CITA O FLUXO.** Dono, 30/08/2026: *"a aba de guias é aba de guias, o fluxo é o
 * fluxo."* Explicar uma tela pela outra obriga o cliente a conhecer as duas para entender uma —
 * esta aba lista as guias da empresa, e isso basta como razão de a linha estar aqui.
 * ⚠ Guia liberada NÃO tem frase: ausência visível não se descreve (critério do dono).
 */
export function motivoDaGuiaNaoLiberada(guia) {
  if (liberadaAoCliente(guia)) return null;
  return "Seu contador ainda não liberou esta guia. Para receber o documento e pagar, fale com ele.";
}

export function podePedirGuiaAtualizada(guia) {
  // ⚠ A liberação vem PRIMEIRO: sem ela o servidor recusa antes de qualquer outra conta, e este
  // botão é o que gasta dinheiro do escritório.
  return liberadaAoCliente(guia)
    && guia?.canRecalculate === true
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

/**
 * ⚠⚠ CONFIRMAR QUE PAGOU — e o que essa confirmação NÃO faz.
 *
 * Decisão do dono (27/08/2026): *"o cliente confirmar deve ser como a confirmação da consulta de
 * pagamento"* — marca a guia e **para aí**. Quem lança a baixa contábil continua sendo o contador.
 *
 * ⚠ SEM COMPROVANTE (decisão do dono): ele confirma sem anexar nada. A prova continua vindo da
 * Receita quando a consulta de pagamento rodar.
 *
 * ⚠ `canConfirmPayment` vem do servidor; ausência do campo NÃO oferece o botão.
 */
export function podeConfirmarPagamento(guia) {
  // ⚠ Idem: a rota de confirmação tem `liberadaCliente: true` no `where` e devolve 404.
  return liberadaAoCliente(guia) && guia?.canConfirmPayment === true;
}

/**
 * ⚠⚠ A CONFIRMAÇÃO REPETE O QUE ELA FAZ **E O QUE NÃO FAZ**.
 *
 * Um "confirmar pagamento?" seco faria o cliente achar que o assunto está encerrado dos dois lados
 * — e ele não está: o contador ainda vai conferir o comprovante e lançar a baixa. Dizer só metade
 * é o que produz o telefonema de "mas eu já confirmei lá".
 */
export function avisoAntesDeConfirmar(guia) {
  if (!podeConfirmarPagamento(guia)) return null;
  return {
    titulo: "Confirmar que você pagou esta guia",
    texto: "Isto registra, para o seu contador, que você já pagou. Não é preciso anexar comprovante: "
      + "ele confere o pagamento direto na Receita. ⚠ A baixa na contabilidade continua sendo feita "
      + "por ele — sua confirmação não a lança.",
    rotuloConfirmar: "Já paguei esta guia",
  };
}
