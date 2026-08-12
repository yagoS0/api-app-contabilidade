// Cofre de credenciais + "outras informações" da empresa.
// Mount: /firm/companies/:companyId/{credenciais,informacoes}
//
// ⚠ ARQUIVO PRÓPRIO, e não mais um bloco em `companyDocuments.js` (que já junta documentos e
// anotações "porque são pequenos e moram no mesmo lugar da UI"). O critério lá é tamanho; aqui é
// consequência: esta é a única superfície do sistema que devolve uma senha de cliente, e o gate de
// papel dela é diferente do gate de tudo que está do lado.
//
// ⚠ MULTI-TENANCY: `requireFirmCompanyAccess` em TODA rota (nenhuma exceção, nem nas de leitura), e
// o `portalClientId` viaja para o service em todo `where`. As duas coisas, não uma: o middleware
// diz que este usuário pode falar desta empresa; o `where` diz que este registro é desta empresa.
//
// ⚠ NÃO EXISTE ROTA DISTO NO APP DO CLIENTE. Tudo mora sob `/firm/`; os papéis
// `CLIENT: OWNER|CLIENT_ADMIN|FINANCEIRO` não alcançam nada aqui. Expor a senha do cliente no
// portal dele é decisão do dono — ver o cabeçalho de `CompanyCredentialsService.js`.

import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  listar,
  criar,
  atualizar,
  remover,
  revelarSenha,
  listarAcessos,
  listarInfos,
  criarInfo,
  atualizarInfo,
  removerInfo,
  estadoDoCofre,
  CompanyCredentialError,
  PAPEL_MINIMO_VER_LISTA,
  PAPEL_MINIMO_REVELAR,
  PAPEL_MINIMO_ESCREVER,
  PAPEL_MINIMO_INFO_LER,
  PAPEL_MINIMO_INFO_ESCREVER,
} from "../../application/companies/CompanyCredentialsService.js";

