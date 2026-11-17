// Caracterização local B3.3: não implementa seleção fiscal nem homologa o provedor.
import { buildDeclaracaoPayload, parseRetornoSimulacao, PgdasSimulacaoService } from '../PgdasSimulacaoService.js';
import { SerproPgdasdService } from '../SerproPgdasdService.js';
import { versaoPgdas, listarHistoricoPgdas } from '../PgdasHistoricoService.js';
import { determinarPoliticaDeclaratoriaFs12 } from '../../../../modules/fiscal/domain/politicaDeclaratoriaFs12.js';
import { interpretarContextoMensalFs12 } from '../../../../modules/fiscal/domain/contextoMensalFs12.js';
import { validarSerieManualFs12 } from '../../../../modules/fiscal/domain/serieManualFs12.js';

// Este contrato é local: qualquer leitura usa o db explícito da fixture abaixo.
// A política/guarda fiscal e os serviços de apresentação continuam reais.
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));

const empresaId = 'empresa-sintetica-b33';
const cnpj = '00000000000100';
const periodos = ['2026-10', '2026-11', '2026-12', '2027-01'];
const contexto = (competenciaApuracao, inicioAtividade = '2020-01', exigenciaHistorica = true) => ({
  empresaId, competenciaApuracao, inicioAtividade, exigenciaHistorica,
  regimeDoPeriodo: { empresaId, competencia: competenciaApuracao, tipo: 'SIMPLES_NACIONAL', referencia: 'fixture-regime-v1' },
});
const montar = (competencia, folhasSalario, atividades = []) => buildDeclaracaoPayload({
  contribuinteCnpj: cnpj, competencia, indicadorTransmissao: false, atividades, folhasSalario,
});

describe('B3.3 — retorno normalizado não comprova vínculo causal', () => {
  test('número e valor da resposta não criam identidade local nem prova de FS12', () => {
    const retorno = parseRetornoSimulacao({ dados: JSON.stringify([{
      idDeclaracao: 'declaracao-sintetica', dataHoraTransmissao: '20261117120000',
      valoresDevidos: [{ codigoTributo: 1010, valor: 10 }],
    }]) });
    expect(retorno).toMatchObject({ numeroDeclaracao: 'declaracao-sintetica', dasValor: 10 });
    for (const campo of ['calculoId', 'tentativaId', 'revisaoFs12', 'folhasSalario']) {
      expect(retorno).not.toHaveProperty(campo);
    }
  });
  test('resposta ilegível não se converte em valor zero ou declaração comprovada', () => {
    expect(parseRetornoSimulacao({ dados: '{invalido' })).toMatchObject({
      dasValor: null, numeroDeclaracao: null, dataHoraTransmissao: null,
    });
  });
});

