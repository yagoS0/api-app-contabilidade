import { ApiError } from "./ApiError";

/**
 * TRAVA DE TIPO DE CONTA — regra de PRODUTO, não detalhe de implementação.
 *
 * Este portal é do CLIENTE. Uma conta `FIRM` (contador) que entrasse aqui veria
 * a tela do cliente — com UMA empresa, os números DELA — e concluiria coisas
 * erradas sobre a própria carteira. O app mobile
 * (`portal-cliente-mobile/src/api.ts`) recusa exatamente assim, e a web faz
 * igual para que os dois lados do cliente não divirjam.
 *
 * ⚠ Vive aqui, chamada pelo mock E pelo real, de propósito: se morasse só num
 * dos dois, o modo offline passaria a mentir sobre a regra mais importante da
 * tela de login.
 *
 * Isto não substitui o servidor: `requireAccountType("CLIENT")` continua
 * barrando toda rota `/client`. Esta é a mensagem legível, não a autorização.
 */
export function exigirContaDeCliente(loginResponse) {
  if (loginResponse?.user?.accountType !== "CLIENT") {
    throw new ApiError(403, "not_a_client", "Este acesso é apenas para clientes.");
  }
  return loginResponse;
}
