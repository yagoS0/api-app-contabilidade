import { obrigacaoIbscbs } from '../obrigacaoIbscbs.js';
import { resolverContextoFiscalDaNota } from '../resolverContextoFiscalDaNota.js';
import { localDaPrestacao } from '../localDaPrestacao.js';
import { classificarFalha } from '../desfechoEmissao.js';
import { snapshotFiscal } from '../snapshotFiscal.js';

const base = { competencia: '2026-10-01', opSimpNac: '1', codigoServico: '171901', categoria: 'SERVICO_ISS' };
test.each([
  ['2026-09-30', 'FACULTATIVO'], ['2026-10-01', 'OBRIGATORIO'], ['2026-10', 'OBRIGATORIO'],
])('serviço ISS na competência %s: %s', (competencia, estado) => {
  expect(obrigacaoIbscbs({ ...base, competencia }).estado).toBe(estado);
});
test.each(['010301', '010501', '010901', '160101'])('prazo especial do serviço %s', codigoServico => {
  expect(obrigacaoIbscbs({ ...base, codigoServico, categoria: null }).estado).toBe('FACULTATIVO');
  expect(obrigacaoIbscbs({ ...base, codigoServico, competencia: '2026-12-01' }).estado).toBe('OBRIGATORIO');
});
test('plataforma exige classificação explícita; ausência não vira dispensa', () => {
  expect(obrigacaoIbscbs({ ...base, categoria: null }).estado).toBe('INDETERMINADO');
  expect(obrigacaoIbscbs({ ...base, categoria: 'PLATAFORMA_DIGITAL' })).toMatchObject({ estado: 'FACULTATIVO', inicio: '2026-12-01' });
  expect(obrigacaoIbscbs({ ...base, categoria: 'PLATAFORMA_DIGITAL', competencia: '2026-12-01' }).estado).toBe('OBRIGATORIO');
});
test('Simples em 2026 não herda prazo de outubro; 2027 exige enquadramento adicional', () => {
  expect(obrigacaoIbscbs({ ...base, opSimpNac: '3' }).estado).toBe('FACULTATIVO');
  expect(obrigacaoIbscbs({ ...base, opSimpNac: '3', competencia: '2027-01-01' }).estado).toBe('INDETERMINADO');
});
test.each(['2026-02-30', '', null, 'ontem'])('competência inválida não autoriza omissão: %s', competencia => {
  expect(obrigacaoIbscbs({ ...base, competencia }).estado).toBe('INDETERMINADO');
});

const entrada = { company: { codigoMunicipioIbge: '3304557' }, regime: 'LUCRO_PRESUMIDO', competencia: '2026-10-01',
  codigoServico: '171901', perfil: { categoriaObrigacaoIbscbs: 'SERVICO_ISS' }, servico: {}, ibscbsLigado: false };
test.each([
  [false, 'NFSE_IBSCBS_OBRIGATORIO_DESLIGADO'], [true, 'NFSE_IBSCBS_OBRIGATORIO_AUSENTE'],
])('obrigação impede omissão com integração %s', (ibscbsLigado, codigo) => {
  const r = resolverContextoFiscalDaNota({ ...entrada, ibscbsLigado });
  expect(r).toMatchObject({ ok: false, codigo });
  expect(classificarFalha(Object.assign(new Error(r.message), { code: r.codigo }))).toMatchObject({ camada: 'NOSSA', numeroReutilizavel: true });
});
test('não tenta exportação ou ignora benefício cadastrado', () => {
  expect(resolverContextoFiscalDaNota({ ...entrada, perfil: { tribISSQN: '3' } })).toMatchObject({ ok: false, codigo: 'NFSE_EXPORTACAO_NAO_SUPORTADA' });
  expect(resolverContextoFiscalDaNota({ ...entrada, company: { beneficioMunicipalNumero: '33045570100001' } })).toMatchObject({ ok: false, codigo: 'NFSE_BENEFICIO_MUNICIPAL_PENDENTE' });
});
test('obrigação preenchida e integração ativa permitem continuar', () => {
  const r = resolverContextoFiscalDaNota({ ...entrada, ibscbsLigado: true,
    perfil: { ...entrada.perfil, codigoNbs: '1.1502.10.00', ibscbsCIndOp: '100301', ibscbsCClassTrib: '200052', ibscbsCst: '200' } });
  expect(r).toMatchObject({ ok: true, obrigacao: { estado: 'OBRIGATORIO' } });
});
test('operação vence perfil; inválido explícito não cai no cadastro', () => {
  expect(localDaPrestacao({ servico: { cLocPrestacao: '3304557' }, perfil: { cLocPrestacao: '3550308' } })).toEqual({ codigo: '3304557', fonte: 'OPERACAO', assumido: false });
  expect(() => localDaPrestacao({ servico: { cLocPrestacao: '123' }, perfil: { cLocPrestacao: '3550308' } })).toThrow();
  expect(localDaPrestacao({ perfil: { cLocPrestacao: '3550308' } }).fonte).toBe('PERFIL');
  expect(localDaPrestacao({ municipioEmissor: '3304557' }).assumido).toBe(true);
});
test('snapshot conserva a decisão e o local efetivo, sem referência mutável', () => {
  const contextoFiscal = resolverContextoFiscalDaNota({ ...entrada, regime: 'SIMPLES', servico: { cLocPrestacao: '3550308' } });
  expect(contextoFiscal.ok).toBe(true);
  const snap = snapshotFiscal({ ...entrada, contextoFiscal });
  contextoFiscal.local.codigo = '3304557';
  expect(snap.localPrestacao.codigo).toBe('3550308');
  expect(snap.obrigacaoIbscbs.estado).toBe('FACULTATIVO');
});
