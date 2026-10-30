import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.DATABASE_URL !== url || parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável do controlador obrigatório');
}
(url ? describe : describe.skip)('S2A migration aditiva e evidências append-only', () => {
  test('preserva S1, permite par de vínculos e recusa todas as reescritas e exclusões', async () => {
    const db = new PrismaClient({ datasources: { db: { url } } });
    const schema = `s2a_${randomUUID().replaceAll('-', '')}`;
    const root = path.resolve(__dirname, '../../../../prisma/migrations');
    const s1 = fs.readFileSync(path.join(root, '20261025180000_solicitacoes_base/migration.sql'), 'utf8');
    const s2 = fs.readFileSync(path.join(root, '20261025200000_solicitacoes_s2a_origens/migration.sql'), 'utf8').replace(/^BEGIN;|^COMMIT;/gm, '');
    const rollback = new Error('ROLLBACK_SCHEMA_S2A');
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(`DO $fixture$ BEGIN
          CREATE TABLE "PortalClient" (id TEXT PRIMARY KEY);
          CREATE TABLE company_notes (id TEXT PRIMARY KEY);
          CREATE TABLE mensagens_whatsapp (id TEXT PRIMARY KEY);
          CREATE TABLE conversas_whatsapp (id TEXT PRIMARY KEY, "portalClientId" TEXT);
          CREATE TABLE encaminhamentos_suporte (id TEXT PRIMARY KEY, "conversaId" TEXT NOT NULL, "mensagemId" TEXT NOT NULL UNIQUE,
            estado TEXT NOT NULL DEFAULT 'AGUARDANDO', motivo TEXT NOT NULL, resumo TEXT NOT NULL, "responsavelId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "resolvidoEm" TIMESTAMP(3),
            CONSTRAINT encaminhamento_estado CHECK (estado IN ('AGUARDANDO','EM_ATENDIMENTO','RESOLVIDO')));
          CREATE UNIQUE INDEX encaminhamento_ativo_conversa ON encaminhamentos_suporte("conversaId") WHERE estado <> 'RESOLVIDO';
          INSERT INTO mensagens_whatsapp VALUES ('m');
        END $fixture$;`);
        await tx.$executeRawUnsafe(`DO $s1$ BEGIN ${s1} END $s1$;`);
        await tx.$executeRawUnsafe(`DO $seed$ BEGIN
          INSERT INTO encaminhamentos_suporte (id,motivo,resumo,"updatedAt","contratoVersao") VALUES ('s1','original','original',CURRENT_TIMESTAMP,1),('s2','outro','outro',CURRENT_TIMESTAMP,1);
          INSERT INTO solicitacoes_eventos (id,"solicitacaoId",revisao,tipo,"atorId",depois) VALUES ('e','s1',1,'CRIADA','humano','{}');
          INSERT INTO solicitacoes_comandos (id,"atorId",chave,fingerprint,"solicitacaoId",resultado) VALUES ('c','humano','k','hash','s1','{}');
          INSERT INTO solicitacoes_mensagens ("mensagemId","solicitacaoId","atorId") VALUES ('m','s1','humano');
        END $seed$;`);
        const before = {};
        for (const table of ['solicitacoes_eventos', 'solicitacoes_comandos', 'solicitacoes_mensagens']) before[table] = await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS registro FROM ${table} t`);
        await tx.$executeRawUnsafe(`DO $s2$ BEGIN ${s2} END $s2$;`);
        for (const table of Object.keys(before)) {
          const after = await tx.$queryRawUnsafe(`SELECT to_jsonb(t) - 'sistemaId' AS registro FROM ${table} t`);
          expect(after).toEqual(before[table]);
          for (const statement of [`UPDATE ${table} SET "atorId"='forjado'`, `DELETE FROM ${table}`]) {
            // Catch only the actual trigger message, preserving the outer transaction.
            await tx.$executeRawUnsafe(`DO $guard$ BEGIN
              BEGIN ${statement}; RAISE EXCEPTION 'GUARDA_AUSENTE';
              EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'solicitacoes_evidencia_imutavel' THEN RAISE; END IF; END;
            END $guard$;`);
          }
          expect(await tx.$queryRawUnsafe(`SELECT to_jsonb(t) - 'sistemaId' AS registro FROM ${table} t`)).toEqual(before[table]);
        }
        await tx.$executeRawUnsafe(`INSERT INTO solicitacoes_mensagens ("mensagemId","solicitacaoId","sistemaId") VALUES ('m','s2','WHATSAPP_SUPORTE')`);
        expect(await tx.$queryRawUnsafe('SELECT count(*)::int AS quantidade FROM solicitacoes_mensagens')).toEqual([{ quantidade: 2 }]);
        await tx.$executeRawUnsafe(`DO $auth$ BEGIN
          BEGIN INSERT INTO solicitacoes_mensagens ("mensagemId","solicitacaoId") VALUES ('m','s2'); RAISE EXCEPTION 'AUTORIA_AUSENTE_ACEITA'; EXCEPTION WHEN check_violation THEN NULL; END;
          BEGIN INSERT INTO solicitacoes_comandos (id,"atorId","sistemaId",chave,fingerprint,"solicitacaoId",resultado) VALUES ('invalido','humano','sistema','k','h','s1','{}'); RAISE EXCEPTION 'AUTORIA_DUPLA_ACEITA'; EXCEPTION WHEN check_violation THEN NULL; END;
        END $auth$;`);
        throw rollback;
      }, { timeout: 30000 })).rejects.toBe(rollback);
      expect(await db.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`).toEqual([]);
    } finally { await db.$disconnect(); }
  }, 40000);
});
