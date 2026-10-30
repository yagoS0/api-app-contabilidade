export function textoBlob(blob) {
  if (blob.text) return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o documento.'));
    reader.readAsText(blob);
  });
}

export async function validarDocumentoBlob(blob, formato) {
  const mime = String(blob?.type || '').split(';')[0].toLowerCase();
  if (!blob?.size || (formato === 'PDF' ? mime !== 'application/pdf' : !['application/xml', 'text/xml'].includes(mime)))
    throw new Error('O servidor não retornou o tipo de documento solicitado.');
  const texto = await textoBlob(formato === 'PDF' ? blob.slice(0, 5) : blob);
  if (formato === 'PDF') {
    if (!texto.startsWith('%PDF-')) throw new Error('Conteúdo do documento inválido. Nenhum arquivo foi aberto.');
  } else {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (/<!DOCTYPE|<!ENTITY/i.test(texto) || doc.getElementsByTagName('parsererror').length || !['NFSe', 'NFe', 'nfeProc'].includes(doc.documentElement?.localName))
      throw new Error('Conteúdo do documento inválido. Nenhum arquivo foi aberto.');
  }
  return blob;
}

export async function lerRespostaDocumento(res, formato) {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw Object.assign(new Error(payload.message || `Não foi possível obter o documento (HTTP ${res.status}).`),
      { code: payload.error, status: res.status, motivo: payload.motivo, payload });
  }
  const blob = await validarDocumentoBlob(await res.blob(), formato);
  const nome = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1];
  return { blob, nome: String(nome || `nota.${formato.toLowerCase()}`).replace(/[^\w.-]/g, '_') };
}

export function baixarDocumentoUrl(url, nome) {
  const link = document.createElement('a');
  link.href = url; link.download = nome;
  document.body.appendChild(link); link.click(); link.remove();
}
