import { calendarioEventosGuia, referenciaVencimentoGuia, dataCapturaGuia, eventoNaHora } from '../calendarioEventosGuia.js';

const lembretes = (before = 2, after = 2, hour = 8) => ({
  before: { enabled: true, businessDays: before, hour },
  onDue: { enabled: true, hour }, after: { enabled: true, businessDays: after, hour },
});
const guia = { id: 'g1', portalClientId: 'c1', competencia: '2026-11', hash: 'pdf1',
  status: 'PROCESSED', tipo: 'OUTRA', vencimento: '2026-11-20', valor: '100.00',
  extracted: { composicao: [{ codigo: '2089', tributo: 'IRPJ' }, { codigo: '2372', tributo: 'CSLL' }] } };
const entrada = overrides => ({ guia: structuredClone(guia), revisao: 'r1',
  globalPolicy: { schemaVersion: 1, defaults: { lembretes: lembretes() } },
  companyPolicy: { schemaVersion: 1 }, feriados: [], municipio: 'Cidade A',
  estado: { pagamentoConfirmado: false, recalculada: false, documentoVigente: true }, horaConsultaPagamento: 9, ...overrides });
const fase = (r, f) => r.eventos.find(e => e.fase === f);

describe('calendarioEventosGuia: preview only, no persistence or transport', () => {
  test('DARF coalesces separately per phase, preserving the whole document', () => {
    const input = entrada({ companyPolicy: { schemaVersion: 1, tributos: {
      IRPJ: { lembretes: lembretes(4, 5, 10) }, CSLL: { lembretes: lembretes(2, 3, 7) },
    } } });
    const original = structuredClone(input);
    const r = calendarioEventosGuia(input);
    expect(r.eventos).toHaveLength(4);
    expect(fase(r, 'ANTES')).toMatchObject({ dataCivil: '2026-11-16', hour: 10 });
    expect(fase(r, 'NO_VENCIMENTO')).toMatchObject({ dataCivil: '2026-11-20', hour: 7 });
    expect(fase(r, 'DEPOIS')).toMatchObject({ dataCivil: '2026-11-25', hour: 7 });
    expect(fase(r, 'PAGAMENTO_D2')).toMatchObject({ dataCivil: '2026-11-24', hour: 9 });
    expect(input).toEqual(original);
  });
  test('national/municipal holidays and weekend do not rewrite nominal due date', () => {
    const r = calendarioEventosGuia(entrada({ guia: { ...guia, vencimento: '2027-01-03' }, feriados: [
      { data: '2027-01-01', abrangencia: 'NACIONAL' },
      { data: '2026-12-31', abrangencia: 'MUNICIPAL', municipio: 'Cidade A' },
      { data: '2027-01-04', abrangencia: 'MUNICIPAL', municipio: 'Outra cidade' },
    ] }));
    expect(r.referencia.dataCivil).toBe('2027-01-03');
    expect(fase(r, 'ANTES').dataCivil).toBe('2026-12-29');
    expect(fase(r, 'NO_VENCIMENTO').dataCivil).toBe('2026-12-30');
    expect(fase(r, 'DEPOIS').dataCivil).toBe('2027-01-05');
  });
  test('one component off does not suppress another; all reminders off leaves D+2 independent', () => {
    const off = { before: { enabled: false }, onDue: { enabled: false }, after: { enabled: false } };
    let r = calendarioEventosGuia(entrada({ companyPolicy: { schemaVersion: 1, tributos: { IRPJ: { lembretes: off } } } }));
    expect(fase(r, 'ANTES').tributosParticipantes).toEqual(['CSLL']);
    r = calendarioEventosGuia(entrada({ companyPolicy: { schemaVersion: 1, defaults: { lembretes: off } } }));
    expect(r.eventos.map(e => e.fase)).toEqual(['PAGAMENTO_D2']);
  });
  test('payment ends all reminders and query for this document', () => {
    expect(calendarioEventosGuia(entrada({ estado: { pagamentoConfirmado: true, recalculada: false, documentoVigente: true } })))
      .toMatchObject({ status: 'ENCERRADO', eventos: [] });
  });
  test('current recalculated document keeps reminders, but never the D+2 query', () => {
    const r = calendarioEventosGuia(entrada({ estado: { pagamentoConfirmado: false, recalculada: true, documentoVigente: true }, horaConsultaPagamento: undefined }));
    expect(r.eventos.map(e => e.fase)).toEqual(['ANTES', 'NO_VENCIMENTO', 'DEPOIS']);
    expect(r.pendencias).toEqual([]);
  });
  test('superseded document cannot resume reminders after recalculation', () => {
    expect(calendarioEventosGuia(entrada({ estado: { pagamentoConfirmado: false, recalculada: true, documentoVigente: false } })))
      .toMatchObject({ motivo: 'DOCUMENTO_SUBSTITUIDO', eventos: [] });
  });
  test('before D-1 and D0 can coincide for Saturday without collapsing phases', () => {
    const r = calendarioEventosGuia(entrada({ guia: { ...guia, vencimento: '2026-11-21' },
      globalPolicy: { schemaVersion: 1, defaults: { lembretes: lembretes(1) } } }));
    expect(fase(r, 'ANTES').dataCivil).toBe('2026-11-20');
    expect(fase(r, 'NO_VENCIMENTO').dataCivil).toBe('2026-11-20');
    expect(r.eventos.filter(e => e.tipo === 'LEMBRETE')).toHaveLength(3);
  });
  test.each(['2026-02-30', null, '2026-11-20T00:00:00-03:00'])('unproven civil date %s does not become day 20', vencimento => {
    expect(referenciaVencimentoGuia({ ...guia, vencimento }, 'r1')).toBeNull();
  });
  test('Prisma document Date keeps its civil date; UNKNOWN and missing state block', () => {
    expect(referenciaVencimentoGuia({ ...guia, vencimento: new Date('2026-11-20T00:00:00Z') }, 'r1').dataCivil).toBe('2026-11-20');
    expect(calendarioEventosGuia(entrada({ guia: { ...guia, extracted: {} } })).motivo).toBe('COMPOSICAO_A_CONFERIR');
    expect(calendarioEventosGuia(entrada({ estado: undefined })).motivo).toBe('ESTADO_GUIA_A_CONFERIR');
  });
  test('incomplete phase does not pick a later component or borrow payment hour', () => {
    const r = calendarioEventosGuia(entrada({ globalPolicy: { schemaVersion: 1, tributos: {
      IRPJ: { lembretes: { before: { enabled: true, businessDays: 4 } } },
      CSLL: { lembretes: lembretes() },
    } }, horaConsultaPagamento: undefined }));
    expect(fase(r, 'ANTES')).toBeUndefined();
    expect(fase(r, 'PAGAMENTO_D2')).toBeUndefined();
    expect(r.pendencias).toHaveLength(2);
  });
  test('hour matching is in Sao Paulo, without next-day or later-hour catchup', () => {
    const e = fase(calendarioEventosGuia(entrada()), 'ANTES');
    expect(eventoNaHora(e, new Date('2026-11-18T11:00:00Z'))).toBe(true);
    expect(eventoNaHora(e, new Date('2026-11-18T11:00:59.999Z'))).toBe(true);
    expect(eventoNaHora(e, new Date('2026-11-18T11:01:00Z'))).toBe(false);
    expect(eventoNaHora(e, new Date('2026-11-18T11:30:00Z'))).toBe(false);
    expect(eventoNaHora(e, new Date('2026-11-18T12:00:00Z'))).toBe(false);
    expect(eventoNaHora(e, new Date('2026-11-19T11:00:00Z'))).toBe(false);
  });
  test('capture requires a proven document reference and independent parameters', () => {
    const reference = referenciaVencimentoGuia(guia, 'r1');
    expect(dataCapturaGuia({ referencia: reference, businessDaysBefore: 3, hour: 6, feriados: [], municipio: 'Cidade A' }))
      .toEqual({ dataCivil: '2026-11-17', hour: 6, timezone: 'America/Sao_Paulo' });
    expect(dataCapturaGuia({ referencia: { ...reference, origem: 'OCORRENCIA_OBRIGACAO' }, businessDaysBefore: 3, hour: 6, feriados: [], municipio: 'Cidade A' })).toBeNull();
    expect(dataCapturaGuia({ businessDaysBefore: 3, hour: 6 })).toBeNull();
  });
});
