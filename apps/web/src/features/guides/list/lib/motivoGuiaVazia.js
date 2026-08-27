// POR QUE ESTA GUIA ESTÁ VAZIA HAVENDO FATURAMENTO — o motivo que o backend passou a exigir.
//
// Contexto (dono, 18/08/2026): *"nas empresas presumidas ele não permite marcar as guias faltantes
// como vazia, por conta do faturamento, mas às vezes não teremos guias mesmo com faturamento, o
// contador deve poder marcar vazio"*.
//
// A recusa dura virou confirmação (ver `routes/firm/index.js`, `GUIA_VAZIA_COM_FATURAMENTO`), e o
// que sustenta a mudança é o MOTIVO: sem ele, *"por que o contador afirmou ausência de guia havendo
// nota emitida?"* não teria resposta numa fiscalização — e essa pergunta é a razão de a guarda ter
// existido. Ele é obrigatório SÓ neste caminho; sem faturamento segue opcional, como sempre foi.
//
// ── A LISTA, E DE ONDE ELA VEIO ─────────────────────────────────────────────────────────────────
//
// ⚠⚠ ESTE BLOCO DIZIA "A LISTA ESTÁ VAZIA DE PROPÓSITO" até 27/08/2026, e a razão era esta:
// *"o dono escolheu 'lista fechada + outro (texto)'; as opções ainda não foram ditadas por ele, e eu
// não as invento — motivo de ausência de guia é classificação fiscal, e um rótulo errado aqui vira
// justificativa errada gravada no lugar em que uma fiscalização vai olhar"*. O argumento continua
// inteiro; o que mudou é que as opções passaram a existir.
//
// ⚠ A PROCEDÊNCIA, DITA COM PRECISÃO: as quatro foram **propostas por mim** no plano de 27/08/2026
// e **aprovadas com ele** — não foram ditadas palavra por palavra pelo dono. É aprovação, e é o que
// autoriza a lista; não é o mesmo que transcrição, e a diferença fica registrada aqui porque quem
// ler depois vai querer saber de quem é o rótulo que está gravado numa afirmação fiscal.
//
// ⚠ A lista NÃO é exaustiva, e por isso o caminho "Outro (descrever abaixo)" continua no formulário:
// fechar a lista de vez obrigaria o contador a escolher o rótulo menos errado para um caso que ela
// não prevê — que é como uma classificação errada entra sem ninguém decidir isso.
//
// Preencher isto NÃO exigiu mexer no componente: ele lê daqui, como o cabeçalho antigo prometia.
export const MOTIVOS_GUIA_VAZIA = Object.freeze([
  // O caso que motivou a entrega: IRPJ e CSLL são apurados por TRIMESTRE (Lei 9.430/1996), então
  // nos dois meses que não fecham o trimestre não há guia deles — mesmo com faturamento.
  Object.freeze({ chave: "TRIMESTRAL_FORA_DO_MES", rotulo: "Tributo trimestral — mês sem apuração" }),
  // ⚠ Diferente do de cima: aqui a apuração EXISTE e o recolhimento aconteceu noutra competência
  // (o trimestre pode ser pago em até três quotas mensais). "Não há apuração" e "já foi recolhido"
  // são fatos distintos, e colapsá-los apagaria a diferença numa fiscalização.
  Object.freeze({ chave: "QUOTA_JA_PAGA", rotulo: "Quota do trimestre já recolhida em outro mês" }),
  // Houve faturamento, mas a base daquele tributo específico é zero (retenção, isenção, exclusão).
  Object.freeze({ chave: "SEM_BASE_NO_MES", rotulo: "Sem base de cálculo nesta competência" }),
  // A empresa não é contribuinte daquele tributo — é afirmação sobre o CADASTRO, não sobre o mês.
  Object.freeze({ chave: "TRIBUTO_NAO_DEVIDO", rotulo: "Tributo não devido por esta empresa" }),
]);

/** A lista já pode ser oferecida? Enquanto for `false`, a tela mostra só o texto livre. */
export const TEM_LISTA_DE_MOTIVOS = MOTIVOS_GUIA_VAZIA.length > 0;

/**
 * O texto que vai para `Guide.vazioMotivo`.
 * ⚠ Escolher da lista e digitar são a MESMA coluna — o que muda é a procedência, e por isso a
 * chave viaja junto do rótulo. Gravar só o rótulo faria renomear uma opção reescrever o passado.
 */
export function motivoParaGravar({ chave, texto } = {}) {
  const livre = String(texto || "").trim();
  const opcao = MOTIVOS_GUIA_VAZIA.find((m) => m.chave === chave);
  if (opcao) return livre ? `[${opcao.chave}] ${opcao.rotulo} — ${livre}` : `[${opcao.chave}] ${opcao.rotulo}`;
  return livre;
}

/** O motivo está preenchido a ponto de poder confirmar? */
export function motivoSuficiente(entrada) {
  return motivoParaGravar(entrada).length > 0;
}
