import { criarManualInssMock } from '../manualInssMock';

const companies = [
  { companyId: 'simple', razao: 'Simples', regimeTributario: 'SIMPLES', hasProlabore: true },
  { companyId: 'presumed', razao: 'Presumido', regimeTributario: 'LUCRO_PRESUMIDO', hasProlabore: true },
  { companyId: 'without', razao: 'Sem pró-labore', regimeTributario: 'SIMPLES', hasProlabore: false },
];
test('pró-labore gera pendência nos dois regimes sem criar guia e usa documentos locais da competência', async () => {
  const guides = new Map([['simple', [{ id: 'old', competencia: '2026-08', tipo: 'INSS', status: 'PROCESSED', hasPdf: true },
    { id: 'das', competencia: '2026-09', tipo: 'SIMPLES', status: 'PROCESSED', hasPdf: true }]]]);
  const api = criarManualInssMock(companies, guides);
  expect((await api.getOperationManualInss('2026-09')).items.map(i => i.status)).toEqual(['PENDING_DOCUMENT', 'PENDING_DOCUMENT', 'NOT_APPLICABLE']);
  guides.get('simple').push({ id: 'inss', competencia: '2026-09', tipo: 'INSS', status: 'PROCESSED', hasPdf: true });
  expect(await api.getCompanyManualInss('simple', '2026-09')).toMatchObject({ status: 'DOCUMENT_AVAILABLE', guides: [{ id: 'inss' }] });
  expect(guides.get('simple')).toHaveLength(3);
});

test('exceção é mensal e idempotente, revisão rejeita estado antigo e nova guia invalida edição', async () => {
  const guides = new Map();
  const api = criarManualInssMock(companies, guides);
  const before = await api.getCompanyManualInss('simple', '2026-09');
  const input = { requestId: 'request-one', expectedRevision: before.revision, state: { ...before.state, applicable: false, reason: 'Sem retirada nesta competência' } };
  const result = await api.saveCompanyManualInss('simple', '2026-09', input);
  expect(result.applicable).toBe(false);
  expect(await api.saveCompanyManualInss('simple', '2026-09', input)).toEqual(result);
  await expect(api.saveCompanyManualInss('presumed', '2026-09', input)).rejects.toMatchObject({ status: 409 });
  expect((await api.getCompanyManualInss('simple', '2026-10')).applicable).toBe(true);
  expect((await api.getCompanyManualInss('presumed', '2026-09')).applicable).toBe(true);
  await expect(api.saveCompanyManualInss('simple', '2026-09', { ...input, requestId: 'request-two' })).rejects.toMatchObject({ status: 409 });
  guides.set('simple', [{ id: 'new', competencia: '2026-09', tipo: 'INSS', status: 'PROCESSED', hasPdf: true }]);
  expect(await api.getCompanyManualInss('simple', '2026-09')).toMatchObject({ status: 'DOCUMENT_REVIEW', applicabilityConflict: true, guides: [{ id: 'new', available: true }] });
  await expect(api.saveCompanyManualInss('simple', '2026-09', { ...input, expectedRevision: result.revision, requestId: 'request-three' })).rejects.toMatchObject({ status: 409 });
});

test('não permite dispensar mês sem justificativa nem salvar data inexistente', async () => {
  const api = criarManualInssMock(companies);
  const before = await api.getCompanyManualInss('simple', '2026-09');
  const input = { requestId: 'request-one', expectedRevision: before.revision, state: { ...before.state, applicable: false } };
  await expect(api.saveCompanyManualInss('simple', '2026-09', input)).rejects.toMatchObject({ status: 422 });
  await expect(api.saveCompanyManualInss('simple', '2026-09', { ...input, state: { ...before.state, dueDate: '2026-02-30' } })).rejects.toMatchObject({ status: 422 });
});
