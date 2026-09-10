// Executar apenas contra o cluster descartável local: node scripts/verify-whatsapp-summary-postgres.js
// --url postgresql://whatsapp_check@127.0.0.1:55439/whatsapp_check
// Não carrega .env. Todas as tabelas são temporárias e desaparecem ao terminar a transação.
import assert from "node:assert/strict";
import { Prisma, PrismaClient } from "@prisma/client";
import { resumoWhatsapp } from "../src/application/whatsapp/resumoWhatsapp.js";

const arg = process.argv.indexOf("--url");
const url = new URL(arg >= 0 ? process.argv[arg + 1] : "invalid:");
if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
  || url.port !== "55439" || url.pathname !== "/whatsapp_check") {
  throw new Error("Use somente o banco descartável whatsapp_check em 127.0.0.1:55439 via --url.");
}
const client = new PrismaClient({ datasources: { db: { url: url.href } } });
let verificacoes = 0;
try {
  const [server] = await client.$queryRaw`SELECT version() AS version, host(inet_server_addr()) AS host, inet_server_port() AS port`;
  assert.equal(server.host, "127.0.0.1");
  assert.equal(server.port, 55439);
  console.log(server.version);
  await client.$transaction(async (tx) => {
    // Nomes e tipos usados pela consulta são os do schema Prisma; demais campos não participam dela.
    await tx.$executeRaw`CREATE TEMP TABLE conversas_whatsapp (id TEXT PRIMARY KEY, "portalClientId" TEXT, "lidaAteEm" TIMESTAMP(3), "chaveEscopo" TEXT) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE mensagens_whatsapp (id TEXT PRIMARY KEY, "conversaId" TEXT REFERENCES conversas_whatsapp(id), direcao TEXT NOT NULL CHECK (direcao IN ('in', 'out')), "registradaEm" TIMESTAMP(3) NOT NULL) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE INDEX ON conversas_whatsapp ("portalClientId")`;
    await tx.$executeRaw`CREATE INDEX ON mensagens_whatsapp ("conversaId", direcao, "registradaEm")`;
    const check = async (name, carteira, expected) => {
      assert.deepEqual(await resumoWhatsapp(carteira, { client: tx }), expected, name);
      verificacoes += 1;
      console.log(`OK ${verificacoes}: ${name}`);
    };
    const r = (conversas, naoVinculadas, conversasNaoLidas, mensagensNaoLidas) => ({ conversas, naoVinculadas, conversasNaoLidas, mensagensNaoLidas });
    const cutoff = new Date("2026-09-06T12:00:00.000Z");
    const before = new Date("2026-09-06T11:59:59.999Z");
    const after = new Date("2026-09-06T12:00:00.001Z");
    const conversa = (id, empresa, leitura = null, escopo = empresa ? `empresa:${empresa}:${id}` : `sem-empresa:${id}`) => tx.$executeRaw`INSERT INTO conversas_whatsapp VALUES (${id}, ${empresa}, ${leitura}, ${escopo})`;
    const mensagem = (id, fio, direcao, instante = after) => tx.$executeRaw`INSERT INTO mensagens_whatsapp VALUES (${id}, ${fio}, ${direcao}, ${instante})`;
    await check("banco vazio retorna números zero", ["permitida"], r(0, 0, 0, 0));
    await conversa("sem-mensagens", "permitida");
    await conversa("somente-saida", "permitida");
    await mensagem("saida", "somente-saida", "out");
    await check("sem mensagens e somente saída não são não lidas", ["permitida"], r(2, 0, 0, 0));
    await conversa("leitura-nula", "permitida");
    await mensagem("nula-antes", "leitura-nula", "in", before);
    await mensagem("nula-depois", "leitura-nula", "in");
    await mensagem("nula-saida", "leitura-nula", "out");
    await check("leitura nula conta todas e somente entradas", ["permitida"], r(3, 0, 1, 2));
    await conversa("leitura-marcada", "permitida", cutoff);
    await mensagem("marcada-antes", "leitura-marcada", "in", before);
    await mensagem("marcada-igual", "leitura-marcada", "in", cutoff);
    await mensagem("marcada-depois", "leitura-marcada", "in");
    await mensagem("marcada-saida", "leitura-marcada", "out");
    await check("comparação estrita preserva precisão de milissegundo", ["permitida"], r(4, 0, 2, 3));
    await conversa("outro-tenant", "proibida");
    await mensagem("outro-tenant-entrada", "outro-tenant", "in");
    await check("carteira não inclui outro tenant", ["permitida"], r(4, 0, 2, 3));
    await conversa("fila", null);
    await mensagem("fila-entrada", "fila", "in");
    await check("fila não vinculada faz parte da leitura", ["permitida"], r(5, 1, 3, 4));
    await check("carteira vazia acessa apenas a fila", [], r(1, 1, 1, 1));
    await conversa("excluida", null, null, "empresa:removida:telefone");
    await mensagem("excluida-entrada", "excluida", "in");
    await conversa("legado-excluido", null, null, "legado:removida:id");
    await mensagem("legado-excluido-entrada", "legado-excluido", "in");
    await check("origem de empresa removida nunca vira fila global", [], r(1, 1, 1, 1));
    await tx.$executeRaw(Prisma.sql`INSERT INTO conversas_whatsapp (id, "portalClientId") VALUES ${Prisma.join(Array.from({ length: 250 }, (_, n) => Prisma.sql`(${`bulk-${n}`}, ${"permitida"})`))}`);
    await tx.$executeRaw(Prisma.sql`INSERT INTO mensagens_whatsapp VALUES ${Prisma.join(Array.from({ length: 250 }, (_, n) => Prisma.sql`(${`bulk-msg-${n}`}, ${`bulk-${n}`}, ${"in"}, ${after})`))}`);
    await check("255 conversas permitidas sem truncamento em 200", ["permitida"], r(255, 1, 253, 254));
    await check("duas empresas explicitamente autorizadas", ["permitida", "proibida"], r(256, 1, 254, 255));
    const malicioso = "x') OR TRUE; DROP TABLE conversas_whatsapp; --";
    await check("id malicioso não altera a consulta nem vaza outro tenant", [malicioso], r(1, 1, 1, 1));
    await conversa("empresa-id-literal", malicioso);
    await mensagem("literal-entrada", "empresa-id-literal", "in");
    await check("id com sintaxe SQL é tratado como valor literal", [malicioso], r(2, 1, 2, 2));
    await check("carteira original permanece intacta depois do id malicioso", ["permitida"], r(255, 1, 253, 254));
  }, { timeout: 30000 });
  console.log(`PASS: ${verificacoes} verificações em PostgreSQL real; tabelas temporárias removidas.`);
} finally {
  await client.$disconnect();
}
