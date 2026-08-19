// O ESTADO DA LINHA — o que a nota está esperando, num lugar só.
//
// ⚠⚠ SÃO **DOIS FATOS DIFERENTES**, e eles não podem ter o mesmo desenho:
//
//   `aguardando_adn`      — a nota foi EMITIDA por nós e o ADN ainda não a devolveu. Ela é uma
//                           nota VÁLIDA, só ainda não confirmada. (Pedido do dono, 19/08/2026:
//                           *"deve ficar mais clarinha e, quando confirmada ADN, ela fica viva
//                           como as outras."*)
//   `cancelamento_enviado` — a pessoa ACABOU DE MANDAR CANCELAR esta nota. O servidor ainda
//                           responde "EMITIDA", porque a lista lê `PortalInvoice` (a projeção do
//                           ADN) e nós não a escrevemos.
//
// ⚠ O SEGUNDO É FEEDBACK DE UMA AÇÃO DELA, e é por isso que ele existe: sem nada mudando na
// linha, o clique parece não ter funcionado — e a pessoa clica de novo, mandando o mesmo
// cancelamento duas vezes. O segundo pedido volta recusado pelo sistema nacional e se lê como
// "falhou", quando o primeiro tinha dado certo.
//
// ⚠⚠ DESENHOS DIFERENTES, DE PROPÓSITO: o primeiro é **mais claro** (opacidade); o segundo é
// **riscado** (`line-through`). Dois fatos diferentes com o mesmo desenho é exatamente o defeito
// que este projeto persegue — e "esperando confirmação de que existe" não é "esperando confirmação
// de que deixou de existir".
//
// ⚠⚠ E NENHUM DOS DOIS PÕE TEXTO NA TELA. Instrução literal do dono, dada sobre o primeiro e que
// vale igual para o segundo: *"Não coloque explicação disso na tela."* O estado viaja em
//   • `data-estado-nota` no `<tr>` — auditável no DOM;
//   • CSS (`styles/app.css`) — a distinção visual;
//   • `title`/`aria-label` do chip — que **não são texto na tela** e são o que existe para quem
//     passa o mouse e para quem usa leitor de tela. Opacidade e risco sozinhos não chegam a quem
//     não enxerga a diferença.

export const ESTADO_DA_LINHA = Object.freeze({
  CONFIRMADA: "confirmada",
  AGUARDANDO_ADN: "aguardando_adn",
  CANCELAMENTO_ENVIADO: "cancelamento_enviado",
});

/**
 * @param {Object} nota — no contrato de `serializeInvoice`
 * @param {Object} [opts]
 * @param {boolean} [opts.cancelamentoEnviado] — mandamos cancelar NESTA sessão
 * @returns {{estado: string, title: string|null, aria: string|null}}
 */
export function estadoDaLinhaDaNota(nota, { cancelamentoEnviado = false } = {}) {
  // ⚠ O CANCELAMENTO ENVIADO VENCE. Uma nota pode estar nos dois estados (emitida por nós, ainda
  // não confirmada, e já mandada cancelar), e o que importa para quem olha é o ato mais recente —
  // que é também o que impede um segundo clique.
  if (cancelamentoEnviado) {
    return {
      estado: ESTADO_DA_LINHA.CANCELAMENTO_ENVIADO,
      title: "Cancelamento enviado — aguardando confirmação do sistema nacional",
      aria: "Cancelamento enviado — aguardando confirmação do sistema nacional",
    };
  }

  // ⚠ `=== false` e não "falsy": o contrato antigo (e o app mobile) não trazem o campo, e
  // `undefined` tem de ser lido como CONFIRMADA — que era o único estado que existia.
  if (nota?.confirmadaPeloAdn === false) {
    return {
      estado: ESTADO_DA_LINHA.AGUARDANDO_ADN,
      title: "Emitida — aguardando confirmação do sistema nacional",
      aria: "Emitida — aguardando confirmação do sistema nacional",
    };
  }

  return { estado: ESTADO_DA_LINHA.CONFIRMADA, title: null, aria: null };
}
