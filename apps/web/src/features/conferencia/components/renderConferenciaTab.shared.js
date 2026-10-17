import {
  ORIGEM_PAGAMENTO,
  acaoPedeData,
} from "../lib/conferenciaTela";
export function montarCorpo({
  acao, item, data, motivo, valor, cfg, contaCompleta = null,
  /**
   * ⚠⚠ O CRÉDITO ESCOLHIDO (01/09/2026) — dono: *"aqueles que viram lançamento contábil devem ter
   * opção de colocar débito e crédito"*.
   *
   * ⚠⚠ SÃO DOIS PARÂMETROS, e não um, porque *"não escolhi"* e *"apaguei a escolha"* são atos
   * OPOSTOS. Mandar `contaCredito: null` sempre que o campo estivesse vazio APAGARIA o crédito que
   * a regra do fornecedor escolheu, a cada confirmação — inclusive as do botão «Lançar» da linha,
   * que não tem campo de crédito nenhum. O servidor distingue ausente de nulo; a tela tem de
   * respeitar a distinção do lado de cá.
   */
  creditoCompleto = null,
  creditoTocado = false,
}) {
  const corpo = {};
  if (acaoPedeData(acao, item) && data) {
    corpo.dataPagamento = data;
    corpo.origemPagamento = ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR;
  }
  if (cfg?.pedeMotivo && motivo) corpo.motivoRecusa = motivo;
  if (cfg?.pedeValor && valor) corpo.valorAjustado = valor;
  // ⚠⚠ A CONTA QUE O CONTADOR ESCOLHEU — em `codigoCompleto`, já traduzida pelo modal.
  //
  // Ela vence a sugestão porque é o ato dele; sem escolha, cai na sugestão derivada, que é o
  // comportamento de antes do seletor. ⚠ NUNCA string vazia: `""` cairia em `sem_conta` no servidor
  // e a tela descobriria a regra pelo erro — por isso `completoDoReduzido` devolve `null` + motivo.
  if (cfg?.criaLancamento) {
    const conta = contaCompleta || item?.sugestao?.conta || null;
    if (conta) corpo.contaAplicada = conta;

    // ⚠ Escolha nova ⇒ manda a conta. Campo LIMPO por quem tinha uma ⇒ manda `null`, que é o
    // servidor voltando ao caixa cravado. Nada disso ⇒ a chave não viaja, e o que estava fica.
    if (creditoCompleto) corpo.contaCredito = creditoCompleto;
    else if (creditoTocado && item?.contaCredito) corpo.contaCredito = null;
  }
  return corpo;
}
