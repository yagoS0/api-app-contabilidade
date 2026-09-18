// Observação somente leitura. Não muda flags, vínculo, atendimento, leitura ou automação.
import { prisma } from '../src/infrastructure/db/prisma.js';
import { projetarIdentidadeConversa } from '../src/application/whatsapp/IdentidadeComunicacaoService.js';
const resumo = { segmentos: 0, naoMigrados: 0, relacionamento: {}, identidade: {}, divergencias: [] };
try {
  let cursor;
  for (;;) {
    const lote = await prisma.conversaWhatsapp.findMany({ orderBy: { id: 'asc' }, take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, portalClientId: true, vinculoNumeroId: true } });
    if (!lote.length) break;
    for (const conversa of lote) {
      resumo.segmentos++;
      if (!conversa.vinculoNumeroId) { resumo.naoMigrados++; continue; }
      const p = await projetarIdentidadeConversa(conversa);
      resumo.relacionamento[p.relacionamento.tipo] = (resumo.relacionamento[p.relacionamento.tipo] || 0) + 1;
      resumo.identidade[p.identidade.estado] = (resumo.identidade[p.identidade.estado] || 0) + 1;
      if ((conversa.portalClientId && p.relacionamento.tipo !== 'CLIENTE') || p.identidade.estado === 'EM_REVISAO') {
        // IDs internos para conferência; nenhum nome, telefone, texto ou documento no relatório.
        resumo.divergencias.push({ conversaId: conversa.id, motivo: p.relacionamento.motivo, identidade: p.identidade.estado });
      }
    }
    cursor = lote.at(-1).id;
  }
  console.log(JSON.stringify(resumo, null, 2));
  if (resumo.naoMigrados || resumo.divergencias.length) process.exitCode = 2;
} catch (e) { console.error(e.code || 'AUDITORIA_FALHOU', e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
