import { criarDocumentosEmpresaMock } from '../companyDocumentsMock';
beforeEach(() => sessionStorage.clear());
const create = () => criarDocumentosEmpresaMock({ documentos: [{ id: 'd1', nome: 'Contrato' }], anotacoes: [{ id: 'n1', texto: 'Original', fixada: true, importancia: 'BAIXA' }] });
test('alterações ficam na empresa e persistem após recriar API', async () => {
  const api = create();
  await api.createCompanyNote('a', { texto: 'Apenas empresa A', fixada: true });
  await api.deleteCompanyDocument('a', 'd1');
  const nova = create();
  expect((await nova.listCompanyNotes('a')).anotacoes[0].texto).toBe('Apenas empresa A');
  expect((await nova.listCompanyNotes('a')).anotacoes.filter(n => n.fixada)).toHaveLength(1);
  expect((await nova.listCompanyNotes('b')).anotacoes).toHaveLength(1);
  expect((await nova.listCompanyDocuments('a')).documentos).toHaveLength(0);
  expect((await nova.listCompanyDocuments('b')).documentos).toHaveLength(1);
});
test('download real do arquivo local e envio simulado respeitam empresa e destinatário', async () => {
  const api = create(); const arquivo = new File(['conteúdo'], 'anexo.txt', { type: 'text/plain' });
  const { documento } = await api.uploadCompanyDocument('a', { arquivo, tipo: 'OUTRO' });
  expect(await api.fetchCompanyDocumentBlob('a', documento.id)).toBe(arquivo);
  await expect(api.fetchCompanyDocumentBlob('b', documento.id)).rejects.toThrow('nesta empresa');
  expect(await api.sendCompanyDocuments('a', [documento.id], 'cliente@example.test')).toMatchObject({ destinatario: 'cliente@example.test', enviados: 1, simulado: true });
  await expect(create().fetchCompanyDocumentBlob('a', documento.id)).rejects.toThrow('demonstração');
});
test('criar após excluir não reutiliza identidade nem altera outra nota', async () => {
  const api = create(); const primeira = await api.createCompanyNote('a', { texto: 'Primeira' });
  await api.deleteCompanyNote('a', primeira.anotacao.id);
  const segunda = await api.createCompanyNote('a', { texto: 'Segunda' });
  expect(segunda.anotacao.id).not.toBe(primeira.anotacao.id);
  await expect(api.updateCompanyNote('b', segunda.anotacao.id, { fixada: true })).rejects.toThrow('nesta empresa');
});
