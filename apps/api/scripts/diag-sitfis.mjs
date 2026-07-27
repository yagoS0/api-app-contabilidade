// Diagnóstico do estado SITFIS de uma empresa (ou de todas) — read-only.
//
// Serve pra entender POR QUE uma empresa não conclui a consulta: se ela tem protocolo salvo,
// de quando é, se já veio relatório alguma vez, e se a trava de 4h está ativa.
//
//   node scripts/diag-sitfis.mjs --cnpj=00000000000000
//   node scripts/diag-sitfis.mjs --razao=erisangela
//   node scripts/diag-sitfis.mjs --todas
//
// Leitura das colunas (chaves pra interpretar):
//   protocolo          → se existe, a próxima consulta vai direto ao /Emitir (NÃO gasta cota AV02)
//   ultimoRelatorioEm  → última consulta que REALMENTE trouxe relatório (ancora a trava de 4h)
//   checkedAt          → última TENTATIVA (sobe mesmo quando volta "processando")

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const temFlag = (name) => process.argv.includes(`--${name}`);

const QUATRO_HORAS_MS = 4 * 60 * 60 * 1000;

function linha(p) {
  const s = p.fiscalStatus;
  if (!s) return `${p.razao}\n    (nunca consultada — sem CompanyFiscalStatus)`;
  const agora = Date.now();
  const travadaAte = s.ultimoRelatorioEm ? new Date(s.ultimoRelatorioEm).getTime() + QUATRO_HORAS_MS : null;
  const travada = travadaAte && travadaAte > agora;
  return [
    `${p.razao}  ·  ${p.cnpj}`,
    `    situacao ........... ${s.situacao || "—"}`,
    `    protocolo salvo .... ${s.protocolo ? `${s.protocolo} (próxima consulta pula o /Apoiar)` : "NENHUM (próxima consulta gasta cota AV02)"}`,
    `    último relatório ... ${s.ultimoRelatorioEm ? new Date(s.ultimoRelatorioEm).toLocaleString("pt-BR") : "NUNCA veio relatório"}`,
    `    última tentativa ... ${s.checkedAt ? new Date(s.checkedAt).toLocaleString("pt-BR") : "—"}`,
    `    tem PDF ............ ${s.relatorioPdfFileId ? "sim" : "não"}   ·   tem texto: ${s.texto ? `${s.texto.length} chars` : "não"}`,
    `    trava de 4h ........ ${travada ? `ATIVA até ${new Date(travadaAte).toLocaleString("pt-BR")}` : "liberada"}`,
  ].join("\n");
}

try {
  const select = {
    id: true, razao: true, cnpj: true,
    fiscalStatus: {
      select: {
        situacao: true, protocolo: true, relatorioPdfFileId: true, texto: true,
        checkedAt: true, ultimoRelatorioEm: true,
      },
    },
  };

  let portais;
  if (temFlag("todas")) {
    portais = await prisma.portalClient.findMany({ orderBy: { razao: "asc" }, select });
  } else {
    const cnpj = arg("cnpj");
    const razao = arg("razao");
    if (!cnpj && !razao) {
      console.error("Uso: node scripts/diag-sitfis.mjs --cnpj=<cnpj> | --razao=<nome> | --todas");
      process.exit(2);
    }
    const where = cnpj
      ? { OR: [{ cnpj }, { cnpj: String(cnpj).replace(/\D+/g, "") }] }
      : { razao: { contains: razao, mode: "insensitive" } };
    portais = await prisma.portalClient.findMany({ where, orderBy: { razao: "asc" }, take: 20, select });
    if (!portais.length) { console.error("Nenhuma empresa encontrada com esse filtro."); process.exit(1); }
  }

  console.log(`\n=== SITFIS — ${portais.length} empresa(s) ===\n`);
  for (const p of portais) console.log(`${linha(p)}\n`);

  const semProtocolo = portais.filter((p) => p.fiscalStatus && !p.fiscalStatus.protocolo && !p.fiscalStatus.ultimoRelatorioEm);
  if (semProtocolo.length) {
    console.log(`⚠ ${semProtocolo.length} empresa(s) sem protocolo E sem relatório: cada consulta delas`);
    console.log("  precisa de um /Apoiar novo, que é o que consome o limite por contratante (AV02).");
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
