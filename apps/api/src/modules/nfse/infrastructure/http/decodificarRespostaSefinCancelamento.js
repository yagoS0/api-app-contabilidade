import { gunzipSync } from 'node:zlib';
import { TextDecoder } from 'node:util';

export const LIMITE_XML_EVENTO = 2_000_000;
// Base64 canônico, UTF-8 estrito e limite aplicado durante a descompactação.
export function decodificarArquivoEvento(valor, { limite = LIMITE_XML_EVENTO } = {}) {
  if (typeof valor !== 'string' || !valor.length || valor.length > 2_800_000 || valor.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(valor)) throw Error('BASE64_INVALIDO');
  const bytes = Buffer.from(valor, 'base64');
  if (bytes.toString('base64') !== valor) throw Error('BASE64_INVALIDO');
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzip) throw Error('GZIP_OBRIGATORIO');
  let aberto;
  try { aberto = gunzipSync(bytes, { maxOutputLength: limite }); }
  catch (erro) {
    // O zlib não informa o volume parcial em falha. Consome conservadoramente
    // o orçamento reservado para impedir expansão repetida em um mesmo lote.
    erro.bytesConsumidos = limite;
    throw erro;
  }
  if (!aberto.length || aberto.length > limite) throw Error('XML_EXCESSIVO');
  try { return { xml: new TextDecoder('utf-8', { fatal: true }).decode(aberto), bytes: aberto.length }; }
  catch (erro) { erro.bytesConsumidos = aberto.length; throw erro; }
}

// Texto Swagger fornecido pelo proprietário; URL de exportação não comprovada.
// SHA256 UTF-8 trim: 6e4c0fc66bd568e9967e5abc21a79ce4c73912e73796b29b75ac5809c9a36642.
// O schemes:http do material não autoriza transporte HTTP; a origem é validada à parte.
// O decoder não atribui origem fiscal nem interpreta assinatura.
export function decodificarRespostaSefinCancelamento(corpo, contexto) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)
    || corpo.tipoAmbiente !== (contexto.ambiente === 'producao' ? 1 : 2)
    || typeof corpo.versaoAplicativo !== 'string' || !corpo.versaoAplicativo.trim()
    || typeof corpo.dataHoraProcessamento !== 'string'
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(corpo.dataHoraProcessamento)
    || !Number.isFinite(Date.parse(corpo.dataHoraProcessamento))
    || corpo.erro != null || corpo.erros != null) throw Error('ENVELOPE_SEFIN_INVALIDO');
  return decodificarArquivoEvento(corpo.eventoXmlGZipB64);
}
