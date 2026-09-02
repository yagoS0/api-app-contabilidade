// Q14.2.d — Endpoints do sistema de apuração v2.
// Mount: /firm/companies/:companyId/{cadastro-fiscal,produtos-servicos,pendencias,classificar-v2}

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { classificarItensV2 } from "../../application/notas/apuracao/v2/ClassificadorService.js";
import {
  resolverPendenciaItemSemRegra,
  resolverPendenciaDivergencia,
  TIPOS_RECEITA_VALIDOS,
} from "../../application/notas/apuracao/v2/AprendizadoService.js";
import { calcularApuracaoLocal } from "../../application/notas/apuracao/v2/MotorApuracaoService.js";
import {
  getDadosFechamento,
  calcularFechamento,
  salvarFechamento,
  transmitirFechamento,
  reabrirFechamento,
  registrarEntregaExternaPgdas,
  FechamentoError,
} from "../../application/notas/apuracao/v2/FechamentoService.js";
import {
  gerarRelatorioFaturamento,
  lerRelatorioFaturamento,
  RelatorioFaturamentoError,
} from "../../application/notas/apuracao/v2/RelatorioFaturamentoService.js";
import { carregarAtividades } from "../../application/notas/apuracao/v2/AtividadeResolver.js";
import { resolverPerfilFiscal, normalizarPerfilConfig } from "../../application/notas/apuracao/v2/PerfilFiscalService.js";
import { sugerirAnexosDaCompetencia } from "../../application/notas/apuracao/v2/SugestaoAnexoService.js";
import { conferirCompetencia } from "../../application/notas/apuracao/v2/ConferenciaAdnService.js";
import { comContextoSerpro, podeForcarSerpro } from "../../application/fiscal/serpro/serproCallContext.js";
import { reconciliarLp } from "../../application/fiscal/lp/LucroPresumidoCalculoService.js";
import { podeApurarPresumido } from "../../application/fiscal/lp/lib/regimeDoPresumido.js";

