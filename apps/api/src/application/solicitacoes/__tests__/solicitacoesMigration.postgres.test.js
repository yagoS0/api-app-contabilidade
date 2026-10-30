import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const url = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.DATABASE_URL !== url || parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável do controlador obrigatório');
}
const suite = url ? describe : describe.skip;
suite('migration S1 — dados legados, aplicação isolada e rollback', () => {
  test('SQL aditivo preserva todos os campos anteriores e só deriva empresa da conversa', async () => {
    const db = new PrismaClient({ datasources: { db: { url } } });
    const schema = `s1_migration_${randomUUID().replaceAll('-', '')}`;
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../../prisma/migrations/20261025180000_solicitacoes_base/migration.sql'), 'utf8');
    const rollback = new Error('ROLLBACK_S1_SCHEMA');
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        // Minimal pre-S1 physical tables, with the actual legacy nullability/unique
        // contract. No production connection and no mutation of the public schema.
        await tx.$executeRawUnsafe(`DO $fixture$ BEGIN
          CREATE TABLE "PortalClient" (id TEXT PRIMARY KEY);
          CREATE TABLE company_notes (id TEXT PRIMARY KEY);
          CREATE TABLE mensagens_whatsapp (id TEXT PRIMARY KEY);
          CREATE TABLE conversas_whatsapp (id TEXT PRIMARY KEY, "portalClientId" TEXT);
          CREATE TABLE encaminhamentos_suporte (
            id TEXT PRIMARY KEY, "conversaId" TEXT NOT NULL, "mensagemId" TEXT NOT NULL UNIQUE,
            estado TEXT NOT NULL DEFAULT 'AGUARDANDO', motivo TEXT NOT NULL, resumo TEXT NOT NULL,
            "responsavelId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL, "resolvidoEm" TIMESTAMP(3),
            CONSTRAINT encaminhamento_estado CHECK (estado IN ('AGUARDANDO','EM_ATENDIMENTO','RESOLVIDO'))
          );
          CREATE UNIQUE INDEX encaminhamento_ativo_conversa ON encaminhamentos_suporte("conversaId") WHERE estado <> 'RESOLVIDO';
          INSERT INTO "PortalClient" VALUES ('pc-comprovada');
          INSERT INTO conversas_whatsapp VALUES ('conversa-com-empresa', 'pc-comprovada'), ('triagem', NULL);
          INSERT INTO encaminhamentos_suporte VALUES
            ('resolvido', 'conversa-com-empresa', 'mensagem-original-a', 'RESOLVIDO', 'Motivo original', 'Resumo original', 'autor-legado', '2025-01-02', '2025-01-03', '2025-01-03'),
            ('aberto', 'triagem', 'mensagem-original-b', 'EM_ATENDIMENTO', 'Sem empresa', 'Sem vínculo comprovado', NULL, '2025-02-02', '2025-02-03', NULL);
        END $fixture$;`);
        // Explicit legacy columns preserve every old-field assertion without
        // reusing a prepared SELECT * whose result type changes after ALTER.
        const before = await tx.$queryRawUnsafe('SELECT id, "conversaId", "mensagemId", estado, motivo, resumo, "responsavelId", "createdAt", "updatedAt", "resolvidoEm" FROM encaminhamentos_suporte ORDER BY id');
        // DO provides one statement to Prisma while retaining dollar-quoted DDL.
        await tx.$executeRawUnsafe(`DO $migration$ BEGIN ${sql} END $migration$;`);
        const after = await tx.$queryRawUnsafe('SELECT * FROM encaminhamentos_suporte ORDER BY id');
        for (let i = 0; i < before.length; i++) {
          for (const key of Object.keys(before[i])) expect(after[i][key]).toEqual(before[i][key]);
          expect(after[i]).toMatchObject({ contratoVersao: null, revisao: 0, criadorId: null, concluidoPorId: null, concluidoEm: null, prioridade: null, prazoCivil: null });
        }
        expect(after.find(r => r.id === 'resolvido').portalClientId).toBe('pc-comprovada');
        expect(after.find(r => r.id === 'aberto').portalClientId).toBeNull();
        await tx.$executeRawUnsafe(`DO $checks$ BEGIN
          BEGIN
            INSERT INTO encaminhamentos_suporte (id, "conversaId", "mensagemId", motivo, resumo, "updatedAt")
              VALUES ('legado-duplicado', 'triagem', 'repetida', 'x', 'x', CURRENT_TIMESTAMP);
            RAISE EXCEPTION 'validacao_legada_perdida';
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
          BEGIN
            INSERT INTO encaminhamentos_suporte (id, "conversaId", "mensagemId", motivo, resumo, estado, "updatedAt")
              VALUES ('legado-estado-invalido', 'conversa-com-empresa', 'legado-nao-permitido', 'x', 'x', 'AGUARDANDO_CLIENTE', CURRENT_TIMESTAMP);
            RAISE EXCEPTION 'estado_legado_sem_validacao';
          EXCEPTION WHEN check_violation THEN NULL;
          END;
          BEGIN
            INSERT INTO encaminhamentos_suporte (id, motivo, resumo, "updatedAt")
              VALUES ('legado-sem-origem', 'x', 'x', CURRENT_TIMESTAMP);
            RAISE EXCEPTION 'origem_legada_sem_validacao';
          EXCEPTION WHEN check_violation THEN NULL;
          END;
          INSERT INTO encaminhamentos_suporte (id, "conversaId", "mensagemId", motivo, resumo, "contratoVersao", estado, "updatedAt") VALUES
            ('assunto-1', 'triagem', 'nova-1', 'x', 'x', 1, 'AGUARDANDO_CLIENTE', CURRENT_TIMESTAMP),
            ('assunto-2', 'triagem', 'nova-2', 'x', 'x', 1, 'AGUARDANDO', CURRENT_TIMESTAMP);
        END $checks$;`);
        await tx.$executeRawUnsafe(`INSERT INTO encaminhamentos_suporte (id, motivo, resumo, "contratoVersao", "updatedAt") VALUES ('manual', 'Manual', 'Sem conversa/mensagem', 1, CURRENT_TIMESTAMP)`);
        expect((await tx.$queryRawUnsafe(`SELECT "conversaId", "mensagemId" FROM encaminhamentos_suporte WHERE id = 'manual'`))[0]).toEqual({ conversaId: null, mensagemId: null });
        expect((await tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM solicitacoes_eventos'))[0].total).toBe(0);
        expect((await tx.$queryRawUnsafe('SELECT count(*)::int AS total FROM solicitacoes_mensagens'))[0].total).toBe(0);
        // Migration does not invent original-message evidence when old IDs are no
        // longer present. New links have their own FK and preserve the original.
        const constraints = await tx.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE connamespace = '${schema}'::regnamespace`);
        expect(constraints.map(c => c.conname)).toContain('solicitacoes_mensagens_mensagemId_fkey');
        throw rollback;
      }, { timeout: 30000 })).rejects.toBe(rollback);
      expect(await db.$queryRawUnsafe(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schema}'`)).toEqual([]);
      const applied = await db.$queryRaw`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = '20261025180000_solicitacoes_base' AND rolled_back_at IS NULL`;
      expect(applied).toHaveLength(1);
      expect(applied[0].finished_at).not.toBeNull();
      // Re-run the real migration mechanism only against the controller's
      // validated disposable database. Applied SQL must not run/backfill again.
      const snapshot = () => db.$queryRaw`SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '' ORDER BY id), '')) AS digest FROM encaminhamentos_suporte s`;
      const persisted = await snapshot();
      const history = await db.$queryRaw`SELECT * FROM "_prisma_migrations" WHERE migration_name = '20261025180000_solicitacoes_base' ORDER BY id`;
      const result = await promisify(execFile)(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy',
        '--schema', path.resolve(__dirname, '../../../../prisma/schema.prisma')], {
        cwd: path.resolve(__dirname, '../../../..'),
        env: { ...process.env, DATABASE_URL: url, ALTAN_GOVERNANCE_TEST_DATABASE_URL: url },
        timeout: 30000, windowsHide: true,
      });
      expect(result.stdout).toContain('No pending migrations to apply');
      expect(await snapshot()).toEqual(persisted);
      expect(await db.$queryRaw`SELECT * FROM "_prisma_migrations" WHERE migration_name = '20261025180000_solicitacoes_base' ORDER BY id`).toEqual(history);
    } finally { await db.$disconnect(); }
  }, 70000);
});
