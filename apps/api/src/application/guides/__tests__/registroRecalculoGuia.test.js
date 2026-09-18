import { lerRegistroRecalculo, registrarRecalculoGuia, sinalizarRecalculosNosLancamentos } from '../RegistroRecalculoGuia.js';

const em = '2026-09-18T12:00:00.000Z';
const registro = (guiaId = 'g1') => ({ guiaId, recalculadoEm: em, valorAnterior: 1000, valorAtual: 1100, escopoValor: 'TOTAL_GUIA', especie: 'DARF_PRESUMIDO', solicitadoPor: 'u1' });
const guia = (over = {}) => ({ id: 'g1', portalClientId: 'p1', competencia: '2026-07', tipo: 'OUTRA', parcelamentoId: null, extracted: { recalculoGuia: registro(), numeroDocumento: 'doc1' }, ...over });

describe('Registro explícito sem alterar contabilidade', () => {
  it.each([1000, 1100])('registra sucesso inclusive quando o total continua %s', async (valor) => {
    const client = { guide: { findFirst: jest.fn(async () => guia({ valor })), update: jest.fn(async () => ({})) } };
    const anterior = { id: 'g1', portalClientId: 'p1', competencia: '2026-07', valor: 1000 };
    const r = await registrarRecalculoGuia(client, { guiaAnterior: anterior, guiaId: 'g1', especie: 'DARF_PRESUMIDO', userId: 'u1', agora: new Date(em) });
    expect(r).toMatchObject({ guiaId: 'g1', valorAnterior: 1000, valorAtual: valor, recalculadoEm: em, escopoValor: 'TOTAL_GUIA' });
    expect(r).not.toHaveProperty('solicitadoPor');
    expect(client.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g1', portalClientId: 'p1', competencia: '2026-07', status: 'PROCESSED' } }));
    const escrita = client.guide.update.mock.calls[0][0];
    expect(Object.keys(escrita.data)).toEqual(['extracted']);
    expect(escrita.data.extracted.numeroDocumento).toBe('doc1');
    expect(escrita.data.extracted.recalculoGuia.solicitadoPor).toBe('u1');
    expect(anterior.valor).toBe(1000);
  });

  it('não registra ausência de guia nem engole falha de persistência', async () => {
    const client = { guide: { findFirst: jest.fn(async () => null), update: jest.fn() } };
    const opts = { guiaAnterior: guia(), guiaId: 'g1', especie: 'INSS' };
    await expect(registrarRecalculoGuia(client, opts)).rejects.toThrow('guia_recalculada_nao_encontrada');
    expect(client.guide.update).not.toHaveBeenCalled();
    client.guide.findFirst.mockResolvedValue(guia());
    client.guide.update.mockRejectedValue(new Error('banco indisponível'));
    await expect(registrarRecalculoGuia(client, opts)).rejects.toThrow('banco indisponível');
  });

  it('não transforma updatedAt ou mudança de valor em recálculo confirmado', () => {
    expect(lerRegistroRecalculo(guia({ extracted: {}, updatedAt: em, valorOriginal: 1000, valor: 1100 }))).toBeNull();
    expect(lerRegistroRecalculo(guia({ extracted: { recalculoGuia: registro('outra-guia') } }))).toBeNull();
  });
});

describe('Sinal contábil com vínculo da guia', () => {
  it('DARF consolidada informa o mesmo total sem alterar provisões por tributo ou baixas', async () => {
    const entries = [
      { id: 'pis', sourceGuideId: 'g1', totalD: 100, lines: [{ tipo: 'D', valor: 100 }], baixas: [{ id: 'b1' }] },
      { id: 'cofins', sourceGuideId: 'g1', totalD: 900, lines: [{ tipo: 'D', valor: 900 }] },
    ];
    const antes = JSON.stringify(entries);
    const client = { guide: { findMany: jest.fn(async () => [guia()]) } };
    const out = await sinalizarRecalculosNosLancamentos(client, 'p1', entries);
    expect(out.map((e) => e.recalculoGuia.valorAtual)).toEqual([1100, 1100]);
    expect(out.map((e) => e.totalD)).toEqual([100, 900]);
    expect(out[0].recalculoGuia.escopoValor).toBe('TOTAL_GUIA');
    expect(JSON.stringify(entries)).toBe(antes);
    expect(out[0].lines).toBe(entries[0].lines);
    expect(out[0].baixas).toBe(entries[0].baixas);
  });

  it('INSS sintético recebe sinal sem criar lançamento', async () => {
    const client = { guide: { findMany: jest.fn(async () => [guia({ tipo: 'INSS' })]) } };
    const out = await sinalizarRecalculosNosLancamentos(client, 'p1', [{ id: 'synthetic-inss-g1', sourceGuide: { id: 'g1' }, synthetic: true }]);
    expect(out[0].recalculoGuia.guiaId).toBe('g1');
    expect(out[0].synthetic).toBe(true);
  });

  it('outra empresa não participa nem por id nem por competência', async () => {
    const client = { guide: { findMany: jest.fn(async () => [guia({ portalClientId: 'p2', tipo: 'SIMPLES' })]) } };
    const out = await sinalizarRecalculosNosLancamentos(client, 'p1', [{ sourceGuideId: 'g1' }, { eventType: 'DAS_SIMPLES', competencia: '2026-07' }]);
    expect(out.every((e) => e.recalculoGuia === null)).toBe(true);
    expect(client.guide.findMany.mock.calls[0][0].where.portalClientId).toBe('p1');
  });

  it('DAS sem vínculo só usa competência inequívoca e nunca parcela', async () => {
    const client = { guide: { findMany: jest.fn(async () => [guia({ tipo: 'SIMPLES' })]) } };
    const entries = [{ eventType: 'DAS_SIMPLES', competencia: '2026-07' }];
    expect((await sinalizarRecalculosNosLancamentos(client, 'p1', entries))[0].recalculoGuia.guiaId).toBe('g1');
    client.guide.findMany.mockResolvedValue([guia({ tipo: 'SIMPLES' }), guia({ id: 'g2', tipo: 'SIMPLES' })]);
    expect((await sinalizarRecalculosNosLancamentos(client, 'p1', entries))[0].recalculoGuia).toBeNull();
    client.guide.findMany.mockResolvedValue([guia({ tipo: 'SIMPLES', parcelamentoId: 'parcela' })]);
    expect((await sinalizarRecalculosNosLancamentos(client, 'p1', entries))[0].recalculoGuia).toBeNull();
  });
});
