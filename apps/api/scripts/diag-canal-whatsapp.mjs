// DIAGNÓSTICO: o canal WhatsApp — o que está gravado, e o que a tela responderia.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma mensagem, nenhuma chamada externa, ZERO credencial da Meta.
//
// Responde, num só lugar, as perguntas que decidem se o canal pode ser ligado:
//   1. os cinco templates: nome na Meta, estado de aprovação, data de conferência;
//   2. quantos contatos / conversas / mensagens / envios existem;
//   3. o que `avaliarCanal` diria COM a flag ligada — ou seja, se o TEMPLATE ainda é o motivo da
//      recusa (a flag em si não é lida aqui: o ambiente do Postgres no Railway não a tem).
//
// USO:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node scripts/diag-canal-whatsapp.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";
import { avaliarCanal } from "../src/application/whatsapp/elegibilidadeEnvioGuia.js";
import { WHATSAPP_TEMPLATE_GUIA } from "../src/config.js";

const templates = await prisma.templateWhatsapp.findMany({ orderBy: { chave: "asc" } });
console.log("═══ TEMPLATES ═══");
for (const t of templates) {
  console.log(
    `  ${t.chave.padEnd(22)} nomeMeta=${(t.nomeMeta ?? "(nulo)").padEnd(22)} ${t.statusAprovacao.padEnd(10)} `
    + `idioma=${t.idioma} doc=${t.temDocumento} conferido=${t.conferidoNaMetaEm ? t.conferidoNaMetaEm.toISOString().slice(0, 10) : "nunca"}`,
  );
}

const [contatos, comOptIn, comUsuario, conversas, naoVinculadas, mensagens, envios] = await Promise.all([
  prisma.contatoWhatsapp.count(),
  prisma.contatoWhatsapp.count({ where: { optInEm: { not: null }, ativo: true } }),
  prisma.contatoWhatsapp.count({ where: { userId: { not: null } } }),
  prisma.conversaWhatsapp.count(),
  prisma.conversaWhatsapp.count({ where: { portalClientId: null } }),
  prisma.mensagemWhatsapp.count(),
  prisma.envioGuia.count(),
]);
console.log("\n═══ O QUE EXISTE ═══");
console.log(`  contatos: ${contatos} (ativos com opt-in: ${comOptIn} · ligados a uma pessoa: ${comUsuario})`);
console.log(`  conversas: ${conversas} (não vinculadas: ${naoVinculadas}) · mensagens: ${mensagens} · envios_guia: ${envios}`);

const guia = templates.find((t) => t.chave === WHATSAPP_TEMPLATE_GUIA) || null;
const canal = avaliarCanal({ integracaoLigada: true, template: guia, chaveTemplate: WHATSAPP_TEMPLATE_GUIA });
console.log("\n═══ O CANAL, SE A FLAG ESTIVESSE LIGADA ═══");
console.log(`  template pedido pelo código: ${WHATSAPP_TEMPLATE_GUIA}`);
console.log(`  ${canal.disponivel ? "✓ DISPONÍVEL" : `✖ indisponível — ${canal.motivo}`}`);
if (!canal.disponivel) console.log(`  ${canal.mensagem}`);

console.log("\nNada foi alterado.");
await prisma.$disconnect();