describe('B3.3 — janela local completa não é seleção de remessa', () => {
  test.each([
    ['2026-10', true, 'EXIGIDA', '2025-10', '2026-09'],
    ['2026-10', false, 'NAO_EXIGIDA', null, null],
    ['2026-11', true, 'EXIGIDA', '2025-11', '2026-10'],
    ['2026-11', false, 'EXIGIDA', '2025-11', '2026-10'],
    ['2026-12', true, 'EXIGIDA', '2025-12', '2026-11'],
    ['2026-12', false, 'EXIGIDA', '2025-12', '2026-11'],
    ['2027-01', true, 'PENDENTE', null, null],
    ['2027-01', false, 'PENDENTE', null, null],
  ])('%s exigência histórica=%s conserva janela B1 e limite temporal', (pa, historica, situacao, primeiro, ultimo) => {
    const politica = determinarPoliticaDeclaratoriaFs12(contexto(pa, '2020-01', historica));
    expect(politica.situacao).toBe(situacao);
    if (primeiro) {
      expect(politica.janela.competencias).toHaveLength(12);
      expect(politica.janela.competencias[0]).toBe(primeiro);
      expect(politica.janela.competencias.at(-1)).toBe(ultimo);
    } else expect(politica.janela).toBeNull();
    expect(politica).not.toHaveProperty('mesesParaEnviar');
  });

  test.each(['2026-11', '2026-12'])('%s: série confirmável inteira e subconjunto têm contratos distintos', pa => {
    const ctx = contexto(pa);
    const meses = determinarPoliticaDeclaratoriaFs12(ctx).janela.competencias;
    const serie = meses.map(mes => ({ mes, valorCentavos: 0 }));
    expect(validarSerieManualFs12(ctx, serie).totalCentavos).toBe(0);
    expect(() => validarSerieManualFs12(ctx, serie.slice(-1))).toThrow(expect.objectContaining({ code: 'FS12_SERIE_INCOMPLETA' }));
    expect(() => validarSerieManualFs12(ctx, [])).toThrow(expect.objectContaining({ code: 'FS12_SERIE_INCOMPLETA' }));
    expect(() => validarSerieManualFs12(ctx, serie.map((item, i) => i ? item : { mes: item.mes })))
      .toThrow(expect.objectContaining({ code: 'FS12_SERIE_INVALIDA' }));
    // O builder legado aceita o subconjunto, mas não prova que o SERPRO o exige/aceita.
    expect(montar(pa, [{ pa: meses.at(-1), valor: 0 }]).declaracao.folhasSalario)
      .toEqual([{ pa: Number(meses.at(-1).replace('-', '')), valor: 0 }]);
  });

  test.each([
    ['2026-11', '2026-11', ['2026-11']],
    ['2026-12', '2026-11', ['2026-11']],
    ['2026-12', '2026-10', ['2026-10', '2026-11']],
  ])('%s abertura %s não recebe meses anteriores fictícios', (pa, abertura, meses) => {
    expect(determinarPoliticaDeclaratoriaFs12(contexto(pa, abertura)).janela.competencias).toEqual(meses);
    expect(montar(pa, meses.map(mes => ({ pa: mes, valor: 0 }))).declaracao.folhasSalario)
      .toEqual(meses.map(mes => ({ pa: Number(mes.replace('-', '')), valor: 0 })));
  });

  test('abertura em 15/11: contexto mensal conservador ainda impede confirmar, sem estender o regime', () => {
    const data = s => new Date(`${s}T00:00:00.000Z`);
    const company = { id: empresaId, dataAbertura: data('2026-11-15'), regimeHistorico: [{
      id: 'regime-fixture', companyId: empresaId, regime: 'SIMPLES', vigenciaInicio: data('2026-11-15'),
      vigenciaFim: null, updatedAt: data('2026-11-15'),
    }] };
    const ctx = interpretarContextoMensalFs12(company, '2026-11');
    expect(ctx.inicioAtividade).toBe('2026-11');
    expect(ctx.regimeDoPeriodo).toBeNull();
    expect(determinarPoliticaDeclaratoriaFs12(ctx).impedimentos).toContain('REGIME_DO_PERIODO_NAO_COMPROVADO');
    expect(() => validarSerieManualFs12(ctx, [{ mes: '2026-11', valorCentavos: 0 }]))
      .toThrow(expect.objectContaining({ code: 'FS12_CONTEXTO_PENDENTE' }));
  });

  test.each(periodos)('%s: omissão, lista vazia e null não são equivalentes na entrada local', pa => {
    expect(montar(pa, undefined).declaracao).not.toHaveProperty('folhasSalario');
    expect(montar(pa, []).declaracao).not.toHaveProperty('folhasSalario');
    expect(() => montar(pa, null)).toThrow(TypeError);
    for (const sujeitoFatorR of [true, false]) {
      const payload = montar(pa, [{ pa: '2026-09', valor: 0 }], [{ idAtividade: 1, valorInterno: 0, sujeitoFatorR }]);
      expect(payload.declaracao.folhasSalario).toEqual([{ pa: 202609, valor: 0 }]);
      expect(payload.declaracao.estabelecimentos[0]).not.toHaveProperty('atividades');
    }
  });
});

