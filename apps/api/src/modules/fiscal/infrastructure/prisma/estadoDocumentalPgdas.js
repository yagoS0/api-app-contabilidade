import { createHash } from 'node:crypto';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { whereDasSalvo } from '../../../../application/fiscal/serpro/pgdasDocumentos.js';

export function criarLeituraEstadoDocumentalPgdas(db) {
  return async ({ portalClientId, competencia }) => {
    const [company, circular, snapshot, guide, entregaExterna] = await Promise.all([
      db.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true, cnpj: true } }),
      db.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } }),
      db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia } } }),
      db.guide.findFirst({ where: whereDasSalvo(portalClientId, competencia), orderBy: { updatedAt: 'desc' } }),
      db.entregaObrigacaoArquivo.findFirst({ where: { portalClientId, competencia, tipo: 'PGDAS_D' } }),
    ]);
    if (!company) throw Object.assign(new Error('Empresa não encontrada.'), { code: 'PORTAL_COMPANY_NOT_FOUND', status: 404 });
    const registros = await db.appSetting.findMany({ where: { key: { startsWith: prefixoIndice(portalClientId, competencia) } }, orderBy: [{ createdAt: 'desc' }, { key: 'desc' }], select: { value: true } });
    const prova = registros.map(r => r.value).find(v => v?.versao === 1 && v.portalClientId === portalClientId && v.competencia === competencia && v.cnpj === digits(company.cnpj) && v.servico === 'CONSDECLARACAO13' && v.numeroDeclaracao && v.atorId);
    // Uma leitura documental mais nova não deve ser substituída por índice antigo.
    const supersedida = prova && circular?.serproSyncStatus === 'SUCCESS' && circular?.pgdasDeclaracaoFileId && circular?.pgdasReciboFileId && circular?.pgdasNumeroDeclaracao && circular.pgdasNumeroDeclaracao !== prova.numeroDeclaracao && new Date(circular.serproLastSyncAt).getTime() > new Date(prova.consultadoEm).getTime();
    const consulta = prova && !supersedida ? { ...prova, confirmada: true } : null;
    return { company, circular, snapshot, guide, entregaExterna, consulta };
  };
}

export const lerEstadoDocumentalPgdas = criarLeituraEstadoDocumentalPgdas(prisma);

const digits = value => String(value || '').replace(/\D/g, '');
const prefixoIndice = (portalClientId, competencia) => `pgdas_indice_documental:${encodeURIComponent(portalClientId)}:${competencia}:`;

// Evidência do índice separada do histórico de PDFs: não representa cálculo nem envio Altan.
// Sem resposta bruta, credenciais ou bytes. Repetição mantém o primeiro ator e instante.
export function criarRegistroIndiceDocumentalPgdas(db) {
  return async ({ portalClientId, competencia, cnpj, numeroDeclaracao, atorId }) => {
    const company = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true, cnpj: true } });
    const normalizado = digits(cnpj);
    if (!atorId || !company || digits(company.cnpj) !== normalizado || !/^\d{14}$/.test(normalizado) || !numeroDeclaracao || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw Object.assign(new Error('A identidade da consulta documental mudou.'), { code: 'PGDAS_IDENTIDADE_DIVERGENTE', status: 409 });
    const identidade = { portalClientId, competencia, cnpj: normalizado, numeroDeclaracao: String(numeroDeclaracao) };
    const key = prefixoIndice(portalClientId, competencia) + createHash('sha256').update(JSON.stringify(identidade)).digest('hex');
    const value = { ...identidade, versao: 1, servico: 'CONSDECLARACAO13', atorId: String(atorId), consultadoEm: new Date().toISOString() };
    // PostgreSQL INSERT ON CONFLICT DO NOTHING: não há janela read/create do
    // upsert emulado nem captura de P2002 dentro de uma transação abortada.
    await db.appSetting.createMany({ data: [{ key, value }], skipDuplicates: true });
    const registro = await db.appSetting.findUnique({ where: { key } });
    return registro.value;
  };
}
export const registrarIndiceDocumentalPgdas = criarRegistroIndiceDocumentalPgdas(prisma);
