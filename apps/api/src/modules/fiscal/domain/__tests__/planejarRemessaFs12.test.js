import { createHash } from 'node:crypto';
import { planejarRemessaFs12 } from '../planejarRemessaFs12.js';
import { determinarPoliticaDeclaratoriaFs12 } from '../politicaDeclaratoriaFs12.js';
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function fixture(pa = '2026-11', abertura = '2020-01-01', historica = false) {
  const identidade = { portalClientId: 'portal-fixture', companyId: 'company-fixture', cnpj: '00000000000100', competencia: pa, dataAbertura: abertura };
  const contexto = { empresaId: identidade.companyId, competenciaApuracao: pa, inicioAtividade: abertura.slice(0, 7),
    exigenciaHistorica: historica, regimeDoPeriodo: { empresaId: identidade.companyId, competencia: pa, tipo: 'SIMPLES_NACIONAL', referencia: 'regime-v1' } };
  const politica = determinarPoliticaDeclaratoriaFs12(contexto);
  const serie = (politica.janela?.competencias || []).map(mes => ({ mes, valorCentavos: 0 }));
  const revisaoManual = { ...identidade, id: 'revisao-1', revisao: 1, origem: 'MANUAL_APURACAO', serie, serieHash: hash(serie),
    contexto, contextoRevisao: hash(contexto), politicaVersao: politica.versao, autorId: 'contador-fixture', confirmadoEm: '2026-11-17T12:00:00.000Z' };
  const historicoOficial = { ...identidade, estado: 'COMPROVADA', meses: serie.map(m => ({ ...identidade, ...m,
    numeroDeclaracao: 'declaracao-fixture', versaoDeclaracao: '1', proveniencia: { tipo: 'SERIE_MENSAL_OFICIAL',
      referencia: 'fixture-sem-provedor', conteudoHash: hash(m), obtidoEm: '2026-11-17T12:00:00.000Z' } })) };
  historicoOficial.declaracoesVigentes = [{ ...identidade, numeroDeclaracao: 'declaracao-fixture',
    versaoDeclaracao: '1', referencia: 'fixture-vigencia-independente', conteudoHash: hash('vigencia'),
    verificadoEm: '2026-11-17T12:00:00.000Z' }];
  return { identidade, contexto, revisaoManual, revisaoVigente: clone(revisaoManual), calculoExistente: null, historicoOficial };
}
function comCalculo() {
  const f = fixture(), r = f.revisaoManual;
  const snapshot = { calculoId: 'calculo-1', portalClientId: f.identidade.portalClientId, competencia: f.identidade.competencia,
    contribuinteCnpj: f.identidade.cnpj,
    fs12: { revisaoId: r.id, revisao: r.revisao, contextoHash: r.contextoRevisao, politicaVersao: r.politicaVersao } };
  f.calculoExistente = { calculoId: snapshot.calculoId, calculoConfirmado: snapshot,
    vinculo: { ...f.identidade, id: 'vinculo-1', calculoId: snapshot.calculoId, revisaoFs12: r.revisao,
      contextoHash: r.contextoRevisao, politicaVersao: r.politicaVersao, calculoConfirmado: clone(snapshot), calculoHash: hash(snapshot) } };
  return f;
}
const bloqueado = r => { expect(r.mesesPropostos).toBeNull(); expect(r.autorizaEfeitoFiscal).toBe(false);
  expect(r.impedimentos).toContain('PROTOCOLO_REMESSA_NAO_HOMOLOGADO'); };

