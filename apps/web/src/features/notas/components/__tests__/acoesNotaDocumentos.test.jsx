import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AcoesNota } from '../AcoesNota';
import { NotasList } from '../NotasList';
import { NotaDetailModal } from '../NotaDetailModal';
const nota = { id: 's1', numero: '1', papel: 'DEST', type: 'NFSE' };
const caps = { revisao: 'r1', XML: { estado: 'disponivel' }, PDF: { estado: 'disponivel' } };
const xml = () => ({ blob: new Blob(['<?xml version="1.0"?><NFSe versao="1.00"><infNFSe/></NFSe>'], { type: 'application/xml' }), nome: 'nota.xml' });
function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'];
  let doc = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(doc.length); doc += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const start = doc.length;
  doc += `xref\n0 4\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return { blob: new Blob([doc], { type: 'application/pdf' }), nome: 'nota.pdf' };
}
const api = () => ({ getAcoesNota: jest.fn(async () => caps), fetchDocumentoNota: jest.fn(async (_c, _n, f) => f === 'PDF' ? pdf() : xml()), marcarNotaStatus: jest.fn() });
beforeEach(() => {
  URL.createObjectURL = jest.fn(() => 'blob:documento'); URL.revokeObjectURL = jest.fn();
  window.open = jest.fn(() => null);
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
test('Recebidas tem coluna Ações sem onMarcarStatus e sem N+1 no mount; seleção/teclado não abrem detalhe', async () => {
  const service = api(), abrir = jest.fn();
  render(<NotasList companyId="a" api={service} notas={[nota]} total={1} filters={{}} onFiltersChange={jest.fn()} onApply={jest.fn()} onAbrirNota={abrir} onBaixarSelecionadas={jest.fn()} />);
  expect(screen.getByRole('columnheader', { name: 'Ações' })).toBeInTheDocument();
  expect(service.getAcoesNota).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Baixar XML da nota 1' });
  fireEvent.focus(button);
  await waitFor(() => expect(service.getAcoesNota).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar nota 1' }));
  await waitFor(() => expect(service.fetchDocumentoNota).toHaveBeenCalledTimes(1));
  expect(abrir).not.toHaveBeenCalled(); expect(service.marcarNotaStatus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Cancelar nota/ }));
  expect(service.marcarNotaStatus).not.toHaveBeenCalled();
});
test('popup bloqueado oferece download; resposta duplicada não abre outro viewer e cleanup revoga URL', async () => {
  const service = api();
  const view = render(<AcoesNota nota={nota} companyId="a" api={service} />);
  const button = screen.getByRole('button', { name: /Abrir \/ imprimir PDF/ });
  fireEvent.click(button); fireEvent.click(button);
  expect(await screen.findByRole('link', { name: 'Baixar PDF' })).toHaveAttribute('href', 'blob:documento');
  expect(service.fetchDocumentoNota).toHaveBeenCalledTimes(1); expect(window.open).toHaveBeenCalledTimes(1);
  view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:documento');
});

test.each(['foco', 'clique'])('mesma linha recupera XML importado por novo %s sem consulta automática no refresh', async intencao => {
  const service = api(), abrir = jest.fn();
  service.getAcoesNota.mockResolvedValue({ ...caps, XML: { estado: 'indisponivel', motivo: 'XML completo ausente.' } });
  const props = { companyId: 'a', api: service, total: 1, filters: {}, onFiltersChange: jest.fn(), onApply: jest.fn(), onAbrirNota: abrir, onBaixarSelecionadas: jest.fn() };
  const view = render(<NotasList {...props} notas={[nota]} />);
  const button = screen.getByRole('button', { name: 'Baixar XML da nota 1' });
  fireEvent.focus(button);
  expect(await screen.findByText('XML completo ausente.')).toBeInTheDocument();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(service.fetchDocumentoNota).not.toHaveBeenCalled();
  expect(service.getAcoesNota).toHaveBeenCalledTimes(1);

  // A refreshed list has the same identity/status and no updatedAt/xmlHash.
  service.getAcoesNota.mockResolvedValue({ ...caps, revisao: 'xml-importado' });
  view.rerender(<NotasList {...props} notas={[{ ...nota }]} />);
  expect(screen.getByRole('button', { name: 'Baixar XML da nota 1' })).toBe(button);
  expect(service.getAcoesNota).toHaveBeenCalledTimes(1);
  if (intencao === 'foco') {
    fireEvent.blur(button); fireEvent.focus(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    expect(service.getAcoesNota).toHaveBeenCalledTimes(2);
    expect(service.fetchDocumentoNota).not.toHaveBeenCalled();
  }
  fireEvent.click(button);
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  expect(service.fetchDocumentoNota).toHaveBeenCalledTimes(1);
  expect(service.fetchDocumentoNota).toHaveBeenCalledWith('a', 's1', 'XML', expect.any(Object));
  expect(service.getAcoesNota).toHaveBeenCalledTimes(intencao === 'foco' ? 3 : 2);
  expect(abrir).not.toHaveBeenCalled();
  expect(service.marcarNotaStatus).not.toHaveBeenCalled();
  view.unmount();
});

test('foco e clique concorrentes compartilham apenas a consulta em andamento', async () => {
  const service = api(); let concluir;
  service.getAcoesNota.mockImplementationOnce(() => new Promise(resolve => { concluir = resolve; }));
  const view = render(<AcoesNota nota={nota} companyId="a" api={service} />);
  const button = screen.getByRole('button', { name: /Baixar XML/ });
  fireEvent.focus(button); fireEvent.click(button); fireEvent.click(button);
  expect(service.getAcoesNota).toHaveBeenCalledTimes(1);
  expect(service.fetchDocumentoNota).not.toHaveBeenCalled();
  await act(async () => { concluir(caps); });
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  expect(service.fetchDocumentoNota).toHaveBeenCalledTimes(1);
  view.unmount();
});
test('PDF autenticado abre viewer somente após validar e URL permanece até fechar', async () => {
  const viewer = { opener: {}, closed: false, close: jest.fn(), location: { replace: jest.fn() } };
  window.open.mockReturnValue(viewer);
  const view = render(<AcoesNota nota={nota} companyId="a" api={api()} />);
  fireEvent.click(screen.getByRole('button', { name: /Abrir \/ imprimir PDF/ }));
  await waitFor(() => expect(viewer.location.replace).toHaveBeenCalledWith('blob:documento'));
  expect(viewer.opener).toBeNull(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  view.unmount(); expect(viewer.close).toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:documento');
});
test('troca empresa/nota durante download ignora resposta antiga e aborta transporte', async () => {
  let concluir;
  const service = api(); service.fetchDocumentoNota.mockImplementation(() => new Promise(resolve => { concluir = resolve; }));
  const view = render(<AcoesNota nota={nota} companyId="a" api={service} />);
  fireEvent.click(screen.getByRole('button', { name: /Baixar XML/ }));
  await waitFor(() => expect(service.fetchDocumentoNota).toHaveBeenCalled());
  const signal = service.fetchDocumentoNota.mock.calls[0][3].signal;
  view.rerender(<AcoesNota nota={{ ...nota, id: 's2' }} companyId="b" api={service} />);
  expect(signal.aborted).toBe(true);
  await act(async () => { concluir(xml()); });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
test('sem XML e retorno JSON200 não produzem arquivo; ServiceInvoice não exige getNota', async () => {
  const service = api(); service.fetchDocumentoNota.mockResolvedValue({ blob: new Blob(['{"ok":true}'], { type: 'application/json' }), nome: 'nota.pdf' });
  render(<AcoesNota nota={{ ...nota, confirmadaPeloAdn: false }} companyId="a" api={service} />);
  fireEvent.click(screen.getByRole('button', { name: /Abrir \/ imprimir PDF/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('tipo de documento');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(service.fetchDocumentoNota).toHaveBeenCalledWith('a', 's1', 'PDF', expect.any(Object));
});

test('XML truncado no DTO baixa a íntegra pela porta autenticada', async () => {
  const service = api();
  render(<NotaDetailModal nota={{ ...nota, xml: { disponivel: true, truncadoPorTamanho: true, conteudo: null, bytes: 300000 } }} companyId="a" api={service} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Baixar XML da nota 1' }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  expect(service.fetchDocumentoNota).toHaveBeenCalledWith('a', 's1', 'XML', expect.any(Object));
});
test('capacidade indisponível fica explícita e impede transporte; falha de leitura não vira arquivo vazio', async () => {
  const service = api();
  service.getAcoesNota.mockResolvedValue({ ...caps, XML: { estado: 'indisponivel', motivo: 'XML completo ausente.' } });
  const view = render(<AcoesNota nota={nota} companyId="a" api={service} />);
  const button = screen.getByRole('button', { name: /Baixar XML/ });
  fireEvent.focus(button);
  expect(await screen.findByText('XML completo ausente.')).toBeInTheDocument();
  fireEvent.click(button);
  expect(service.fetchDocumentoNota).not.toHaveBeenCalled();
  service.getAcoesNota.mockRejectedValue(new Error('Leitura indisponível'));
  view.rerender(<AcoesNota nota={nota} companyId="b" api={service} />);
  fireEvent.click(screen.getByRole('button', { name: /Baixar XML/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Leitura indisponível');
  expect(service.fetchDocumentoNota).not.toHaveBeenCalled();
});
