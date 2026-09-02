// SO LEITURA. Quantas empresas NAO CONSEGUEM SALVAR o cadastro?
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const cs = await prisma.company.findMany({
  select: { id:true, razaoSocial:true, cnaePrincipal:true, cnaesSecundarios:true, codigoMunicipioIbge:true },
});
const longo = cs.filter(c => (c.cnaePrincipal||"").length > 20);
const secLongo = cs.filter(c => (c.cnaesSecundarios||[]).some(s => String(s).length > 20));
console.log(`empresas: ${cs.length}`);
console.log(`⚠ cnaePrincipal com MAIS de 20 chars (o Zod recusa): ${longo.length}`);
longo.slice(0,8).forEach(c => console.log(`   ${c.razaoSocial}: ${(c.cnaePrincipal||"").length} chars — ${String(c.cnaePrincipal).slice(0,60)}…`));
console.log(`⚠ cnaesSecundarios com item > 20 chars: ${secLongo.length}`);
console.log("");
const comMun = cs.filter(c => c.codigoMunicipioIbge);
console.log(`codigoMunicipioIbge preenchido: ${comMun.length} de ${cs.length}`);
await prisma.$disconnect();
