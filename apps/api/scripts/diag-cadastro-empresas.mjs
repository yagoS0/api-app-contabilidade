// SO LEITURA. Mede os tres achados da varredura do cadastro contra a producao.
// Zero chamada externa (nada de SERPRO/ADN/SEFAZ/BrasilAPI). Nao escreve nada.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const alvo = (process.argv[2] || "ALESSANDRO").toUpperCase();

console.log("=".repeat(78));
console.log("ACHADO 1 — o campo do responsavel cai para o e-mail da EMPRESA?");
console.log("=".repeat(78));

// A empresa do relato
const portais = await prisma.portalClient.findMany({
  where: { razao: { contains: alvo, mode: "insensitive" } },
  select: { id: true, razao: true, cnpj: true, companyId: true },
});
console.log(`empresas cujo nome contem "${alvo}": ${portais.length}`);

for (const p of portais) {
  const legacy = p.companyId
    ? await prisma.company.findUnique({ where: { id: p.companyId }, select: { email: true } })
    : null;
  const owner = await prisma.companyClientUser.findFirst({
    where: { companyId: p.id, role: "OWNER", status: "ACTIVE" },
    select: { userId: true, user: { select: { email: true } } },
  });
  const emailEmpresa = legacy?.email || null;
  // ⚠ A pergunta exata: o e-mail da EMPRESA pertence a um User que existe?
  const donoDesseEmail = emailEmpresa
    ? await prisma.user.findUnique({ where: { email: emailEmpresa.toLowerCase() }, select: { id: true } })
    : null;

  console.log(`\n  ${p.razao}`);
  console.log(`    tem OWNER ativo?      ${owner ? "SIM (" + owner.user?.email + ")" : "NAO  <-- o form cai para o e-mail da empresa"}`);
  console.log(`    Company.email         ${emailEmpresa || "(vazio)"}`);
  console.log(`    esse e-mail e de um User existente?  ${donoDesseEmail ? "SIM" : "nao"}`);
  const reproduz = !owner && !!donoDesseEmail && donoDesseEmail.id !== owner?.userId;
  console.log(`    >> REPRODUZ o 409 owner_email_already_in_use: ${reproduz ? "SIM" : "nao"}`);
}

// Quantas empresas da carteira estao nesse estado?
const todos = await prisma.portalClient.findMany({ select: { id: true, razao: true, companyId: true } });
let semOwner = 0, semOwnerComEmailDeUser = 0;
for (const p of todos) {
  const owner = await prisma.companyClientUser.findFirst({
    where: { companyId: p.id, role: "OWNER", status: "ACTIVE" }, select: { id: true },
  });
  if (owner) continue;
  semOwner++;
  const legacy = p.companyId ? await prisma.company.findUnique({ where: { id: p.companyId }, select: { email: true } }) : null;
  if (!legacy?.email) continue;
  const u = await prisma.user.findUnique({ where: { email: legacy.email.toLowerCase() }, select: { id: true } });
  if (u) semOwnerComEmailDeUser++;
}
console.log(`\n  CARTEIRA: ${todos.length} empresas`);
console.log(`    sem OWNER ativo:                          ${semOwner}`);
console.log(`    ...e cujo Company.email JA e de um User:  ${semOwnerComEmailDeUser}  <-- estas reproduzem o 409`);

console.log("\n" + "=".repeat(78));
console.log("ACHADO 6 — quanto o 'Salvar' apagaria de Anexo do Simples?");
console.log("=".repeat(78));
const comAnexo = await prisma.company.count({ where: { OR: [{ simplesAnexo: { not: null } }, { anexoSimples: { not: null } }] } });
const comDataOpcao = await prisma.company.count({ where: { simplesDataOpcao: { not: null } } });
const totalCompanies = await prisma.company.count();
console.log(`  empresas legadas: ${totalCompanies}`);
console.log(`    com anexo do Simples preenchido:  ${comAnexo}  <-- zerado a cada 'Salvar alteracoes'`);
console.log(`    com data de opcao preenchida:     ${comDataOpcao}`);

console.log("\n" + "=".repeat(78));
console.log("ACHADO 5 — quanto o 'Salvar' apagaria de DESCRICAO de CNAE?");
console.log("=".repeat(78));
const comAtividades = await prisma.company.findMany({
  where: { NOT: { atividades: { isEmpty: true } } },
  select: { id: true, razaoSocial: true, atividades: true },
});
// "codigo - descricao" tem letra depois do traco; codigo nu nao tem
const temTexto = (linha) => /\d.*[-–]\s*\S*\p{L}/u.test(String(linha || ""));
let empresasComTexto = 0, linhasComTexto = 0, linhasNuas = 0;
const exemplos = [];
for (const c of comAtividades) {
  const comTexto = (c.atividades || []).filter(temTexto);
  linhasComTexto += comTexto.length;
  linhasNuas += (c.atividades || []).length - comTexto.length;
  if (comTexto.length) {
    empresasComTexto++;
    if (exemplos.length < 3) exemplos.push(`${c.razaoSocial}: ${comTexto[0]}`);
  }
}
console.log(`  empresas com 'atividades' preenchida: ${comAtividades.length}`);
console.log(`    com ao menos UMA linha descrita:    ${empresasComTexto}  <-- perdem o texto a cada 'Salvar'`);
console.log(`    linhas com descricao: ${linhasComTexto} | linhas com codigo nu: ${linhasNuas}`);
exemplos.forEach((e) => console.log(`      ex: ${e}`));

console.log("\n" + "=".repeat(78));
console.log("ACHADO 4 — Company.email que a validacao do Zod reprovaria");
console.log("=".repeat(78));
const zod = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const comEmail = await prisma.company.findMany({ where: { email: { not: null } }, select: { razaoSocial: true, email: true } });
const reprovados = comEmail.filter((c) => c.email && c.email.trim() !== "" && !zod.test(c.email.trim()));
console.log(`  empresas com Company.email preenchido: ${comEmail.length}`);
console.log(`    que o Zod REPROVA (=> PATCH inteiro falha, sem campo na tela): ${reprovados.length}`);
reprovados.slice(0, 5).forEach((c) => console.log(`      ${c.razaoSocial}: ${c.email}`));

await prisma.$disconnect();
