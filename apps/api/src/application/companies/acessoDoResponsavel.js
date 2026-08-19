// TROCAR O E-MAIL DO RESPONSÁVEL — a decisão de RENOMEAR × CRIAR ACESSO PRÓPRIO.
//
// ⚠⚠ POR QUE ESTE ARQUIVO EXISTE (defeito de produção, 19/08/2026): o dono entrou no portal do
// cliente com UM login e enxergou NOVE empresas. `PATCH /firm/companies/:id` pegava o usuário
// `OWNER` da empresa e fazia `tx.user.update({ data: { email } })` — RENOMEAVA A CONTA. Como o
// mesmo e-mail estava cadastrado em várias empresas (e `CompanyProvisioningService` REUSA o `User`
// quando o e-mail já existe), todas apontavam para uma conta só: trocar o e-mail de UMA
// renomeava a conta compartilhada e LEVAVA OS NOVE VÍNCULOS JUNTO. O resultado é o oposto do
// pedido — em vez de a empresa editada se separar, as outras passaram a pertencer ao login novo.
//
// ⚠ A REGRA É PURA E MORA AQUI, SOZINHA, porque ela é a entrega inteira. Escrita dentro da rota
// (que tem 5 mil linhas e é compartilhada por dezenas de fluxos) ela não teria nome, não teria
// teste próprio, e a próxima pessoa a mexer no bloco do responsável não saberia que existe.
//
// ⚠ NADA AQUI FALA COM O BANCO. Quem conta os vínculos é a rota, dentro da transação; esta função
// só decide a partir da contagem. É o que permite exercer as três saídas sem Prisma nenhum.

import crypto from "crypto";
import bcrypt from "bcryptjs";

/** As três saídas possíveis. Vocabulário fechado — a rota faz `switch` sobre ele. */
export const DECISAO = Object.freeze({
  /** A conta é desta empresa e SÓ dela: renomear continua certo. É o caso comum. */
  RENOMEAR: "RENOMEAR",
  /** A conta é de várias: o contador precisa ver a consequência ANTES. Nada foi escrito. */
  PEDIR_CONFIRMACAO: "PEDIR_CONFIRMACAO",
  /** Confirmado: a editada ganha acesso próprio; as outras ficam exatamente onde estavam. */
  CRIAR_ACESSO_PROPRIO: "CRIAR_ACESSO_PROPRIO",
});

/**
 * Decide o que fazer com a troca de e-mail do responsável.
 *
 * @param {number} vinculosDaConta  Quantas empresas a conta do OWNER atende HOJE (vínculos
 *   `CompanyClientUser` ACTIVE daquele `userId`). ⚠ Contado dentro da MESMA transação da escrita:
 *   contar fora abriria a janela em que uma empresa nova é vinculada entre a contagem e o update,
 *   e o arrasto voltaria por essa fresta.
 * @param {boolean} confirmado  O contador viu o aviso na tela e confirmou.
 */
export function decidirTrocaDeEmail({ vinculosDaConta, confirmado }) {
  // ⚠ `<= 1` e não `=== 1`: contagem 0 é estado impossível (a rota só chega aqui com um vínculo
  // OWNER na mão), mas se acontecer, renomear a conta de ninguém não arrasta ninguém. Já um
  // `!== 1` mandaria o caso degenerado para o caminho que CRIA conta — escrita a mais por causa
  // de um estado que ninguém entende.
  if (Number(vinculosDaConta) <= 1) return DECISAO.RENOMEAR;
  if (confirmado === true) return DECISAO.CRIAR_ACESSO_PROPRIO;
  return DECISAO.PEDIR_CONFIRMACAO;
}

/**
 * O hash da senha da conta NOVA — que nasce SEM SENHA UTILIZÁVEL.
 *
 * ⚠⚠ NÃO EXISTE SENHA EM CLARO AQUI, e não pode passar a existir. O segredo é sorteado, hasheado
 * e descartado dentro desta função: nada o devolve, nada o registra. Ninguém — nem o contador, nem
 * o cliente, nem quem tem o dump do banco — pode entrar com esta conta até que alguém DEFINA uma
 * senha pela porta própria (`POST /firm/companies/:id/acesso-portal/:userId/senha`), que audita,
 * revoga sessões e exibe o valor UMA vez.
 *
 * ⚠ Aceitar a `ownerPassword` do payload aqui seria criar uma SEGUNDA porta de definição de senha,
 * sem auditoria e sem exibição controlada — exatamente o que `SenhaDoPortalService` existe para
 * impedir. A rota não a repassa, e não deve passar a repassar.
 *
 * ⚠ `passwordHash` é NOT NULL no schema, então não há a opção de "nascer sem hash". Um valor
 * fixo ("!", "sem-senha") seria pior que nenhum: bastaria alguém descobrir uma vez qual é o texto
 * que gera aquele hash para entrar em toda conta criada por este caminho. 32 bytes de
 * `crypto.randomBytes` não têm essa propriedade.
 */
export async function hashDeSenhaInutilizavel() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}

/**
 * O estado da conta nova.
 *
 * ⚠ `"active"` é MEDIDO, não escolhido por gosto: `definirSenhaPeloEscritorio`
 * (`application/auth/SenhaDoPortalService.js`) grava só `passwordHash` e NÃO mexe em `status`, e
 * `routes/auth.js` recusa login com `user_not_active` para qualquer status diferente de `active`.
 * Nascer `"pending"` faria a senha definida pelo contador não servir para nada, e o cliente ficaria
 * fora sem que ninguém soubesse por quê. Quem impede a entrada é o hash, não o status.
 */
export const STATUS_DA_CONTA_NOVA = "active";
