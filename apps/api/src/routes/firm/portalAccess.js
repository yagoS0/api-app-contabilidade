// ACESSO DO CLIENTE AO PORTAL — quem é o usuário daquela empresa, e a troca da senha dele.
// Mount: /firm/companies/:companyId/acesso-portal
//
// PEDIDO DO DONO (19/08/2026): *"o contador deve poder mudar a senha via cadastro da empresa, como
// o cliente também pode via recuperação ou o próprio cadastro; mas quando mudar, o portal do
// contador também muda."*
//
// ⚠⚠ É UMA SENHA SÓ, e por isso NÃO HÁ SINCRONIZAÇÃO NENHUMA AQUI. O "portal do contador também
// muda" não é uma segunda escrita: é `User.passwordHash`, a mesma linha que `/auth/change-password`
// e `/auth/reset-password` escrevem. O que o portal do contador precisa refletir é o ESTADO — a
// última troca e por qual caminho — e é isso que o `GET` devolve.
//
// ⚠⚠ ARQUIVO PRÓPRIO, E ROTA PRÓPRIA — não é o `PATCH` do cadastro com um campo a mais. Uma senha
// trocada como efeito colateral de salvar um telefone é exatamente o que este projeto evita, e
// está escrito no `CLAUDE.md` de `features/companies`. É a mesma decisão de
// `PATCH .../emissao-cliente`, pelo mesmo motivo: ato de consequência tem porta própria,
// confirmação própria e auditoria própria.
//
// ⚠ E não entra em `companyCredentials.js` (o cofre), apesar de as duas telas serem vizinhas: o
// cofre guarda senhas de TERCEIROS de forma recuperável, de propósito. Esta NÃO é recuperável e não
// pode passar a ser. Juntar as duas no mesmo arquivo faria a próxima pessoa reaproveitar o
// mecanismo errado.
//
// ⚠ NÃO EXISTE ROTA DISTO NO APP DO CLIENTE. O cliente troca a senha dele pelos caminhos que já
// existem (`/auth/change-password` e o fluxo de recuperação). Nada aqui alcança `/client/`.
//
// ⚠⚠ NADA AQUI EMITE, CANCELA OU TRANSMITE NFS-e.

import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  listarAcessoDoPortal,
  definirSenhaPeloEscritorio,
  SenhaDoPortalError,
  PAPEL_MINIMO_DEFINIR_SENHA,
} from "../../application/auth/SenhaDoPortalService.js";

