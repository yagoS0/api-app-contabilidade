// Synthetic one-page PDF, with complete xref and trailer.
const PDF_SINTETICO = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n186\n%%EOF\n";
import { lerRespostaDocumento, textoBlob, validarDocumentoBlob } from '../documentoIndividual';
import { createRealApi } from '../../../../api/real/realApi';
const resposta = (texto, type) => ({ ok: true, headers: { get: () => 'attachment; filename="nota.pdf"' }, blob: async () => new Blob([texto], { type }) });
test.each([['{"ok":true}', 'application/json'], ['<html>erro</html>', 'text/html'], ['{"ok":true}', 'application/pdf'], ['PKzip', 'application/pdf']])('200 %s não vira PDF', async (text, type) => {
  await expect(lerRespostaDocumento(resposta(text, type), 'PDF')).rejects.toThrow();
});
test('valida PDF e XML sem reescrever o blob', async () => {
  const pdf = new Blob([PDF_SINTETICO], { type: 'application/pdf' });
  expect(await validarDocumentoBlob(pdf, 'PDF')).toBe(pdf);
  const xml = new Blob(['<?xml version="1.0"?><NFe versao="4.00"></NFe>'], { type: 'application/xml' });
  expect(await validarDocumentoBlob(xml, 'XML')).toBe(xml);
  await expect(validarDocumentoBlob(new Blob(['<html/>'], { type: 'application/xml' }), 'XML')).rejects.toThrow();
});
test('erro nomeado preserva QR, motivo e status', async () => {
  await expect(lerRespostaDocumento({ ok: false, status: 503, json: async () => ({ error: 'danfse_sem_qrcode', message: 'QR ausente', motivo: 'chave ausente' }) }, 'PDF'))
    .rejects.toMatchObject({ code: 'danfse_sem_qrcode', status: 503, motivo: 'chave ausente' });
});

test.each(['NFe', 'nfeProc', 'NFSe'])('XML %s com BOM, prólogo longo, comentário e PI preserva o blob original', async raiz => {
  const original = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n'
    + `<!--${'Comentário sintético. '.repeat(200)}-->\r\n`
    + '<?origem teste="sintético"?>\r\n'
    + `<${raiz}><conteudo>á &amp; ç</conteudo></${raiz}>\r\n  `;
  const blob = new Blob([original], { type: 'application/xml' });
  // FileReader may consume the BOM when decoding; compare raw bytes as well.
  const bytes = value => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result)));
    reader.readAsArrayBuffer(value);
  });
  const antes = await bytes(blob);
  expect(antes.slice(0, 3)).toEqual([239, 187, 191]);
  expect(await validarDocumentoBlob(blob, 'XML')).toBe(blob);
  expect(await bytes(blob)).toEqual(antes);
  expect(await textoBlob(blob)).toContain('Comentário sintético.');
  const out = await lerRespostaDocumento({ ok: true, headers: { get: () => 'attachment; filename="nota.xml"' }, blob: async () => blob }, 'XML');
  expect(out.blob).toBe(blob);
  expect(await bytes(out.blob)).toEqual(antes);
});

test.each([
  '{"ok":true}', '<html><body>erro</body></html>',
  '<?xml version="1.0"?><!DOCTYPE NFe [<!ENTITY dado "teste">]><NFe>&dado;</NFe>',
  '<?xml version="1.0"?><NFe><item></NFe>',
])('XML MIME não legitima conteúdo inválido: %s', async texto => {
  await expect(validarDocumentoBlob(new Blob([texto], { type: 'application/xml' }), 'XML')).rejects.toThrow();
});
test('transporte envia Bearer e AbortSignal e valida retorno 200', async () => {
  const original = global.fetch;
  try {
    global.fetch = jest.fn(async () => resposta(PDF_SINTETICO, 'application/pdf'));
    const api = createRealApi(); api.setAccessToken('token-sintetico');
    const controller = new AbortController();
    await api.fetchDocumentoNota('empresa', 'nota', 'PDF', { signal: controller.signal });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/firm/companies/empresa/notas/nota/documento?formato=PDF'), expect.objectContaining({ method: 'GET', signal: controller.signal, headers: { Authorization: 'Bearer token-sintetico' }, cache: 'no-store' }));
    global.fetch.mockResolvedValue(resposta('{"ok":true}', 'application/json'));
    await expect(api.fetchDocumentoNota('empresa', 'nota', 'PDF')).rejects.toThrow();
  } finally { global.fetch = original; }
});