test('história completa zero explícito não produz lista vazia nem autorização por homologado', () => {
  const f = fixture(), r = planejarRemessaFs12(f);
  bloqueado(r); expect(r.mesesComProvaOficial).toHaveLength(12);
  expect(r.analiseCandidata.meses.every(m => m.situacao === 'CONCORDANTE')).toBe(true);
  expect(planejarRemessaFs12({ ...f, homologado: true, autorizaEfeitoFiscal: true })).toEqual(r);
});
test('determinismo, ordem canônica, entrada congelada e saída sem referências compartilhadas', () => {
  const f = fixture(), original = clone(f), r = planejarRemessaFs12(freeze(f));
  expect(planejarRemessaFs12(f)).toEqual(r);
  const invertida = clone(f); invertida.revisaoManual.serie.reverse(); invertida.historicoOficial.meses.reverse();
  expect(planejarRemessaFs12(invertida)).toEqual(r);
  r.mesesComProvaOficial[0].proveniencia.referencia = 'editada'; r.janelaFiscal.competencias.pop();
  expect(f).toEqual(original); expect(planejarRemessaFs12(f).mesesComProvaOficial[0].proveniencia.referencia).toBe('fixture-sem-provedor');
});
test.each(['DESCONHECIDA', 'INDISPONIVEL', 'DIVERGENTE'])('história %s não prova meses', estado => {
  const f = fixture(); f.historicoOficial.estado = estado;
  const r = planejarRemessaFs12(f); bloqueado(r); expect(r.mesesComProvaOficial).toEqual([]);
  expect(r.impedimentos).toContain(`HISTORIA_OFICIAL_${estado}`);
});
test('história parcial/ausente/vazia não presume remessa dos meses faltantes', () => {
  for (const h of [undefined, null, { ...fixture().historicoOficial, meses: [] },
    { ...fixture().historicoOficial, estado: 'PARCIAL', meses: fixture().historicoOficial.meses.slice(0, 2) }]) {
    const r = planejarRemessaFs12({ ...fixture(), historicoOficial: h }); bloqueado(r);
    expect(r.mesesComProvaOficial.length).toBeLessThan(12);
  }
});
test.each(['portalClientId', 'companyId', 'cnpj', 'competencia'])('isola %s no envelope e em cada prova', campo => {
  for (const alvo of ['envelope', 'mes']) {
    const f = fixture(); (alvo === 'envelope' ? f.historicoOficial : f.historicoOficial.meses[0])[campo] = 'outro';
    const r = planejarRemessaFs12(f); bloqueado(r);
    expect(r.mesesComProvaOficial.some(m => m[campo] === 'outro')).toBe(false);
  }
});
test.each(['serieHash', 'contextoRevisao', 'politicaVersao', 'companyId', 'portalClientId', 'competencia', 'origem', 'confirmadoEm'])('adulteração da revisão: %s', campo => {
  const f = fixture(); f.revisaoManual[campo] = 'adulterado';
  const r = planejarRemessaFs12(f); expect(r.impedimentos).toContain('REVISAO_MANUAL_INCOMPATIVEL'); bloqueado(r);
});
test.each([null, undefined, '', '0', -1, 0.1, Number.MAX_SAFE_INTEGER + 1])('valor manual inválido %s não vira zero', valor => {
  const f = fixture(); f.revisaoManual.serie[0].valorCentavos = valor;
  expect(planejarRemessaFs12(f).impedimentos).toContain('FS12_SERIE_INVALIDA');
});
test('série completa obrigatória; duplicata, alteração de valor/contexto e overflow recusados', () => {
  for (const mudar of [f => f.revisaoManual.serie.pop(), f => { f.revisaoManual.serie[0] = f.revisaoManual.serie[1]; },
    f => { f.revisaoManual.serie[0].valorCentavos = 1; }, f => { f.contexto.exigenciaHistorica = true; },
    f => f.revisaoManual.serie.forEach(m => { m.valorCentavos = Number.MAX_SAFE_INTEGER; })]) {
    const f = fixture(); mudar(f); const r = planejarRemessaFs12(f); bloqueado(r); expect(r.analiseCandidata).toBeNull();
  }
});
test('duplicatas iguais/divergentes não elegem vencedor; divergência simples preserva ambos os valores', () => {
  for (const valorCentavos of [0, 9]) {
    const f = fixture(); f.historicoOficial.meses.push({ ...clone(f.historicoOficial.meses[0]), valorCentavos });
    const r = planejarRemessaFs12(f); expect(r.impedimentos).toContain('PROVA_MENSAL_DUPLICADA_OU_AMBIGUA');
    expect(r.mesesComProvaOficial).toHaveLength(11); bloqueado(r);
  }
  const f = fixture(); f.historicoOficial.meses[0].valorCentavos = 9;
  expect(planejarRemessaFs12(f).analiseCandidata.meses[0]).toMatchObject({ situacao: 'DIVERGENTE', valorManualCentavos: 0, valorOficialCentavos: 9 });
});
test.each(['INDICE', 'PDF', 'AGREGADO', null])('proveniência %s não é série oficial', tipo => {
  const f = fixture(); f.historicoOficial.meses[0].proveniencia.tipo = tipo;
  expect(planejarRemessaFs12(f).impedimentos).toContain('PROVA_MENSAL_INVALIDA');
});
test.each(['numeroDeclaracao', 'versaoDeclaracao', 'valorCentavos', 'proveniencia'])('prova mensal sem %s é lacuna', campo => {
  const f = fixture(); delete f.historicoOficial.meses[0][campo];
  expect(planejarRemessaFs12(f).impedimentos).toContain('PROVA_MENSAL_INVALIDA');
});
test('vínculo exato aceito apenas como evidência; omissão não fabrica cálculo', () => {
  const r = planejarRemessaFs12(comCalculo()); bloqueado(r); expect(r.fontes.vinculoCalculo.id).toBe('vinculo-1');
  const f = fixture(); delete f.calculoExistente;
  expect(planejarRemessaFs12(f).impedimentos).toContain('VINCULO_B32_INCOMPATIVEL_OU_AUSENTE');
});
test.each(['calculoId', 'companyId', 'portalClientId', 'competencia', 'revisaoFs12', 'contextoHash', 'politicaVersao', 'calculoHash'])('vínculo adulterado %s', campo => {
  const f = comCalculo(); f.calculoExistente.vinculo[campo] = 'outro';
  expect(planejarRemessaFs12(f).impedimentos).toContain('VINCULO_B32_INCOMPATIVEL_OU_AUSENTE');
});
test('snapshot substituído e revisão antiga não são reatribuídos', () => {
  for (const mudar of [f => { f.calculoExistente.calculoConfirmado.fs12.revisaoId = 'antiga'; },
    f => { f.calculoExistente.vinculo.calculoConfirmado.extra = 1; }]) {
    const f = comCalculo(); mudar(f); const anterior = clone(f); bloqueado(planejarRemessaFs12(f));
    expect(planejarRemessaFs12(f).impedimentos).toContain('VINCULO_B32_INCOMPATIVEL_OU_AUSENTE'); expect(f).toEqual(anterior);
  }
});

