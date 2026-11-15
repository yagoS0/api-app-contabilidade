import { classificarElegibilidade448, fatosDaObservacao448, PROVAS_OBRIGATORIAS_448 } from '../elegibilidadeRecuperacaoDas448.js';

const completo = () => ({ provas: Object.fromEntries(PROVAS_OBRIGATORIAS_448.map(k => [k, true])), bloqueios: [], lacunas: [], documentoEquivalente: false });
describe('política conservadora 448', () => {
  test('ausência completa é não verificável', () => expect(classificarElegibilidade448({}).classificacao).toBe('NAO_VERIFICAVEL'));
  test.each(['RESERVA_INCERTA','RESERVA_RESERVADA','PAGAMENTO_CONHECIDO','CONFIRMACAO_ORFA','COMPETENCIA_FECHADA','DOCUMENTO_REMOVIDO','DOCUMENTO_SUBSTITUIDO','CONFLITO_HASH','CONFLITO_SOURCE_FILE_ID'])( '%s precede lacunas', motivo => {
    const r = classificarElegibilidade448({ bloqueios: [motivo], lacunas: ['FONTE_INDISPONIVEL'] });
    expect(r.classificacao).toBe('BLOQUEADO'); expect(r.lacunas).toContain('FONTE_INDISPONIVEL'); expect(r.efeitosPermitidos).toEqual([]);
  });
  test.each(['PDF_INVALIDO','IDENTIDADE_AMBIGUA','MULTIPLAS_REVISOES','LANCAMENTO_SEM_VINCULO','FONTE_TRUNCADA','EVIDENCIAS_ALTERADAS'])( '%s impede conclusão positiva', motivo => {
    expect(classificarElegibilidade448({ ...completo(), lacunas: [motivo] }).classificacao).toBe('NAO_VERIFICAVEL');
  });
  test('provas explícitas completas permitem somente proposta futura', () => {
    expect(classificarElegibilidade448(completo()).classificacao).toBe('POTENCIALMENTE_ELEGIVEL');
    expect(classificarElegibilidade448({ ...completo(), documentoEquivalente: true }).classificacao).toBe('SEM_ALTERACAO_NECESSARIA');
  });
  test.each(PROVAS_OBRIGATORIAS_448)('sem prova %s não conclui', key => {
    const f = completo(); delete f.provas[key]; expect(classificarElegibilidade448(f).classificacao).toBe('NAO_VERIFICAVEL');
  });
});
test.each(['incerta','reservada'])('contexto445 com reserva %s, cache não resolve', estadoLocal => {
  const f = fatosDaObservacao448({ fiscal: { chamadas: { items: [{ estadoLocal }] }, cache: { items: [{ pdfNaResposta: true }] } } }, {});
  expect(classificarElegibilidade448(f).classificacao).toBe('BLOQUEADO');
});
test('equivalência aparente do445 nunca produz atestado positivo', () => {
  const f = fatosDaObservacao448({ guias: { guias: { items: [{ id: 'g', hash: 'a'.repeat(64), documento: { bytesLocais: true }, revisao: { atualizadaEm: '2026-10-10' } }] } } }, {});
  expect(classificarElegibilidade448(f).classificacao).toBe('NAO_VERIFICAVEL');
  expect(f.lacunas).toContain('PDF_NAO_VALIDADO');
});


const source = (items = [], extra = {}) => ({ consulta: 'ok', items, truncated: false, limit: 50, ...extra });
const contexto445 = () => ({ fiscal: { chamadas: source(), cache: source(), despachos: source() },
  guias: { guias: source(), pagamentos: source() }, contabilidade: { circular: source(), lancamentos: source() },
  operacoes: { execucoes: source(), worker: source() }, lacunas: [] });
test.each(['incerta','reservada'])('reserva %s permanece bloqueada com e sem resposta local', estadoLocal => {
  for (const caches of [[], [{ vigente: true, pdfNaResposta: true }]]) {
    const c = contexto445(); c.fiscal.chamadas.items = [{ estadoLocal }]; c.fiscal.cache.items = caches;
    expect(classificarElegibilidade448(fatosDaObservacao448(c, source())).classificacao).toBe('BLOQUEADO');
  }
});
test('expiração, PDF ausente, despacho divergente e assinatura compartilhada ficam explícitos', () => {
  const c = contexto445(); c.fiscal.cache.items = [{ vigente: false, pdfNaResposta: false }];
  c.fiscal.chamadas.items = [{ assinatura: 'same' }, { assinatura: 'same' }];
  c.fiscal.despachos.lacunas = ['IDENTIDADE_DESPACHO_DIVERGENTE'];
  const f = fatosDaObservacao448(c, source());
  expect(f.bloqueios).toContain('IDENTIDADE_DESPACHO_DIVERGENTE');
  expect(f.lacunas).toEqual(expect.arrayContaining(['RESPOSTA_LOCAL_EXPIRADA_OU_VIGENCIA_DESCONHECIDA','PDF_NAO_IDENTIFICADO_NA_RESPOSTA_LOCAL','ASSINATURA_COMPARTILHADA_ENTRE_TENTATIVAS']));
});
test.each(['execucoes','worker'])('fonte de Operações %s participa da completude', name => {
  const c = contexto445(); c.operacoes[name] = source(null, { consulta: 'falhou', truncated: null });
  expect(fatosDaObservacao448(c, source()).lacunas).toContain('FONTE_INDISPONIVEL');
  c.operacoes[name] = source([], { truncated: true });
  expect(fatosDaObservacao448(c, source()).lacunas).toContain('COMPLETUDE_NAO_COMPROVADA');
});
test('revisão de pagamento, igualdade de hash e fechamento são fatos distintos', () => {
  const c = contexto445(); c.guias.pagamentos.items = [{ revisaoCompativel: false }];
  c.contabilidade.circular.items = [{ fechadoContabilEm: '2026-10-31' }];
  c.contabilidade.lancamentos.items = [{ tipo: 'BAIXA', status: 'EXPORTADO', associacao: 'SEM_VINCULO_DOCUMENTAL_INEQUIVOCO', linhasTruncadas: true }];
  const f = fatosDaObservacao448(c, source([{ hashDocumentalCoincidente: false, competenciaAtualCompativel: false }]));
  expect(f.bloqueios).toEqual(expect.arrayContaining(['HASH_DOCUMENTAL_DIVERGENTE','COMPETENCIA_DOCUMENTAL_DIVERGENTE','CONFIRMACAO_DE_REVISAO_ANTERIOR','COMPETENCIA_CONTABIL_FECHADA','BAIXA_CONTABIL_CONHECIDA','LANCAMENTO_EXPORTADO']));
  expect(f.lacunas).toEqual(expect.arrayContaining(['LANCAMENTO_SEM_VINCULO_DOCUMENTAL','LINHAS_TRUNCADAS']));
});
