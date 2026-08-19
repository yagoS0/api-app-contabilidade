// A SENHA DO PORTAL DO CLIENTE — a parte que NÃO fala HTTP.
//
// ⚠⚠⚠ É UMA SENHA SÓ. Não existe "senha do contador" e "senha do cliente": existe a credencial do
// usuário do portal daquela empresa (`User.passwordHash`), e TRÊS caminhos para trocá-la:
//
//   ESCRITORIO          o contador, pelo cadastro da empresa  → `definirSenhaPeloEscritorio`
//   CLIENTE_PERFIL      o cliente, sabendo a senha atual      → `POST /auth/change-password`
//   CLIENTE_RECUPERACAO o cliente, pelo link do e-mail        → `POST /auth/reset-password`
//
// Quem trocar por qualquer um dos três troca DE VERDADE, e vale para todos — não há sincronização
// a fazer entre portais porque não há duas senhas. O que o portal do contador precisa refletir é o
// ESTADO (quando foi a última troca e por quem), e é para isso que `registrarTroca` existe e é
// chamada pelos três.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A SENHA ATUAL NÃO PODE SER MOSTRADA — E ISSO NÃO É UMA LIMITAÇÃO A CONTORNAR
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `User.passwordHash` é bcrypt (`routes/auth.js`), e bcrypt NÃO TEM VOLTA. Este arquivo não tem, e
// nunca deve ganhar, nada que guarde a senha de forma recuperável — nem coluna nova, nem cifra
// reversível, nem "só o primeiro caractere", nem o comprimento. Com essa credencial o usuário do
// portal EMITE NFS-e em nome da empresa dele (`routes/middlewares/emissaoNfseGate.js`); uma cópia
// do banco viraria a senha de todos os clientes do escritório.
//
// Daí o desenho: o contador não LÊ a senha, ele DEFINE uma nova, que é exibida UMA VEZ, na
// resposta desta chamada, e nunca mais. É a mesma disciplina do cofre de credenciais
// (`features/companies/credentials/`), com uma diferença que importa: lá o valor é recuperável de
// propósito (é senha de portal de terceiro, cifrada com chave própria); aqui não é, e não deve ser.

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../infrastructure/db/prisma.js";
import {
  validateStrongPassword,
  strongPasswordMessage,
} from "../validators/passwordPolicy.js";

/** Papel mínimo do ESCRITÓRIO para definir a senha de um cliente. */
export const PAPEL_MINIMO_DEFINIR_SENHA = "ACCOUNTANT";

export const ORIGENS = Object.freeze({
  ESCRITORIO: "ESCRITORIO",
  CLIENTE_PERFIL: "CLIENTE_PERFIL",
  CLIENTE_RECUPERACAO: "CLIENTE_RECUPERACAO",
});

export class SenhaDoPortalError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SenhaDoPortalError";
    this.code = code;
    this.status = status;
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A SENHA NOVA É GERADA AQUI, NÃO DIGITADA PELO CONTADOR — e a decisão é deliberada
// ───────────────────────────────────────────────────────────────────────────────────────────────
//
// Senha digitada por quem NÃO VAI USÁ-LA tende a ser fraca e, pior, REPETIDA: o mesmo
// `Empresa@2026` em trinta clientes, porque quem digita precisa conseguir ditar e não precisa
// lembrar. Uma senha assim satisfaz a política (`validateStrongPassword`) e não protege nada — o
// vizinho de sala descobre a de todo mundo descobrindo a de um.
//
// Não existe também a opção de digitar. Duas portas, e a que se usa é a rápida — a digitada, que é
// a fraca. E a gerada tem uma propriedade que a digitada não tem: o contador NÃO A DECORA. Ele
// copia, repassa e esquece; não sobra na cabeça de ninguém uma senha "que costuma ser a daquele
// cliente".
//
// ⚠ ALFABETO SEM AMBIGUIDADE (sem `O/0`, `I/l/1`), e agrupada em blocos de quatro por hífen. Isto
// não é enfeite: esta senha vai ser DITADA por telefone ou digitada à mão a partir da tela. Uma
// senha que se transcreve errado volta como "não consigo entrar", e o contador troca de novo — o
// que gasta uma segunda troca, uma segunda linha de auditoria e uma segunda sessão revogada.
// ⚠ O hífen também é o que satisfaz a exigência de caractere especial da política, sem obrigar o
// gerador a sortear um símbolo que o cliente teria de identificar de ouvido.
const LETRAS_MINUSCULAS = "abcdefghijkmnpqrstuvwxyz"; // sem `l`, sem `o`
const LETRAS_MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem `I`, sem `O`
const DIGITOS = "23456789"; // sem `0`, sem `1`
const ALFABETO = LETRAS_MINUSCULAS + LETRAS_MAIUSCULAS + DIGITOS;

