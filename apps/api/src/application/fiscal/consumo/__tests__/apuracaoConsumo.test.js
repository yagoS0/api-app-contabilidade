import { randomUUID } from 'node:crypto';
import { lerBaseConsumo, vincularEstabelecimentos, salvarConfiguracaoConsumo, prepararRevisaoConsumo } from '../ApuracaoConsumoService.js';

const usuario = { id: 'contador', role: 'contador' };
const ctx = { tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2027-01' };
let db, tabelas;
const matches = (r, where = {}) => Object.entries(where).every(([k, v]) => v && typeof v === 'object' && 'in' in v ? v.in.includes(r[k]) : r[k] === v);
const select = (r, fields) => !r || !fields ? r : Object.fromEntries(Object.keys(fields).filter(k => fields[k]).map(k => [k, r[k]]));
beforeEach(() => {
  tabelas = {
    portalClient: [{ id: 'a', cnpj: '12345678000195', razao: 'Matriz' }, { id: 'b', cnpj: '12345678000276', razao: 'Filial' }, { id: 'c', cnpj: '87654321000198', razao: 'Outra' }],
    companyFirmAccess: ['a', 'b', 'c'].map(companyId => ({ companyId, userId: usuario.id, role: 'ACCOUNTANT', status: 'ACTIVE' })),
    apuracaoConsumoContribuinte: [], apuracaoConsumoEstabelecimento: [], apuracaoConsumoConfiguracao: [], apuracaoConsumoRevisao: [],
    companyCredential: [{ id: 'cred-a', portalClientId: 'a', senhaCifrada: 'NUNCA_RETORNAR' }, { id: 'cred-c', portalClientId: 'c' }],
    reformaFiscalRevisao: ['a', 'b'].map(portalClientId => ({ id: `cad-${portalClientId}`, portalClientId, versao: 1, dados: { periodos: [
      { inicio: '2027-01-01', fim: null, regime: 'LUCRO_PRESUMIDO', forma: 'REGULAR', situacao: 'CONFIRMADA', evidencia: 'Cadastro fiscal' },
    ] } })),
  };
  db = Object.fromEntries(Object.entries(tabelas).map(([nome, rows]) => {
    const buscar = ({ where, orderBy, select: fields } = {}) => {
      const encontrados = rows.filter(r => matches(r, where));
      if (orderBy) { const [k, direcao] = Object.entries(orderBy)[0]; encontrados.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (direcao === 'desc' ? -1 : 1)); }
      return encontrados.map(r => select(r, fields));
    };
    return [nome, { findMany: jest.fn(async q => buscar(q)), findUnique: jest.fn(async q => buscar(q)[0] || null),
      findFirst: jest.fn(async q => buscar(q)[0] || null), create: jest.fn(async ({ data }) => { const r = { id: randomUUID(), ...data }; rows.push(r); return r; }) }];
  }));
  db.$transaction = jest.fn(async fn => fn(db));
});
const vincular = (ids = ['a']) => vincularEstabelecimentos(db, 'a', { portalClientIds: ids }, usuario);
const config = (patch = {}) => ({ id: randomUUID(), versao: 0, tributo: 'CBS', ambiente: 'HOMOLOGACAO', habilitado: true,
  dados: { motivo: 'Preparação local', referenciaContrato: 'Contrato em conferência' }, ...patch });
const revisao = (patch = {}) => ({ id: randomUUID(), versao: 0, ...ctx, motivo: 'Preparar competência', ...patch });

