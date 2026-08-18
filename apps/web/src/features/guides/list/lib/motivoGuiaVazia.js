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
// ── ⚠ A LISTA ESTÁ VAZIA DE PROPÓSITO ───────────────────────────────────────────────────────────
//
// O dono escolheu "lista fechada + outro (texto)". **As opções ainda não foram ditadas por ele**, e
// eu não as invento: motivo de ausência de guia é classificação fiscal, e um rótulo errado aqui vira
// justificativa errada gravada no lugar em que uma fiscalização vai olhar. Enquanto a lista não
// chega, o campo funciona por TEXTO LIVRE — que é o caminho "outro", já implementado.
//
// Preencher isto depois NÃO exige mexer no componente: ele lê daqui.
export const MOTIVOS_GUIA_VAZIA = Object.freeze([
  // Exemplo da forma esperada (NÃO é conteúdo aprovado — não descomente sem o dono ditar):
  // { chave: "TRIMESTRAL_FORA_DO_MES", rotulo: "Tributo trimestral — mês sem apuração" },
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