const REGIMES_VALIDOS = new Set(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"]);

// Q44: mapeia o regime do cadastro da empresa (Company, dados do CNPJ) → enum do CadastroFiscal.
// ⚠⚠ ELE TERMINAVA EM `return "SIMPLES_NACIONAL"` — E O CHUTE VIRAVA DADO GRAVADO.
//
// O default era descrito como inofensivo ("a maioria das empresas do app é SN"), e seria, se ele
// só alimentasse tela. Mas o `PUT /perfil-fiscal` (abaixo) fazia
// `cadastroFiscal.create({ regime: mapRegime(company) })` — e a partir daí:
//
//   • `NfseService.carregarRegimeDaEmpresa` trata `CadastroFiscal` como AUTORIDADE e devolve
//     Simples Nacional com confiança total, sem o `prefill: true` que fazia a tela pintar âmbar;
//   • `dpsCodigos.resolverOpSimpNac` — escrito de propósito para RECUSAR regime desconhecido —
//     passa a ver um dado, não uma ausência. Guarda nenhuma resiste a um caminho de escrita que
//     fabrica exatamente o dado que a satisfaz;
//   • mais seis serviços leem `CadastroFiscal` como autoridade (`ClassificadorService`,
//     `CnaesDaEmpresaService`, `DisparidadeService`, `FechamentoService`, `MotorApuracaoService`,
//     `PerfilFiscalService`) — o chute entra na classificação, na apuração e no fechamento.
//
// Nada distingue, no banco, um `SIMPLES_NACIONAL` que o contador afirmou de um que esta função
// chutou. Medido em 14/08/2026: 28 das 34 empresas ainda não têm linha em `cadastros_fiscais` — o
// estrago em massa não aconteceu, mas cada salvamento de perfil fiscal o produzia.
//
// ⚠ O autor de `dpsCodigos.js` VIU esta função, RECUSOU reusá-la e escreveu o motivo:
// *"na apuração o default é inofensivo; numa DPS ele declararia o regime da empresa por
// suposição"*. O mesmo argumento vale contra PERSISTIR.
//
// ⚠⚠ A APURAÇÃO CONTINUA TOLERANTE, e isso não mudou — `apps/api/CLAUDE.md:3009` registra que ali
// *"bloquear por falta de dado é o erro caro"*. Quem trata o `null` é cada chamador: a tela o lê
// como AUSENTE (`perfilFiscalTela.estadoDoRegime`, que já tinha o ramo), e só a ESCRITA recusa.
// Tolerar em memória ≠ gravar.
function mapRegime(company) {
  const raw = String(company?.regimeTributario || "").toUpperCase();
  if (/MEI/.test(raw)) return "MEI";
  if (/PRESUMID/.test(raw)) return "LUCRO_PRESUMIDO";
  if (/REAL/.test(raw)) return "LUCRO_REAL";
  if (/SIMPLES/.test(raw) || company?.optanteSimples) return "SIMPLES_NACIONAL";
  return null; // não sabemos — e "não sabemos" não é "Simples Nacional"
}

export function createApuracaoV2Router({ log } = {}) {
  const router = Router({ mergeParams: true });

  function bad(res, status, error, message, extra = {}) {
    return res.status(status).json({ ok: false, error, message, ...extra });
  }

  // Erro de negócio/config conhecido (validação nossa ou rejeição do SERPRO) → 400; 500 só pro inesperado.
  function statusForFechamentoErr(err) {
    if (err instanceof FechamentoError) return 400;
    if (String(err?.code || "").startsWith("SERPRO_")) return 400;
    return 500;
  }


  // ─── Cadastro Fiscal ──────────────────────────────────────────────────────
  // GET cadastro-fiscal (com sugestão CNAE→tipoReceita)
  router.get(
    "/cadastro-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        let cadastro = await prisma.cadastroFiscal.findUnique({
          where: { portalClientId },
        });
        // Regime + CNAE são do CADASTRO DA EMPRESA (fonte única, editados na aba "Editar Cadastro").
        // SEMPRE sobrepõe esses campos com os do Company — evita re-digitação e divergência.
        // Os campos fiscais-específicos (usaFatorR, sublimite, forçarCnae, dataOpcao, observações)
        // continuam vindo do CadastroFiscal salvo.
        let prefill = false;
        const pc = await prisma.portalClient.findUnique({
          where: { id: portalClientId }, select: { companyId: true },
        });
        const company = pc?.companyId
          ? await prisma.company.findUnique({
              where: { id: pc.companyId },
              select: { cnaePrincipal: true, cnaesSecundarios: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true },
            }).catch(() => null)
          : null;
        if (company?.cnaePrincipal) {
          const regimeDaFicha = mapRegime(company);
          const doCompany = {
            regime: regimeDaFicha,
            cnaePrincipal: String(company.cnaePrincipal).replace(/\D+/g, ""),
            cnaesSecundarios: (company.cnaesSecundarios || []).map((c) => String(c).replace(/\D+/g, "")).filter(Boolean),
          };
          if (cadastro) {
            // ⚠⚠ `null` NÃO SOBREPÕE. A ficha continua sendo a fonte quando ela RESPONDE — mas
            // desde que `mapRegime` deixou de chutar, ela pode responder "não sei", e "não sei"
            // apagando um regime que alguém salvou seria trocar um defeito por outro: a tela diria
            // "não cadastrado" sobre uma empresa cadastrada. Só sobrepõe o que foi resolvido.
            if (regimeDaFicha == null) delete doCompany.regime;
            cadastro = { ...cadastro, ...doCompany }; // sobrepõe CNAE (e o regime, quando há)
          } else {
            cadastro = {
              ...doCompany,
              dataOpcaoSN: company.simplesDataOpcao || null,
              sublimiteICMSISS: false,
              usaFatorR: false,
              forcarTipoReceitaPorCnae: false,
              observacoes: null,
            };
            prefill = true;
          }
        }
        let cnaePrincipalRef = null;
        if (cadastro?.cnaePrincipal) {
          cnaePrincipalRef = await prisma.cnaeAnexo.findUnique({
            where: { cnae: String(cadastro.cnaePrincipal).replace(/\D+/g, "").slice(0, 7) },
            select: { descricao: true, tipoReceitaSugerido: true, ambiguo: true },
          }).catch(() => null);
        }
        return res.json({ ok: true, cadastro, cnaePrincipalRef, prefill });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao buscar cadastro fiscal");
        return bad(res, 500, "cadastro_fetch_failed", err?.message || "Erro");
      }
    }
  );

  // POST/PUT cadastro-fiscal (upsert)
  router.put(
    "/cadastro-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const { regime, dataOpcaoSN, cnaePrincipal, cnaesSecundarios, sublimiteICMSISS, usaFatorR, forcarTipoReceitaPorCnae, observacoes } = req.body || {};
      if (!regime || !REGIMES_VALIDOS.has(regime)) {
        return bad(res, 400, "invalid_regime", `Regime deve ser um de: ${[...REGIMES_VALIDOS].join(", ")}`);
      }
      if (!cnaePrincipal || String(cnaePrincipal).replace(/\D+/g, "").length < 7) {
        return bad(res, 400, "invalid_cnae", "cnaePrincipal deve ter 7 dígitos");
      }
      const data = {
        regime,
        dataOpcaoSN: dataOpcaoSN ? new Date(dataOpcaoSN) : null,
        cnaePrincipal: String(cnaePrincipal).replace(/\D+/g, ""),
        cnaesSecundarios: Array.isArray(cnaesSecundarios) ? cnaesSecundarios.map((c) => String(c).replace(/\D+/g, "")) : [],
        sublimiteICMSISS: Boolean(sublimiteICMSISS),
        usaFatorR: Boolean(usaFatorR),
        forcarTipoReceitaPorCnae: Boolean(forcarTipoReceitaPorCnae),
        observacoes: observacoes ? String(observacoes) : null,
        createdByUserId: req.auth?.user?.id,
      };
      try {
        const existing = await prisma.cadastroFiscal.findUnique({ where: { portalClientId } });
        const cadastro = existing
          ? await prisma.cadastroFiscal.update({ where: { portalClientId }, data })
          : await prisma.cadastroFiscal.create({ data: { ...data, portalClientId } });
        return res.json({ ok: true, cadastro });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao salvar cadastro fiscal");
        return bad(res, 500, "cadastro_save_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Perfil Fiscal (Aba Fiscal / Bloco A) ─────────────────────────────────
  // GET perfil-fiscal — atividades permitidas derivadas dos CNAEs + config do contador.
  router.get(
    "/perfil-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        const perfil = await resolverPerfilFiscal({ portalClientId });
        return res.json({ ok: true, ...perfil });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao resolver perfil fiscal");
        return bad(res, 500, "perfil_fetch_failed", err?.message || "Erro");
      }
    }
  );

  // PUT perfil-fiscal — salva a config por CNAE (ativar/desativar, atividade padrão, atributos ISS).
  router.put(
    "/perfil-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const perfilAtividades = normalizarPerfilConfig(req.body?.perfilAtividades);
      try {
        const existing = await prisma.cadastroFiscal.findUnique({ where: { portalClientId } });
        if (existing) {
          const cadastro = await prisma.cadastroFiscal.update({
            where: { portalClientId },
            data: { perfilAtividades },
          });
          const perfil = await resolverPerfilFiscal({ portalClientId });
          return res.json({ ok: true, cadastro, ...perfil });
        }
        // Sem CadastroFiscal → cria mínimo a partir do Company (CNPJ), como faz o GET /cadastro-fiscal.
        const pc = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
        const company = pc?.companyId
          ? await prisma.company.findUnique({
              where: { id: pc.companyId },
              select: { cnaePrincipal: true, cnaesSecundarios: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true },
            }).catch(() => null)
          : null;
        if (!company?.cnaePrincipal) {
          return bad(res, 409, "cadastro_fiscal_required", "Salve o Cadastro Fiscal (regime + CNAE) antes de configurar o perfil.");
        }

        // ⚠⚠ AQUI ERA O CAMINHO QUE FABRICAVA O DADO. `regime: mapRegime(company)` gravava
        // `SIMPLES_NACIONAL` para toda empresa cuja ficha não trouxesse regime reconhecível — e a
        // linha criada aqui é tratada como AUTORIDADE por sete serviços, inclusive a emissão de
        // NFS-e. Ver o cabeçalho de `mapRegime`.
        //
        // ⚠ RECUSAR É MAIS BARATO QUE UM ESTADO NOVO: `CadastroFiscal.regime` é `String` NOT NULL,
        // e torná-lo anulável só empurraria o problema — `carregarRegimeDaEmpresa` continuaria
        // vendo uma linha, e `temCadastro` continuaria `true`. Sem regime, não há cadastro fiscal.
        //
        // ⚠ A recusa segue a forma do `cadastro_fiscal_required` três linhas acima: 409, código
        // próprio, e a frase diz ONDE se conserta.
        const regime = mapRegime(company);
        if (!regime) {
          return bad(
            res,
            409,
            "regime_nao_confirmado",
            "Esta empresa não tem regime tributário reconhecível na ficha, e o perfil fiscal não "
              + "pode ser salvo sobre um regime suposto. Informe o regime em Empresa → Cadastro e "
              + "tente de novo.",
          );
        }

        const cadastro = await prisma.cadastroFiscal.create({
          data: {
            portalClientId,
            regime,
            dataOpcaoSN: company.simplesDataOpcao || null,
            cnaePrincipal: String(company.cnaePrincipal).replace(/\D+/g, ""),
            cnaesSecundarios: (company.cnaesSecundarios || []).map((c) => String(c).replace(/\D+/g, "")).filter(Boolean),
            perfilAtividades,
            createdByUserId: req.auth?.user?.id,
          },
        });
        const perfil = await resolverPerfilFiscal({ portalClientId });
        return res.json({ ok: true, cadastro, ...perfil });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao salvar perfil fiscal");
        return bad(res, 500, "perfil_save_failed", err?.message || "Erro");
      }
    }
  );

  // GET apuracao-sugestao/:competencia — sugestão de anexo por nota (§1.3).
  router.get(
    "/apuracao-sugestao/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia || "");
      if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return bad(res, 400, "invalid_competencia", "competência YYYY-MM obrigatória");
      }
      try {
        const out = await sugerirAnexosDaCompetencia({ portalClientId, competencia });
        return res.json({ ok: true, ...out });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId, competencia }, "Falha na sugestão de anexo");
        return bad(res, 500, "sugestao_failed", err?.message || "Erro");
      }
    }
  );

  // ─── APURAÇÃO DO LUCRO PRESUMIDO ─────────────────────────────────────────
  //
  // ⚠ SÓ LEITURA, ZERO CHAMADA AO SERPRO. O [Calcular] do Presumido é LOCAL: ele lê as notas já
  // capturadas e a DARF já capturada. Quem gasta chamada paga continua sendo o botão "Buscar
  // tributos do Presumido", que não foi tocado.
  //
  // ⚠ E NÃO GRAVA SNAPSHOT. `ApuracaoSnapshot.rbt12` é NOT NULL, e inventar um RBT12 para o
  // Presumido seria fabricar dado fiscal — o erro que a seção "TRÊS NÚMEROS DE DAS" existe para
  // impedir. O cálculo é inteiramente derivável do que já está persistido.
  router.get(
    "/apuracao-lp/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia || "");
      if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return bad(res, 400, "invalid_competencia", "competência YYYY-MM obrigatória");
      }

      // ⚠⚠ A CONFIRMAÇÃO DOS R$ 120.000 VEM NA QUERY, E NÃO PERSISTE — decisão NOMEADA, não
      // esquecimento. Não existe coluna para ela em lugar nenhum, e criar uma é migration, que é
      // decisão do dono. Enquanto não existir, o contador reconfirma a cada abertura da tela; o
      // custo está dito aqui para não virar descoberta.
      //
      // ⚠ Três estados, e a string vazia NÃO pode virar `false`: `?servicos16=` significa "não
      // veio", não "o contador disse que não". É a família do `Number(null) === 0`.
      const cru = req.query.servicos16;
      const servicos16 = cru === "true" ? true : cru === "false" ? false : null;

      try {
        // ⚠ OS DOIS IDS, DE NOVO. `PortalClient` **não tem relação `company`** — só o escalar
        // `companyId` (`@unique`). Um `select: { company: { … } }` estouraria em runtime; a volta é
        // por consulta separada, como manda o resto do projeto.
        // ⚠ Empresa sem `Company` legada cai em regime nulo ⇒ DESCONHECIDO ⇒ passa com aviso.
        const pc = await prisma.portalClient.findUnique({
          where: { id: portalClientId },
          select: { companyId: true },
        });
        const company = pc?.companyId
          ? await prisma.company.findUnique({
            where: { id: pc.companyId },
            select: { regimeTributario: true },
          })
          : null;
        const regime = company?.regimeTributario ?? null;

        // ⚠ Empresa do Simples é RECUSADA com nome próprio; regime DESCONHECIDO passa, com aviso.
        // Bloquear por falta de dado é o erro caro nesta direção — mesmo critério da guarda da EFD.
        const porta = podeApurarPresumido(regime);
        if (!porta.pode) {
          return bad(res, 409, "regime_nao_apura_presumido", porta.motivo, { apuracao: porta.apuracao });
        }

        const apuracao = await reconciliarLp({ portalClientId, competencia, servicos16 });
        return res.json({
          ok: true,
          regime,
          apuracao: porta.apuracao,
          avisoDeRegime: porta.aviso,
          ...apuracao,
        });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId, competencia }, "Falha na apuração do Lucro Presumido");
        return bad(res, 500, "apuracao_lp_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Produtos / Serviços (catálogo da empresa) ────────────────────────────
  router.get(
    "/produtos-servicos",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const ativo = req.query.ativo !== "false";
      try {
        const items = await prisma.produtoServico.findMany({
          where: { portalClientId, ...(ativo ? { ativo: true } : {}) },
          orderBy: { nome: "asc" },
        });
        return res.json({ ok: true, items });
      } catch (err) {
        return bad(res, 500, "list_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/produtos-servicos",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const { nome, tipoReceita, codigoServico, ncm, cfop, codigoInterno } = req.body || {};
      if (!nome) return bad(res, 400, "nome_required", "nome obrigatório");
      if (!TIPOS_RECEITA_VALIDOS.has(tipoReceita)) {
        return bad(res, 400, "tipo_receita_invalido", `tipoReceita deve ser um de: ${[...TIPOS_RECEITA_VALIDOS].join(", ")}`);
      }
      try {
        const created = await prisma.produtoServico.create({
          data: {
            portalClientId,
            nome: String(nome).trim(),
            tipoReceita,
            codigoServico: codigoServico ? String(codigoServico).trim() : null,
            ncm: ncm ? String(ncm).trim() : null,
            cfop: cfop ? String(cfop).trim() : null,
            codigoInterno: codigoInterno ? String(codigoInterno).trim() : null,
            origem: "MANUAL",
            createdByUserId: req.auth?.user?.id,
          },
        });
        return res.json({ ok: true, produto: created });
      } catch (err) {
        return bad(res, 500, "create_failed", err?.message || "Erro");
      }
    }
  );

  router.patch(
    "/produtos-servicos/:produtoId",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const produtoId = String(req.params.produtoId);
      const { nome, tipoReceita, codigoServico, ncm, cfop, codigoInterno, ativo } = req.body || {};
      try {
        const existing = await prisma.produtoServico.findFirst({ where: { id: produtoId, portalClientId } });
        if (!existing) return bad(res, 404, "not_found", "Produto não encontrado");
        const data = {};
        if (nome != null) data.nome = String(nome).trim();
        if (tipoReceita != null) {
          if (!TIPOS_RECEITA_VALIDOS.has(tipoReceita)) return bad(res, 400, "tipo_receita_invalido", "");
          data.tipoReceita = tipoReceita;
        }
        if (codigoServico !== undefined) data.codigoServico = codigoServico ? String(codigoServico).trim() : null;
        if (ncm !== undefined) data.ncm = ncm ? String(ncm).trim() : null;
        if (cfop !== undefined) data.cfop = cfop ? String(cfop).trim() : null;
        if (codigoInterno !== undefined) data.codigoInterno = codigoInterno ? String(codigoInterno).trim() : null;
        if (ativo != null) data.ativo = Boolean(ativo);
        const updated = await prisma.produtoServico.update({ where: { id: produtoId }, data });
        return res.json({ ok: true, produto: updated });
      } catch (err) {
        return bad(res, 500, "update_failed", err?.message || "Erro");
      }
    }
  );

  router.delete(
    "/produtos-servicos/:produtoId",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const produtoId = String(req.params.produtoId);
      try {
        const existing = await prisma.produtoServico.findFirst({ where: { id: produtoId, portalClientId } });
        if (!existing) return bad(res, 404, "not_found", "Produto não encontrado");
        await prisma.produtoServico.delete({ where: { id: produtoId } });
        return res.json({ ok: true });
      } catch (err) {
        return bad(res, 500, "delete_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Pendências ────────────────────────────────────────────────────────────
  router.get(
    "/pendencias",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const resolvida = req.query.resolvida === "true";
      const tipo = req.query.tipo ? String(req.query.tipo) : undefined;
      const competencia = req.query.competencia ? String(req.query.competencia) : undefined;
      try {
        const items = await prisma.filaPendencia.findMany({
          where: {
            portalClientId,
            resolvida,
            ...(tipo ? { tipo } : {}),
            ...(competencia ? { competencia } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
        const counts = await prisma.filaPendencia.groupBy({
          by: ["tipo"],
          where: { portalClientId, resolvida: false },
          _count: true,
        });

        // ⚠⚠ QUANTAS OUTRAS EMPRESAS ESPERAM ESTA MESMA DECISÃO.
        //
        // Sem este número a escolha de escopo é às cegas: o contador não tem como saber que
        // resolver como GLOBAL apagaria N pendências idênticas de outros clientes — e a economia de
        // hora que o escopo global existe para dar só acontece se ele souber que ela está lá.
        //
        // ⚠ Vai como campo DERIVADO no item, **nunca dentro de `detalhes`**: aquele Json é o payload
        // GRAVADO da pendência, e enfiar um número calculado agora lá dentro o faria parecer dado
        // guardado — e envelhecer como se fosse.
        //
        // ⚠ `detalhes` é Json e `groupBy` não agrupa por path de Json no Prisma; daí o SQL cru. Ele
        // conta EMPRESAS DISTINTAS, não pendências: duas pendências da mesma empresa são uma
        // decisão só. E exclui a própria empresa — ela já está na tela.
        const codigos = [...new Set(
          items.filter((i) => i.tipo === "ITEM_SEM_REGRA").map((i) => i.detalhes?.codigo).filter(Boolean),
        )];
        let esperando = new Map();
        if (codigos.length) {
          const linhas = await prisma.$queryRaw`
            SELECT "detalhes"->>'codigo' AS codigo,
                   COUNT(DISTINCT "portalClientId")::int AS empresas
            FROM "fila_pendencias"
            WHERE "tipo" = 'ITEM_SEM_REGRA'
              AND "resolvida" = false
              AND "portalClientId" <> ${portalClientId}
              AND "detalhes"->>'codigo' = ANY(${codigos})
            GROUP BY 1
          `;
          esperando = new Map(linhas.map((l) => [l.codigo, Number(l.empresas) || 0]));
        }
        const comEspera = items.map((i) => (
          i.tipo === "ITEM_SEM_REGRA" && i.detalhes?.codigo
            ? { ...i, esperandoAMesmaDecisao: esperando.get(i.detalhes.codigo) || 0 }
            : i
        ));

        return res.json({ ok: true, items: comEspera, counts });
      } catch (err) {
        return bad(res, 500, "list_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/pendencias/:pendenciaId/resolver",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const pendenciaId = String(req.params.pendenciaId);
      const portalClientId = String(req.params.companyId);
      const { tipoReceita, criarRegra = true, nomeProduto, acao, escopo } = req.body || {};
      try {
        // Confirma que a pendência pertence à empresa
        const pend = await prisma.filaPendencia.findFirst({
          where: { id: pendenciaId, portalClientId },
        });
        if (!pend) return bad(res, 404, "pendencia_not_found", "Pendência não encontrada");

        let result;
        if (pend.tipo === "ITEM_SEM_REGRA") {
          if (!tipoReceita) return bad(res, 400, "tipo_receita_required", "Escolha um tipoReceita");

          // ⚠⚠ RESOLVER COMO **GLOBAL** SAI DO ESCOPO DESTA EMPRESA, e por isso tem porta própria.
          //
          // O gate desta rota (`requireFirmCompanyAccess`) responde *"esta pessoa tem acesso a ESTA
          // empresa?"*. Uma regra GLOBAL vale para a carteira inteira: ela fecha pendências e muda
          // a classificação de empresas que quem clicou pode nem enxergar. Deixar isso atrás de
          // `ACCOUNTANT` faria o alcance da decisão exceder o alcance da permissão que a autorizou.
          //
          // ⚠ **LIMITE DECLARADO, e ele é do SCHEMA:** `RegraClassificacao` não tem coluna de
          // escritório — uma regra GLOBAL é global de verdade. O papel é o único controle que
          // existe aqui; separá-la por escritório exigiria migration, que é decisão do dono.
          if (escopo === "GLOBAL" && String(req.access?.role || "") !== "FIRM_ADMIN") {
            return bad(
              res, 403, "escopo_global_exige_admin",
              "Resolver para toda a carteira exige perfil FIRM_ADMIN: a regra passa a valer para "
              + "todas as empresas, inclusive as que você não acessa.",
            );
          }

          result = await resolverPendenciaItemSemRegra({
            pendenciaId, tipoReceita, criarRegra, nomeProduto,
            // ⚠ `undefined` cai no default EMPRESA do serviço — o corpo antigo continua funcionando.
            ...(escopo ? { escopo } : {}),
            userId: req.auth?.user?.id,
          });
        } else if (pend.tipo === "DIVERGENCIA_CADASTRO") {
          result = await resolverPendenciaDivergencia({
            pendenciaId, acao, userId: req.auth?.user?.id,
          });
        } else {
          return bad(res, 400, "tipo_nao_suportado", `Tipo de pendência ${pend.tipo} não tem resolver automático`);
        }
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn({ err: err?.message, pendenciaId }, "Falha ao resolver pendência");
        return bad(res, 500, "resolve_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Q19: lista de atividades do PGDAS-D (de-para oficial) p/ o dropdown do modal ──
  // Path distinto de "/fechamento/:competencia" pra não colidir com o param.
  router.get(
    "/atividades-pgdasd",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const dataReferencia = req.query.dataReferencia
        ? new Date(String(req.query.dataReferencia))
        : new Date();
      try {
        const { linhas } = await carregarAtividades(
          Number.isNaN(dataReferencia.getTime()) ? new Date() : dataReferencia,
        );
        // linhas vêm ordenadas por vigenciaInicio desc → 1ª ocorrência por idAtividade vence.
        const porId = new Map();
        for (const a of linhas) {
          if (!porId.has(a.idAtividade)) {
            porId.set(a.idAtividade, {
              idAtividade: a.idAtividade,
              descricao: a.descricao,
              anexoImplicito: a.anexoImplicito,
              mercado: a.mercado,
              sujeitoFatorR: a.sujeitoFatorR,
              tipoReceita: a.tipoReceita,
            });
          }
        }
        const atividades = [...porId.values()].sort((x, y) => x.idAtividade - y.idAtividade);
        return res.json({ ok: true, atividades });
      } catch (err) {
        log?.warn?.({ err: err?.message }, "Falha ao listar atividades PGDAS-D");
        return bad(res, 500, "atividades_list_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Q15: Fechamento (modal) — dados / calcular(simulação) / salvar / transmitir ──
  router.get(
    "/fechamento/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      try {
        const dados = await getDadosFechamento({ portalClientId, competencia });
        return res.json({ ok: true, dados });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha getDadosFechamento");
        return bad(res, err?.code === "PORTAL_NOT_FOUND" ? 404 : 500, err?.code || "fechamento_get_failed", err?.message || "Erro");
      }
    }
  );

  // Camada 2 (Robustez): confere a contagem de NFS-e da competência contra o ADN (scan read-only) e
  // grava o resultado no snapshot. Divergência → salvarFechamento trava. Sob demanda (hit no ADN).
  router.post(
    "/fechamento/:competencia/conferencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const env = String(req.body?.env || "prod");
      try {
        const conferencia = await conferirCompetencia({ portalClientId, competencia, env });
        return res.json({ ok: true, conferencia });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha conferência ADN");
        return bad(res, statusForFechamentoErr(err), err?.code || "conferencia_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/fechamento/:competencia/calcular",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { atividades, folhaMensal12, regimeApuracao, semMovimento } = req.body || {};
      try {
        // As chamadas ao SERPRO daqui pra baixo são PAGAS. O contexto leva quem disparou (para o
        // registro) e o `forcar`, que só um ADMIN consegue pedir — é o escape do teto diário
        // quando o fechamento está em cima do prazo. Fica gravado quem forçou.
        const result = await comContextoSerpro(
          { origem: "fechamento:calcular", userId: req.auth?.user?.id, forcar: podeForcarSerpro(req) },
          () => calcularFechamento({ portalClientId, competencia, atividades, folhaMensal12, regimeApuracao, semMovimento: Boolean(semMovimento) }),
        );
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha calcularFechamento");
        return bad(res, statusForFechamentoErr(err), err?.code || "calcular_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/fechamento/:competencia/salvar",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { atividades, folhaMensal12, regimeApuracao } = req.body || {};
      try {
        const result = await salvarFechamento({
          portalClientId, competencia, atividades, folhaMensal12, regimeApuracao,
          userId: req.auth?.user?.id,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha salvarFechamento");
        return bad(res, err?.code === "NAO_CALCULADA" ? 409 : statusForFechamentoErr(err), err?.code || "salvar_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/fechamento/:competencia/transmitir",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { confirmCompetencia } = req.body || {};
      if (confirmCompetencia !== competencia) {
        return bad(res, 400, "confirm_competencia_mismatch",
          "Digite a competência exata pra confirmar a transmissão (proteção contra envio acidental).");
      }
      try {
        const result = await comContextoSerpro(
          { origem: "fechamento:transmitir", userId: req.auth?.user?.id, forcar: podeForcarSerpro(req) },
          () => transmitirFechamento({ portalClientId, competencia, userId: req.auth?.user?.id }),
        );
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha transmitirFechamento");
        return bad(res, err?.code === "ESTADO_INVALIDO" ? 409 : statusForFechamentoErr(err), err?.code || "transmitir_failed", err?.message || "Erro");
      }
    }
  );

  /**
   * Registra que o PGDAS-D desta competência foi entregue **FORA do portal** (gov.br), ou desfaz
   * esse registro.
   *
   * ⚠ NÃO TRANSMITE NADA, e não é prova. É a afirmação do contador — mesma natureza da marca da
   * entrega por arquivo, e guardada no mesmo modelo (`EntregaObrigacaoArquivo`,
   * tipo `PGDAS_D`). A prova continua sendo o número que o extrato da RFB devolve
   * (`CompanyMonthlyCircular.pgdasNumeroDeclaracao`), e a tela mostra as duas coisas com nomes
   * diferentes.
   *
   * ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS: afirmar entrega de declaração é responder
   * "esta obrigação está cumprida?" por um mês inteiro. `confirmCompetencia` é exigido na MARCAÇÃO
   * (não no desfazer — desfazer devolve a competência ao estado de pendência, que é o lado seguro).
   */
  router.post(
    "/fechamento/:competencia/entrega-externa",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { entregue, confirmCompetencia, observacao } = req.body || {};
      if (entregue === true && confirmCompetencia !== competencia) {
        return bad(res, 400, "confirm_competencia_mismatch",
          "Confirme a competência exata para registrar a entrega feita fora do portal.");
      }
      try {
        const result = await registrarEntregaExternaPgdas({
          portalClientId, competencia,
          entregue: entregue === true,
          observacao,
          userId: req.auth?.user?.id || null,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha ao registrar entrega externa do PGDAS-D");
        return bad(
          res,
          err?.code === "ENTREGA_EXTERNA_JA_TRANSMITIDA" ? 409 : statusForFechamentoErr(err),
          err?.code || "entrega_externa_failed",
          err?.message || "Erro",
        );
      }
    }
  );

  // Q55 — Reabrir uma apuração "transmitida" para retificar (rebaixa p/ "calculada").
  router.post(
    "/fechamento/:competencia/reabrir",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      try {
        const result = await reabrirFechamento({ portalClientId, competencia, userId: req.auth?.user?.id });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha reabrirFechamento");
        return bad(res, err?.code === "ESTADO_INVALIDO" ? 409 : statusForFechamentoErr(err), err?.code || "reabrir_failed", err?.message || "Erro");
      }
    }
  );

  // Q55 — Retransmitir como RETIFICADORA (tipoDeclaracao:2). Dupla confirmação obrigatória.
  router.post(
    "/fechamento/:competencia/retificar",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { confirmCompetencia, confirmRetificar } = req.body || {};
      if (confirmCompetencia !== competencia) {
        return bad(res, 400, "confirm_competencia_mismatch",
          "Digite a competência exata pra confirmar a retificação.");
      }
      if (confirmRetificar !== true) {
        return bad(res, 400, "confirm_retificar_required",
          "Confirme explicitamente que deseja RETIFICAR (retransmitir a declaração à Receita).");
      }
      try {
        const result = await comContextoSerpro(
          { origem: "fechamento:retificar", userId: req.auth?.user?.id, forcar: podeForcarSerpro(req) },
          () => transmitirFechamento({ portalClientId, competencia, userId: req.auth?.user?.id, retificar: true }),
        );
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha retificar (transmitir)");
        return bad(res, err?.code === "ESTADO_INVALIDO" ? 409 : statusForFechamentoErr(err), err?.code || "retificar_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Apurar v2 (motor local de cálculo de DAS) ─────────────────────────────
  router.post(
    "/apurar-v2/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { folha12m } = req.body || {};
      try {
        const result = await calcularApuracaoLocal({
          portalClientId, competencia,
          folha12mOverride: folha12m != null ? Number(folha12m) : undefined,
          userId: req.auth?.user?.id,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId, competencia }, "Falha ao apurar v2");
        return bad(res, 500, "apurar_failed", err?.message || "Erro", { code: err?.code });
      }
    }
  );

  // GET apuração calculada (snapshot)
  router.get(
    "/apuracao-snapshot/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      try {
        const snap = await prisma.apuracaoSnapshot.findUnique({
          where: { portalClientId_competencia: { portalClientId, competencia } },
        });
        return res.json({ ok: true, snapshot: snap });
      } catch (err) {
        return bad(res, 500, "get_snapshot_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Relatório "Faturamento no Período — Consolidado" ──────────────────────
  //
  // Duas rotas, e a divisão é deliberada: LER não gera. Um GET que gerasse o relatório faria
  // abrir a aba recalcular a competência inteira a cada visita — e o relatório é uma FOTO, com
  // data. Quem quer a foto de agora clica em gerar.
  //
  // ⚠ Nenhuma das duas chama ADN, SEFAZ ou SERPRO. O pré-apurado é o motor LOCAL, em modo
  // `persistir: false` — ver `RelatorioFaturamentoService`. Gerar o relatório NÃO muda o estado
  // da apuração da empresa.

  // GET — o relatório salvo. `relatorio: null` quando nunca foi gerado (ausência não é erro).
  router.get(
    "/relatorio-faturamento/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia || "");
      try {
        const relatorio = await lerRelatorioFaturamento({ portalClientId, competencia });
        return res.json({ ok: true, relatorio });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha ao ler relatório de faturamento");
        return bad(
          res,
          err instanceof RelatorioFaturamentoError ? 400 : 500,
          err?.code || "relatorio_get_failed",
          err?.message || "Erro",
        );
      }
    }
  );

  // POST — gera (ou regera) e salva. Sobrescreve a foto anterior da mesma competência.
  router.post(
    "/relatorio-faturamento/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia || "");
      try {
        const relatorio = await gerarRelatorioFaturamento({
          portalClientId, competencia, userId: req.auth?.user?.id || null,
        });
        return res.json({ ok: true, relatorio });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha ao gerar relatório de faturamento");
        return bad(
          res,
          err?.code === "PORTAL_NOT_FOUND" ? 404
            : err instanceof RelatorioFaturamentoError ? 400 : 500,
          err?.code || "relatorio_gerar_failed",
          err?.message || "Erro",
        );
      }
    }
  );

  // ─── Classificar v2 (dispara ClassificadorService) ─────────────────────────
  router.post(
    "/classificar-v2",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const force = req.query.force === "true" || req.body?.force === true;
      const competencia = req.body?.competencia || req.query.competencia;
      try {
        const result = await classificarItensV2({ portalClientId, force, competencia });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao classificar v2");
        return bad(res, 500, "classify_failed", err?.message || "Erro");
      }
    }
  );

  return router;
}
