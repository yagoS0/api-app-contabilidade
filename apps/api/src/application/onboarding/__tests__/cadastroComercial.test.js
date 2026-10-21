import { criarCadastroComercial } from '../CadastroComercialService.js';

const user = { id: 'u', role: 'contador' };
const cnpj = '11222333000181';
const empresa = { razaoSocial: 'Empresa sintética', naturezaJuridica: 'Sociedade limitada', porte: 'ME', cnaePrincipal: '6201501', endereco: { logradouro: 'Rua de teste', numero: '1', bairro: 'Centro', cep: '20000000', municipio: 'Rio de Janeiro', uf: 'RJ' }, socios: [{ nome: 'Sócio sintético' }] };
function fixture() {
  let ficha = { id: 'f', origem: 'TRANSFERENCIA', status: 'RASCUNHO', versao: 2, dados: { anotacao: 'preservar', responsavelNome: 'Contato anterior' }, fontesDados: { outro: 'preservar' } };
  const eventos = [];
  let caso = { onboardingId: 'f', autorizacao: { estado: 'ATIVA', cnpj }, representanteVerificadoEm: '2026-10-20', representanteVerificadoPor: 'u', evidenciaRepresentante: 'Conferida' };
  const db = {
    atendimentoLead: { updateMany: jest.fn(async ({ data }) => { caso = { ...caso, ...data }; return { count: 1 }; }) },
    onboarding: {
      findUnique: jest.fn(async () => structuredClone(ficha)),
      updateMany: jest.fn(async ({ where, data }) => {
        if (ficha.versao !== where.versao || ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'].includes(ficha.status)) return { count: 0 };
        ficha = { ...ficha, ...data, versao: ficha.versao + 1 }; return { count: 1 };
      }),
    },
    onboardingEvento: { create: jest.fn(async ({ data }) => { eventos.push(data); return data; }) },
  };
  db.$transaction = async fn => {
    const antes = structuredClone(ficha); const casoAntes = structuredClone(caso); const n = eventos.length;
    try { return await fn(db); } catch (e) { ficha = antes; caso = casoAntes; eventos.length = n; throw e; }
  };
  const consulta = jest.fn(async () => ({ ok: true, fonte: 'BRASILAPI', bruto: { cnpj, razao_social: 'Empresa consultada', municipio: 'Rio de Janeiro', uf: 'RJ', logradouro: 'Rua pública', numero: '3' } }));
  return { db, consulta, eventos, ler: () => ficha, lerCaso: () => caso, mudar: patch => { ficha = { ...ficha, ...patch }; }, service: criarCadastroComercial({ db, consultarCnpj: consulta, agora: () => new Date('2026-10-21T12:00:00Z') }) };
}
const manual = { versao: 2, cnpj, empresa, origem: 'MANUAL' };
test('cadastro único manual preserva dados, colunas, origem e histórico sem questionário', async () => {
  const f = fixture();
  const r = await f.service.salvar('f', user, manual);
  expect(r).toMatchObject({ versao: 3, cadastroRevisao: 1, dados: { anotacao: 'preservar', responsavelNome: 'Contato anterior', cnpj, razaoSocial: empresa.razaoSocial, municipio: 'Rio de Janeiro', derivadosCadastro: { estado: 'REVISAR' } }, cadastroCnpj: { origem: 'MANUAL', atorId: 'u', em: '2026-10-21T12:00:00.000Z' } });
  expect(f.ler()).toMatchObject({ cnpj, razaoSocial: empresa.razaoSocial, fontesDados: { outro: 'preservar' } });
  expect(f.eventos).toHaveLength(1); expect(f.consulta).not.toHaveBeenCalled();
});
test('recusa cadastro incompleto sem exigir narrativa', async () => {
  const f = fixture();
  await expect(f.service.salvar('f', user, { ...manual, empresa: { razaoSocial: 'Teste' } })).rejects.toMatchObject({ code: 'cadastro_incompleto' });
  expect(f.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test.each(['DESISTIU', 'CONVERTIDO', 'CONCLUIDO_AVULSO'])('preserva ficha %s', async status => {
  const f = fixture(); f.mudar({ status });
  await expect(f.service.salvar('f', user, manual)).rejects.toMatchObject({ code: 'ficha_encerrada' });
  expect(f.eventos).toHaveLength(0);
});
test('permissão e revisão inválidas não consultam nem gravam', async () => {
  const f = fixture();
  await expect(f.service.consultar('f', { id: 'outro', role: 'cliente' }, manual)).rejects.toMatchObject({ code: 'forbidden' });
  await expect(f.service.salvar('f', user, { ...manual, versao: 1 })).rejects.toMatchObject({ code: 'ficha_alterada' });
  expect(f.consulta).not.toHaveBeenCalled(); expect(f.eventos).toHaveLength(0);
});
test('consulta guarda somente resposta validada do servidor, sem dados forjados do browser', async () => {
  const f = fixture(); const r = await f.service.consultar('f', user, manual);
  expect(r.cadastroCnpj).toMatchObject({ origem: 'CONSULTA', empresa: { razaoSocial: 'Empresa consultada', cnpj } });
  await expect(f.service.salvar('f', user, { ...manual, versao: 3, origem: 'CONSULTA' })).rejects.toMatchObject({ code: 'cadastro_editado' });
  expect(f.eventos).toHaveLength(1);
});
test('não reutiliza análise não comprovada de outra ficha', async () => {
  const f = fixture();
  await expect(f.service.salvar('f', user, { ...manual, origem: 'CONSULTA', analiseId: 'outra-ficha' })).rejects.toMatchObject({ code: 'consulta_cadastral_necessaria' });
  expect(f.eventos).toHaveLength(0);
});
test.each([{}, { ok: false }, { ok: true, bruto: { cnpj: '46426073000140' } }])('falha/identidade diferente não produz cadastro nem regularidade: %j', async out => {
  const f = fixture(); f.consulta.mockResolvedValue(out);
  await expect(f.service.consultar('f', user, manual)).rejects.toMatchObject({ code: 'consulta_indisponivel' });
  expect(f.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test('resposta tardia não sobrescreve edição concorrente', async () => {
  const f = fixture(); let resolver;
  f.consulta.mockImplementation(() => new Promise(resolve => { resolver = resolve; }));
  const consulta = f.service.consultar('f', user, manual);
  await new Promise(resolve => setImmediate(resolve));
  await f.service.salvar('f', user, manual);
  resolver({ ok: true, bruto: { cnpj, razao_social: 'Resposta antiga' } });
  await expect(consulta).rejects.toMatchObject({ code: 'ficha_alterada' });
  expect(f.ler().razaoSocial).toBe(empresa.razaoSocial); expect(f.eventos).toHaveLength(1);
});
test('falha da auditoria desfaz a escrita e conflito no CAS não cria evento', async () => {
  const f = fixture(); f.db.onboardingEvento.create.mockRejectedValue(new Error('auditoria'));
  await expect(f.service.salvar('f', user, manual)).rejects.toThrow('auditoria');
  expect(f.ler().versao).toBe(2);
  expect(f.lerCaso()).toMatchObject({ autorizacao: { estado: 'ATIVA', cnpj }, representanteVerificadoPor: 'u' });
  f.db.onboarding.updateMany.mockResolvedValue({ count: 0 });
  await expect(f.service.salvar('f', user, manual)).rejects.toMatchObject({ code: 'ficha_alterada' });
  expect(f.db.onboardingEvento.create).toHaveBeenCalledTimes(1);
});

test.each(['socios', 'cnaesSecundarios'])('itens inválidos em %s retornam erro controlado', async campo => {
  const f = fixture();
  await expect(f.service.salvar('f', user, { ...manual, empresa: { ...empresa, [campo]: [null] } })).rejects.toMatchObject({ code: 'cadastro_invalido', status: 400, extra: { campos: [campo] } });
  expect(f.db.onboarding.updateMany).not.toHaveBeenCalled();
});
test('troca de CNPJ e retorno não ressuscitam procuração ou representação anterior', async () => {
  const f = fixture(); f.mudar({ cnpj });
  await f.service.salvar('f', user, { ...manual, cnpj: '46426073000140' });
  expect(f.lerCaso()).toMatchObject({ autorizacao: {}, representanteVerificadoEm: null, representanteVerificadoPor: null, evidenciaRepresentante: null });
  await f.service.salvar('f', user, { ...manual, versao: 3 });
  expect(f.lerCaso()).toMatchObject({ autorizacao: {}, representanteVerificadoEm: null });
  expect(f.db.atendimentoLead.updateMany).toHaveBeenCalledTimes(2);
  expect(f.eventos.map(e => e.dados.cnpj)).toEqual(['46426073000140', cnpj]);
});
test('mudança de origem com mesmos dados invalida derivados; salvar mesma origem não aumenta revisão material', async () => {
  const f = fixture();
  f.consulta.mockResolvedValue({ ok: true, fonte: 'BRASILAPI', bruto: { cnpj, razao_social: 'Empresa sintética', natureza_juridica: 'Sociedade limitada', porte: 'ME', cnae_fiscal: '6201501', municipio: 'Rio de Janeiro', uf: 'RJ', logradouro: 'Rua de teste', numero: '1' } });
  const consultado = await f.service.consultar('f', user, manual);
  const salvo = await f.service.salvar('f', user, { ...manual, versao: 3, empresa: consultado.cadastroCnpj.empresa });
  expect(salvo.cadastroCnpj.fingerprint).toBe(consultado.cadastroCnpj.fingerprint);
  expect(salvo.cadastroRevisao).toBe(consultado.cadastroRevisao + 1);
  const repetido = await f.service.salvar('f', user, { ...manual, versao: 4, empresa: consultado.cadastroCnpj.empresa });
  expect(repetido.cadastroRevisao).toBe(salvo.cadastroRevisao);
});
