import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../infrastructure/db/prisma.js";
import { EmailService } from "../../infrastructure/mail/EmailService.js";
import { registrarTroca, ORIGENS } from "./SenhaDoPortalService.js";
import {
  PASSWORD_RESET_TTL_MINUTES,
  PORTAL_CLIENTE_WEB_URL,
  USE_GMAIL_API,
  FROM,
  SMTP_HOST,
  GMAIL_DELEGATED_USER,
  GOOGLE_APPLICATION_CREDENTIALS,
  GOOGLE_APPLICATION_CREDENTIALS_JSON,
} from "../../config.js";

// Recuperação de senha ("esqueci minha senha") — a parte que NÃO fala HTTP.
//
// ⚠ ESTE MÓDULO NUNCA LOGA NADA. Não é esquecimento: o token em claro passa por aqui, e a única
// forma de garantir que ele não vaza para um arquivo de log é não haver, neste arquivo, nenhum
// caminho que escreva. Quem loga é a rota — e ela só recebe `userId`, nunca o token.
//
// A forma do token é a MESMA do refresh opaco de `ClientSessionService`, de propósito: o projeto
// já decidiu como guarda credencial (hash em repouso, claro só em trânsito) e uma segunda forma
// seria uma segunda superfície a auditar.

/** SHA-256 em hex — idêntico ao `hashToken` de `ClientSessionService`. */
function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

/**
 * 32 bytes de entropia criptográfica → 64 caracteres hex.
 *
 * ⚠ NUNCA `uuid`: um UUID v4 tem 122 bits e, pior, formato reconhecível e geradores que já foram
 * previsíveis. E nunca derivado de e-mail, id ou timestamp — derivar significa que quem conhece a
 * entrada reconstrói o token sem nunca ver a caixa de e-mail, que é a falha inteira desta tela.
 */
function novoTokenCru() {
  return crypto.randomBytes(32).toString("hex");
}

function prazoMs() {
  return PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
}

/**
 * O mailer está configurado a ponto de PODER enviar?
 *
 * ⚠ Isto é checado ANTES de qualquer consulta pelo e-mail pedido, e a ordem é a regra: a resposta
 * depende só do estado do SERVIDOR, nunca de qual endereço foi digitado. Checar depois de achar (ou
 * não achar) o usuário transformaria o 503 num oráculo de existência — exatamente o vazamento que
 * a resposta genérica existe para fechar.
 */
