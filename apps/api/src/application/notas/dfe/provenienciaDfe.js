import { createHash } from 'node:crypto';

const capturas = new WeakSet();
const digits = value => String(value || '').replace(/\D/g, '');
const hash = xml => createHash('sha256').update(xml).digest('hex');
// Server configuration, never a value from a document, proof or HTTP payload.
export function ambienteDfeConfigurado() {
  const value = process.env.DFE_AMBIENTE || 'prod';
  if (!['prod', 'hom'].includes(value)) throw Error('Ambiente DFe configurado inválido');
  return value;
}

// Internal capability: a deserialized object supplied by an importer cannot impersonate it.
// Only DfeSyncService calls this after company_a1 authentication and accepted distribution.
export function criarCapturaDfe({ clientId, cnpj, ambiente, nsu, chave, xml }) {
  if (!clientId || digits(cnpj).length !== 14 || ambiente !== ambienteDfeConfigurado()
      || !/^\d{1,15}$/.test(String(nsu || '')) || !/^\d{44}$/.test(chave || '') || !xml) {
    throw Error('Contexto de captura DFe inválido');
  }
  const proof = Object.freeze({ versao: 1, origem: 'DFE_DISTRIBUICAO', clientId,
    cnpj: digits(cnpj), ambiente, nsu: String(nsu), chave, hash: hash(xml) });
  capturas.add(proof);
  return proof;
}

export function validarProvenienciaDfe(proof, { clientId, cnpj, chave, xml }) {
  return Boolean(proof && proof.versao === 1 && proof.origem === 'DFE_DISTRIBUICAO'
    && clientId && proof.clientId === clientId && digits(cnpj).length === 14 && proof.cnpj === digits(cnpj)
    && proof.ambiente === ambienteDfeConfigurado() && /^\d{1,15}$/.test(proof.nsu || '')
    && proof.chave === chave && xml && proof.hash === hash(xml));
}

export function provaDaCapturaDfe(captura, context) {
  if (!captura) return null;
  if (!capturas.has(captura) || !validarProvenienciaDfe(captura, context)) {
    throw Object.assign(Error('Proveniência DFe inválida'), { code: 'PROVENIENCIA_DFE_INVALIDA' });
  }
  return { ...captura };
}