export function createPortalAccessRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  // ⚠ O `err` nunca é serializado inteiro para o cliente nem para o log — mesma regra do cofre.
  // Um erro desconhecido vindo daqui pode carregar um payload do Prisma, e o payload do `user.update`
  // deste fluxo carrega o `passwordHash`.
  function falhar(res, err, contexto) {
    const conhecido = err instanceof SenhaDoPortalError;
    if (!conhecido) {
      log?.error?.({ err: err?.message || "erro", ...contexto }, "Falha no acesso do cliente ao portal");
    }
    return res.status(conhecido ? err.status : 500).json({
      ok: false,
      error: conhecido ? err.code : "erro_interno",
      message: conhecido ? err.message : "Erro interno.",
    });
  }

  const pcId = (req) => String(req.params.companyId);

  // O mesmo peso de `requireFirmCompanyAccess` — é ele quem manda; isto só ANTECIPA a resposta para
  // a tela desabilitar o botão NOMEANDO o motivo, em vez de o contador descobrir o 403 clicando.
  const PESO = { STAFF: 1, ACCOUNTANT: 2, FIRM_ADMIN: 3 };
  const podeDefinirSenhaPara = (req) =>
    (PESO[String(req.access?.role || "").toUpperCase()] || 0)
    >= (PESO[PAPEL_MINIMO_DEFINIR_SENHA] || 0);

  // Quem está agindo — vai para a auditoria, como cópia imutável.
  const atorDe = (req) => ({
    id: req.auth?.user?.id || null,
    name: req.auth?.user?.name || null,
    email: req.auth?.user?.email || null,
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get?.("user-agent") || null,
  });

  /**
   * Quem são os usuários do portal desta empresa e como está a senha de cada um.
   *
   * ⚠ LEITURA ABERTA A QUALQUER PAPEL DO ESCRITÓRIO (só `requireFirmCompanyAccess`), enquanto a
   * escrita exige `ACCOUNTANT`+. Fechar a leitura no mesmo papel faria a seção inteira virar um
   * erro vermelho para o `STAFF` — e o que ela mostra (nome, e-mail e QUANDO a senha mudou) o
   * `STAFF` já vê no payload da empresa. O que ele não pode é trocar, e é isso que `podeDefinirSenha`
   * diz à tela.
   *
   * ⚠ NENHUMA SENHA, NEM MÁSCARA, NEM TAMANHO sai daqui. Não há o que mascarar: o que está no banco
   * é bcrypt.
   */
  router.get("/acesso-portal", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const usuarios = await listarAcessoDoPortal({ portalClientId: pcId(req) });
      return res.json({
        ok: true,
        usuarios,
        podeDefinirSenha: podeDefinirSenhaPara(req),
        papelMinimoDefinirSenha: PAPEL_MINIMO_DEFINIR_SENHA,
      });
    } catch (err) {
      return falhar(res, err, { companyId: pcId(req) });
    }
  });

  /**
   * DEFINE uma senha nova para UM usuário do portal e devolve o texto claro UMA VEZ.
   *
   * ⚠⚠ ISTO É TRANSFERÊNCIA DE AUTORIDADE. Quem define a senha do cliente pode entrar como ele e
   * EMITIR NFS-e em nome da empresa dele (`middlewares/emissaoNfseGate.js` deixa passar
   * `OWNER`/`CLIENT_ADMIN`). Daí `ACCOUNTANT`+, o mesmo gate de `PATCH .../emissao-cliente`, e daí
   * a linha de auditoria escrita na mesma transação da senha.
   *
   * ⚠ O `userId` ESTÁ NA URL e é OBRIGATÓRIO. Não existe "a senha do portal desta empresa": existe
   * a senha DE UM USUÁRIO. Hoje há um por empresa (medido: 33/33, todos `OWNER`), mas o servidor
   * nunca escolhe sozinho — no dia do segundo usuário, escolher em silêncio troca a senha de quem
   * ninguém pediu.
   *
   * ⚠ POST, e não PATCH/PUT, por três motivos concretos — os mesmos de `.../credenciais/:id/revelar`:
   * ela ESCREVE a linha de auditoria; a resposta CARREGA UM SEGREDO, e um GET/idempotente entra em
   * histórico de navegador e log de proxy como "a URL que traz a senha"; e um verbo repetível seria
   * repetido de graça por refresh e "abrir em nova aba" — cada repetição sendo uma senha NOVA,
   * invalidando a que o contador acabou de ditar ao cliente.
   */
  router.post(
    "/acesso-portal/:userId/senha",
    requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_DEFINIR_SENHA }),
    async (req, res) => {
      try {
        const resultado = await definirSenhaPeloEscritorio({
          portalClientId: pcId(req),
          userId: String(req.params.userId || ""),
          confirmado: req.body?.confirmado === true,
          ator: atorDe(req),
        });
        // ⚠ `no-store` porque o corpo desta resposta contém a senha em claro. Sem ele, o cache do
        // navegador e qualquer proxy no caminho passam a ter uma cópia em disco de um valor que a
        // tela promete mostrar UMA VEZ.
        res.setHeader("Cache-Control", "no-store");
        // ⚠ O LOG NÃO TEM A SENHA — e nunca pode ganhar um campo ao lado. `userId`, empresa e autor
        // bastam para reconstruir o ato; o registro de verdade é a linha em `senhas_portal_trocas`,
        // e é lá que ele deve estar. Mesma regra do `revelar` do cofre, que não loga nem sucesso.
        log?.info?.(
          {
            portalClientId: pcId(req),
            userId: resultado.usuario.userId,
            autorUserId: req.auth?.user?.id || null,
          },
          "Senha do portal do cliente DEFINIDA pelo escritório; sessões revogadas",
        );
        return res.json({
          ok: true,
          senha: resultado.senha,
          usuario: resultado.usuario,
          troca: resultado.troca,
        });
      } catch (err) {
        return falhar(res, err, { companyId: pcId(req), userId: String(req.params.userId || "") });
      }
    },
  );

  return router;
}
