// Códigos reais de requireFirmCompanyAccess; somente apresentação.
const RECUSAS = {
  forbidden: 'Você não tem acesso aos registros fiscais desta empresa.',
  insufficient_role: 'Seu perfil não permite alterar pendências fiscais. Solicite acesso ao responsável pelo escritório.',
  scope_required: 'Seu acesso não inclui esta operação fiscal. Solicite a permissão ao responsável pelo escritório.',
  unauthorized: 'Sua sessão expirou. Entre novamente para continuar.',
};
export function mensagemDaPendencia(erro) {
  const textos = typeof erro === 'string' ? [erro] : [erro?.reason, erro?.payload?.reason, erro?.message];
  for (const valor of textos) {
    const texto = String(valor || '').trim();
    if (texto && !RECUSAS[texto.toLowerCase()]) return texto;
  }
  for (const valor of [...textos, erro?.code, erro?.payload?.error]) {
    const traducao = RECUSAS[String(valor || '').trim().toLowerCase()];
    if (traducao) return traducao;
  }
  return 'Não foi possível concluir a operação.';
}