export function mailerConfigurado() {
  if (!FROM) return false;
  if (USE_GMAIL_API) {
    const temCredencial = Boolean(
      String(GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() ||
        String(GOOGLE_APPLICATION_CREDENTIALS || "").trim()
    );
    return temCredencial && Boolean(String(GMAIL_DELEGATED_USER || "").trim());
  }
  return Boolean(String(SMTP_HOST || "").trim());
}

/** A base do portal do cliente existe? Sem ela não há link a enviar. */
export function portalConfigurado() {
  return Boolean(PORTAL_CLIENTE_WEB_URL);
}

/**
 * O link que vai no e-mail. A base vem de `config.js` — NUNCA cravada, e nunca lida de um header
 * da requisição (`Host`/`X-Forwarded-Host` são controlados por quem chama: um atacante pediria a
 * redefinição da vítima apontando o link para o servidor dele e receberia o token de volta).
 */
export function montarLinkRedefinicao(tokenCru) {
  return `${PORTAL_CLIENTE_WEB_URL}/redefinir-senha?token=${encodeURIComponent(tokenCru)}`;
}

// Mesma função local que `GuideCompanyEmailService` e `CompanyDocumentsEmailService` já carregam.
// Duplicada pelo mesmo motivo que lá: três linhas repetidas são melhores que uma abstração
// prematura (regra do projeto), e o nome do usuário é dado livre que entra em HTML.
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * O e-mail da redefinição.
 *
 * ⚠ O TOKEN EM CLARO EXISTE AQUI E SÓ AQUI, dentro do corpo da mensagem. Ele não é devolvido, não
 * é logado e não aparece no `subject` (assunto vai para índices de servidor de e-mail e para a
 * lista de notificações do celular — que qualquer um lê por cima do ombro).
 *
 * ⚠ A mensagem diz o que fazer se NÃO foi o usuário que pediu. Sem essa frase, quem recebe um
 * pedido que não fez não tem como saber se deve se preocupar.
 */
export async function enviarEmailRedefinicao({ to, nome, token, expiraEmMinutos }) {
  const saudacao = nome ? `Olá, <strong>${escapeHtml(nome)}</strong>,` : "Olá,";
  const link = montarLinkRedefinicao(token);
  const linkSafe = escapeHtml(link);
  const html = `
    <!doctype html>
    <html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px">
    <p>${saudacao}</p>
    <p>Recebemos um pedido para redefinir a senha do seu acesso ao Portal do Cliente.</p>
    <p style="margin:1.5em 0">
      <a href="${linkSafe}" style="background:#1f5eff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
        Criar uma nova senha
      </a>
    </p>
    <p>Se o botão não funcionar, copie e cole este endereço no navegador:</p>
    <p style="word-break:break-all;color:#6b7280">${linkSafe}</p>
    <p><strong>Este link vale por ${escapeHtml(expiraEmMinutos)} minutos</strong> e só pode ser usado uma vez.</p>
    <p>Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo e ninguém
    consegue alterá-la sem este link.</p>
    <p style="margin-top:1.5em">Um abraço,<br><strong>Equipe Belgen Contabilidade</strong></p>
    </body></html>
  `;
  await new EmailService().send({
    to,
    subject: "Redefinição de senha — Portal do Cliente",
    html,
  });
}

export class PasswordResetService {
  /**
   * Cria um pedido de redefinição e devolve o token EM CLARO — uma única vez, para o chamador
   * montar o e-mail. Nada mais no sistema volta a ver este valor.
   *
   * ⚠ Invalida os pedidos pendentes anteriores do mesmo usuário. Sem isso, pedir "esqueci minha
   * senha" três vezes deixaria três links vivos ao mesmo tempo, e o mais antigo — o que já teve
   * mais tempo para vazar — continuaria valendo.
   */
  static async criarPedido(userId, { requestIp } = {}) {
    const tokenCru = novoTokenCru();
    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: String(userId), usedAt: null },
        data: { usedAt: agora },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: String(userId),
          tokenHash: hashToken(tokenCru),
          expiresAt: new Date(agora.getTime() + prazoMs()),
          requestIp: requestIp ? String(requestIp).slice(0, 60) : null,
        },
      });
    });

    return { token: tokenCru, expiraEmMinutos: PASSWORD_RESET_TTL_MINUTES };
  }

  /**
   * Consome um token e troca a senha.
   *
   * Devolve `{ ok: true, userId }` ou `{ ok: false }` — e o falso é UM SÓ, deliberadamente. Token
   * inexistente, adulterado, expirado, já consumido e de usuário apagado saem todos pela mesma
   * porta, sem motivo anexo. Distinguir "já foi usado" de "não existe" confirma ao atacante que o
   * token existiu, que empresa o pediu e quando.
   */
  static async redefinirSenha(tokenCru, novaSenha) {
    if (!tokenCru || typeof tokenCru !== "string") return { ok: false };

    const registro = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(tokenCru) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (!registro) return { ok: false };
    if (registro.usedAt) return { ok: false };
    if (registro.expiresAt.getTime() <= Date.now()) return { ok: false };

    const passwordHash = await bcrypt.hash(String(novaSenha), 10);
    const agora = new Date();

    // ⚠ AS TRÊS ESCRITAS SÃO UMA TRANSAÇÃO SÓ, e a do meio é a que costuma faltar.
    //
    //  1. a senha nova;
    //  2. o token queimado — junto de qualquer outro pendente do mesmo usuário;
    //  3. TODAS as sessões revogadas.
    //
    // O item 3 é o motivo de a tela poder prometer segurança. Quem redefine a senha porque
    // desconfia de invasão continuaria com o invasor logado no `ClientSession` dele — o refresh
    // opaco sobrevive à troca de senha se ninguém o revogar. É a MESMA garantia que
    // `POST /auth/change-password` já dá (`ClientSessionService.revokeAllForUser`); esta rota não
    // podia dar menos, já que é a que se usa justamente quando algo deu errado.
    //
    // Se qualquer passo falhar, nada acontece: senha trocada com token vivo, ou token queimado com
    // senha velha, são os dois estados intermediários que uma transação evita.
    //
    // ⚠ Por isso a revogação é escrita à mão aqui em vez de chamar
    // `ClientSessionService.revokeAllForUser`: aquela roda fora de transação, e a revogação precisa
    // acontecer no MESMO commit da troca de senha. A regra é a mesma; o que muda é a fronteira.
    //
    // ⚠ A QUARTA ESCRITA — a linha de auditoria — entrou em 19/08/2026, junto da porta do contador
    // (`POST /firm/companies/:id/acesso-portal/:userId/senha`). Ela está AQUI, e não só lá, porque
    // é UMA SENHA SÓ com TRÊS caminhos: se só o caminho do escritório registrasse, a tela do
    // contador diria "trocada por mim em tal dia" para uma senha que o cliente redefiniu depois
    // pelo e-mail — o estado errado exatamente no caso em que ele importa.
    //
    // ⚠ NADA DA SENHA, NEM DO TOKEN, entra nessa linha (ver a assinatura de `registrarTroca`).
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: registro.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: registro.userId, usedAt: null },
        data: { usedAt: agora },
      });
      await tx.clientSession.updateMany({
        where: { userId: registro.userId, revokedAt: null },
        data: { revokedAt: agora },
      });
      // O autor é o PRÓPRIO dono da senha: quem redefine pelo link é quem tem a caixa de e-mail.
      // Nome e e-mail ficam nulos de propósito — este módulo não consulta a `User`, e a tela sabe
      // dizer "pelo próprio cliente" só pela `origem`.
      await registrarTroca(tx, {
        userId: registro.userId,
        portalClientId: null,
        origem: ORIGENS.CLIENTE_RECUPERACAO,
        ator: { id: registro.userId },
      });
    });

    return { ok: true, userId: registro.userId };
  }
}
