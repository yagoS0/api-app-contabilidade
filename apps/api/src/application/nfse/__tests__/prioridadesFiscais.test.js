import { obrigacaoIbscbs, CATEGORIAS_IBSCBS, VERSAO_OBRIGACAO_IBSCBS } from '../obrigacaoIbscbs.js';
import { resolverContextoFiscalDaNota } from '../resolverContextoFiscalDaNota.js';
import { localDaPrestacao } from '../localDaPrestacao.js';
import { classificarFalha } from '../desfechoEmissao.js';
import { snapshotFiscal } from '../snapshotFiscal.js';

const base = { competencia: '2026-10-01', opSimpNac: '1', codigoServico: '171901', categoria: 'SERVICO_ISS' };
test.each([
  ['2026-09-30', 'FACULTATIVO'], ['2026-10-01', 'OBRIGATORIO'], ['2026-10-02', 'OBRIGATORIO'], ['2026-10', 'OBRIGATORIO'],
])('serviço ISS na competência %s: %s', (competencia, estado) => {
  expect(obrigacaoIbscbs({ ...base, competencia }).estado).toBe(estado);
});
test.each(['010301', '010501', '010901', '160101'])('prazo especial do serviço %s', codigoServico => {
  expect(obrigacaoIbscbs({ ...base, codigoServico, categoria: null }).estado).toBe('FACULTATIVO');
  for (const competencia of ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-31', '2027-01-01', '2027-01-02', '2027-02-28']) {
    for (const opSimpNac of ['1', '2', '3']) {
      expect(obrigacaoIbscbs({ ...base, codigoServico, competencia, opSimpNac })).toMatchObject({ estado: 'FACULTATIVO', inicio: '2027-03-01' });
    }
  }
  for (const competencia of ['2027-03-01', '2027-03-02']) {
    for (const opSimpNac of ['1', '2', '3']) {
      expect(obrigacaoIbscbs({ ...base, codigoServico, competencia, opSimpNac })).toMatchObject({ estado: opSimpNac === '1' ? 'OBRIGATORIO' : 'INDETERMINADO', inicio: '2027-03-01' });
    }
  }
});
test('plataforma exige classificação explícita; ausência não vira dispensa', () => {
  expect(obrigacaoIbscbs({ ...base, categoria: null }).estado).toBe('INDETERMINADO');
  expect(obrigacaoIbscbs({ ...base, categoria: 'PLATAFORMA_DIGITAL' })).toMatchObject({ estado: 'FACULTATIVO', inicio: '2027-03-01' });
  for (const competencia of ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-31', '2027-01-01', '2027-01-02', '2027-02-28', '2027-03-01', '2027-03-02']) {
    for (const opSimpNac of ['1', '2', '3']) {
      expect(obrigacaoIbscbs({ ...base, categoria: 'PLATAFORMA_DIGITAL', competencia, opSimpNac })).toMatchObject({
        estado: competencia < '2027-03-01' ? 'FACULTATIVO' : opSimpNac === '1' ? 'OBRIGATORIO' : 'INDETERMINADO', inicio: '2027-03-01',
      });
    }
  }
});
test.each(['2', '3'])('Simples %s: calendário não resolve opção de apuração', opSimpNac => {
  for (const competencia of ['2026-10-01', '2026-12-31', '2027-01-01', '2027-01-02']) {
    expect(obrigacaoIbscbs({ ...base, opSimpNac, competencia })).toMatchObject({
      estado: competencia < '2027-01-01' ? 'FACULTATIVO' : 'INDETERMINADO', inicio: '2027-01-01',
    });
  }
});
test('não amplia categorias nem presume hipóteses sem contrato', () => {
  expect(CATEGORIAS_IBSCBS).toEqual(['SERVICO_ISS', 'PLATAFORMA_DIGITAL']);
  for (const categoria of ['BEM_IMATERIAL', 'CONDOMINIO', 'LOCACAO', 'RESIDUAL', 'DESCONHECIDA']) {
    for (const competencia of ['2026-12-31', '2027-01-01', '2027-01-02', '2027-02-28', '2027-03-01', '2027-03-02']) {
      expect(obrigacaoIbscbs({ ...base, categoria, competencia }).estado).toBe('INDETERMINADO');
    }
  }
  for (const codigoServico of [null, '', '990101', '0103']) {
    expect(obrigacaoIbscbs({ ...base, codigoServico }).estado).toBe('INDETERMINADO');
  }
  expect(obrigacaoIbscbs({ ...base, opSimpNac: null }).estado).toBe('INDETERMINADO');
});
test('serviços sem exceção mantêm outubro, inclusive na leitura de competência histórica', () => {
  for (const codigoServico of ['010101', '010201', '010401', '010601', '160201', '171901']) {
    expect(obrigacaoIbscbs({ ...base, codigoServico })).toMatchObject({ estado: 'OBRIGATORIO', inicio: '2026-10-01' });
  }
  expect(obrigacaoIbscbs({ ...base, competencia: new Date('2026-10-01T00:00:00Z') }).versao).toBe(VERSAO_OBRIGACAO_IBSCBS);
});
test('categoria ausente exige conferência até março, sem fabricar data inicial depois', () => {
  for (const competencia of ['2026-10-01', '2026-12-01', '2027-01-01', '2027-02-28']) {
    expect(obrigacaoIbscbs({ ...base, categoria: null, competencia })).toMatchObject({ estado: 'INDETERMINADO', inicio: null });
  }
  for (const competencia of ['2027-03-01', '2027-03-02']) {
    expect(obrigacaoIbscbs({ ...base, categoria: null, competencia })).toMatchObject({ estado: 'OBRIGATORIO', inicio: null });
    expect(obrigacaoIbscbs({ ...base, categoria: null, competencia, opSimpNac: '3' }).estado).toBe('INDETERMINADO');
  }
});

test.each(['2', '3'])('Simples %s em 2026 não ganha bloqueio temporal por cadastro incompleto', opSimpNac => {
  for (const competencia of ['2025-12-31', '2026-09-30', '2026-10-01', '2026-12-31']) {
    for (const patch of [{ codigoServico: null }, { categoria: 'DESCONHECIDA' }, { categoria: null }]) {
      expect(obrigacaoIbscbs({ ...base, ...patch, opSimpNac, competencia })).toMatchObject({ estado: 'FACULTATIVO', inicio: null });
    }
  }
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

test.each(['010301', '010501', '010901', '160101'])('preparo fiscal não antecipa o prazo de %s para dezembro', codigoServico => {
  const r = resolverContextoFiscalDaNota({ ...entrada, competencia: '2026-12-01', codigoServico,
    servico: { cLocPrestacao: '3304557' } });
  expect(r).toMatchObject({ ok: true, obrigacao: { estado: 'FACULTATIVO', inicio: '2027-03-01' }, ibscbs: { informar: false } });
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
