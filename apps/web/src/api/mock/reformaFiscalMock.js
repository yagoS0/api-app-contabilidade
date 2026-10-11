import { cadastroReformaVazio, validarCadastroReforma, resumirCadastroReforma } from '@contabilidade/shared/reforma-cadastro';
export function criarReformaFiscalMock(empresas) {
  const historicos = new Map();
  const atual = id => (historicos.get(id) || [])[0];
  return {
    async getCadastroReforma(id) { return { ok: true, versao: atual(id)?.versao || 0, dados: atual(id)?.dados || cadastroReformaVazio(), historico: historicos.get(id) || [], podeEditar: true, demonstracao: true }; },
    async salvarCadastroReforma(id, entrada) {
      const dados = validarCadastroReforma(entrada.dados);
      const repetida = (historicos.get(id) || []).find(r => r.id === entrada.id);
      if (repetida && JSON.stringify(repetida.dados) === JSON.stringify(dados)) return { ok: true, revisao: repetida };
      if (repetida || entrada.versao !== (atual(id)?.versao || 0)) throw new Error('O cadastro mudou. Recarregue antes de salvar.');
      const revisao = { id: entrada.id, dados, versao: entrada.versao + 1, createdByName: 'Demonstração', createdAt: new Date().toISOString() };
      historicos.set(id, [revisao, ...(historicos.get(id) || [])]);
      return { ok: true, revisao };
    },
    async getCarteiraReforma(competencia) { return { ok: true, demonstracao: true, competencia, empresas: empresas.map(e => ({ id: e.companyId, razao: e.razaoSocial || e.razao || e.name, cnpj: e.cnpj, ...resumirCadastroReforma(atual(e.companyId)?.dados, `${competencia}-01`), verificacao: null, desatualizada: false })) }; },
    async getVerificacaoNfse() { return { ok: true, demonstracao: true, verificacao: null, escopo: 'Demonstração: nenhuma nota real foi analisada.' }; },
    async verificarNfseReforma() { throw new Error('A demonstração não contém XMLs para conferência. Use uma empresa com documentos armazenados no ambiente real.'); },
  };
}
