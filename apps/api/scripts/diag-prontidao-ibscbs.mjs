// Inventário agregado: leitura local do banco, sem documentos, nomes ou credenciais na saída.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const relatorio = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return {
      emitidas: await tx.$queryRawUnsafe('SELECT status, COUNT(*)::int AS quantidade FROM "ServiceInvoice" GROUP BY status'),
      regimes: await tx.$queryRawUnsafe('SELECT "regimeTributario" AS regime, COUNT(*)::int AS quantidade FROM "Company" GROUP BY "regimeTributario"'),
      perfis: await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "ativo")::int AS ativos,
        COUNT(*) FILTER (WHERE "ativo" AND "codigoNbs" IS NOT NULL AND "ibscbsCst" IS NOT NULL AND "ibscbsCClassTrib" IS NOT NULL AND "ibscbsCIndOp" IS NOT NULL)::int AS preenchidos
        FROM "perfis_emissao_nfse"`),
      documentos: await tx.$queryRawUnsafe(`SELECT type, papel, COUNT(*)::int AS quantidade,
        COUNT(*) FILTER (WHERE "xmlRaw" IS NOT NULL)::int AS com_xml,
        COUNT(*) FILTER (WHERE "xmlRaw" LIKE '%IBSCBS%')::int AS com_grupo_ibscbs,
        COUNT(*) FILTER (WHERE "competenciaPosFechamento")::int AS posteriores_ao_fechamento
        FROM "PortalInvoice" GROUP BY type,papel`),
      migracoes: await tx.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10'),
    };
  });
  console.log(JSON.stringify({ consultadoEm:new Date().toISOString(),
    ambiente: process.env.NFSE_ENV ?? 'não informado',
    configuracaoDoProcesso: { perfis:process.env.INTEGRACAO_PERFIL_EMISSAO_NFSE === '1',ibscbs:process.env.INTEGRACAO_NFSE_IBSCBS === '1' },
    observacao:'As flags são deste processo. Execute no ambiente de destino para medir as flags publicadas. Presença do grupo não comprova conformidade.',
    ...relatorio },null,2));
} finally { await prisma.$disconnect(); }
