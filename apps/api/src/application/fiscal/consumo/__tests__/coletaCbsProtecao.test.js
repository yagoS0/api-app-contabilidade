import { randomBytes } from 'node:crypto';
import { criarProtecaoCbs, criarProtecaoCbsComRotacao } from '../CbsProtecao.js';
import { validarEnvelopeArquivoCbs, listarColetasCbs, abrirColetaCbs } from '../ColetaCbsService.js';

const contexto = { contribuinteId: 'grupo', ambiente: 'HOMOLOGACAO', coletaId: 'coleta', finalidade: 'arquivo' };
const identidade = { cnpjBase: '12345678', ticket: 'ticket', recurso: 'DEBITOS' };
const documento = () => ({ ni: '12345678', tiqueteSolicitacao: 'ticket', geradoEm: '2026-10-11T10:00:00Z', apuracao: [{ pa: '10/2026', debitos: [] }] });
const bytes = value => Buffer.from(JSON.stringify(value));

test('rotação lê evidência antiga imutável e cifra novas somente com chave ativa', () => {
  const antiga = randomBytes(32), nova = randomBytes(32), raw = Buffer.from('evidência preservada');
  const original = criarProtecaoCbs(antiga).cifrar(raw, contexto), copia = Buffer.from(original);
  const rotacao = criarProtecaoCbsComRotacao({ chaveAtiva: nova, chavesAnteriores: [antiga] });
  expect(rotacao.decifrar(original, contexto)).toEqual(raw); expect(original).toEqual(copia);
  const atual = rotacao.cifrar(raw, contexto);
  expect(criarProtecaoCbs(nova).decifrar(atual, contexto)).toEqual(raw);
  expect(() => criarProtecaoCbs(antiga).decifrar(atual, contexto)).toThrow('INTEGRIDADE');
  expect(() => rotacao.decifrar(original, { ...contexto, ambiente: 'PRODUCAO' })).toThrow('INTEGRIDADE');
  expect(() => criarProtecaoCbsComRotacao({ chaveAtiva: nova, chavesAnteriores: Array(9).fill(antiga) })).toThrow('CHAVE_INVALIDA');
});

test('AES-GCM preserva bytes exatos, usa nonce novo e não expõe texto', () => {
  const p = criarProtecaoCbs(randomBytes(32)), raw = Buffer.from('arquivo original\ncom espaços\x00');
  const a = p.cifrar(raw, contexto), b = p.cifrar(raw, contexto);
  expect(a.equals(b)).toBe(false);
  expect(a.length).toBe(raw.length + 29);
  expect(a.includes(raw)).toBe(false);
  expect(p.decifrar(a, contexto)).toEqual(raw);
});
test.each(Object.keys(contexto))('AAD impede troca de %s', campo => {
  const p = criarProtecaoCbs(randomBytes(32)), cifrado = p.cifrar(bytes(documento()), contexto);
  expect(() => p.decifrar(cifrado, { ...contexto, [campo]: 'outro' })).toThrow('CBS_PROTECAO_INTEGRIDADE_INVALIDA');
});
test('adulteração, chave errada e truncamento são recusados sem conteúdo no erro', () => {
  const p = criarProtecaoCbs(randomBytes(32)), cifrado = p.cifrar(bytes(documento()), contexto);
  const adulterado = Buffer.from(cifrado); adulterado[adulterado.length - 1] ^= 1;
  for (const b of [adulterado, cifrado.subarray(0, 20)]) expect(() => p.decifrar(b, contexto)).toThrow('CBS_PROTECAO_INTEGRIDADE_INVALIDA');
  expect(() => criarProtecaoCbs(randomBytes(32)).decifrar(cifrado, contexto)).toThrow('CBS_PROTECAO_INTEGRIDADE_INVALIDA');
});
test('proteção exige chave e escopo explícitos', () => {
  expect(() => criarProtecaoCbs(Buffer.alloc(16))).toThrow('CBS_PROTECAO_CHAVE_INVALIDA');
  expect(() => criarProtecaoCbs(Buffer.alloc(32)).cifrar(Buffer.from('x'), {})).toThrow('CBS_PROTECAO_ESCOPO_INVALIDO');
});
test('envelope aceita múltiplos PA e vazio sem inventar cobertura/valores', () => {
  const doc = documento(); doc.apuracao.push({ pa: '09/2026', debitos: [{ cbs: { apurado: 900 } }] });
  expect(() => validarEnvelopeArquivoCbs(bytes(doc), identidade)).not.toThrow();
  expect(() => validarEnvelopeArquivoCbs(bytes({ ...doc, apuracao: [] }), identidade)).not.toThrow();
});
test.each([
  { ni: '87654321' }, { tiqueteSolicitacao: 'outro' }, { geradoEm: 'invalido' },
  { apuracao: [{}] }, { apuracao: [{ pa: '13/2026', debitos: [] }] },
  { apuracao: [{ pa: '10/2026', creditos: [] }] }, { apuracao: {} },
])('envelope recusa identidade ou estrutura incompatível %j', patch => {
  expect(() => validarEnvelopeArquivoCbs(bytes({ ...documento(), ...patch }), identidade)).toThrow('O arquivo não corresponde');
});
test('envelope recusa binário/UTF8 inválido e não copia conteúdo na mensagem', () => {
  expect(() => validarEnvelopeArquivoCbs(Buffer.from([255, 254, 0]), identidade)).toThrow('O arquivo não corresponde');
});
test('contrato não aceita competência, cursor ou data mesmo sem banco', async () => {
  for (const campo of ['competencia', 'cursor', 'inicio']) {
    await expect(listarColetasCbs({}, 'empresa', { ambiente: 'HOMOLOGACAO', [campo]: 'valor' }, {})).rejects.toMatchObject({ status: 400 });
  }
  await expect(abrirColetaCbs({}, 'empresa', { ambiente: 'PRODUCAO', id: 'invalido', recurso: 'DEBITOS' }, {})).rejects.toMatchObject({ status: 400 });
});
