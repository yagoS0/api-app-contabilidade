// Tradução dos códigos do middleware; não concede nem infere permissões.
export function recusaDeAcesso(codigo) {
  return ({
    insufficient_role: 'Seu acesso permite consultar, mas esta ação exige permissão de contador nesta empresa. Peça ao administrador do escritório para revisar seu acesso.',
    forbidden: 'Você não tem acesso ativo a esta empresa. Peça ao administrador do escritório para revisar seu acesso.',
    scope_required: 'Seu acesso não inclui esta operação. Peça ao administrador do escritório para revisar suas permissões.',
    unauthorized: 'Entre novamente para continuar.',
  })[codigo] || null;
}