const BLOCOS = 3;
const TAMANHO_BLOCO = 4;

/** Um caractere sorteado com `crypto.randomInt` — nunca `Math.random`, que é previsível. */
function sortear(alfabeto) {
  return alfabeto[crypto.randomInt(0, alfabeto.length)];
}

/**
 * Gera a senha nova. ~12 caracteres de um alfabeto de 56 ≈ 69 bits de entropia, mais os hífens.
 *
 * ⚠ As três classes obrigatórias são plantadas em POSIÇÕES SORTEADAS DISTINTAS, não nas três
 * primeiras. Fixar as posições (maiúscula sempre no começo) é o que transforma 69 bits em muito
 * menos para quem conhece o gerador — e o gerador está neste arquivo, aberto.
 */
export function gerarSenhaDoPortal() {
  const total = BLOCOS * TAMANHO_BLOCO;
  const chars = Array.from({ length: total }, () => sortear(ALFABETO));

  const posicoes = new Set();
  while (posicoes.size < 3) posicoes.add(crypto.randomInt(0, total));
  const [pMin, pMai, pDig] = [...posicoes];
  chars[pMin] = sortear(LETRAS_MINUSCULAS);
  chars[pMai] = sortear(LETRAS_MAIUSCULAS);
  chars[pDig] = sortear(DIGITOS);

  const blocos = [];
  for (let i = 0; i < total; i += TAMANHO_BLOCO) {
    blocos.push(chars.slice(i, i + TAMANHO_BLOCO).join(""));
  }
  const senha = blocos.join("-");

  // ⚠ A política é conferida no que SAI, não presumida do desenho. O gerador satisfaz as quatro
  // regras por construção — mas ele e a política moram em arquivos diferentes, e a política já
  // mudou uma vez. Se um dia divergirem, é aqui que se descobre, e não no cliente que não entra.
  const check = validateStrongPassword(senha);
  if (!check.ok) {
    throw new SenhaDoPortalError(
      "senha_gerada_invalida",
      `A senha gerada não passou na política do sistema (${strongPasswordMessage(check.errors)}). `
        + "Nenhuma senha foi trocada.",
      500,
    );
  }
  return senha;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A LINHA DE AUDITORIA
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Grava a troca. Recebe `tx` porque TEM de acontecer no MESMO commit da senha nova — é a mesma
 * fronteira que `PasswordResetService.redefinirSenha` já escolheu para a revogação das sessões.
 *
 * Senha trocada sem linha de auditoria é o estado que esta tabela existe para tornar impossível:
 * quem define a senha do cliente pode entrar como ele e emitir nota em nome da empresa dele, e
 * "não sabemos quem trocou" não é uma resposta que este sistema pode dar.
 *
 * ⚠ NENHUM ARGUMENTO DESTA FUNÇÃO É A SENHA, e não há parâmetro para ela. Não é um esquecimento a
 * consertar: é a garantia, verificável lendo a assinatura, de que a senha não tem caminho até esta
 * tabela.
 */
export async function registrarTroca(tx, { userId, portalClientId = null, origem, ator = null }) {
  if (!ORIGENS[origem]) {
    throw new SenhaDoPortalError("origem_invalida", `Origem desconhecida: ${origem}`, 500);
  }
  return tx.portalPasswordChange.create({
    data: {
      userId: String(userId),
      portalClientId: portalClientId ? String(portalClientId) : null,
      origem,
      autorUserId: ator?.id ? String(ator.id) : null,
      // Cópia imutável: o autor pode ser apagado, e a linha continua contando quem foi.
      autorNome: ator?.name ? String(ator.name).slice(0, 200) : null,
      autorEmail: ator?.email ? String(ator.email).slice(0, 200) : null,
      ip: ator?.ip ? String(ator.ip).slice(0, 60) : null,
      userAgent: ator?.userAgent ? String(ator.userAgent).slice(0, 300) : null,
    },
  });
}

/** A última troca de cada usuário da lista. `Map<userId, troca>`; usuário sem troca não entra. */
async function ultimaTrocaPorUsuario(userIds) {
  if (!userIds.length) return new Map();
  const trocas = await prisma.portalPasswordChange.findMany({
    where: { userId: { in: userIds } },
    // ⚠ `select` explícito, e sem nada que se pareça com senha — não há coluna dessas na tabela, e
    // listar os campos aqui é o que faz uma coluna futura precisar ser adicionada de propósito.
    select: {
      userId: true,
      origem: true,
      autorUserId: true,
      autorNome: true,
      autorEmail: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const porUsuario = new Map();
  for (const t of trocas) {
    if (!porUsuario.has(t.userId)) porUsuario.set(t.userId, t);
  }
  return porUsuario;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// LEITURA — quem são os usuários do portal desta empresa, e como está a senha de cada um
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ A TELA PRECISA NOMEAR DE QUEM É A SENHA, e é esta função que dá o nome.
 *
 * Medido em produção (19/08/2026): 33 empresas, 33 usuários ativos, um por empresa, todos `OWNER`.
 * Hoje não há ambiguidade — mas `CompanyClientUser` é `@@unique([companyId, userId])`, o que
 * PERMITE dois. No dia em que houver, uma tela que diz só "a senha do portal" troca a senha de
 * alguém por engano, e ninguém descobre até o outro não conseguir entrar.
 *
 * Por isso a lista volta SEMPRE como lista, inclusive com um elemento só, e a rota de escrita
 * EXIGE o `userId` — não há caminho em que o servidor escolha o usuário sozinho.
 */
export async function listarAcessoDoPortal({ portalClientId }) {
  const vinculos = await prisma.companyClientUser.findMany({
    where: { companyId: String(portalClientId), status: "ACTIVE" },
    // ⚠ `select` EXPLÍCITO, e por isso mesmo perigoso: campo que não entre aqui volta `undefined`
    // sem erro nenhum, e a tela mostra em branco. Já mordeu este projeto três vezes esta semana
    // (`legacyCompanySelect`, `codigoMunicipioIbge`, os campos de NFS-e). Tudo que o cartão do
    // usuário mostra está nesta lista — nome, e-mail, papel e situação.
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const userIds = vinculos.map((v) => v.user?.id).filter(Boolean);
  const trocas = await ultimaTrocaPorUsuario(userIds);

  return vinculos
    .filter((v) => v.user?.id)
    .map((v) => ({
      userId: v.user.id,
      nome: v.user.name || null,
      email: v.user.email || null,
      papel: v.role,
      situacaoUsuario: v.user.status || null,
      vinculadoEm: v.createdAt,
      // `null` = NUNCA TROCADA desde que este registro passou a existir. A tela diz isso com todas
      // as letras em vez de inventar uma data: a senha pode ter sido definida no provisionamento da
      // empresa (`CompanyProvisioningService`, `ownerPassword`), que é anterior a esta tabela.
      ultimaTroca: trocas.get(v.user.id)
        ? {
            origem: trocas.get(v.user.id).origem,
            em: trocas.get(v.user.id).createdAt,
            autorUserId: trocas.get(v.user.id).autorUserId,
            autorNome: trocas.get(v.user.id).autorNome,
            autorEmail: trocas.get(v.user.id).autorEmail,
          }
        : null,
    }));
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// ESCRITA — o contador define a senha do usuário do portal
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Define uma senha NOVA para um usuário do portal desta empresa e devolve o texto claro UMA VEZ.
 *
 * ⚠ `confirmado: true` viaja explícito do front até aqui, e o service recusa sem ele — a mesma
 * disciplina de `revelarSenha` no cofre. A tela já confirmou; o duplo cinto é de propósito, porque
 * um dos dois lados sozinho já foi contornado antes neste projeto.
 *
 * ⚠ MULTI-TENANCY EM DOIS PONTOS, como no cofre: o middleware diz que este contador pode falar
 * desta empresa, e o `where` abaixo diz que este usuário é DESTA empresa. Sem o segundo, um
 * `userId` de outro cliente trocaria a senha dele passando pelo gate da empresa errada.
 */
export async function definirSenhaPeloEscritorio({
  portalClientId,
  userId,
  confirmado,
  ator = null,
}) {
  if (confirmado !== true) {
    throw new SenhaDoPortalError(
      "confirmacao_obrigatoria",
      "Trocar a senha do cliente exige confirmação explícita.",
      400,
    );
  }
  const pcId = String(portalClientId || "").trim();
  const uId = String(userId || "").trim();
  if (!pcId || !uId) {
    throw new SenhaDoPortalError("usuario_obrigatorio", "Informe de qual usuário é a senha.", 400);
  }

  const vinculo = await prisma.companyClientUser.findFirst({
    where: { companyId: pcId, userId: uId, status: "ACTIVE" },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!vinculo?.user?.id) {
    // ⚠ Uma recusa só para "não existe" e "é de outra empresa". Distinguir diria a um contador com
    // acesso a UMA empresa se um dado `userId` existe em OUTRA — enumeração de usuário pela porta
    // dos fundos, o mesmo vazamento que `/auth/forgot-password` fecha lá na frente.
    throw new SenhaDoPortalError(
      "usuario_nao_e_do_portal",
      "Este usuário não é um usuário ativo do portal desta empresa.",
      404,
    );
  }

  const senha = gerarSenhaDoPortal();
  const passwordHash = await bcrypt.hash(senha, 10);
  const agora = new Date();

  // ⚠ AS QUATRO ESCRITAS SÃO UMA TRANSAÇÃO SÓ:
  //
  //   1. a senha nova;
  //   2. TODAS as sessões do usuário revogadas;
  //   3. os pedidos de recuperação pendentes queimados;
  //   4. a linha de auditoria.
  //
  // ⚠ O ITEM 2 É O MOTIVO DE A TROCA SERVIR PARA ALGUMA COISA, e é o comportamento que
  // `/auth/change-password` e `/auth/reset-password` já têm (`schema.prisma`, model
  // `ClientSession`). Sem ele, a sessão antiga do cliente SOBREVIVE a uma senha trocada pelo
  // contador — e o caminho novo seria o único dos três em que trocar a senha não tira ninguém de
  // dentro, que é o oposto do que a troca serve.
  //
  // ⚠ O ITEM 3 pelo mesmo motivo: um link de "esqueci minha senha" pedido ANTES desta troca ainda
  // estaria vivo, e usá-lo desfaria em silêncio a senha que o contador acabou de repassar.
  //
  // ⚠ O ITEM 4 não é acessório: senha trocada sem registro de quem trocou é exatamente o estado que
  // a tabela existe para impedir. Se ele falhar, NADA acontece — inclusive a senha não muda.
  //
  // ⚠ A revogação é escrita à mão aqui em vez de chamar `ClientSessionService.revokeAllForUser`
  // porque aquela roda FORA de transação. A regra é a mesma; o que muda é a fronteira. É o mesmo
  // parágrafo que já está em `PasswordResetService.redefinirSenha`.
  const troca = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: uId }, data: { passwordHash } });
    await tx.clientSession.updateMany({
      where: { userId: uId, revokedAt: null },
      data: { revokedAt: agora },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: uId, usedAt: null },
      data: { usedAt: agora },
    });
    return registrarTroca(tx, {
      userId: uId,
      portalClientId: pcId,
      origem: ORIGENS.ESCRITORIO,
      ator,
    });
  });

  return {
    // ⚠ ÚNICA VEZ QUE ESTE VALOR EXISTE FORA DA CABEÇA DE QUEM O LER. Quem consome esta resposta
    // não pode gravá-la em lugar nenhum — nem `localStorage`, nem `title`, nem log, nem numa
    // listagem posterior. Não há segunda chance: o que está no banco é bcrypt.
    senha,
    usuario: {
      userId: vinculo.user.id,
      nome: vinculo.user.name || null,
      email: vinculo.user.email || null,
      papel: vinculo.role,
    },
    troca: {
      origem: ORIGENS.ESCRITORIO,
      em: troca?.createdAt || agora,
      autorUserId: ator?.id || null,
      autorNome: ator?.name || null,
      autorEmail: ator?.email || null,
    },
  };
}
