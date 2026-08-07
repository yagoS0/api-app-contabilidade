// TRAVA DE LIBERAÇÃO DA ENTREGA POR ARQUIVO (EFD-Contribuições).
//
// ⚠ DESLIGADA POR DECISÃO DO DONO, EM 07/08/2026, E O MOTIVO NÃO É BUG:
// o fluxo foi construído e conferido no mock, mas nunca foi exercido contra a API real nem contra
// uma entrega de verdade — e a EFD é assunto grande demais para ficar meio pronto ao alcance de um
// clique. Vai ser desenvolvida em separado, com atenção própria. Enquanto isso, ninguém deve poder
// registrar entrega por aqui e sair achando que registrou.
//
// ⚠ POR QUE ESCONDER, AQUI, NÃO CONTRARIA A REGRA DE "OBRIGAÇÃO NUNCA SOME DA TELA":
// aquela regra vale para obrigação que o app ACOMPANHA — sumir transformaria "não sabemos fazer"
// em "não existe obrigação". Esta funcionalidade nasceu hoje, nunca esteve em produção e nenhum
// contador jamais registrou nada nela. Não há rastro a esconder: há uma feature não liberada.
// Se um dia houver dado gravado, reveja esta decisão antes de desligar de novo — aí sumir passaria
// a esconder trabalho já feito, que é outra coisa.
//
// PARA RELIGAR: troque para `true` aqui e derrube o `ENTREGA_ARQUIVO_LIBERADA` em
// `apps/api/src/routes/firm/obrigacoes.js`. São dois lugares de propósito — só a tela deixaria a
// rota aberta para uma aba antiga; só a rota deixaria a tela oferecendo o que o backend recusa.
// Antes de religar, leia `docs/efd-contribuicoes-onde-paramos.md`.
export const ENTREGA_POR_ARQUIVO_LIBERADA = false;
