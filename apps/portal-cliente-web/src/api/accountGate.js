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
/**
 * ⚠⚠ A EXCEÇÃO DO ESCRITÓRIO — uma marca POR USUÁRIO, e nada mais (30/08/2026).
 *
 * > Dono: *"não estou conseguindo acessar o portal do cliente com meu acesso de contador (…) o meu
 * > acesso admin deve ser o único a conseguir isso."*
 *
 * ⚠⚠ **NÃO É O `role`, e a distinção é o ponto.** `role: "admin"` é **bypass total** nos três
 * middlewares da api — quem o tem ganha OWNER em qualquer empresa do banco, fora da carteira
 * inclusive. Promover a conta para abrir esta porta daria privilégio sobre o sistema inteiro.
 * ⚠ Medido em 30/08/2026: **zero** usuários com role `admin` na base; a exceção que já existia lá
 * nunca foi acionada por ninguém.
 *
 * ⚠ **Nem "qualquer conta FIRM".** Hoje isso seria a mesma coisa — há um único usuário FIRM —, e
 * deixaria de ser no dia em que entrar um segundo contador, sem ninguém decidir.
 *
 * ⚠⚠ **ELA ABRE A PORTA, NÃO DÁ PODER.** Quem entra por aqui recebe `FINANCEIRO` e o escopo da
 * própria carteira, no SERVIDOR: vê notas, guias, alíquota e fluxo, e é recusado em emissão de
 * NFS-e, pró-labore, certificado e gestão de usuários. Emitir nota em nome do cliente é ato fiscal
 * irreversível no CNPJ de outro.
 *
 * ⚠ `=== true`, nunca truthy: contrato antigo (sem o campo) responde `undefined`, e ausência não é
 * permissão. Falha fechado, como o portão de emissão desta casa.
 */
export function exigirContaDeCliente(loginResponse) {
  const user = loginResponse?.user;
  if (user?.accountType === "CLIENT") return loginResponse;
  if (user?.podeAbrirPortalDoCliente === true) return loginResponse;
  throw new ApiError(403, "not_a_client", "Este acesso é apenas para clientes.");
}

/**
 * ⚠⚠ ESTA SESSÃO É UMA VISITA DO ESCRITÓRIO? — e a tela precisa DIZER.
 *
 * Sem a marca visível, o contador lê a tela do cliente achando que é a dele, e conclui coisas
 * erradas sobre a carteira — que é exatamente o risco que `exigirContaDeCliente` existia para
 * impedir. A porta abriu; o aviso é o que a mantém honesta.
 */
export function ehVisitaDoEscritorio(user) {
  return user?.accountType !== "CLIENT" && user?.podeAbrirPortalDoCliente === true;
}
