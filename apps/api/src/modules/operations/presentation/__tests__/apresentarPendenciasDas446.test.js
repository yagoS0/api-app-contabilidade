import { apresentarPendenciasDas446 } from '../apresentarPendenciasDas446.js';
const source = (items = [], extra = {}) => ({ consulta: 'ok', items, limit: 50, truncated: false, ...extra });
const fixture = () => ({ companyId: 'a', competencia: '2026-10', consultadoEm: '2026-11-14T12:00:00Z', limit: 50,
  fiscal: { chamadas: source([{ id: 'r', estadoLocal: 'incerta' }]), cache: source(), despachos: source(), lacunas: ['RESULTADO_EXTERNO_INCERTO_CACHE_NAO_RESOLVE_RESERVA'] },
  guias: { guias: source(), pagamentos: source(), lacunas: [] }, contabilidade: { circular: source(), lancamentos: source(), lacunas: [] },
  operacoes: { execucoes: source(), worker: source(), lacunas: [] }, lacunas: [] });
test('preserves uncertainty and identity without changing source or exposing raw fields', () => {
  const input = fixture(); input.fiscal.chamadas.items[0].secret = 'PRIVATE'; const before = JSON.stringify(input);
  const result = apresentarPendenciasDas446(input);
  expect(result).toMatchObject({ companyId: 'a', competencia: '2026-10', contrato: 'pendencias-das-leitura-4.4.6' });
  expect(result.achados.some(a => a.classificacao === 'Resultado incerto')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(JSON.stringify(input)).toBe(before);
  expect(result).not.toHaveProperty('conciliado');
});
test('partial failure is not absence and truncation stays explicit', () => {
  const input = fixture(); input.guias.guias = source(null, { consulta: 'falhou', truncated: null });
  input.contabilidade.lancamentos = source([{ id: 'e', linhasTruncadas: true }], { truncated: true });
  const result = apresentarPendenciasDas446(input);
  expect(result.fontes.find(f => f.id === 'guias')).toMatchObject({ quantidade: null, estado: 'Falha na leitura' });
  expect(result.truncado).toBe(true); expect(result.falhasParciais).toBe(true);
});
test('duplicates, missing provision and local payment remain descriptive', () => {
  const input = fixture(); input.guias.lacunas = ['MULTIPLAS_GUIAS_REVISAO_VIGENTE_NAO_DETERMINADA'];
  input.contabilidade.lacunas = ['GUIA_SEM_PROVISAO_VINCULADA:g'];
  input.guias.guias.items = [{ id: 'g', pagamento: { estadoLocal: 'PAID', origem: 'CLIENTE', referenciaComprovante: true } }];
  const result = apresentarPendenciasDas446(input);
  expect(result.achados.some(a => a.evidencia.includes('Múltiplas guias'))).toBe(true);
  expect(result.achados.some(a => a.evidencia.includes('Provisão vinculada'))).toBe(true);
  expect(result.achados.some(a => a.evidencia.includes('cliente') && a.evidencia.includes('comprovante'))).toBe(true);
});


test('general cautions do not invent findings when every source is empty', () => {
  const input = fixture(); input.fiscal.chamadas.items = [];
  input.fiscal.lacunas = ['LEDGER_NAO_COMPROVA_SUCESSO_FISCAL','NENHUMA_AUTORIZACAO_DE_RETRY','SEM_CHAMADA_ASSOCIAVEL_CACHE_NAO_VARRIDO'];
  input.guias.lacunas = ['PDF_NAO_BAIXADO_NEM_VALIDADO','SEM_DOCUMENTO_NO_RECORTE_NAO_AUTORIZA_RETRY'];
  input.contabilidade.lacunas = ['CIRCULAR_NAO_COMPROVA_PROVISAO','SEM_LANCAMENTO_NO_RECORTE_NAO_COMPROVA_PROVISAO_CONCLUIDA'];
  input.operacoes.lacunas = ['COMPLETED_NAO_COMPROVA_SUCESSO_FISCAL_OU_CONTABIL','ACCOUNTING_OK_NAO_PERSISTIDO'];
  const result = apresentarPendenciasDas446(input);
  expect(result.achados).toEqual([]);
  expect(result.limitacoes.some(a => a.includes('Circular não comprova provisão'))).toBe(true);
  expect(result.limitacoes.some(a => a.includes('não persistido') || a.includes('não é persistido'))).toBe(true);
});

test('preserves operational identities, closure, old payment and observed completed execution separately', () => {
  const input = fixture();
  input.fiscal.despachos.items = [{ reservaId: 'dispatch', autorizadoEm: '2026-11-14T12:00:00Z' }];
  input.operacoes.worker.items = [{ registro: 'worker:2026-10', grupo: 'results', status: 'skipped_procuration_inactive' }];
  input.operacoes.execucoes.items = [{ id: 'execution', status: 'completed', entriesGenerated: 0 }];
  input.contabilidade.circular.items = [{ id: 'circular', fechadoContabilEm: '2026-11-14T12:00:00Z' }];
  input.guias.pagamentos.items = [{ id: 'payment', guideId: 'guide', revisaoCompativel: false }];
  const text = apresentarPendenciasDas446(input).achados.map(a => a.evidencia).join(' ');
  for (const fragment of ['dispatch','worker:2026-10','execution','concluída no log','lançamentos gerados segundo o log: 0','não executada por procuração inativa','fechamento contábil registrado','revisão anterior ou incompatível']) expect(text).toContain(fragment);
});


test.each(['abortada_auth','abortada_politica','recusada_cooldown','recusada_teto'])('retains known reservation status %s', estadoLocal => {
  const input = fixture(); input.fiscal.chamadas.items = [{ id: 'reservation', estadoLocal, registradaEm: '2026-11-14T12:00:00Z' }];
  const observation = apresentarPendenciasDas446(input).achados.find(a => a.evidencia.startsWith('Reserva reservation:'));
  expect(observation.evidencia).not.toContain('não identificado');
});
