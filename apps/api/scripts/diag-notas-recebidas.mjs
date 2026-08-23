// SÓ LEITURA — o que existe hoje de NOTA RECEBIDA, para a aba "Notas recebidas".
//
// Pedido do dono: "todas as notas recebidas, sejam elas de venda ou de serviço, devem ficar em uma
// mesma aba (...) para que saibamos o total de notas recebidas."
//
// Antes de construir, medir. Nenhum INSERT/UPDATE/DDL, nenhuma chamada externa (ADN/SEFAZ).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const q = (sql) => prisma.$queryRawUnsafe(sql);
const n = (v) => Number(v ?? 0);

console.log("=== 1) NOTAS POR type × papel ===");
for (const l of await q(`
  SELECT COALESCE("type",'(null)') AS type, COALESCE("papel",'(sem papel)') AS papel,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE "xmlRaw" IS NOT NULL) AS com_xml,
         COUNT(*) FILTER (WHERE "competencia" IS NULL) AS sem_competencia,
         COUNT(*) FILTER (WHERE "statusEfetivo" = 'cancelada') AS canceladas
  FROM "PortalInvoice" GROUP BY 1,2 ORDER BY 3 DESC
`)) {
  console.log(
    `${String(l.type).padEnd(6)} ${String(l.papel).padEnd(12)} total ${String(n(l.total)).padStart(6)}` +
    ` | com XML ${String(n(l.com_xml)).padStart(6)}` +
    ` | SEM competencia ${String(n(l.sem_competencia)).padStart(6)}` +
    ` | canceladas ${String(n(l.canceladas)).padStart(5)}`,
  );
}

console.log("\n=== 2) RECEBIDAS (papel=DEST) por empresa × type — e a inscrição estadual ===");
for (const l of await q(`
  SELECT c."id", COALESCE(lc."razaoSocial", c."cnpj") AS empresa,
         COALESCE(NULLIF(TRIM(lc."inscricaoEstadual"), ''), '(SEM IE)') AS ie,
         COUNT(*) FILTER (WHERE i."type" = 'NFE')  AS nfe,
         COUNT(*) FILTER (WHERE i."type" = 'NFSE') AS nfse,
         COUNT(*) AS total
  FROM "PortalInvoice" i
  JOIN "PortalClient" c ON c."id" = i."clientId"
  LEFT JOIN "Company" lc ON lc."id" = c."companyId"
  WHERE i."papel" = 'DEST'
  GROUP BY 1,2,3 ORDER BY 6 DESC LIMIT 25
`)) {
  console.log(
    `${String(l.empresa).slice(0, 34).padEnd(34)} IE ${String(l.ie).slice(0, 16).padEnd(16)}` +
    ` | NF-e ${String(n(l.nfe)).padStart(4)} | NFS-e ${String(n(l.nfse)).padStart(5)} | total ${String(n(l.total)).padStart(5)}`,
  );
}

console.log("\n=== 3) As empresas que TÊM NF-e (qualquer papel) têm inscrição estadual? ===");
for (const l of await q(`
  SELECT COALESCE(lc."razaoSocial", c."cnpj") AS empresa,
         COALESCE(NULLIF(TRIM(lc."inscricaoEstadual"), ''), '(SEM IE)') AS ie,
         COUNT(*) AS nfe,
         COUNT(*) FILTER (WHERE i."papel" = 'DEST') AS nfe_dest,
         COUNT(*) FILTER (WHERE i."xmlRaw" IS NOT NULL) AS nfe_com_xml
  FROM "PortalInvoice" i
  JOIN "PortalClient" c ON c."id" = i."clientId"
  LEFT JOIN "Company" lc ON lc."id" = c."companyId"
  WHERE i."type" = 'NFE'
  GROUP BY 1,2 ORDER BY 3 DESC
`)) {
  console.log(
    `${String(l.empresa).slice(0, 40).padEnd(40)} IE ${String(l.ie).slice(0, 16).padEnd(16)}` +
    ` | NF-e ${String(n(l.nfe)).padStart(4)} | DEST ${String(n(l.nfe_dest)).padStart(4)} | com XML ${String(n(l.nfe_com_xml)).padStart(4)}`,
  );
}

console.log("\n=== 4) RECEBIDAS por competência (as 15 mais recentes) — a aba filtra por competência ===");
for (const l of await q(`
  SELECT TO_CHAR("competencia", 'YYYY-MM') AS comp,
         COUNT(*) FILTER (WHERE "type" = 'NFE')  AS nfe,
         COUNT(*) FILTER (WHERE "type" = 'NFSE') AS nfse,
         COUNT(*) AS total
  FROM "PortalInvoice" WHERE "papel" = 'DEST'
  GROUP BY 1 ORDER BY 1 DESC NULLS FIRST LIMIT 15
`)) {
  console.log(`${String(l.comp ?? "(SEM COMPETENCIA)").padEnd(20)} NF-e ${String(n(l.nfe)).padStart(4)} | NFS-e ${String(n(l.nfse)).padStart(5)} | total ${String(n(l.total)).padStart(5)}`);
}

console.log("\n=== 5) Empresa×competência com AS DUAS espécies recebidas (a aba nova junta as duas) ===");
const mistas = await q(`
  SELECT COUNT(*) AS celulas FROM (
    SELECT "clientId", TO_CHAR("competencia",'YYYY-MM') AS comp
    FROM "PortalInvoice" WHERE "papel" = 'DEST' AND "competencia" IS NOT NULL
    GROUP BY 1,2 HAVING COUNT(*) FILTER (WHERE "type"='NFE') > 0 AND COUNT(*) FILTER (WHERE "type"='NFSE') > 0
  ) t
`);
console.log(`células empresa×competência com NF-e E NFS-e recebidas: ${n(mistas[0]?.celulas)}`);

console.log("\n=== 6) NF-e DEST: o que temos para mostrar por linha ===");
const campos = await q(`
  SELECT COUNT(*) AS total,
         COUNT("emitenteNome") AS com_emitente, COUNT("total") AS com_valor,
         COUNT("issueDate") AS com_data, COUNT("chaveAcesso") AS com_chave,
         COUNT("xmlRaw") AS com_xml, COUNT("pdfUrl") AS com_pdf
  FROM "PortalInvoice" WHERE "type" = 'NFE' AND "papel" = 'DEST'
`);
console.log(campos[0]);

const itens = await q(`
  SELECT COUNT(DISTINCT i."notaId") AS notas_com_item FROM "NotaItem" i
  JOIN "PortalInvoice" p ON p."id" = i."notaId" WHERE p."type" = 'NFE'
`);
console.log(`NF-e com ao menos 1 item (NCM/CFOP): ${n(itens[0]?.notas_com_item)}`);

await prisma.$disconnect();
