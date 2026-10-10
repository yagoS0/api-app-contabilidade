// node scripts/registrar-templates-guias-whatsapp.mjs --listar
// node scripts/registrar-templates-guias-whatsapp.mjs --chave <chave> --arquivo <json-da-meta> [--aplicar]
// O JSON deve ser o objeto do modelo aprovado, com status/category/language/name/components.
import fs from 'node:fs/promises';
import { TEMPLATES_GUIAS_WHATSAPP, validarTemplateGuias } from '../src/application/whatsapp/templatesGuiasWhatsapp.js';
const args = process.argv.slice(2);
const arg = nome => args[args.indexOf(nome) + 1];
if (args.includes('--listar')) {
  console.log(JSON.stringify(TEMPLATES_GUIAS_WHATSAPP, null, 2));
} else {
  if (!args.includes('--chave') || !args.includes('--arquivo')) throw Error('Informe --listar ou --chave e --arquivo.');
  const chave = arg('--chave');
  const data = validarTemplateGuias(chave, JSON.parse(await fs.readFile(arg('--arquivo'), 'utf8')));
  console.log(JSON.stringify({ chave, ...data, aplicar: args.includes('--aplicar') }, null, 2));
  if (args.includes('--aplicar')) {
    const { prisma } = await import('../src/infrastructure/db/prisma.js');
    try { await prisma.templateWhatsapp.upsert({ where: { chave }, create: { chave, ...data }, update: data }); }
    finally { await prisma.$disconnect(); }
  }
}
