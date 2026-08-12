// DIAGNÓSTICO: alguma NFS-e já foi EMITIDA por este portal? E alguém consegue vê-la?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa — nem ADN, nem prefeitura.
//
// POR QUE ELE EXISTE
// A emissão (`POST /nfse/issue` → `NfseService.issue`) grava em **ServiceInvoice**, chaveada pela
// **Company legada**. A aba Notas Fiscais lê **PortalInvoice**, chaveada pelo **PortalClient**.
// São duas tabelas e dois ids diferentes: uma nota emitida por este caminho nunca apareceria na
// lista, mesmo que a emissão funcionasse. Este script responde três perguntas separadas:
//
//   1. existe linha em `ServiceInvoice`? (a emissão já foi exercida alguma vez?)
//   2. em que estado ela parou? (`pending` = registrada e nada mais; `rejected` = o provedor
//      recusou; `issued`/`autorizada` = nota de verdade)
//   3. essa mesma nota está em `PortalInvoice`? (ou seja: ela é VISÍVEL na aba?)
//
// ⚠ Ausência não é resposta pronta: zero linhas pode ser "ninguém nunca clicou em Emitir" OU
// "clicou e a rota devolveu 403/404 antes de gravar". Por isso o script também conta os
// PortalClient sem `companyId` — o vínculo que a rota de emissão precisa para resolver a empresa.
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres pwsh -NoProfile -Command
//     '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-emissao-nfse.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const num = (v) => Number(v || 0).toLocaleString("pt-BR");
const linha = (c = "─") => console.log(c.repeat(96));
const q = async (sql, ...p) => (await prisma.$queryRawUnsafe(sql, ...p).catch((e) => {
  console.log(`   ⚠ query falhou: ${String(e?.message || e).slice(0, 140)}`);
  return null;
})) ?? null;

linha("═");
console.log("EMISSÃO DE NFS-e — o caminho `ServiceInvoice` já foi exercido?");
linha("═");

// ── 1) A tabela existe e tem linha? ──────────────────────────────────────────────────────────
console.log("\n[1] ServiceInvoice — a tabela da EMISSÃO");
const total = await q(`SELECT count(*)::int AS n FROM "ServiceInvoice"`);
if (total === null) {
  console.log("   tabela ilegível — nada além disto pode ser afirmado.");
} else {
  console.log(`   linhas: ${num(total[0].n)}`);
}

const porStatus = await q(
  `SELECT status, count(*)::int AS n,
          min("createdAt") AS primeira, max("createdAt") AS ultima,
          count("chaveAcesso")::int AS com_chave,
          count("numeroNfse")::int AS com_numero
     FROM "ServiceInvoice" GROUP BY status ORDER BY n DESC`
);
if (porStatus?.length) {
  console.log("\n   por status:");
  for (const r of porStatus) {
    console.log(
      `     ${String(r.status).padEnd(24)} n=${String(r.n).padStart(5)}  ` +
      `chave=${r.com_chave} numero=${r.com_numero}  ` +
      `${r.primeira?.toISOString?.().slice(0, 10)} → ${r.ultima?.toISOString?.().slice(0, 10)}`
    );
  }
} else if (total?.[0]?.n === 0) {
  console.log("   nenhuma linha — a emissão NUNCA gravou nada nesta base.");
}

// ── 2) De quem são essas notas ───────────────────────────────────────────────────────────────
console.log("\n[2] Por empresa (Company legada) — e ela tem PortalClient?");
const porEmpresa = await q(
  `SELECT c.id AS company_id, c."razaoSocial", c.cnpj,
          count(si.id)::int AS notas,
          max(si."createdAt") AS ultima,
          pc.id AS portal_id
     FROM "ServiceInvoice" si
     JOIN "Company" c ON c.id = si."companyId"
     LEFT JOIN "PortalClient" pc ON pc."companyId" = c.id
    GROUP BY c.id, c."razaoSocial", c.cnpj, pc.id
    ORDER BY notas DESC LIMIT 40`
);
if (porEmpresa?.length) {
  for (const r of porEmpresa) {
    console.log(
      `     ${String(r.razaoSocial).slice(0, 34).padEnd(34)} ${r.cnpj}  ` +
      `notas=${String(r.notas).padStart(4)}  portal=${r.portal_id ? "sim" : "NÃO"}  ` +
      `última=${r.ultima?.toISOString?.().slice(0, 10)}`
    );
  }
} else {
  console.log("     (nenhuma)");
}

