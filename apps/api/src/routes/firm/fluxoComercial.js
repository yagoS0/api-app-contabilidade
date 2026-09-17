import { Router } from "express";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { criarRecursosComerciais, exigirGestor } from "../../application/onboarding/RecursosComerciaisService.js";
import { criarPropostasComerciais } from "../../application/onboarding/PropostasComerciaisService.js";
import { criarFiscalLead } from "../../application/onboarding/FiscalLeadService.js";
import { iniciarAtendimento, registrarCampos, proximaPergunta } from "../../application/onboarding/LeadService.js";
import { exigirEscopo } from "../../application/onboarding/ComercialService.js";
import { OnboardingError } from "../../application/onboarding/OnboardingService.js";
import { enviarProposta } from "../../application/onboarding/EnvioPropostaService.js";
import { gerarContratoPdf } from "../../application/onboarding/ContratoComercialPdf.js";
import { criarJornadaLead } from "../../application/onboarding/JornadaLeadService.js";
import { INTEGRACAO_FISCAL_LEADS } from "../../config.js";
import { gerarPropostaPdf } from "../../application/onboarding/PropostaComercialPdf.js";
import { identidadeDoCaso, filtroCasoDaConversa } from "../../application/onboarding/ContextoComercialService.js";
import { montarJornadaComercial } from "../../application/onboarding/PoliticaJornadaComercial.js";
import { criarFichaEmpresaAvulsa } from "../../application/onboarding/FichaEmpresaAvulsaService.js";
import { empresasVisiveis } from "./empresasVisiveis.js";
import { carregarGrupoIdentidade } from "../../application/whatsapp/InboxWhatsappService.js";
export function createFluxoComercialRouter({
  db = prisma, escopo = empresasVisiveis
} = {}) {
  const router = Router(),
    recursos = criarRecursosComerciais({
      db
    }),
    propostas = criarPropostasComerciais({
      db
    }),
    fiscal = criarFiscalLead({
      db
    });
  const jornada = criarJornadaLead({ db });
  const fichasAvulsas = criarFichaEmpresaAvulsa({ db });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1
    }
  });
  const wrap = fn => async (req, res) => {
    try {
      let conversaId = req.params.conversaId;
      if (!conversaId && req.params.id) conversaId = (await db.atendimentoLead.findFirst({ where: { onboardingId: req.params.id }, orderBy: { createdAt: "desc" } }))?.conversaId;
      if (conversaId) {
        const conversa = await db.conversaWhatsapp.findUnique({ where: { id: conversaId } });
        if (!conversa) throw new OnboardingError("lead_ausente", "Atendimento não encontrado.", 404);
        if (conversa.vinculoNumeroId) {
          let grupo;
          try { grupo = await carregarGrupoIdentidade({ conversaId, visiveis: await escopo(req), client: db }); }
          catch (e) { if ([403, 404].includes(e.status)) throw new OnboardingError("lead_ausente", "Atendimento não encontrado.", 404); throw e; }
          if (!grupo.completo) throw new OnboardingError("lead_ausente", "Atendimento não encontrado.", 404);
        } else if (conversa.portalClientId) {
          const visiveis = await escopo(req);
          const contatos = await db.contatoWhatsapp.findMany({ where: { telefoneE164: conversa.telefoneE164, ativo: true }, select: { portalClientId: true } });
          if (!visiveis.includes(conversa.portalClientId) || contatos.some(c => !visiveis.includes(c.portalClientId))) throw new OnboardingError("lead_ausente", "Atendimento não encontrado.", 404);
        }
      }
      const out = await fn(req, res);
      if (!res.headersSent) res.json({
        ok: true,
        ...out
      });
    } catch (e) {
      if (!res.headersSent) res.status(e instanceof OnboardingError ? e.status : 500).json({
        ok: false,
        error: e instanceof OnboardingError ? e.code : "erro_interno",
        message: e instanceof OnboardingError ? e.message : "Não foi possível concluir. Confira antes de repetir."
      });
    }
  };
  router.use((req, res, next) => {
    try {
      exigirGestor(req.auth?.user);
      res.set("Cache-Control", "no-store");
      next();
    } catch (e) {
      res.status(e.status).json({
        ok: false,
        error: e.code,
        message: e.message
      });
    }
  });
  router.get("/recursos", wrap(async () => ({
    recursos: await recursos.listar()
  })));
  router.post("/recursos/iniciar", wrap(async req => ({
    recursos: await recursos.iniciarBiblioteca(req.auth.user)
  })));
  router.post("/recursos", wrap(async req => ({
    recurso: await recursos.criar(req.body, req.auth.user)
  })));
  router.post("/recursos/:recursoId/aprovar", wrap(async req => ({
    recurso: await recursos.aprovar(req.params.recursoId, req.auth.user)
  })));
  router.post("/recursos/:recursoId/previa", wrap(async req => ({
    previa: await recursos.prepararOrientacao(req.params.recursoId, req.body?.variaveis || {})
  })));
  router.get("/conversas/:conversaId", wrap(async req => {
    const c = await db.conversaWhatsapp.findFirst({
      where: {
        id: req.params.conversaId,
        excluidaEm: null,
        NOT: {
          chaveEscopo: {
            startsWith: "legado:"
          }
        }
      }
    });
    if (!c) throw new OnboardingError("lead_ausente", "Conversa não encontrada.", 404);
    const escopoCaso = filtroCasoDaConversa(c, await identidadeDoCaso(c, db));
    const atendimento = await db.atendimentoLead.findFirst({
      where: {
        ...escopoCaso,
        encerradoEm: null
      },
      include: {
        onboarding: true
      }
    });
    return {
      atendimento,
      proximaPergunta: proximaPergunta(atendimento?.onboarding),
      anteriores: await db.atendimentoLead.findMany({ where: { ...escopoCaso, encerradoEm: { not: null } }, include: { onboarding: { select: { id: true, origem: true, status: true } } }, orderBy: { encerradoEm: "desc" }, take: 20 })
    };
  }));
  router.post("/conversas/:conversaId/iniciar", wrap(async req => ({
    atendimento: await iniciarAtendimento({
      conversaId: req.params.conversaId,
      origem: req.body?.origem,
      onboardingId: req.body?.onboardingId,
      reiniciarAtendimentoId: req.body?.reiniciarAtendimentoId,
      motivoReinicio: req.body?.motivoReinicio,
      atorId: req.auth.user.id,
      client: db
    })
  })));
  router.get("/onboardings/:id", wrap(async req => {
    const painel = await propostas.painel(req.params.id, req.auth.user);
    const onboarding = await exigirEscopo(req.params.id, req.auth.user, db);
    const estadoJornada = await jornada.carregar(req.params.id, req.auth.user);
    return { configuracao: { consultasFiscais: INTEGRACAO_FISCAL_LEADS }, ...painel, onboarding,
      fichaAvulsa: await fichasAvulsas.obter(req.params.id, req.auth.user),
      jornada: { ...estadoJornada, projecao: montarJornadaComercial({ ...painel, onboarding, jornada: estadoJornada }) } };
  }));
  router.post("/onboardings/:id/jornada/diagnostico", wrap(async req => ({ diagnostico: await jornada.diagnosticar(req.params.id, req.auth.user, req.body) })));
  router.post("/onboardings/:id/jornada/devolutiva", wrap(async req => jornada.enviarDevolutiva(req.params.id, req.auth.user, req.body)));
  router.post("/onboardings/:id/jornada/pagamento", wrap(async req => ({ marco: await jornada.confirmarPagamento(req.params.id, req.auth.user, req.body) })));
  router.post("/onboardings/:id/jornada/conferencia", wrap(async req => ({ conferencia: await jornada.conferirAnalise(req.params.id, req.auth.user, req.body) })));
  router.post("/onboardings/:id/jornada/apresentacao", wrap(async req => ({ apresentacao: await jornada.registrarApresentacao(req.params.id, req.auth.user, req.body) })));
  router.patch("/onboardings/:id/campos", wrap(async req => {
    await exigirEscopo(req.params.id, req.auth.user, db);
    return {
      onboarding: await registrarCampos({
        onboardingId: req.params.id,
        versao: req.body?.versao,
        operacoes: req.body?.operacoes,
        atorId: req.auth.user.id,
        fonte: "ESCRITORIO",
        client: db
      })
    };
  }));
  router.post("/onboardings/:id/representante", wrap(async req => fiscal.verificarRepresentante(req.params.id, req.auth.user, req.body?.evidencia)));
  router.post("/onboardings/:id/consultas", wrap(async req => ({
    trabalho: await fiscal.enfileirar(req.params.id, req.auth.user, req.body?.tipo)
  })));
  router.post("/onboardings/:id/propostas", wrap(async req => ({
    proposta: await propostas.gerar(req.params.id, req.auth.user, req.body)
  })));
  router.post("/onboardings/:id/propostas/:propostaId/aprovar", wrap(async req => ({
    proposta: await propostas.aprovar(req.params.id, req.params.propostaId, req.auth.user)
  })));
  router.get("/onboardings/:id/propostas/:propostaId/pdf", wrap(async (req, res) => {
    const proposta = await propostas.documentoProposta(req.params.id, req.params.propostaId, req.auth.user);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="proposta-altan.pdf"', "X-Content-Type-Options": "nosniff" });
    res.send(await gerarPropostaPdf(proposta));
  }));
  router.post("/onboardings/:id/propostas/:propostaId/link", wrap(async req => propostas.emitirLink(req.params.id, req.params.propostaId, req.auth.user)));
  router.post("/onboardings/:id/propostas/:propostaId/enviar", wrap(async req => enviarProposta(req.params.id, req.params.propostaId, req.auth.user, {
    db, conversaId: req.body?.conversaId
  })));
  router.post("/onboardings/:id/propostas/:propostaId/contrato", wrap(async req => ({
    contrato: await propostas.contrato(req.params.id, req.params.propostaId, req.auth.user, req.body)
  })));
  router.post("/onboardings/:id/contratos/:contratoId/aprovar", wrap(async req => propostas.aprovarContrato(req.params.id, req.params.contratoId, req.auth.user)));
  router.get("/onboardings/:id/contratos/:contratoId/pdf", wrap(async (req, res) => {
    await exigirEscopo(req.params.id, req.auth.user, db);
    const contrato = await db.contratoComercial.findFirst({
      where: {
        id: req.params.contratoId,
        onboardingId: req.params.id
      }
    });
    if (!contrato) throw new OnboardingError("contrato_ausente", "Contrato não encontrado.", 404);
    const pdf = await gerarContratoPdf(contrato);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="contrato-altan.pdf"',
      "X-Content-Type-Options": "nosniff"
    });
    res.send(pdf);
  }));
  router.post("/onboardings/:id/contratos/:contratoId/assinatura", wrap(async req => propostas.conferirAssinatura(req.params.id, req.params.contratoId, req.auth.user, req.body?.documentoId)));
  router.post("/onboardings/:id/documentos", upload.single("arquivo"), wrap(async req => ({
    documento: await propostas.salvarDocumento(req.params.id, req.auth.user, req.file)
  })));
  router.get("/onboardings/:id/documentos/:documentoId", wrap(async (req, res) => {
    const pdf = await propostas.documento(req.params.id, req.params.documentoId, req.auth.user);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="documento.pdf"',
      "X-Content-Type-Options": "nosniff"
    });
    res.send(pdf);
  }));
  router.post("/onboardings/:id/concluir-avulso", wrap(async req => propostas.concluirAvulso(req.params.id, req.auth.user, req.body?.evidencia)));
  router.get("/onboardings/:id/ficha-avulsa", wrap(async req => ({ fichaAvulsa: await fichasAvulsas.obter(req.params.id, req.auth.user) })));
  router.put("/onboardings/:id/ficha-avulsa", wrap(async req => ({ fichaAvulsa: await fichasAvulsas.salvar(req.params.id, req.auth.user, req.body) })));
  router.get("/onboardings/:id/ficha-avulsa/documentos/:documentoId", wrap(async (req, res) => {
    const documento = await fichasAvulsas.documento(req.params.id, req.params.documentoId, req.auth.user);
    res.set({ "Content-Type": documento.mimeType, "Content-Disposition": 'attachment; filename="documento.pdf"', "X-Content-Type-Options": "nosniff" });
    res.send(documento.buffer);
  }));
  router.post("/onboardings/:id/marcos", wrap(async req => propostas.registrarMarco(req.params.id, req.auth.user, req.body?.tipo, req.body?.evidencia)));
  router.use((e, _req, res, _next) => res.status(400).json({
    ok: false,
    error: "upload_invalido",
    message: "Envie um PDF de até 5 MB."
  }));
  return router;
}
