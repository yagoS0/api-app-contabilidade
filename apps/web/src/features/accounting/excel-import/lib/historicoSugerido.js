// O HISTÓRICO SUGERIDO DA LINHA IMPORTADA — sugestão, nunca decisão.
//
// O import de Excel gravava a descrição da planilha como se ela FOSSE o histórico contábil. A
// descrição de um extrato ("ALUGUEL SALA 302", "INSS - 06/2026") descreve o que o banco viu; o
// histórico descreve o que o escritório lança. O OFX já separa as duas coisas na tela; aqui a
// separação não existia.
//
// ⚠ NADA DISTO É GRAVADO SEM O CONTADOR VER. O que estas funções produzem nasce dentro de um campo
// EDITÁVEL da tabela de revisão — ele escreve por cima e o que sobe é o texto dele. Regra do dono.

// Já começa com o prefixo? A âncora é o TOKEN "PAGO", não as quatro letras: "PAGAMENTO FORNECEDOR"
// não começa com PAGO, e tratá-lo como se começasse deixaria a linha sem prefixo nenhum.
const JA_TEM_PREFIXO = /^pago\b/i;

/**
 * `PAGO ` + descrição, **sem duplicar o prefixo**.
 *
 * ⚠ A guarda não é hipotética: 41 dos 230 registros da memória desta base já começam com "PAGO".
 * Sem ela, a sugestão daquelas linhas seria "PAGO PAGO ALUGUEL".
 *
 * Descrição vazia devolve string vazia — um "PAGO " solto seria um histórico que não diz nada,
 * e pior, um campo que PARECE preenchido.
 */
export function comPrefixoPago(descricao) {
  const texto = String(descricao || "").trim();
  if (!texto) return "";
  if (JA_TEM_PREFIXO.test(texto)) return texto;
  return `PAGO ${texto}`;
}

/**
 * A sugestão de uma linha do preview.
 *
 * A memória vence o prefixo: `match.historicoSugerido` é o histórico que o contador JÁ escreveu
 * para esta descrição num import anterior — refazer o "PAGO " por cima dele descartaria a única
 * coisa que ele ensinou ao sistema. Sem memória (é o caso de todos os 230 registros de hoje, que
 * nasceram sem o campo), cai no prefixo.
 */
export function historicoSugeridoDaLinha(linha) {
  const daMemoria = String(linha?.match?.historicoSugerido || "").trim();
  if (daMemoria) return daMemoria;
  return comPrefixoPago(linha?.descricao);
}
