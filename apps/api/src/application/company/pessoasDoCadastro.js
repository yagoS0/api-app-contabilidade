import { mensagemDoErroDeCadastro } from '@contabilidade/shared/erros-cadastro-empresa';
// Todas as mutações de pessoas do cadastro compartilham a trava da Company.
export async function travarPessoasDoCadastro(tx, companyId) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
  return tx.company.findUnique({ where: { id: companyId }, select: { titular: true, partners: { select: { id: true } }, atividades: true } });
}
export function exigirPessoasCompativeis(titular, socios) {
  if (titular && socios?.length) {
    const err = new Error(mensagemDoErroDeCadastro('company_titular_invalid'));
    err.code = 'COMPANY_TITULAR_INVALID';
    throw err;
  }
}
