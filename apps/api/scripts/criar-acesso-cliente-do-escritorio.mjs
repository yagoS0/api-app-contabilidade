// CRIA (ou atualiza) UM ACESSO DE CLIENTE PARA QUEM É DO ESCRITÓRIO — para TESTAR o portal do cliente.
//
// > Pedido do dono (28/08/2026): *"preciso que crie um usuario admin, com as mesmas credenciais do
// > portal do contador, que me de acesso a todas as empresas"* — e, perguntado qual portal, escolheu
// > **o portal do CLIENTE, vendo todas**.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ POR QUE UM USUÁRIO NOVO, E NÃO O DELE PROMOVIDO
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `accountGate.js` (portal do cliente) recusa conta que não seja `CLIENT`, na tela de login, por
// REGRA DE PRODUTO — está escrito lá: *"uma conta FIRM que entrasse aqui veria a tela do cliente,
// com UMA empresa, os números DELA, e concluiria coisas erradas sobre a própria carteira"*.
// E `User.email` é `@unique`, então o mesmo endereço não pode existir nas duas contas.
//
// ⚠⚠ A SENHA NUNCA EXISTE EM TEXTO. O `passwordHash` (bcrypt) é COPIADO do usuário de origem —
// é isso que faz "as mesmas credenciais" ser literal. Este script não gera, não lê e não imprime
// senha nenhuma; quem a conhece é só o dono dela.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ OS 34 VÍNCULOS SÃO OBRIGATÓRIOS — medido, não suposto
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `GET /client/companies` (`routes/client/index.js:231`) monta a lista com
// `companyClientUser.findMany({ where: { userId, status: "ACTIVE" } })` — **e não há bypass de
// admin ali**. Um usuário `role: "admin"` SEM vínculos passa em todos os middlewares e vê a lista
// **VAZIA**: entra e não acha nada. É o "filtro fantasma" desta casa, na porta de entrada.
//
// ⚠ `CompanyClientUser.role = "OWNER"` (o mais alto) porque é ele que abre TUDO do lado do cliente:
// emissão de NFS-e e certificado exigem `CLIENT_ADMIN`+, a Situação Fiscal exige `CLIENT_ADMIN`, e
// gestão de usuários exige `OWNER`. Um piso menor esconderia justamente as telas a testar.
//
// ⚠⚠ `User.role` FICA `"user"`, E NÃO `"admin"` — decisão minha, declarada.
// O pedido foi "usuário admin", e `admin` aqui **não acrescentaria nada** ao portal do cliente (os
// 34 vínculos já dão acesso total). O que ele acrescentaria é perigoso: `requireAccountType`
// (`middlewares/requireAccountType.js:12`) faz `if (role === "admin") return next()` — ou seja, um
// login de CLIENTE com `role: admin` passaria também nas rotas `/firm`. Isso é uma conta de teste
// que dirige o portal do escritório, e o dono já tem o login de contador para isso.
// **Se ele quiser `admin` mesmo assim, é `--role admin`** — a porta existe e é dele.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// COMO RODAR
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/criar-acesso-cliente-do-escritorio.mjs                  # ENSAIO (não grava nada)
//   node scripts/criar-acesso-cliente-do-escritorio.mjs --aplicar        # grava
//
//   --origem <email>   de quem copiar o hash          (padrão: yago@belgencontabilidade.com)
//   --email  <email>   o login novo                   (padrão: yago.cliente@belgencontabilidade.com)
//   --role   <papel>   `User.role`                    (padrão: user — ver o aviso acima)
//
// ⚠ ENSAIO POR PADRÃO, como todo script desta casa que escreve. E é IDEMPOTENTE: rodar de novo
// não duplica nada — o usuário é encontrado pelo e-mail e os vínculos por (empresa, usuário).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i > -1 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : padrao;
};

const APLICAR = process.argv.includes("--aplicar");
const ORIGEM = arg("--origem", "yago@belgencontabilidade.com").toLowerCase();
const EMAIL = arg("--email", "yago.cliente@belgencontabilidade.com").toLowerCase();
const ROLE = arg("--role", "user");

