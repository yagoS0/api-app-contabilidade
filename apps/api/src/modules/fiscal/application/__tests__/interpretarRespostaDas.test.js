import { interpretarRespostaDas, extractDocumentNumber, parsePossibleDate } from '../../public.js';

const bytes = Buffer.from('%PDF-1.4\n' + 'synthetic interpretation fixture '.repeat(8));
const pdf = bytes.toString('base64');
const facts = { contribuinteCnpj: '12345678000199', competencia: '2026-10' };
const interpret = (response, reader = jest.fn()) => interpretarRespostaDas({ ...facts, response }, { lerTextoPdfDas: reader });

test('nested JSON preserves bytes, raw response identity, caller period and exact monetary precision', async () => {
  const response = {
    contratante: { numero: '98765432000198' },
    dados: JSON.stringify([{ pdf, numeroDocumento: 'DOC/001', competencia: '2026-11',
      valorTotal: 1.005, receitaBruta: '1.234,56', inss: '80,50', dataVencimento: '20261120' }]),
  };
  const reader = jest.fn();
  const result = await interpret(response, reader);
  expect(result).toEqual({
    parsed: { cnpj: facts.contribuinteCnpj, competencia: facts.competencia, tipo: 'SIMPLES',
      valor: 1.005, receitaBruta: 1234.56, inssTotal: 80.5, vencimento: '2026-11-20T00:00:00.000Z' },
    pdfBuffer: bytes, numeroDocumento: 'DOC/001', rawPayload: response,
  });
  expect(result.rawPayload).toBe(response);
  expect(reader).not.toHaveBeenCalled();
});

test.each([
  [null, 'Valor Total do Documento\n1.234,56', 1234.56],
  [0, 'Valor Total do Documento: R$ 80,19', 80.19],
  [undefined, 'Principal 10,00 Multa 1,00 Juros 1,00 Total 12,00', 12],
  // This first-column behavior is legacy, not an approved correction to PDF interpretation.
  [null, 'Totais 10,00 2,00 12,00', 10],
  [0, 'Valor Total do Documento 0,00', 0],
  [null, 'unrecognized', null],
])('fallback preserves legacy result for %s / %s', async (valorTotal, text, expected) => {
  const reader = jest.fn().mockResolvedValue(text);
  const result = await interpret({ pdf, valorTotal }, reader);
  expect(result.parsed.valor).toBe(expected);
  expect(reader).toHaveBeenCalledTimes(1);
  expect(reader).toHaveBeenCalledWith(bytes);
});

test.each([0, null, undefined])('PDF failure preserves JSON absence/zero: %s', async valorTotal => {
  const reader = jest.fn().mockRejectedValue(new Error('synthetic PDF failure'));
  expect((await interpret({ pdf, valorTotal }, reader)).parsed.valor).toBe(valorTotal ?? null);
});

test.each([1.005, 0.1 + 0.2, -1])('nonzero JSON does not invoke fallback or round %s', async valorTotal => {
  const reader = jest.fn().mockResolvedValue('Valor Total do Documento 999,99');
  expect((await interpret({ pdf, valorTotal }, reader)).parsed.valor).toBe(valorTotal);
  expect(reader).not.toHaveBeenCalled();
});

test.each(['1.234,56', '1,234.56', 'R$ 1.234,56'])('legacy money format %s', async valorTotal => {
  expect((await interpret({ pdf, valorTotal })).parsed.valor).toBe(1234.56);
});

test('specific positive total wins over other monetary fields and zero', async () => {
  const result = await interpret({ pdf, valorMulta: 0, valorTotal: 3, nested: { valorTotalDocumento: '9,90' } });
  expect(result.parsed.valor).toBe(9.9);
});

const messages = [
  'nao foram encontrados debitos',
  'nao foi gerado das por nao haver valor devido',
  'nao ha declaracao transmitida para o periodo informado',
];
test.each([
  [[messages[2], messages[1], messages[0]], 'SERPRO_PGDASD_NO_DEBTS_FOUND', messages[0]],
  [[messages[2], messages[1]], 'SERPRO_PGDASD_NO_AMOUNT_DUE', messages[1]],
  [[messages[2]], 'SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED', messages[2]],
  [['não foram encontrados débitos'], 'SERPRO_PGDASD_PDF_NOT_FOUND', 'serpro_pgdasd_pdf_not_found'],
])('missing PDF error precedence: %j', async (texts, code, message) => {
  const response = { mensagens: texts.map(texto => ({ texto })) };
  const reader = jest.fn();
  try {
    await interpret(response, reader);
    throw new Error('expected refusal');
  } catch (error) {
    expect(error).toMatchObject({ code, message });
    expect(error.details).toBe(response);
  }
  expect(reader).not.toHaveBeenCalled();
});

test('PDF wins over negative messages; invalid base64 keeps its distinct error without details', async () => {
  expect((await interpret({ pdf, valorTotal: 12, mensagens: [{ texto: messages[0] }] })).parsed.valor).toBe(12);
  await expect(interpret({ pdf: '!'.repeat(120) })).rejects.toMatchObject({ code: 'SERPRO_PGDASD_PDF_INVALID' });
  await expect(interpret({ pdf: '!'.repeat(120) })).rejects.not.toHaveProperty('details');
});

test('number extraction excludes echoed CNPJ and prefers strict key within dados', () => {
  const envelope = { contratante: { numero: '98765432000198' } };
  expect(extractDocumentNumber(envelope)).toBeNull();
  expect(extractDocumentNumber({ ...envelope, Dados: JSON.stringify({ numeroRecibo: 'receipt', nested: { numeroDocumento: 'document' } }) })).toBe('document');
  expect(extractDocumentNumber({ ...envelope, dados: { numero: 'generic' } })).toBe('generic');
});

test('dates preserve compact rollover and invalid ISO rejection rather than changing policy', async () => {
  expect(parsePossibleDate('20260231').toISOString()).toBe('2026-03-03T00:00:00.000Z');
  expect(parsePossibleDate('20261301')).toBeNull();
  await expect(interpret({ pdf, dataVencimento: '2026-13-01' })).rejects.toBeInstanceOf(RangeError);
});

test('simultaneous interpretations keep response, company, period and PDF text isolated', async () => {
  const responseA = { pdf };
  const responseB = { pdf, valorTotal: 42 };
  const [a, b] = await Promise.all([
    interpret(responseA, jest.fn().mockResolvedValue('Valor Total do Documento 12,34')),
    interpretarRespostaDas({ response: responseB, contribuinteCnpj: '98765432000198', competencia: '2026-09' }, { lerTextoPdfDas: jest.fn() }),
  ]);
  expect(a.parsed).toMatchObject({ cnpj: facts.contribuinteCnpj, competencia: facts.competencia, valor: 12.34 });
  expect(b.parsed).toMatchObject({ cnpj: '98765432000198', competencia: '2026-09', valor: 42 });
  expect(a.rawPayload).toBe(responseA);
  expect(b.rawPayload).toBe(responseB);
  expect(responseA).not.toHaveProperty('valorTotal');
});
