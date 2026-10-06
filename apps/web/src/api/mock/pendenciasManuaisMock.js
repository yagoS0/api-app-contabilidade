import { validarPendenciaManual } from '@contabilidade/shared/pendencias-manuais';

// Somente createMockApi usa este armazenamento de demonstração; o cliente real nunca cai aqui.
export function createPendenciasManuaisMock() {
  const memoria = new Map();
  const chave = id => `altan.dev.pendencias-manuais.v1:${id}`;
  function ler(id) {
    if (typeof localStorage !== 'undefined') {
      const salvo = localStorage.getItem(chave(id));
      if (salvo) return JSON.parse(salvo);
    }
    return memoria.get(id) || [];
  }
  function gravar(id, itens) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(chave(id), JSON.stringify(itens));
    memoria.set(id, itens);
  }
  return {
    async listPendenciasManuais(companyId) { return { itens: ler(companyId) }; },
    async savePendenciaManual(companyId, payload) {
      const itens = ler(companyId);
      const atual = itens.find(i => i.id === payload.id);
      const dados = validarPendenciaManual(payload.dados);
      if (payload.versao != null && atual?.versao !== payload.versao) throw new Error('O registro mudou. Recarregue a lista.');
      if (atual && payload.versao == null) {
        if (Object.keys(dados).every(k => atual.dados[k] === dados[k])) return { item: atual };
        throw new Error('O registro já existe. Recarregue a lista.');
      }
      const item = { id: payload.id, dados, versao: (atual?.versao || 0) + 1, createdAt: atual?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      gravar(companyId, atual ? itens.map(i => i.id === item.id ? item : i) : [...itens, item]);
      return { item };
    },
    async deletePendenciaManual(companyId, { id, versao }) {
      const itens = ler(companyId);
      if (itens.find(i => i.id === id)?.versao !== versao) throw new Error('O registro mudou. Recarregue a lista.');
      gravar(companyId, itens.filter(i => i.id !== id));
      return { ok: true };
    },
  };
}
