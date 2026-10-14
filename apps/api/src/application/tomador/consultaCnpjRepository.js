import { createHash, randomUUID } from 'node:crypto';

export const chaveCacheCnpj = (escopo, cnpj, modalidade) => createHash('sha256')
  .update(JSON.stringify([escopo, cnpj, modalidade, 1])).digest('hex');

// SQL parametrizado evita depender da regeneração do Prisma compartilhado durante deploy.
export function criarRepositorioConsultaCnpj({ db, cifrar, decifrar, orcamentoId = 'ALTAN', agora = () => new Date() }) {
  return {
    precosPersistidos: true,
    async adquirir({ escopo, cnpj, modalidade }) {
      const chave = chaveCacheCnpj(escopo, cnpj, modalidade), instante = agora();
      const rows = await db.$queryRaw`SELECT * FROM "ConsultaCnpjCache" WHERE "chave" = ${chave}`;
      const row = rows[0];
      if (row?.conteudo && row.expiraEm > instante) {
        const resultado = JSON.parse(await decifrar(row.conteudo));
        return { cache: true, resultado };
      }
      const lease = randomUUID(), ate = new Date(instante.getTime() + 30000);
      const locks = await db.$queryRaw`INSERT INTO "ConsultaCnpjCache" ("chave","escopo","cnpj","modalidade","lease","leaseAte")
        VALUES (${chave},${escopo},${cnpj},${modalidade},${lease},${ate})
        ON CONFLICT ("chave") DO UPDATE SET "lease" = EXCLUDED."lease", "leaseAte" = EXCLUDED."leaseAte"
        WHERE ("ConsultaCnpjCache"."leaseAte" IS NULL OR "ConsultaCnpjCache"."leaseAte" <= ${instante})
          AND ("ConsultaCnpjCache"."expiraEm" IS NULL OR "ConsultaCnpjCache"."expiraEm" <= ${instante})
        RETURNING "chave"`;
      return locks.length ? { chave, lease } : { ocupado: true };
    },
    async salvar({ chave, lease }, resultado, ttlMs) {
      const conteudo = await cifrar(JSON.stringify(resultado));
      const instante = agora(), expira = new Date(instante.getTime() + ttlMs);
      return db.$executeRaw`UPDATE "ConsultaCnpjCache" SET "conteudo"=${conteudo}, "expiraEm"=${expira},
        "lease"=NULL,"leaseAte"=NULL,"atualizadoEm"=${instante} WHERE "chave"=${chave} AND "lease"=${lease}`;
    },
    async liberar({ chave, lease }) {
      await db.$executeRaw`UPDATE "ConsultaCnpjCache" SET "lease"=NULL,"leaseAte"=NULL WHERE "chave"=${chave} AND "lease"=${lease}`;
    },
    async reservar({ escritorioId: escopo, cnpj, modalidade, requestKey }) {
      if (!escopo || !requestKey || !['BASICA','QSA','EMPRESA'].includes(modalidade)) return { autorizada: false };
      return db.$transaction(async tx => {
        // Mesmo lock financeiro para todas as empresas, modalidades e instâncias da API.
        await tx.$queryRaw`SELECT "id" FROM "ConsultaCnpjOrcamento" WHERE "id"=${orcamentoId} FOR UPDATE`;
        const [cfg] = await tx.$queryRaw`SELECT * FROM "ConsultaCnpjOrcamento" WHERE "id"=${orcamentoId}`;
        const instante = agora();
        if (!cfg?.habilitado || !cfg.precosAte || cfg.precosAte <= instante) return { autorizada: false };
        const custo = cfg[{ BASICA: 'basicaMicros', EMPRESA: 'empresaMicros', QSA: 'qsaMicros' }[modalidade]];
        if (!custo || custo <= 0n) return { autorizada: false };
        const anteriores = await tx.$queryRaw`SELECT "id" FROM "ConsultaCnpjReserva" WHERE "orcamentoId"=${orcamentoId}
          AND ("requestKey"=${requestKey} OR ("escopo"=${escopo} AND "cnpj"=${cnpj} AND "modalidade"=${modalidade}
          AND ("status" IN ('RESERVADA','INCERTA') OR "criadaEm">${new Date(instante.getTime()-60000)}))) LIMIT 1`;
        if (anteriores.length) return { autorizada: false };
        const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(instante);
        const mes = `${partes.find(p=>p.type==='year').value}-${partes.find(p=>p.type==='month').value}`;
        const [uso] = await tx.$queryRaw`SELECT COALESCE(SUM("custoMicros"),0)::bigint AS total FROM "ConsultaCnpjReserva" WHERE "orcamentoId"=${orcamentoId} AND "mes"=${mes}`;
        if (BigInt(uso.total) + BigInt(custo) > BigInt(cfg.limiteMicros)) return { autorizada: false };
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO "ConsultaCnpjReserva" ("id","orcamentoId","requestKey","escopo","cnpj","modalidade","mes","custoMicros","criadaEm")
          VALUES (${id},${orcamentoId},${requestKey},${escopo},${cnpj},${modalidade},${mes},${custo},${instante})`;
        return { id, autorizada: true };
      });
    },
    async concluir({ id, status }) {
      if (!['CONCLUIDA','INCERTA'].includes(status)) throw new Error('status_invalido');
      await db.$executeRaw`UPDATE "ConsultaCnpjReserva" SET "status"=${status},"concluidaEm"=${agora()}
        WHERE "id"=${id} AND "orcamentoId"=${orcamentoId} AND "status"='RESERVADA'`;
    },
    async consumo() {
      const rows = await db.$queryRaw`SELECT "mes","modalidade","status",COUNT(*)::int AS quantidade,SUM("custoMicros")::text AS "custoMicros"
        FROM "ConsultaCnpjReserva" WHERE "orcamentoId"=${orcamentoId} GROUP BY "mes","modalidade","status" ORDER BY "mes" DESC`;
      return rows;
    },
  };
}
