// REGISTRA A APROVAÇÃO DE UM TEMPLATE DA META NO NOSSO BANCO — a chave que LIGA o canal.
//
// ⚠ NÃO EXISTE (e não vai existir aqui) código que submeta ou consulte template na Meta. Quem
// submete e lê a aprovação é o dono, no painel do WhatsApp Business. Este script grava o que ele
// leu lá: o NOME EXATO aprovado e o estado `APROVADO`, com a data em que foi conferido.
//
// ⚠ ENSAIO POR PADRÃO. Escreve só com `--aplicar`. É a ÚNICA escrita (DML) da fase de ligar o canal,
// e é o dono quem roda.
//
// ⚠ A CONFERÊNCIA DO CORPO É A RAZÃO DE O SCRIPT EXISTIR. O código envia CINCO variáveis posicionais
// numa ordem que veio do esqueleto do dono (`variaveisDaGuia`); a Meta só CONTA variáveis. Modelo
// aprovado com outra quantidade ⇒ a Meta recusa (132000) e o contador lê "falhou". Modelo com cinco
// em OUTRA ordem ⇒ a Meta ACEITA e o cliente recebe o vencimento no lugar do valor, guia após guia,
// sem erro nenhum. Por isso:
//   · `--corpo-arquivo <txt>`  o corpo aprovado, copiado do painel → prova MECÂNICA (quantidade,
//                              numeração {{1}}…{{5}}, sem nomeada, sem repetição);
//   · `--conferido`            a prova HUMANA: quem leu confirma que {{1}} é o nome … {{5}} é o
//                              vencimento. Sem ela NADA é gravado, mesmo com o corpo perfeito.
// Se o corpo aprovado discordar do código, É O CÓDIGO QUE MUDA (`variaveisDaGuia`), nunca o
// template — mudar o modelo na Meta é nova submissão e nova espera.
//
// USO (contra produção, pelo Railway):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node scripts/registrar-template-whatsapp.mjs --chave guia_disponivel --nome-meta <nome> --corpo-arquivo corpo.txt --conferido'
//   … e, depois de ler o ensaio, o mesmo comando com `--aplicar`.
//
// A regra que decide mora em `src/application/whatsapp/templateAprovado.js` (pura, com teste); aqui é
// só a ligação com o banco e com o terminal.

import fs from "node:fs";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { VARIAVEIS_GUIA, decidirRegistroDeAprovacao } from "../src/application/whatsapp/templateAprovado.js";
import { avaliarCanal } from "../src/application/whatsapp/elegibilidadeEnvioGuia.js";

function argumento(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const aplicar = process.argv.includes("--aplicar");
const conferido = process.argv.includes("--conferido");
const chave = argumento("--chave") || "guia_disponivel";
const nomeMeta = argumento("--nome-meta");
const idioma = argumento("--idioma");
const corpoArquivo = argumento("--corpo-arquivo");

let corpoAprovado = null;
if (corpoArquivo) {
  try {
    corpoAprovado = fs.readFileSync(corpoArquivo, "utf8");
  } catch (err) {
    console.log(`⚠ Não consegui ler o corpo aprovado em ${corpoArquivo}: ${err?.message}`);
    process.exit(1);
  }
}

const template = await prisma.templateWhatsapp.findUnique({ where: { chave } });

console.log(`template: ${chave}`);
if (template) {
  console.log(`  hoje: nomeMeta=${template.nomeMeta ?? "(nulo)"} · statusAprovacao=${template.statusAprovacao} · idioma=${template.idioma} · temDocumento=${template.temDocumento} · conferidoNaMetaEm=${template.conferidoNaMetaEm ? template.conferidoNaMetaEm.toISOString() : "(nunca)"}`);
}
console.log("");
console.log("A ORDEM que o código envia no corpo (variaveisDaGuia) — confira contra o texto aprovado:");
VARIAVEIS_GUIA.forEach((v, i) => console.log(`  {{${i + 1}}} = ${v}`));
console.log("");

const decisao = decidirRegistroDeAprovacao({ template, nomeMeta, corpoAprovado, conferidoPorPessoa: conferido, idioma });

if (decisao.conferencia) {
  const c = decisao.conferencia;
  console.log(`corpo aprovado: ${c.posicionais.length} variável(is) posicional(is) {{${c.posicionais.join("}}, {{")}}}${c.nomeadas.length ? ` · nomeadas: ${c.nomeadas.join(", ")}` : ""} → ${c.ok ? "confere com o código" : `NÃO confere (${c.motivo})`}`);
}
for (const aviso of decisao.avisos) console.log(`⚠ ${aviso}`);

if (!decisao.ok) {
  console.log("");
  console.log(`✖ NÃO REGISTRADO — ${decisao.motivo}`);
  console.log(`  ${decisao.mensagem}`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log("");
console.log("o que seria gravado:");
console.log(`  ${JSON.stringify({ ...decisao.dados, conferidoNaMetaEm: decisao.dados.conferidoNaMetaEm.toISOString() })}`);

// O que `carregarCanal` responderia COM a flag ligada — é a pergunta que a tela faz antes de
// oferecer o botão. A flag em si não é lida aqui: o ambiente do Postgres no Railway não a tem, e
// o que se quer saber é se o TEMPLATE deixa de ser o motivo da recusa.
const previa = avaliarCanal({ integracaoLigada: true, template: { ...template, ...decisao.dados }, chaveTemplate: chave });
console.log(`  com INTEGRACAO_WHATSAPP=1, o canal responderia: ${previa.disponivel ? "DISPONÍVEL" : `indisponível (${previa.motivo})`}`);

if (!aplicar) {
  console.log("");
  console.log("ensaio. rode com --aplicar para gravar.");
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.templateWhatsapp.update({ where: { chave }, data: decisao.dados });
const depois = await prisma.templateWhatsapp.findUnique({ where: { chave } });
console.log("");
console.log(`gravado. releitura: nomeMeta=${depois.nomeMeta} · statusAprovacao=${depois.statusAprovacao} · idioma=${depois.idioma} · conferidoNaMetaEm=${depois.conferidoNaMetaEm?.toISOString()}`);
const canal = avaliarCanal({ integracaoLigada: true, template: depois, chaveTemplate: chave });
console.log(`com INTEGRACAO_WHATSAPP=1, o canal responde: ${canal.disponivel ? "DISPONÍVEL" : `indisponível (${canal.motivo})`}`);

await prisma.$disconnect();