test('GET não cria grupo nem configuração e informa ausência de capacidades oficiais', async () => {
  const r = await lerBaseConsumo(db, 'a', ctx, usuario);
  expect(r).toMatchObject({ contribuinte: null, configuracao: null, revisao: null, podeEditar: true, capacidades: { coletar: false, emitirGuia: false, conferir: false } });
  expect(db.apuracaoConsumoContribuinte.create).not.toHaveBeenCalled();
});
test('vínculo é explícito, repetível e não agrega filial pelo CNPJ automaticamente', async () => {
  const primeiro = await vincular();
  expect(primeiro.estabelecimentos.map(e => e.id)).toEqual(['a']);
  expect((await vincular()).id).toBe(primeiro.id);
  expect(tabelas.apuracaoConsumoContribuinte).toHaveLength(1);
  expect((await vincular(['a', 'b'])).estabelecimentos.map(e => e.id)).toEqual(['a', 'b']);
});
test('CNPJ-base diferente não pode entrar no grupo', async () => {
  await expect(vincular(['a', 'c'])).rejects.toMatchObject({ status: 400 });
  expect(db.apuracaoConsumoContribuinte.create).not.toHaveBeenCalled();
});
test('empresa sem acesso não é lida nem vinculada', async () => {
  tabelas.companyFirmAccess.length = 0;
  await expect(vincular()).rejects.toMatchObject({ status: 403 });
  expect(db.portalClient.findUnique).not.toHaveBeenCalled();
});
test('STAFF não lê referências do cofre nem vincula/configura/revisa', async () => {
  await vincular(); tabelas.companyFirmAccess[0].role = 'STAFF';
  await expect(lerBaseConsumo(db, 'a', ctx, usuario)).rejects.toMatchObject({ status: 403 });
  await expect(vincular()).rejects.toMatchObject({ status: 403 });
  await expect(salvarConfiguracaoConsumo(db, 'a', config(), usuario)).rejects.toMatchObject({ status: 403 });
  await expect(prepararRevisaoConsumo(db, 'a', revisao(), usuario)).rejects.toMatchObject({ status: 403 });
});
test('acesso à matriz não revela grupo quando falta acesso à filial', async () => {
  await vincular(['a', 'b']); tabelas.companyFirmAccess[1].status = 'INACTIVE';
  await expect(lerBaseConsumo(db, 'a', ctx, usuario)).rejects.toMatchObject({ status: 403 });
  await expect(salvarConfiguracaoConsumo(db, 'a', config(), usuario)).rejects.toMatchObject({ status: 403 });
  await expect(vincular()).rejects.toMatchObject({ status: 403 });
});
test('adicionar matriz a grupo existente exige permissão sobre os membros anteriores', async () => {
  await vincularEstabelecimentos(db, 'b', { portalClientIds: ['b'] }, usuario);
  tabelas.companyFirmAccess[1].status = 'INACTIVE';
  await expect(vincular()).rejects.toMatchObject({ status: 403 });
  expect(tabelas.apuracaoConsumoEstabelecimento.map(v => v.portalClientId)).toEqual(['b']);
});
test('mudança de CNPJ-base após vínculo exige revisão e não expõe apuração', async () => {
  await vincular(); tabelas.portalClient[0].cnpj = '87654321000198';
  await expect(lerBaseConsumo(db, 'a', ctx, usuario)).rejects.toMatchObject({ status: 409 });
});
test('aceita formato alfanumérico de CNPJ sem eliminar letras', async () => {
  tabelas.portalClient[0].cnpj = 'AB.CDE.F12/0001-95';
  expect((await vincular()).cnpjBase).toBe('ABCDEF12');
});
test('CNPJ com formato correto e DV inválido não cria grupo', async () => {
  tabelas.portalClient[0].cnpj = '12345678000190';
  await expect(vincular()).rejects.toMatchObject({ status: 400 });
  expect(db.apuracaoConsumoContribuinte.create).not.toHaveBeenCalled();
});
test('empresa inexistente não aparece como cadastro vazio para administrador', async () => {
  await expect(lerBaseConsumo(db, 'inexistente', ctx, { id: 'admin', role: 'admin' })).rejects.toMatchObject({ status: 404 });
});
test('configuração exige vínculo e não herda habilitação', async () => {
  await expect(salvarConfiguracaoConsumo(db, 'a', config(), usuario)).rejects.toMatchObject({ status: 409 });
  await vincular();
  await expect(salvarConfiguracaoConsumo(db, 'a', config({ habilitado: undefined }), usuario)).rejects.toMatchObject({ status: 400 });
});
test('configuração é versionada e a intenção repetida devolve o mesmo resultado', async () => {
  await vincular(); const entrada = config();
  const a = await salvarConfiguracaoConsumo(db, 'a', entrada, usuario);
  expect((await salvarConfiguracaoConsumo(db, 'a', entrada, usuario)).id).toBe(a.id);
  await expect(salvarConfiguracaoConsumo(db, 'a', { ...entrada, habilitado: false }, usuario)).rejects.toMatchObject({ status: 409 });
  await expect(salvarConfiguracaoConsumo(db, 'a', config(), usuario)).rejects.toMatchObject({ status: 409 });
  const b = await salvarConfiguracaoConsumo(db, 'a', config({ versao: 1, habilitado: false }), usuario);
  expect(b.versao).toBe(2); expect(a.habilitado).toBe(true);
});
test('CBS/IBS e homologação/produção têm configurações independentes', async () => {
  await vincular();
  for (const tributo of ['CBS', 'IBS']) for (const ambiente of ['HOMOLOGACAO', 'PRODUCAO']) {
    await salvarConfiguracaoConsumo(db, 'a', config({ tributo, ambiente }), usuario);
    await prepararRevisaoConsumo(db, 'a', revisao({ tributo, ambiente }), usuario);
  }
  expect(tabelas.apuracaoConsumoConfiguracao).toHaveLength(4);
  expect(tabelas.apuracaoConsumoRevisao).toHaveLength(4);
  expect(tabelas.apuracaoConsumoRevisao.every(r => r.versao === 1 && r.estado === 'PREPARACAO')).toBe(true);
});
test('credencial deve pertencer ao grupo e nenhum segredo é selecionado', async () => {
  await vincular();
  await expect(salvarConfiguracaoConsumo(db, 'a', config({ dados: { motivo: 'Teste', credencialId: 'cred-c', credencialPortalClientId: 'c' } }), usuario)).rejects.toMatchObject({ status: 403 });
  const r = await salvarConfiguracaoConsumo(db, 'a', config({ dados: { motivo: 'Teste', credencialId: 'cred-a', credencialPortalClientId: 'a' } }), usuario);
  expect(db.companyCredential.findFirst).toHaveBeenLastCalledWith({ where: { id: 'cred-a', portalClientId: 'a' }, select: { id: true } });
  expect(JSON.stringify(r)).not.toContain('NUNCA_RETORNAR');
});
test('credencial removida invalida preparação anterior e gera pendência na próxima', async () => {
  await vincular();
  await salvarConfiguracaoConsumo(db, 'a', config({ dados: { motivo: 'Cofre', credencialId: 'cred-a', credencialPortalClientId: 'a' } }), usuario);
  await prepararRevisaoConsumo(db, 'a', revisao(), usuario);
  expect((await lerBaseConsumo(db, 'a', ctx, usuario)).desatualizada).toBe(false);
  tabelas.companyCredential.shift();
  expect(await lerBaseConsumo(db, 'a', ctx, usuario)).toMatchObject({ desatualizada: true, credencialDisponivel: false });
  const nova = await prepararRevisaoConsumo(db, 'a', revisao({ versao: 1 }), usuario);
  expect(nova.dados.pendencias).toContain('CREDENCIAL_REFERENCIADA_INDISPONIVEL');
});
test.each([
  { tributo: 'DAS' }, { ambiente: 'BETA' }, { versao: -1 }, { id: 'x' }, { habilitado: 'true' },
  { dados: { motivo: 'x', clientSecret: 'segredo' } }, { dados: { motivo: '' } }, { capacidades: { emitirGuia: true } },
])('configuração recusa entrada inválida %j antes de acessar banco', async patch => {
  await expect(salvarConfiguracaoConsumo(db, 'a', config(patch), usuario)).rejects.toMatchObject({ status: 400 });
  expect(db.$transaction).not.toHaveBeenCalled();
});
test('revisão mantém ausência de valores oficiais e snapshot imutável', async () => {
  await vincular(); await salvarConfiguracaoConsumo(db, 'a', config(), usuario);
  const entrada = revisao(), r = await prepararRevisaoConsumo(db, 'a', entrada, usuario);
  expect(r).toMatchObject({ estado: 'PREPARACAO', dados: { valoresOficiais: null, cobertura: 'NAO_COLETADA' } });
  expect(r.dados.pendencias).toContain('COLETA_OFICIAL_NAO_IMPLEMENTADA');
  expect((await prepararRevisaoConsumo(db, 'a', entrada, usuario)).id).toBe(r.id);
  expect((await lerBaseConsumo(db, 'a', ctx, usuario)).desatualizada).toBe(false);
  tabelas.reformaFiscalRevisao.push({ ...tabelas.reformaFiscalRevisao[0], id: 'novo-cad', versao: 2 });
  expect((await lerBaseConsumo(db, 'a', ctx, usuario)).desatualizada).toBe(true);
  expect(r.cadastroSnapshot[0].cadastroVersao).toBe(1);
});
test('configuração nova ou estabelecimento adicionado torna revisão desatualizada', async () => {
  await vincular(); await salvarConfiguracaoConsumo(db, 'a', config(), usuario);
  await prepararRevisaoConsumo(db, 'a', revisao(), usuario);
  await vincular(['a', 'b']);
  expect((await lerBaseConsumo(db, 'a', ctx, usuario)).desatualizada).toBe(true);
  await prepararRevisaoConsumo(db, 'a', revisao({ versao: 1 }), usuario);
  expect((await lerBaseConsumo(db, 'a', ctx, usuario)).desatualizada).toBe(false);
  await salvarConfiguracaoConsumo(db, 'a', config({ versao: 1 }), usuario);
  expect((await lerBaseConsumo(db, 'a', ctx, usuario)).desatualizada).toBe(true);
});
test('vigência precisa cobrir todo o mês; opção futura não regula mês anterior', async () => {
  await vincular(); await salvarConfiguracaoConsumo(db, 'a', config(), usuario);
  const futuro = await prepararRevisaoConsumo(db, 'a', revisao({ competencia: '2026-12' }), usuario);
  expect(futuro.cadastroSnapshot[0].regularConfirmado).toBe(false);
  tabelas.reformaFiscalRevisao[0].dados.periodos[0].fim = '2027-01-15';
  const parcial = await prepararRevisaoConsumo(db, 'a', revisao(), usuario);
  expect(parcial.cadastroSnapshot[0].cobreMes).toBe(false);
  expect(parcial.dados.pendencias).toContain('ENQUADRAMENTO_REGULAR_NAO_CONFIRMADO_PARA_TODO_O_MES');
});
test('usuário não pode promover preparação a conferida ou injetar valores', async () => {
  await expect(prepararRevisaoConsumo(db, 'a', revisao({ estado: 'CONFERIDA', valoresOficiais: 1 }), usuario)).rejects.toMatchObject({ status: 400 });
});
test.each(['2027-13', '2027-00', '2027-1', null])('competência inválida %s', async competencia => {
  await expect(lerBaseConsumo(db, 'a', { ...ctx, competencia }, usuario)).rejects.toMatchObject({ status: 400 });
});
test('conflito de serialização retorna409 sem replay automático', async () => {
  db.$transaction.mockRejectedValue({ code: 'P2034' });
  await expect(vincular()).rejects.toMatchObject({ status: 409 });
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
