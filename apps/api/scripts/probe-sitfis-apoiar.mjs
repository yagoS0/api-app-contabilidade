// Sonda o /Apoiar do SITFIS de UMA empresa e imprime a resposta CRUA do SERPRO.
//
// Por que existe: quando o /Apoiar não devolve protocolo, a aplicação traduz isso para
// "limite momentâneo atingido" — mas esse texto é INFERÊNCIA NOSSA (a mensagem casou com um
// padrão). A mensagem real do SERPRO nunca aparecia em lugar nenhum, e sem ela o diagnóstico
// vira adivinhação: pode ser limite de conta, procuração ausente, certificado, contribuinte
// inválido... Este script mostra exatamente o que volta.
//
//   node scripts/probe-sitfis-apoiar.mjs --cnpj=00000000000000
//   node scripts/probe-sitfis-apoiar.mjs --razao=atim
//
// ⚠ Faz UMA chamada paga ao /Apoiar. Rode em UMA empresa, não em lote.
//
// NÃO necessariamente consome um lugar na fila: quando a resposta vem SEM protocolo (aviso AV02),
// nenhuma solicitação foi aberta — só quando um protocolo é devolvido é que o lugar passa a
// existir. O aviso anterior dizia que consumia sempre, o que desencorajava usar justamente o
// diagnóstico que mostra a mensagem crua do SERPRO quando a fila está cheia.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "../src/application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproHttpClient } from "../src/application/fiscal/serpro/SerproHttpClient.js";
import {
  INTEGRACAO_SERPRO_SITFIS,
  SERPRO_SITFIS_SYSTEM,
  SERPRO_SITFIS_SERVICE_PROTOCOLO,
  SERPRO_SITFIS_VERSAO,
} from "../src/config.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");

try {
  console.log(`INTEGRACAO_SERPRO_SITFIS = ${INTEGRACAO_SERPRO_SITFIS ? "ON" : "OFF"}`);
  if (!INTEGRACAO_SERPRO_SITFIS) {
    console.error("Integração SITFIS desligada — a consulta nem sairia. Ligue INTEGRACAO_SERPRO_SITFIS.");
    process.exit(1);
  }

  const cnpjArg = arg("cnpj");
  const razaoArg = arg("razao");
  if (!cnpjArg && !razaoArg) {
    console.error("Uso: node scripts/probe-sitfis-apoiar.mjs --cnpj=<cnpj> | --razao=<nome>");
    process.exit(2);
  }
  const where = cnpjArg
    ? { OR: [{ cnpj: cnpjArg }, { cnpj: onlyDigits(cnpjArg) }] }
    : { razao: { contains: razaoArg, mode: "insensitive" } };
  const empresas = await prisma.portalClient.findMany({ where, select: { id: true, razao: true, cnpj: true }, take: 5 });
  if (!empresas.length) { console.error("Empresa não encontrada."); process.exit(1); }
  if (empresas.length > 1) {
    console.error("Mais de uma empresa — refine o filtro:");
    empresas.forEach((e) => console.error(`  ${e.razao} · ${e.cnpj}`));
    process.exit(1);
  }
  const empresa = empresas[0];

  const runtime = await getResolvedSerproCredentials();
  const contratante = onlyDigits(runtime.certificate?.document);
  const contribuinte = onlyDigits(empresa.cnpj);
  console.log(`Empresa .....: ${empresa.razao} · ${contribuinte}`);
  console.log(`Contratante .: ${contratante || "(não configurado)"}`);
  console.log(`Serviço .....: ${SERPRO_SITFIS_SYSTEM}/${SERPRO_SITFIS_SERVICE_PROTOCOLO} v${SERPRO_SITFIS_VERSAO}\n`);

  const client = new SerproHttpClient();
  const resp = await client.post("/Apoiar", {
    contratante: { numero: contratante, tipo: 2 },
    autorPedidoDados: { numero: contratante, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    pedidoDados: {
      idSistema: SERPRO_SITFIS_SYSTEM,
      idServico: SERPRO_SITFIS_SERVICE_PROTOCOLO,
      versaoSistema: SERPRO_SITFIS_VERSAO,
      dados: "",
    },
  }, { raw: true, validateStatus: () => true });

  console.log(`=== HTTP ${resp.status} ===`);
  const etag = resp.headers?.etag || resp.headers?.ETag || null;
  console.log(`ETag (protocolo em cache): ${etag ? `${String(etag).slice(0, 40)}…` : "(nenhum)"}`);
  console.log("\n=== CORPO DA RESPOSTA (cru) ===");
  console.log(typeof resp.data === "string" ? resp.data.slice(0, 4000) : JSON.stringify(resp.data, null, 2).slice(0, 4000));
} catch (err) {
  console.error("\nErro:", err?.message || err);
  if (err?.response) {
    console.error("HTTP:", err.response.status);
    console.error("Corpo:", JSON.stringify(err.response.data).slice(0, 2000));
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
