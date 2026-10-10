jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { previaFiscalDoContador } from '../previaFiscalDoContador.js';

const historico = [{ regime: 'SIMPLES', vigenciaInicio: '2025-01-01', vigenciaFim: '2026-01-15' },
  { regime: 'LUCRO_PRESUMIDO', vigenciaInicio: '2026-01-16', vigenciaFim: null }];
function preparar(company = {}, extras = {}) {
  const db = { portalClient: { findUnique: jest.fn(async () => ({ companyId: 'legado' })) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: 'LUCRO_REAL', regimeHistorico: historico,
      codigoMunicipioIbge: '3304557', codigoServicoNacional: '170601', ...company })) } };
  const deps = { db, perfisHabilitados: false, ibscbsLigado: false, ambiente: 'homolog', ...extras };
  return { db, executar: (entrada = {}) => previaFiscalDoContador({ portalClientId: 'portal-1', competencia: '2025-12', ...entrada }, deps) };
}
test('prévia usa histórico e mesmo núcleo da emissão, sem escrita ou rede', async () => {
  const { executar, db } = preparar();
  const r = await executar();
  expect(r).toMatchObject({ ok: true, ambiente: 'homolog', validacaoIntegral: false,
    regimeVigente: { regime: 'SIMPLES', fonte: 'REGIME_HISTORICO' }, contextoFiscal: { obrigacao: { estado: 'FACULTATIVO' } } });
  expect(db.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'legado' } }));
});
test('mês com mudança bloqueia, dia resolve novo regime', async () => {
  const { executar } = preparar();
  expect((await executar({ competencia: '2026-01' })).pendencias[0].codigo).toBe('NFSE_REGIME_HISTORICO_AMBIGUO');
  expect(await executar({ competencia: '2026-01-16' })).toMatchObject({ ok: true, regimeVigente: { regime: 'LUCRO_PRESUMIDO' } });
});
test('regime atual não preenche histórico ausente', async () => {
  expect(await preparar({ regimeHistorico: [] }).executar()).toMatchObject({ ok: false, pendencias: [{ codigo: 'NFSE_REGIME_SEM_VIGENCIA' }] });
});
test('prévia preserva campos fiscais do perfil para detectar alteração antes de confirmar', async () => {
  const perfil = { id: 'p1', codigoServicoNacional: '170601', regApTribSN: '1', tribISSQN: '1', retencaoFederalArt30: true };
  const { executar } = preparar({}, { perfisHabilitados: true, resolverPerfil: async () => ({ temPerfil: true, perfisAtivos: 1, perfil }) });
  const antes = await executar({ perfilId: 'p1' });
  perfil.retencaoFederalArt30 = false;
  const depois = await executar({ perfilId: 'p1' });
  expect(antes.configuracaoFiscal.perfil.retencaoFederalArt30).toBe('true');
  expect(depois.configuracaoFiscal.perfil.retencaoFederalArt30).toBe('false');
});
test('mantém regime para formulário corrigir pendência municipal', async () => {
  expect(await preparar({ codigoServicoNacional: '070201' }).executar()).toMatchObject({ ok: false,
    regimeVigente: { regime: 'SIMPLES' }, pendencias: [{ codigo: 'NFSE_INCIDENCIA_MUNICIPAL_PENDENTE' }] });
});
test('perfil explícito tem escopo e indisponibilidade não cai no cadastro', async () => {
  const resolverPerfil = jest.fn(async () => ({ temPerfil: false, perfisAtivos: 0 }));
  const r = await preparar({}, { perfisHabilitados: true, resolverPerfil }).executar({ perfilId: 'outra-empresa' });
  expect(r.ok).toBe(false);
  expect(resolverPerfil).toHaveBeenCalledWith({ portalClientId: 'portal-1', perfilId: 'outra-empresa', exigirDisponibilidade: true });
});
test('prazo obrigatório não vira destaque facultativo com integração desligada', async () => {
  const perfil = { id: 'p1', codigoServicoNacional: '170601', categoriaObrigacaoIbscbs: 'SERVICO_ISS' };
  const r = await preparar({}, { perfisHabilitados: true, resolverPerfil: async () => ({ temPerfil: true, perfisAtivos: 1, perfil }) }).executar({ competencia: '2026-10-10', perfilId: 'p1' });
  expect(r.ok).toBe(false);
  expect(r.contextoFiscal.obrigacao.estado).toBe('OBRIGATORIO');
});

const periodosOpcao = [
 { regime: 'SIMPLES', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' },
 { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: '2027-06-30', apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'teste' },
 { regime: 'SIMPLES', vigenciaInicio: '2027-07-01', vigenciaFim: null, apuracaoIbsCbs: 'NO_DAS' },
];
test('resolve híbrido e retorno ao DAS por vigência sem liberar transmissão', async () => {
 const { executar } = preparar({ regimeHistorico: periodosOpcao });
 const antes = await executar({ competencia: '2026-12' });
 expect(antes.opcaoIbsCbs).toMatchObject({ apuracao: null, hibrido: false });
 const durante = await executar({ competencia: '2027-01' });
 expect(durante.opcaoIbsCbs).toMatchObject({ apuracao: 'REGULAR', hibrido: true, vigenciaInicio: '2027-01-01' });
 expect(durante.regimeVigente.regime).toBe('SIMPLES');
 expect(durante.ok).toBe(false);
 expect(durante.pendencias[0].codigo).toBe('NFSE_CONTRATO_SIMPLES_2027_PENDENTE');
 expect(durante.contextoFiscal.apuracaoIbsCbs.regApIBSCBSSN).toBe('3');
 expect(durante.configuracaoFiscal.regimeVigente.apuracaoIbsCbs).toBe('REGULAR');
 expect((await executar({ competencia: '2027-07' })).opcaoIbsCbs).toMatchObject({ apuracao: 'NO_DAS', hibrido: false });
});
test('2027 sem escolha exige cadastro, sem assumir opção pelo DAS', async () => {
 const r = await preparar({ regimeHistorico: [{ regime: 'SIMPLES', vigenciaInicio: '2020-01-01' }] }).executar({ competencia: '2027-01' });
 expect(r.pendencias[0].codigo).toBe('NFSE_IBSCBS_OPCAO_PENDENTE');
});
test('não usa opção futura e recusa ambiguidade dentro do mês', async () => {
 const { executar } = preparar({ regimeHistorico: [
 { ...periodosOpcao[1], vigenciaFim: '2027-01-15' }, { ...periodosOpcao[2], vigenciaInicio: '2027-01-16' },
 ] });
 expect((await executar({ competencia: '2027-01' })).pendencias[0].codigo).toBe('NFSE_REGIME_HISTORICO_AMBIGUO');
 expect((await executar({ competencia: '2027-01-15' })).opcaoIbsCbs.hibrido).toBe(true);
 expect((await executar({ competencia: '2027-01-16' })).opcaoIbsCbs.hibrido).toBe(false);
});
