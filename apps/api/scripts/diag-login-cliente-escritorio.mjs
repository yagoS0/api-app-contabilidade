// SO LEITURA. Por que o acesso de teste do portal do CLIENTE nao entra?
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A RESPOSTA JA FOI MEDIDA (30/08/2026), E NAO ERA A SENHA NEM O BANCO
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Sao DOIS portais em DOIS dominios, e o dono estava no lugar certo com a conta errada:
//
//     altan.company          -> `contador-front`      = portal do CONTADOR
//     cliente.altan.company  -> `gracious-acceptance` = portal do CLIENTE
//
// Ele entrou com **`YAGO`** (o identificador do `AUTH_USERS`), e medido contra a producao esse
// login volta **`accountType: FIRM`**. O portal do cliente recusa conta FIRM por REGRA DE PRODUTO
// (`portal-cliente-web/src/api/accountGate.js`): *"uma conta FIRM que entrasse aqui veria a tela
// do cliente, com UMA empresa, e concluiria coisas erradas sobre a propria carteira"*.
// **Nao e defeito -- e a trava funcionando.**
//
// ⚠ E a hipotese de que a senha copiada era de outra credencial ERA FALSA: `bcrypt.compare` da
// senha do `AUTH_USERS` contra o hash do usuario de teste devolve **true**. Exercido o login real
// contra a API de producao: HTTP 200, token, e `GET /client/companies` devolve as **34 empresas**.
//
// ⚠⚠ NAO "CONSERTE" ISTO CRIANDO UM `User` COM E-MAIL `yago`. A busca no banco vem ANTES do
// fallback de ambiente (`AuthService.js:64`): a linha sombrearia o `AUTH_USERS` e, sendo
// `accountType: CLIENT`, o **portal do contador passaria a recusar o dono**. Troca um login que
// falta por um login que quebra.
//
// Este script continua util para conferir a linha (hash, tipo de conta, vinculos) quando o acesso
// de teste voltar a falhar -- ele responde "o banco esta certo?", que foi o que faltou saber.

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const ORIGEM = "yago@belgencontabilidade.com";
const NOVO   = "yago.cliente@belgencontabilidade.com";

const sel = { id:true, email:true, name:true, role:true, status:true, accountType:true, passwordHash:true, createdAt:true };
const [a, b] = await Promise.all([
  prisma.user.findUnique({ where:{ email: ORIGEM }, select: sel }),
  prisma.user.findUnique({ where:{ email: NOVO   }, select: sel }),
]);

const resumo = (u) => u ? {
  id:u.id, role:u.role, status:u.status, accountType:u.accountType,
  temHash: !!u.passwordHash,
  algoritmoHash: (u.passwordHash||"").slice(0,4),   // so o prefixo bcrypt ($2a/$2b), nunca o hash
  tamanhoHash: (u.passwordHash||"").length,
} : null;

console.log("origem :", JSON.stringify(resumo(a)));
console.log("novo   :", JSON.stringify(resumo(b)));
console.log("HASHES IDENTICOS:", !!a && !!b && a.passwordHash === b.passwordHash);
console.log("");

if (b) {
  const v = await prisma.companyClientUser.groupBy({ by:["status","role"], where:{ userId:b.id }, _count:true });
  console.log("vinculos do novo:", JSON.stringify(v));
}

// A hipotese principal: o ramo CLIENT do login grava ClientSession. Se a tabela nao existir,
// o login FALHA DEPOIS de a senha ser aceita -- e so para conta CLIENT.
try {
  const n = await prisma.clientSession.count();
  console.log("client_sessions: EXISTE, linhas =", n);
} catch (e) {
  console.log("client_sessions: FALHOU ->", e.code || e.message);
}

// Quantas contas CLIENT ja entraram alguma vez (prova de que o caminho funciona para outros)
try {
  const porUser = await prisma.clientSession.groupBy({ by:["userId"], _count:true });
  console.log("usuarios distintos com sessao de cliente:", porUser.length);
  console.log("o NOVO ja abriu sessao alguma vez:", !!b && porUser.some(x=>x.userId===b.id));
} catch (e) { console.log("groupBy sessoes falhou:", e.code || e.message); }

await prisma.$disconnect();
