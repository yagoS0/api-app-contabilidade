import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function aad(escopo) {
  const campos = ['contribuinteId', 'ambiente', 'coletaId', 'finalidade'];
  if (campos.some(k => typeof escopo?.[k] !== 'string' || !escopo[k])) throw new Error('CBS_PROTECAO_ESCOPO_INVALIDO');
  return Buffer.from(JSON.stringify(campos.map(k => escopo[k])));
}

// Chave injetada de 32 bytes; este módulo não lê env nem habilita integração.
export function criarProtecaoCbs(chave) {
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('CBS_PROTECAO_CHAVE_INVALIDA');
  const key = Buffer.from(chave);
  return {
    cifrar(bytes, escopo) {
      if (!Buffer.isBuffer(bytes)) throw new Error('CBS_PROTECAO_CONTEUDO_INVALIDO');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(escopo));
      const payload = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), payload]);
    },
    decifrar(bytes, escopo) {
      try {
        const b = Buffer.from(bytes);
        if (b.length < 29 || b[0] !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(1, 13));
        decipher.setAAD(aad(escopo)); decipher.setAuthTag(b.subarray(13, 29));
        return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]);
      } catch { throw new Error('CBS_PROTECAO_INTEGRIDADE_INVALIDA'); }
    },
  };
}

// Rotação sem reescrever evidências imutáveis. Novas cifras usam somente a
// chave ativa; até oito chaves históricas explícitas permitem ler envelopes v1.
// O cofre e o ciclo de retenção continuam responsabilidade do runtime.
export function criarProtecaoCbsComRotacao({ chaveAtiva, chavesAnteriores = [] } = {}) {
  if (!Array.isArray(chavesAnteriores) || chavesAnteriores.length > 8) throw new Error('CBS_PROTECAO_CHAVE_INVALIDA');
  const ativa = criarProtecaoCbs(chaveAtiva);
  const leitoras = [ativa, ...chavesAnteriores.map(criarProtecaoCbs)];
  return Object.freeze({
    cifrar: (bytes, escopo) => ativa.cifrar(bytes, escopo),
    decifrar(bytes, escopo) {
      for (const leitora of leitoras) {
        try { return leitora.decifrar(bytes, escopo); } catch { /* outra chave histórica explícita */ }
      }
      throw new Error('CBS_PROTECAO_INTEGRIDADE_INVALIDA');
    },
  });
}
