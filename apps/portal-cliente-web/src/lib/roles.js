// Papel do usuário DENTRO da empresa (CompanyClientUser.role).
// Copiado de `src/roles.ts` do app mobile — pesos alinhados ao backend
// (`requireClientCompanyAccess.ROLE_WEIGHT`). CLIENT_USER é legado.

export const ROLE_LABEL = {
  OWNER: "Proprietário",
  CLIENT_ADMIN: "Administrador",
  FINANCEIRO: "Financeiro",
  CLIENT_USER: "Usuário",
};

export function roleLabel(role) {
  if (!role) return "";
  return ROLE_LABEL[String(role).toUpperCase()] ?? String(role);
}

export const ROLE_WEIGHT = {
  CLIENT_USER: 1,
  FINANCEIRO: 1,
  CLIENT_ADMIN: 2,
  OWNER: 3,
};

/**
 * Papel mínimo para os ATOS FISCAIS do lado do cliente (emitir NFS-e).
 *
 * ⚠ Cópia do `PAPEL_MINIMO_EMISSAO` de
 * `apps/api/src/application/nfse/emissaoClienteAutorizacao.js`. Quem AUTORIZA continua sendo o
 * servidor (`ensureEmissaoNfseAutorizada`, a cada emissão) — isto aqui só existe para a tela não
 * oferecer um botão que já se sabe que vai ser recusado.
 */
export const PAPEL_MINIMO_EMISSAO = "CLIENT_ADMIN";

/**
 * O papel alcança `CLIENT_ADMIN` (peso ≥ 2)?
 *
 * ⚠ **UM de-para só.** A pergunta é respondida pelo `ROLE_WEIGHT` acima — o mesmo mapa que já
 * espelha `PESO_PAPEL_CLIENTE` do backend. Escrever uma segunda tabela de papéis em qualquer
 * feature é como os dois lados passam a discordar sem ninguém notar; quando o backend mudar a
 * régua, só existe UM lugar aqui para acompanhar.
 *
 * ⚠ Papel ausente/desconhecido devolve `false`: peso 0 não alcança 2. Isso NÃO é o mesmo que a
 * flag da empresa ausente (ver `emitir/lib/portaoEmissao.js`) — papel que a API não reconhece é
 * papel que não emite, enquanto flag ausente é "esta tela não recebeu o estado".
 */
export function isAdminOrAbove(role) {
  const peso = ROLE_WEIGHT[String(role || "").toUpperCase()] || 0;
  return peso >= ROLE_WEIGHT[PAPEL_MINIMO_EMISSAO];
}