test.each(['id', 'revisao', 'serieHash', 'contextoRevisao', 'politicaVersao', 'autorId', 'confirmadoEm',
  'portalClientId', 'companyId', 'competencia'])('referência vigente independente: %s divergente', campo => {
  const f = fixture(); f.revisaoVigente[campo] = campo === 'revisao' ? 2 : 'outra';
  const r = planejarRemessaFs12(f);
  expect(r.impedimentos).toContain('REVISAO_MANUAL_NAO_VIGENTE_OU_NAO_COMPROVADA');
  expect(r.fontes.revisaoManual).toBeNull(); expect(r.analiseCandidata).toBeNull(); bloqueado(r);
});
test('autor adulterado e confirmação substituída de mesmo valor não viram revisão vigente', () => {
  const f = fixture(); f.revisaoManual.autorId = 'outro-autor';
  expect(planejarRemessaFs12(f).impedimentos).toContain('REVISAO_MANUAL_NAO_VIGENTE_OU_NAO_COMPROVADA');
  const g = fixture(); g.revisaoVigente.id = 'revisao-2'; g.revisaoVigente.revisao = 2;
  expect(planejarRemessaFs12(g).analiseCandidata).toBeNull();
  delete g.revisaoVigente;
  expect(planejarRemessaFs12(g).impedimentos).toContain('REVISAO_MANUAL_NAO_VIGENTE_OU_NAO_COMPROVADA');
});
test.each([undefined, 'outro-cnpj'])('cálculo com CNPJ %s é recusado mesmo com hash íntegro', cnpj => {
  const f = comCalculo(); f.calculoExistente.calculoConfirmado.contribuinteCnpj = cnpj;
  f.calculoExistente.vinculo.calculoConfirmado = clone(f.calculoExistente.calculoConfirmado);
  f.calculoExistente.vinculo.calculoHash = hash(f.calculoExistente.calculoConfirmado);
  const r = planejarRemessaFs12(f); bloqueado(r);
  expect(r.impedimentos).toContain('VINCULO_B32_INCOMPATIVEL_OU_AUSENTE');
});
test.each(['versaoDeclaracao', 'numeroDeclaracao', 'portalClientId', 'companyId', 'cnpj', 'competencia',
  'referencia', 'conteudoHash', 'verificadoEm'])('vigência oficial independente exige %s compatível', campo => {
  const f = fixture(); f.historicoOficial.declaracoesVigentes[0][campo] = '';
  const r = planejarRemessaFs12(f); bloqueado(r);
  expect(r.impedimentos).toContain('VERSAO_OFICIAL_NAO_VIGENTE_OU_NAO_COMPROVADA');
  expect(r.mesesComProvaOficial).toEqual([]);
});
test.each([0, 9])('prova retificada, mesmo com valor %s, não é aproveitada', valor => {
  const f = fixture(); f.historicoOficial.meses[0].valorCentavos = valor;
  f.historicoOficial.declaracoesVigentes[0].versaoDeclaracao = '2';
  const r = planejarRemessaFs12(f); expect(r.mesesComProvaOficial).toEqual([]); bloqueado(r);
  expect(r.impedimentos).toContain('VERSAO_OFICIAL_NAO_VIGENTE_OU_NAO_COMPROVADA');
});
test('ausência ou ambiguidade de referência oficial não elege versão', () => {
  for (const refs of [undefined, [], [...fixture().historicoOficial.declaracoesVigentes, ...fixture().historicoOficial.declaracoesVigentes]]) {
    const f = fixture(); f.historicoOficial.declaracoesVigentes = refs;
    expect(planejarRemessaFs12(f).mesesComProvaOficial).toEqual([]);
  }
});
test('abertura parcial antiga não bloqueia janela que já não contém o mês da abertura', () => {
  const r = planejarRemessaFs12(fixture('2026-11', '2020-01-15'));
  expect(r.impedimentos).not.toContain('PROTOCOLO_ABERTURA_MEIO_MES_PENDENTE'); bloqueado(r);
  expect(planejarRemessaFs12(fixture('2026-12', '2026-11-15')).impedimentos)
    .toContain('PROTOCOLO_ABERTURA_MEIO_MES_PENDENTE');
});
test.each([['2026-10', false, 'NAO_EXIGIDA'], ['2026-10', true, 'EXIGIDA'],
  ['2026-11', false, 'EXIGIDA'], ['2026-12', false, 'EXIGIDA'], ['2027-01', false, 'PENDENTE']])('B1 %s histórica=%s preservada', (pa, historica, situacao) => {
  const f = fixture(pa, '2020-01-01', historica), r = planejarRemessaFs12(f);
  expect(r.politicaFiscal.situacao).toBe(situacao); expect(r.janelaFiscal).toEqual(determinarPoliticaDeclaratoriaFs12(f.contexto).janela); bloqueado(r);
});
test.each(['2026-11-01', '2026-11-15'])('abertura %s sem Fator R mantém pendência e não cria meses anteriores', abertura => {
  const r = planejarRemessaFs12(fixture('2026-11', abertura));
  expect(r.janelaFiscal.competencias).toEqual(['2026-11']); expect(r.impedimentos).toContain('PROTOCOLO_INICIO_PROPRIO_PA_PENDENTE');
  if (abertura.endsWith('15')) expect(r.impedimentos).toContain('PROTOCOLO_ABERTURA_MEIO_MES_PENDENTE'); bloqueado(r);
});
test('contexto parcial/desconhecido e entradas ausentes permanecem bloqueados', () => {
  const f = fixture(); f.contexto.regimeDoPeriodo = null;
  expect(planejarRemessaFs12(f).impedimentos).toContain('REGIME_DO_PERIODO_NAO_COMPROVADO');
  for (const v of [undefined, null, {}, { contexto: null }]) bloqueado(planejarRemessaFs12(v));
});
