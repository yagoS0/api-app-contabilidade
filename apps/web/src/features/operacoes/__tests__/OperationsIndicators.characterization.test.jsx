import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { projetarFluxoCarteira } from '@contabilidade/shared/fluxo-carteira';
import { projetarOperacoesEmpresas, resumirEtapasOperacoes } from '../operacoes';
import { OperationsPage } from '../OperationsPage';

// Characterization of the legacy indicators, not the proposed P2b rules.
jest.mock('../OperationsDailyCalendar', () => ({ OperationsDailyCalendar: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
const pa = '2026-10';
const company = (id, extra = {}) => ({ companyId: id, razao: id, status: 'ATIVA', myRole: 'ACCOUNTANT', regimeTributario: 'SIMPLES', apuracao: { competencia: pa, estado: 'aberta' }, ...extra });
const summarize = (companies, evidence = []) => resumirEtapasOperacoes(projetarOperacoesEmpresas(companies, pa).rows, evidence);

test.each([
  ['ativa', { status: 'ATIVA' }, 1],
  ['suspensa', { status: 'SUSPENSA' }, 1],
  ['inativa', { status: 'INATIVA' }, 0],
  ['cadastro/regime ausente', { regimeTributario: null }, 1],
  ['sem procuração', { serproStatus: null }, 1],
  ['sem movimento declarado no cadastro', { empresaZerada: true }, 1],
  ['Presumido', { regimeTributario: 'LUCRO_PRESUMIDO' }, 1],
])('universo legado: %s não é uma decisão de aplicabilidade legal', (_name, extra, total) => {
  const result = summarize([company('a', extra)]);
  for (const key of ['calculado', 'confirmado', 'transmitido']) expect(result.metrics[key].total).toBe(total);
  expect(result.metrics.transmitido.done).toHaveLength(0);
});

test('identidade e competência: última duplicata vence; ausente/inativa/outro mês ficam fora', () => {
  const rows = projetarOperacoesEmpresas([company('a'), company('a', { razao: 'Última' }), company(''), company('old', { apuracao: { competencia: '2026-09' } }), company('inactive', { status: 'INATIVA' })], pa).rows;
  expect(rows.map(r => [r.company.companyId, r.company.razao])).toEqual([['a', 'Última']]);
  expect(projetarOperacoesEmpresas([company('a')], '2026-13').rows).toEqual([]);
});

test.each(['calculada', 'fechada', 'revisada', 'transmitida', 'confirmada'])('snapshot %s possui semântica distinta da confirmação operacional', estado => {
  const result = summarize([company('a', { apuracao: { competencia: pa, estado } })]);
  expect(result.metrics.calculado.done).toHaveLength(1);
  expect(result.metrics.transmitido.done).toHaveLength(['transmitida', 'confirmada'].includes(estado) ? 1 : 0);
  expect(result.metrics.confirmado.unknown).toHaveLength(1);
});

test.each(['CONFIRMED', 'RELEASED', 'EXECUTED', 'INVALIDATED', 'ATTENTION'])('operação %s não altera por si o eixo de transmissão', status => {
  const result = summarize([company('a')], [{ companyId: 'a', competencia: pa, regime: 'SIMPLES', status }]);
  expect(result.metrics.confirmado.done).toHaveLength(['CONFIRMED', 'RELEASED', 'EXECUTED'].includes(status) ? 1 : 0);
  expect(result.metrics.transmitido.done).toHaveLength(0);
});

test.each([true, false])('conclusão manual de transmitir: hash vigente=%s; legado não exige recibo', vigente => {
  const c = company('a');
  const fluxoCarteira = projetarFluxoCarteira(c, { competencia: pa, hashes: { transmitir: 'current' }, registros: [{ chave: 'transmitir', dados: { conclusao: { em: '2026-11-01T10:00:00Z', hash: vigente ? 'current' : 'old' } } }] });
  const result = summarize([{ ...c, fluxoCarteira }]);
  expect(result.metrics.transmitido.done).toHaveLength(vigente ? 1 : 0);
  expect(c.apuracao.numeroDeclaracao).toBeUndefined();
  expect(result.metrics.calculado.done).toHaveLength(vigente ? 1 : 0);
});

test('número RFB externo conta; guia isolada não é prova nesse caminho', () => {
  const official = company('official', { apuracao: { competencia: pa, numeroDeclaracaoRfb: 'synthetic-official' } });
  const guideOnly = company('guide', { guideCompliance: { competencia: pa, das: { required: true, state: 'gerada', guideId: 'g', ok: true } } });
  const result = summarize([official, guideOnly]);
  expect(result.metrics.transmitido.done.map(r => r.company.companyId)).toEqual(['official']);
  expect(result.metrics.calculado.done.map(r => r.company.companyId)).toEqual(['official']);
});

test('conclusão externa Presumido entra em Confirmado, não transforma o snapshot em transmissão', () => {
  const result = summarize([company('lp', { regimeTributario: 'LUCRO_PRESUMIDO' })], [{ companyId: 'lp', competencia: pa, regime: 'PRESUMIDO', status: 'PENDING', externalSummary: { apurar: { concluida: true }, transmitir: { concluida: false } } }]);
  expect(result.metrics.confirmado.done).toHaveLength(1);
  expect(result.metrics.transmitido.done).toHaveLength(0);
});

test('evidência de outra empresa/mês não confirma; null permanece unknown e também missing', () => {
  const result = summarize([company('a')], [{ companyId: 'b', competencia: pa, status: 'CONFIRMED' }, { companyId: 'a', competencia: '2026-09', status: 'CONFIRMED' }]);
  expect(result.metrics.confirmado.done).toEqual([]);
  expect(result.metrics.confirmado.unknown).toHaveLength(1);
  expect(result.metrics.confirmado.missing).toHaveLength(1);
  expect(result.metrics.confirmado.total).toBe(1);
});

test('conjuntos se sobrepõem e pausa não apaga evidência fiscal já projetada', () => {
  const result = summarize([company('a', { apuracao: { competencia: pa, estado: 'transmitida' } })], [{ companyId: 'a', competencia: pa, status: 'EXECUTED', routine: { status: 'PAUSED' }, execution: { status: 'DONE' } }]);
  for (const key of ['calculado', 'confirmado', 'transmitido']) expect(result.metrics[key].done.map(r => r.company.companyId)).toEqual(['a']);
});

test.each([null, 0])('contador legado não comprova qualidade monetária: imposto=%s', dasValor => {
  const result = summarize([company('a', { apuracao: { competencia: pa, estado: 'calculada' } })], [{ companyId: 'a', competencia: pa, status: 'CONFIRMED', calculation: { calculoId: 'c', dasValor } }]);
  expect(result.metrics.calculado.done).toHaveLength(1);
  expect(result.metrics.confirmado.done).toHaveLength(1);
  // Validation for commands lives elsewhere; the badge is not that validation.
  expect(result.items[0].operation.calculation.dasValor).toBe(dasValor);
});

test('lista de Transmitido pagina 30 de todas as empresas; não usa numerador como universo', async () => {
  const companies = Array.from({ length: 31 }, (_, i) => company(`Empresa ${String(i).padStart(2, '0')}`, { apuracao: { competencia: pa, estado: i === 0 ? 'transmitida' : 'aberta' } }));
  const api = {
    getOperationAlerts: jest.fn(async () => ({ items: [], total: 0 })),
    getOperationManualInss: jest.fn(async () => ({ items: [], competencia: pa })),
    getOperationsTransmissionDocuments: jest.fn(async id => ({ ok: true, companyId: id, competencia: pa, items: [] })),
  };
  render(<OperationsPage api={api} companies={companies} competencia={pa} />);
  fireEvent.click(screen.getByRole('button', { name: 'Transmitido 1/31 empresas' }));
  const dialog = within(screen.getByRole('region', { name: 'Tabela contextual: Transmitido' }));
  await waitFor(() => expect(dialog.queryByText('Lendo documentos salvos…')).not.toBeInTheDocument());
  const firstPage = dialog.getAllByRole('rowheader').map(el => el.textContent.split('Vínculo')[0]);
  expect(firstPage).toHaveLength(30);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Próxima' }));
  const secondPage = dialog.getAllByRole('rowheader').map(el => el.textContent.split('Vínculo')[0]);
  expect(secondPage).toHaveLength(1);
  expect(new Set([...firstPage, ...secondPage]).size).toBe(31);
  expect(api.getOperationsTransmissionDocuments).toHaveBeenCalledTimes(31);
});

test.each([
  ['Calculado', '3/4', ['Alfa', 'Beta', 'Gama', 'Delta']],
  ['Confirmado', '1/4', ['Alfa', 'Gama', 'Delta']],
  ['Transmitido', '1/4', ['Alfa', 'Beta', 'Gama', 'Delta']],
])('contador/lista legados de %s: diferença caracterizada, sem corrigir P2a', async (stage, count, names) => {
  const companies = ['Alfa', 'Beta', 'Gama', 'Delta'].map((id, i) => company(id, { apuracao: { competencia: pa, estado: ['calculada', 'aberta', 'calculada', 'transmitida'][i] } }));
  const items = companies.map((c, i) => ({ companyId: c.companyId, competencia: pa, revision: 'r1', regime: 'SIMPLES', status: ['CONFIRMED', 'PENDING', 'INVALIDATED', 'ATTENTION'][i], pending: [], calculation: i === 1 ? null : { calculoId: 'c', dasValor: 0 } }));
  const api = {
    getOperationEvidence: jest.fn(async () => ({ items, total: items.length, competencia: pa })),
    getCompanyOperation: jest.fn(), getOperationAlerts: jest.fn(async () => ({ items: [], total: 0 })),
    getOperationManualInss: jest.fn(async () => ({ items: [], competencia: pa })),
    listOperationsBatches: jest.fn(async () => ({ items: [] })),
    getOperationsTransmissionDocuments: jest.fn(async id => ({ ok: true, companyId: id, competencia: pa, items: [] })),
    saveCompanyOperation: jest.fn(), executeCompanyOperation: jest.fn(),
  };
  render(<OperationsPage api={api} companies={companies} competencia={pa} />);
  const trigger = await screen.findByRole('button', { name: `${stage} ${count} empresas` });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  const dialog = within(await screen.findByRole('region', { name: `Tabela contextual: ${stage}` }));
  await waitFor(() => expect(dialog.getAllByRole('rowheader')).toHaveLength(names.length));
  for (const name of names) expect(dialog.getByRole('rowheader', { name: new RegExp(`^${name}`) })).toBeVisible();
  expect(api.getCompanyOperation).not.toHaveBeenCalled();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
