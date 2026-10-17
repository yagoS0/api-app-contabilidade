// Local demonstration only. Every company owns its own documents and notes.
const KEY = 'altan:mock:company-documents:v1';
const clone = value => JSON.parse(JSON.stringify(value));
export function criarDocumentosEmpresaMock({ documentos = [], anotacoes = [], tipos = [], tipoLabels = {}, storage = typeof sessionStorage === 'undefined' ? null : sessionStorage } = {}) {
  let banco = {};
  const arquivos = new Map();
  function ler(companyId) {
    if (!companyId) throw new Error('Empresa não informada.');
    if (storage) { try { banco = JSON.parse(storage.getItem(KEY) || '{}'); } catch { throw new Error('Não foi possível ler os dados locais de demonstração.'); } }
    if (!banco[companyId]) banco[companyId] = { documentos: clone(documentos), anotacoes: clone(anotacoes), sequencia: 0 };
    return banco[companyId];
  }
  function salvar() { if (storage) storage.setItem(KEY, JSON.stringify(banco)); }
  function id(base, prefixo) { base.sequencia += 1; return `${prefixo}-${Date.now()}-${base.sequencia}`; }
  function encontrar(base, collection, recordId) {
    const item = base[collection].find(d => d.id === recordId);
    if (!item) throw new Error('Registro não encontrado nesta empresa.');
    return item;
  }
  return {
    async listCompanyDocuments(companyId) { return { ok: true, documentos: clone(ler(companyId).documentos), tipos, tipoLabels }; },
    async uploadCompanyDocument(companyId, { arquivo, tipo, nome, validade }) {
      const base = ler(companyId);
      const doc = { id: id(base, 'mock-doc'), tipo: tipo || 'OUTRO', nome: nome || arquivo?.name || 'documento.pdf', mimeType: arquivo?.type || 'application/pdf', bytes: arquivo?.size || 0, validade: validade || null, createdAt: new Date().toISOString() };
      base.documentos.unshift(doc); salvar();
      if (arquivo) arquivos.set(companyId + ':' + doc.id, arquivo);
      return { ok: true, documento: clone(doc) };
    },
    async fetchCompanyDocumentBlob(companyId, documentId) {
      const doc = encontrar(ler(companyId), 'documentos', documentId);
      const arquivo = arquivos.get(companyId + ':' + documentId);
      if (arquivo) return arquivo;
      throw new Error(`O arquivo de ${doc.nome} não está disponível nesta demonstração. Adicione um arquivo para testar o download.`);
    },
    async deleteCompanyDocument(companyId, documentId) {
      const base = ler(companyId); encontrar(base, 'documentos', documentId);
      base.documentos = base.documentos.filter(d => d.id !== documentId); salvar();
      arquivos.delete(companyId + ':' + documentId);
      return { ok: true, removido: { id: documentId } };
    },
    async sendCompanyDocuments(companyId, documentIds, destinatario) {
      const base = ler(companyId);
      const docs = documentIds.map(id => encontrar(base, 'documentos', id));
      return { ok: true, enviados: docs.length, destinatario, documentos: clone(docs), simulado: true };
    },
    async listCompanyNotes(companyId, ordenarPor = 'data') {
      const notas = clone(ler(companyId).anotacoes);
      const peso = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
      notas.sort((a, b) => Number(b.fixada) - Number(a.fixada) || (ordenarPor === 'importancia' ? peso[a.importancia] - peso[b.importancia] : 0) || new Date(b.createdAt) - new Date(a.createdAt));
      return { ok: true, anotacoes: notas, importancias: ['ALTA', 'MEDIA', 'BAIXA'] };
    },
    async createCompanyNote(companyId, { texto, importancia = 'MEDIA', fixada = false }) {
      const base = ler(companyId);
      if (fixada) base.anotacoes.forEach(n => { n.fixada = false; });
      const nota = { id: id(base, 'mock-nota'), texto, importancia, fixada, createdAt: new Date().toISOString() };
      base.anotacoes.unshift(nota); salvar(); return { ok: true, anotacao: clone(nota) };
    },
    async updateCompanyNote(companyId, noteId, patch) {
      const base = ler(companyId); const nota = encontrar(base, 'anotacoes', noteId);
      if (patch.fixada) base.anotacoes.forEach(n => { n.fixada = false; });
      Object.assign(nota, patch); salvar(); return { ok: true, anotacao: clone(nota) };
    },
    async deleteCompanyNote(companyId, noteId) {
      const base = ler(companyId); encontrar(base, 'anotacoes', noteId);
      base.anotacoes = base.anotacoes.filter(n => n.id !== noteId); salvar();
      return { ok: true, removida: { id: noteId } };
    },
  };
}
