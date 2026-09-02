// PLANEJAMENTO TRIBUTÁRIO — os dados da empresa para a simulação, e a FOTO do que foi simulado.
//
// ⚠⚠ O PLANEJAMENTO CONTINUA NÃO GRAVANDO CADASTRO NEM LANÇAMENTO. Esta frase abria o arquivo
// ("UMA rota, GET, sem efeito colateral") e ficou parcialmente falsa em 01/09/2026, quando o dono
// pediu que a simulação pudesse ser *"impressa, salva e colocada na área de documento"*. O que
// passou a existir é a gravação de uma FOTO da própria simulação — nada de cadastro, nada de
// lançamento contábil, nada de ato fiscal. A distinção é o ponto: guardar o que foi entregue ao
// cliente não é escrever no cadastro dele.
//
// ⚠ Multi-tenancy: `requireFirmCompanyAccess()` — a mesma guarda das demais rotas por empresa. O id
// vem do PATH e é conferido contra `CompanyFirmAccess`; nada aqui confia no que o navegador mandou.
// A lista que alimenta o seletor da tela é a de `GET /firm/companies`, que já é escopada pelo mesmo
// critério de `empresasVisiveis` — não há uma quarta leitura de escopo neste módulo.

import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { montarDadosPlanejamento } from "../../application/planejamento/DadosPlanejamentoService.js";
import {
  salvarSimulacao,
  listarSimulacoes,
  gerarDocumentoDaSimulacao,
  SimulacaoPlanejamentoError,
} from "../../application/planejamento/SimulacaoPlanejamentoService.js";
import { prisma } from "../../infrastructure/db/prisma.js";

export function createPlanejamentoRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  router.get("/planejamento", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const dados = await montarDadosPlanejamento({ portalClientId });
      if (!dados) return res.status(404).json({ ok: false, error: "company_not_found" });
      return res.json({ ok: true, ...dados });
    } catch (err) {
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao montar dados de planejamento");
      return res.status(500).json({ ok: false, error: "planejamento_fetch_failed" });
    }
  });

  // ─── A FOTO DA SIMULAÇÃO ────────────────────────────────────────────────────────────────────
  //
  // ⚠ `minRole: "ACCOUNTANT"` nas duas escritas, no molde da `emissao-nfse`: o planejamento é
  // documento que vai ao cliente, e quem o assina é o contador.

  router.get("/planejamento/simulacoes", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const simulacoes = await listarSimulacoes({ portalClientId });
      return res.json({ ok: true, simulacoes });
    } catch (err) {
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao listar simulações");
      return res.status(500).json({ ok: false, error: "simulacoes_fetch_failed" });
    }
  });

  router.post("/planejamento/simulacoes", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      // ⚠⚠ O `portalClientId` VEM DO PATH e é escrito DEPOIS do spread — um `portalClientId` no
      // corpo apontaria a foto para OUTRA empresa depois de a permissão ter sido conferida nesta.
      // É literalmente o furo de multi-tenancy que a F1 do WhatsApp já pagou.
      const simulacao = await salvarSimulacao({
        ...req.body,
        portalClientId,
        geradoPor: req.user?.id || null,
      });
      return res.status(201).json({ ok: true, simulacao });
    } catch (err) {
      if (err instanceof SimulacaoPlanejamentoError) {
        return res.status(err.status).json({ ok: false, error: err.codigo, message: err.message });
      }
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao salvar simulação");
      return res.status(500).json({ ok: false, error: "simulacao_save_failed" });
    }
  });

  router.post(
    "/planejamento/simulacoes/:simulacaoId/documento",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        // ⚠ A razão social vai para o cabeçalho do PDF, que circula sozinho. Lida aqui, do banco —
        // nunca do corpo do pedido: um nome vindo do navegador poria no papel a empresa que quem
        // chamou quisesse.
        const empresa = await prisma.portalClient.findUnique({
          where: { id: portalClientId },
          select: { razao: true, cnpj: true },
        });
        const out = await gerarDocumentoDaSimulacao({
          portalClientId,
          id: String(req.params.simulacaoId),
          empresa,
          uploadedById: req.user?.id || null,
        });
        return res.status(201).json({ ok: true, ...out });
      } catch (err) {
        if (err instanceof SimulacaoPlanejamentoError) {
          return res.status(err.status).json({ ok: false, error: err.codigo, message: err.message });
        }
        // ⚠⚠ FALHA DE STORAGE CHEGA NOMEADA. Sem o Volume no Railway (`/app/storage` +
        // `GUIDE_LOCAL_STORAGE_DIR` absoluto) a gravação falha, e um 500 genérico faria o contador
        // procurar o defeito na simulação em vez de na infraestrutura.
        log?.warn?.({ err: err?.message, portalClientId }, "Falha ao gerar documento da simulação");
        return res.status(500).json({
          ok: false,
          error: "documento_nao_gerado",
          message: "A simulação foi salva, mas o PDF não pôde ser guardado. Verifique o armazenamento de arquivos.",
        });
      }
    },
  );

  return router;
}
