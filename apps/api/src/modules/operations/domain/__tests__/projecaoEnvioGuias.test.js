import { projetarCanalEnvio, estadoOperacionalGuia, selecionarGuiasNaJanela } from '../projecaoEnvioGuias.js';

const facts = overrides => ({
  guide: { id: 'guia-1', emailStatus: 'PENDING' },
  target: { channel: 'EMAIL', destination: 'fixture@example.invalid' },
  persisted: { attempts: [] }, envios: [], documentRevision: 'rev-atual', reason: null,
  channel: { disponivel: true }, ...overrides,
});
const attempt = overrides => ({ id: 'tentativa-1', guideId: 'guia-1', channel: 'EMAIL',
  destination: 'fixture@example.invalid', documentRevision: 'rev-atual', status: 'SENT', ...overrides });

test('projeção elegível não muda os fatos recebidos nem fabrica tentativa', () => {
  const input = facts(); const before = JSON.stringify(input);
  expect(projetarCanalEnvio(input)).toEqual({ channel: 'EMAIL', destinationLabel: 'fixture@example.invalid', state: 'PENDING', reason: null, attemptId: null });
  expect(JSON.stringify(input)).toBe(before);
});
test('revisão anterior em outro destino conserva bloqueio antes de tentativa atual', () => {
  const result = projetarCanalEnvio(facts({ persisted: { attempts: [attempt({ destination: 'anterior@example.invalid', documentRevision: 'rev-antiga' }), attempt()] } }));
  expect(result).toMatchObject({ state: 'REVIEW', reason: 'O documento mudou após uma tentativa. Confira o histórico antes de reenviar.', attemptId: 'tentativa-1' });
});
test.each([['falhou', 'REVIEW'], ['indeterminado', 'UNCERTAIN'], ['enviando', 'STARTED']])('ledger %s preserva histórico e projeta %s', (status, state) => {
  expect(projetarCanalEnvio(facts({ persisted: { attempts: [attempt()] }, envios: [{ guideId: 'guia-1', canal: 'EMAIL', destino: 'fixture@example.invalid', status }] }))).toMatchObject({ state, attemptId: 'tentativa-1' });
});
test('recibo EXTERNO anterior prevalece por first-match sem ordenar o ledger', () => {
  const envios = [{ guideId: 'guia-1', canal: 'EXTERNO', status: 'enviado' }, { guideId: 'guia-1', canal: 'EMAIL', destino: 'fixture@example.invalid', status: 'falhou' }];
  expect(projetarCanalEnvio(facts({ persisted: { attempts: [attempt()] }, envios }))).toMatchObject({ state: 'SENT', reason: null });
});
test('histórico sem tentativa correlacionada exige revisão, não comprova entrega', () => {
  expect(projetarCanalEnvio(facts({ envios: [{ guideId: 'guia-1', canal: 'EMAIL', destino: 'outro@example.invalid', status: 'entregue' }] }))).toMatchObject({ state: 'REVIEW', attemptId: null });
});
test('indisponibilidade WhatsApp conserva estado aceito e apresenta motivo do canal', () => {
  expect(projetarCanalEnvio(facts({ target: { channel: 'WHATSAPP', destination: '+5500000000000' }, persisted: { attempts: [attempt({ channel: 'WHATSAPP', destination: '+5500000000000' })] }, channel: { disponivel: false, mensagem: 'Canal indisponível' } }))).toMatchObject({ state: 'SENT', reason: 'Canal indisponível' });
});
test.each([
  ['bloqueio', [{ state: 'SENT' }], 'REVIEW'],
  [null, [{ state: 'UNCERTAIN' }, { state: 'STARTED' }], 'REVIEW'],
  [null, [{ state: 'STARTED' }, { state: 'SENT' }], 'STARTED'],
  [null, [{ state: 'SENT' }], 'SENT'],
  [null, [], 'PENDING'],
])('estado operacional preserva precedência %#', (reason, channels, expected) => {
  expect(estadoOperacionalGuia(reason, channels)).toBe(expected);
});
const selection = overrides => ({
  eligible: [{ guide: { id: 'antecipada' }, calendar: { advanceDate: '2026-11-10' } }, { guide: { id: 'futura' }, calendar: { advanceDate: '2026-11-17' } }],
  dto: { decision: { kind: 'PARTIAL_DUE', eligibleAt: '2026-11-10' }, cutoffDate: '2026-11-13', expectation: { state: 'REVIEW', missing: [{}] } },
  ...overrides,
});
test('janela parcial anterior ao corte inclui somente vencimento antecipado', () => {
  const snapshot = selection();
  expect(selecionarGuiasNaJanela(snapshot)).toEqual([snapshot.eligible[0]]);
});
test('corte inclui ambas, sem exigir cobertura completa', () => {
  const snapshot = selection(); snapshot.dto.decision.eligibleAt = '2026-11-13';
  expect(selecionarGuiasNaJanela(snapshot)).toEqual(snapshot.eligible);
});
test('cobertura completa permite todas antes do corte', () => {
  const snapshot = selection(); snapshot.dto.decision.kind = 'COMPLETE'; snapshot.dto.expectation = { state: 'KNOWN', missing: [] };
  expect(selecionarGuiasNaJanela(snapshot)).toEqual(snapshot.eligible);
});
test('decisão não elegível impede seleção mesmo com cobertura completa', () => {
  const snapshot = selection(); snapshot.dto.decision.kind = 'WAIT'; snapshot.dto.expectation = { state: 'KNOWN', missing: [] };
  expect(selecionarGuiasNaJanela(snapshot)).toEqual([]);
});