describe('B3.3 — histórico consultável não comprova a série mensal', () => {
  const circular = { pgdasNumeroDeclaracao: 'fixture-declaracao-anterior', receitaBruta: 100,
    dasTotal: 6, pgdasDeclaracaoFileId: 'fixture-pdf', pgdasReciboFileId: 'fixture-recibo' };

  test('versão documental não contém meses/valores da folha nem cálculo causal', async () => {
    const versao = versaoPgdas(circular, empresaId, '2026-11');
    expect(Object.keys(versao).sort()).toEqual(['id', 'numeroDeclaracao', 'receitaBruta', 'dasTotal', 'declaracaoFileId', 'reciboFileId'].sort());
    const db = { appSetting: { findMany: jest.fn(async () => []) },
      companyMonthlyCircular: { findUnique: jest.fn(async () => circular) },
      apuracaoSnapshot: { findUnique: jest.fn(async () => ({ estado: 'transmitida', numeroDeclaracao: 'fixture-declaracao-anterior' })) } };
    const historico = await listarHistoricoPgdas(empresaId, '2026-11', db);
    expect(historico.versoes).toHaveLength(1);
    expect(historico.versoes[0]).toMatchObject({ temDeclaracao: true, temRecibo: true });
    for (const campo of ['folhasSalario', 'mesesDeclarados', 'calculoId', 'fs12']) expect(historico.versoes[0]).not.toHaveProperty(campo);
  });

  test('CONSDECLARACAO13 repassa retorno bruto e mantém empresa/PA no envelope, sem produzir seleção', async () => {
    const retorno = { dados: JSON.stringify({ declaracoes: [{ numeroDeclaracao: 'fixture-anterior', periodoApuracao: '202611' }] }) };
    const post = jest.fn(async () => retorno);
    const service = new SerproPgdasdService({ client: { post } });
    expect(await service.consultarDeclaracaoIndice({ contratanteCnpj: cnpj, contribuinteCnpj: cnpj, periodoApuracao: '2026-11' })).toBe(retorno);
    expect(post).toHaveBeenCalledTimes(1);
    const [rota, envelope] = post.mock.calls[0];
    expect(rota).toBe('/Consultar');
    expect(envelope.contribuinte.numero).toBe(cnpj);
    expect(envelope.pedidoDados.idServico).toBe('CONSDECLARACAO13');
    expect(JSON.parse(envelope.pedidoDados.dados)).toEqual({ periodoApuracao: '202611' });
    expect(retorno).not.toHaveProperty('mesesParaEnviar');
  });

  test('histórico local de outra empresa/PA é descartado, sem inferir folha zero', async () => {
    const db = { appSetting: { findMany: jest.fn(async () => [
      { value: { companyId: 'outra-empresa', competencia: '2026-11', numeroDeclaracao: 'fixture-alheia' } },
      { value: { companyId: empresaId, competencia: '2026-10', numeroDeclaracao: 'fixture-outro-pa' } },
    ]) }, companyMonthlyCircular: { findUnique: jest.fn(async () => null) },
    apuracaoSnapshot: { findUnique: jest.fn(async () => null) } };
    const historico = await listarHistoricoPgdas(empresaId, '2026-11', db);
    expect(historico.versoes).toEqual([]);
    expect(historico).not.toHaveProperty('folhasSalario');
    expect(db.appSetting.findMany.mock.calls[0][0].where.key.startsWith).toBe(`pgdas_historico:${empresaId}:2026-11:`);
  });

  test('falha de leitura histórica não vira lista vazia, folha zero ou permissão de despacho', async () => {
    const falha = new Error('fixture-leitura-indisponivel');
    const db = { appSetting: { findMany: jest.fn(async () => { throw falha; }) },
      companyMonthlyCircular: { findUnique: jest.fn(async () => circular) },
      apuracaoSnapshot: { findUnique: jest.fn(async () => null) } };
    await expect(listarHistoricoPgdas(empresaId, '2026-11', db)).rejects.toBe(falha);
  });

  test.each(['2026-11', '2026-12', '2027-01'])('%s: histórico/PDF/confirmação alegados não liberam simular ou transmitir', async competencia => {
    const transmitirDeclaracao = jest.fn();
    const service = new PgdasSimulacaoService({ pgdasService: { transmitirDeclaracao } });
    const params = { contribuinteCnpj: cnpj, contratanteCnpj: cnpj, competencia,
      folhasSalario: [{ pa: 202610, valor: 0 }], fs12Confirmada: true, autorizaEfeitoFiscal: true,
      historico: versaoPgdas(circular, empresaId, competencia) };
    for (const metodo of ['simular', 'transmitir']) {
      await expect(service[metodo](params)).rejects.toMatchObject({ code: competencia === '2027-01'
        ? 'FS12_HOMOLOGACAO_2027_PENDENTE' : 'FS12_INTEGRACAO_B33_PENDENTE' });
    }
    expect(transmitirDeclaracao).not.toHaveBeenCalled();
  });
});
