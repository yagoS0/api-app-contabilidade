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