async function main() {
  console.log(APLICAR ? "MODO: APLICAR (grava)" : "MODO: ENSAIO (não grava nada)");
  console.log(`origem do hash: ${ORIGEM}`);
  console.log(`login novo:     ${EMAIL}   (role: ${ROLE}, accountType: CLIENT)`);
  console.log("");

  const origem = await prisma.user.findUnique({
    where: { email: ORIGEM },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!origem) {
    console.error(`RECUSADO: não existe usuário com o e-mail ${ORIGEM}. Sem ele não há hash a copiar.`);
    process.exitCode = 1;
    return;
  }
  // ⚠ O hash NÃO é impresso. Nem truncado: um prefixo de bcrypt não abre nada, mas imprimir
  //   credencial em log é hábito que se paga na próxima vez.
  if (!origem.passwordHash) {
    console.error("RECUSADO: o usuário de origem não tem `passwordHash`.");
    process.exitCode = 1;
    return;
  }

  const empresas = await prisma.portalClient.findMany({
    select: { id: true, razao: true, cnpj: true },
    orderBy: { razao: "asc" },
  });
  console.log(`empresas (PortalClient): ${empresas.length}`);

  const existente = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, role: true, status: true, accountType: true },
  });
  console.log(existente ? `usuário JÁ EXISTE (${existente.id}) — será atualizado` : "usuário será CRIADO");

  let jaVinculadas = 0;
  if (existente) {
    jaVinculadas = await prisma.companyClientUser.count({ where: { userId: existente.id } });
  }
  console.log(`vínculos já existentes: ${jaVinculadas}`);
  console.log(`vínculos a garantir:    ${empresas.length}  (role OWNER, status ACTIVE)`);
  console.log("");

  if (!APLICAR) {
    console.log("ENSAIO — nada foi gravado. Rode com --aplicar para valer.");
    return;
  }

  // ⚠⚠ TUDO NUMA TRANSAÇÃO: um usuário criado sem vínculos entraria no portal e veria a lista
  //   VAZIA — o pior desfecho, porque parece que o sistema perdeu as empresas.
  //
  // ⚠⚠ O `timeout` NÃO É ENFEITE — a primeira execução MORREU nele. O default da transação
  //   interativa do Prisma é **5 s**, e aqui são 34 empresas × ida-e-volta pelo proxy PÚBLICO do
  //   Railway (dezenas de ms cada). A transação estourou no meio e o Prisma respondeu *"Transaction
  //   not found"*. ⚠ O rollback funcionou — conferido depois: zero usuário, zero vínculo. Mas o
  //   modo de falhar é feio, e a saída NÃO é tirar a transação: é dar tempo a ela e gastar menos
  //   viagens (ver o `findUnique` que saiu do laço, abaixo).
  const r = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: EMAIL },
      // ⚠ `status: "active"` explícito: o default do model é `"pending"`, e usuário pendente não
      //   entra. Criar um login que não loga seria entregar meio trabalho.
      create: {
        email: EMAIL,
        name: `${origem.name || "Escritório"} (teste cliente)`,
        passwordHash: origem.passwordHash,
        role: ROLE,
        status: "active",
        accountType: "CLIENT",
      },
      // ⚠ O update NÃO reescreve o hash: se a senha da origem mudou depois, quem manda é a que já
      //   está aqui — rodar o script de novo não pode trocar a senha de ninguém em silêncio.
      update: { role: ROLE, status: "active", accountType: "CLIENT" },
      select: { id: true, email: true },
    });

    // ⚠ O `findUnique` por linha SAIU daqui: ele DOBRAVA as viagens ao banco só para contar quantos
    //   eram novos, e foi metade do que estourou o tempo. Quem conta agora é a diferença entre o
    //   total de antes e o de depois — mesma resposta, metade do custo.
    const antes = await tx.companyClientUser.count({ where: { userId: user.id } });
    for (const e of empresas) {
      await tx.companyClientUser.upsert({
        where: { companyId_userId: { companyId: e.id, userId: user.id } },
        create: { companyId: e.id, userId: user.id, role: "OWNER", status: "ACTIVE" },
        update: { role: "OWNER", status: "ACTIVE" },
      });
    }
    const depois = await tx.companyClientUser.count({ where: { userId: user.id } });
    return { user, criados: depois - antes };
  }, {
    // ⚠ Folgado de propósito: 34 upserts por um proxy público. Curto demais é o defeito que esta
    //   linha existe para não repetir; longo demais só segura uma conexão por mais alguns segundos
    //   num script que roda uma vez.
    timeout: 60_000,
    maxWait: 15_000,
  });

  const total = await prisma.companyClientUser.count({ where: { userId: r.user.id } });
  console.log(`OK. usuário ${r.user.email} (${r.user.id})`);
  console.log(`vínculos criados agora: ${r.criados} · total do usuário: ${total} de ${empresas.length}`);
  if (total !== empresas.length) {
    console.error("⚠ ATENÇÃO: o total não bate com o número de empresas. Confira antes de usar.");
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("FALHOU:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
