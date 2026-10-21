import { createHash } from 'node:crypto';
import { apresentarDiagnostico } from './ApresentacaoDiagnosticoPdf.js';

export function hashApresentacao(ficha, diagnostico, fiscal = null) {
  const documento = apresentarDiagnostico({ ficha, diagnostico, fiscal });
  const valor = { fichaId: ficha.id, fichaVersao: ficha.versao, cadastroRevisao: ficha.dados?.cadastroRevisao || null, documento, diagnostico: diagnostico.dados };
  return createHash('sha256').update(JSON.stringify(valor, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)).digest('hex');
}

export function conferenciaPdfVigente(evento, ficha, diagnostico, fiscal = null) {
  return Boolean(evento?.dados?.origem === 'PDF_CONTADOR' && evento.atorId && evento.createdAt
    && diagnostico?.id === evento.dados.diagnosticoId && Number.isInteger(evento.dados.fichaVersao)
    && evento.dados.conteudoHash === hashApresentacao({ ...ficha, versao: evento.dados.fichaVersao }, diagnostico, fiscal));
}