export function createCompanyCredentialsRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  // ⚠ O `err` NUNCA é serializado para o cliente e NUNCA vai inteiro para o log. Erro desconhecido
  // vindo daqui pode carregar um payload do Prisma, e um payload do Prisma desta tabela carrega a
  // coluna cifrada. Só a mensagem do erro é logada, e só as mensagens escritas à mão no service
  // chegam ao usuário.
  function falhar(res, err, contexto) {
    const conhecido = err instanceof CompanyCredentialError;
    if (!conhecido) log?.error?.({ err: err?.message || "erro", ...contexto }, "Falha no cofre de credenciais");
    return res.status(conhecido ? err.status : 500).json({
      ok: false,
      error: conhecido ? err.code : "erro_interno",
      message: conhecido ? err.message : "Erro interno.",
    });
  }

  const pcId = (req) => String(req.params.companyId);

  // O mesmo peso de `requireFirmCompanyAccess` — é ele quem manda; isto só ANTECIPA a resposta para
  // a tela poder desabilitar o botão com o motivo à vista, em vez de deixar o contador descobrir o
  // 403 clicando. ⚠ Antecipar não é substituir: quem recusa continua sendo o middleware.
  const PESO = { STAFF: 1, ACCOUNTANT: 2, FIRM_ADMIN: 3 };
  const podeRevelarPara = (req) =>
    (PESO[String(req.access?.role || "").toUpperCase()] || 0) >= (PESO[PAPEL_MINIMO_REVELAR] || 0);

  // Quem está agindo — vai para a auditoria. `motivo` só existe na revelação.
  const atorDe = (req, motivo) => ({
    id: req.auth?.user?.id || null,
    email: req.auth?.user?.email || null,
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get?.("user-agent") || null,
    motivo: motivo ?? null,
  });

  // ── Credenciais ─────────────────────────────────────────────────────────────────────────────

  router.get("/credenciais", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_VER_LISTA }), async (req, res) => {
    try {
      const credenciais = await listar({ portalClientId: pcId(req) });
      // `cofre` acompanha a listagem para a tela poder DIZER com o que a senha está protegida.
      // Ver `estadoDoCofre` — nenhum segredo sai nele.
      return res.json({
        ok: true,
        credenciais,
        cofre: estadoDoCofre(),
        podeRevelar: podeRevelarPara(req),
        papelMinimoRevelar: PAPEL_MINIMO_REVELAR,
      });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  // ⚠ LITERAL ANTES DO CURINGA. Hoje não há `GET /credenciais/:credentialId`, então nada a engole —
  // mas o dia em que alguém acrescentar um, "acessos" viraria um id e o histórico responderia 404
  // falando de credencial inexistente. O projeto já tem o precedente disso em
  // `/companies/annual` e nas rotas literais de parcelamento.
  //
  // Mesmo papel de revelar: saber QUEM olhou a senha do cliente é informação sobre as pessoas do
  // escritório, não relatório operacional.
  router.get("/credenciais/acessos", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_REVELAR }), async (req, res) => {
    try {
      const acessos = await listarAcessos({ portalClientId: pcId(req), limite: req.query?.limite });
      return res.json({ ok: true, acessos });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.post("/credenciais", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_ESCREVER }), async (req, res) => {
    try {
      const credencial = await criar({
        portalClientId: pcId(req),
        rotulo: req.body?.rotulo,
        login: req.body?.login,
        senha: req.body?.senha,
        observacao: req.body?.observacao,
        ator: atorDe(req),
      });
      return res.status(201).json({ ok: true, credencial });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.patch("/credenciais/:credentialId", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_ESCREVER }), async (req, res) => {
    try {
      // ⚠ `senha` é repassada com `hasOwnProperty`, não com `req.body?.senha`. Ausente = não mexer;
      // `""` = apagar. Um `|| undefined` colapsaria os dois casos e tornaria "apagar a senha"
      // inalcançável pela tela. Ver o comentário de `atualizar` no service.
      const temSenhaNoCorpo = Object.prototype.hasOwnProperty.call(req.body || {}, "senha");
      const credencial = await atualizar({
        portalClientId: pcId(req),
        credentialId: String(req.params.credentialId),
        rotulo: req.body?.rotulo,
        login: req.body?.login,
        senha: temSenhaNoCorpo ? req.body.senha : undefined,
        observacao: req.body?.observacao,
        ator: atorDe(req),
      });
      return res.json({ ok: true, credencial });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.delete("/credenciais/:credentialId", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_ESCREVER }), async (req, res) => {
    try {
      const removida = await remover({
        portalClientId: pcId(req),
        credentialId: String(req.params.credentialId),
        ator: atorDe(req),
      });
      return res.json({ ok: true, removida });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  // ⚠ A ÚNICA rota que devolve uma senha.
  //
  // POST, não GET, e por três motivos concretos: ela ESCREVE (a linha de auditoria); um GET entra
  // no histórico do navegador e em log de proxy como uma URL que "traz a senha"; e um GET é
  // repetido de graça por refresh, prefetch e "abrir em nova aba" — cada repetição seria uma linha
  // de revelação que ninguém pediu, envenenando a própria auditoria.
  //
  // O papel mínimo é o mais alto do arquivo (`PAPEL_MINIMO_REVELAR`). Ver a decisão nº 1 no service.
  router.post("/credenciais/:credentialId/revelar", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_REVELAR }), async (req, res) => {
    try {
      const revelada = await revelarSenha({
        portalClientId: pcId(req),
        credentialId: String(req.params.credentialId),
        confirmado: req.body?.confirmado === true,
        ator: atorDe(req, req.body?.motivo),
      });
      // ⚠ NENHUM log aqui — nem de sucesso. Um `log.info({ credentialId, usuario })` pareceria
      // inofensivo e seria o começo do caminho que termina com alguém acrescentando o campo ao lado.
      // O registro desta ação é a linha em `company_credential_acessos`, e é lá que ele deve estar.
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, ...revelada });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  // ── "Outras informações" — NÃO cifradas ─────────────────────────────────────────────────────

  router.get("/informacoes", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_INFO_LER }), async (req, res) => {
    try {
      const informacoes = await listarInfos({ portalClientId: pcId(req) });
      // `cifrado: false` viaja no payload de propósito: a tela não deve depender de lembrar disso.
      return res.json({ ok: true, informacoes, cifrado: false });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.post("/informacoes", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_INFO_ESCREVER }), async (req, res) => {
    try {
      const informacao = await criarInfo({
        portalClientId: pcId(req),
        rotulo: req.body?.rotulo,
        valor: req.body?.valor,
        ator: atorDe(req),
      });
      return res.status(201).json({ ok: true, informacao });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.patch("/informacoes/:infoId", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_INFO_ESCREVER }), async (req, res) => {
    try {
      const informacao = await atualizarInfo({
        portalClientId: pcId(req),
        infoId: String(req.params.infoId),
        rotulo: req.body?.rotulo,
        valor: req.body?.valor,
      });
      return res.json({ ok: true, informacao });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  router.delete("/informacoes/:infoId", requireFirmCompanyAccess({ minRole: PAPEL_MINIMO_INFO_ESCREVER }), async (req, res) => {
    try {
      const removida = await removerInfo({ portalClientId: pcId(req), infoId: String(req.params.infoId) });
      return res.json({ ok: true, removida });
    } catch (err) { return falhar(res, err, { companyId: pcId(req) }); }
  });

  return router;
}