// ── 3) A nota emitida está VISÍVEL? (PortalInvoice tem a mesma chave/idDps?) ──────────────────
console.log("\n[3] A nota emitida aparece na aba? (mesma chaveAcesso ou idDps em PortalInvoice)");
const visiveis = await q(
  `SELECT
     count(*) FILTER (WHERE si."chaveAcesso" IS NOT NULL)::int AS com_chave,
     count(*) FILTER (WHERE si."chaveAcesso" IS NOT NULL AND EXISTS (
       SELECT 1 FROM "PortalInvoice" pi WHERE pi."chaveAcesso" = si."chaveAcesso"))::int AS chave_visivel,
     count(*) FILTER (WHERE si."idDps" IS NOT NULL AND EXISTS (
       SELECT 1 FROM "PortalInvoice" pi WHERE pi."idDps" = si."idDps"))::int AS dps_visivel
   FROM "ServiceInvoice" si`
);
if (visiveis?.length) {
  const r = visiveis[0];
  console.log(`     com chaveAcesso: ${r.com_chave} · dessas visíveis na aba: ${r.chave_visivel}`);
  console.log(`     visíveis por idDps: ${r.dps_visivel}`);
  console.log("     ⚠ 'visível' aqui é só coincidência de chave — a aba lê PortalInvoice, e a");
  console.log("       emissão não escreve lá. Um match significa que a CAPTURA (ADN) trouxe a nota");
  console.log("       de volta depois, não que a emissão a tenha publicado.");
}

// ── 4) O vínculo que a rota de emissão precisa ───────────────────────────────────────────────
console.log("\n[4] PortalClient → Company: o vínculo que `POST /nfse/issue` precisa resolver");
const vinculo = await q(
  `SELECT count(*)::int AS total,
          count("companyId")::int AS com_company
     FROM "PortalClient"`
);
if (vinculo?.length) {
  const r = vinculo[0];
  console.log(`     PortalClient: ${num(r.total)}  ·  com companyId: ${num(r.com_company)}  ·  SEM: ${num(r.total - r.com_company)}`);
  console.log("     (empresa sem `companyId` não tem Company legada — a emissão não tem onde");
  console.log("      buscar cnpj/inscricaoMunicipal/rpsSerie e responde company_not_found.)");
}

// ── 5) Cadastro exigido pela emissão ─────────────────────────────────────────────────────────
console.log("\n[5] Quantas empresas teriam cadastro COMPLETO para emitir?");
console.log("    (REQUIRED_COMPANY_FIELDS de NfseService: cnpj, inscricaoMunicipal,");
console.log("     codigoServicoNacional, codigoServicoMunicipal, rpsSerie)");
const cadastro = await q(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE "inscricaoMunicipal" IS NOT NULL AND "inscricaoMunicipal" <> '')::int AS im,
          count(*) FILTER (WHERE "codigoServicoNacional" IS NOT NULL AND "codigoServicoNacional" <> '')::int AS csn,
          count(*) FILTER (WHERE "codigoServicoMunicipal" IS NOT NULL AND "codigoServicoMunicipal" <> '')::int AS csm,
          count(*) FILTER (WHERE "rpsSerie" IS NOT NULL AND "rpsSerie" <> '')::int AS serie,
          count(*) FILTER (WHERE "inscricaoMunicipal" IS NOT NULL AND "inscricaoMunicipal" <> ''
                            AND "codigoServicoNacional" IS NOT NULL AND "codigoServicoNacional" <> ''
                            AND "codigoServicoMunicipal" IS NOT NULL AND "codigoServicoMunicipal" <> ''
                            AND "rpsSerie" IS NOT NULL AND "rpsSerie" <> '')::int AS completas
     FROM "Company"`
);
if (cadastro?.length) {
  const r = cadastro[0];
  console.log(`     Company: ${num(r.total)}  ·  IM ${r.im}  ·  cod.nac ${r.csn}  ·  cod.mun ${r.csm}  ·  rpsSerie ${r.serie}`);
  console.log(`     COMPLETAS (emitiriam sem cair em company_missing_fields): ${r.completas}`);
}

linha("═");
console.log("FIM — nada foi escrito.");
await prisma.$disconnect();
