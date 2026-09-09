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
export function createFluxoComercialRouter({
  db = prisma
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
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1
    }
  });
  const wrap = fn => async (req, res) => {
    try {
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
        portalClientId: null,
        NOT: {
          chaveEscopo: {
            startsWith: "legado:"
          }
        }
      }
    });
    if (!c) throw new OnboardingError("lead_ausente", "Conversa de lead não encontrada.", 404);
    const atendimento = await db.atendimentoLead.findFirst({
      where: {
        conversaId: c.id,
        encerradoEm: null
      },
      include: {
        onboarding: true
      }
    });
    return {
      atendimento,
      proximaPergunta: proximaPergunta(atendimento?.onboarding)
    };
  }));
  router.post("/conversas/:conversaId/iniciar", wrap(async req => ({
    atendimento: await iniciarAtendimento({
      conversaId: req.params.conversaId,
      origem: req.body?.origem,
      onboardingId: req.body?.onboardingId,
      atorId: req.auth.user.id,
      client: db
    })
  })));
  router.get("/onboardings/:id", wrap(async req => ({
    ...(await propostas.painel(req.params.id, req.auth.user)),
    onboarding: await exigirEscopo(req.params.id, req.auth.user, db)
  })));
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
  router.post("/onboardings/:id/propostas/:propostaId/link", wrap(async req => propostas.emitirLink(req.params.id, req.params.propostaId, req.auth.user)));
  router.post("/onboardings/:id/propostas/:propostaId/enviar", wrap(async req => enviarProposta(req.params.id, req.params.propostaId, req.auth.user, {
    db
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
  router.post("/onboardings/:id/marcos", wrap(async req => propostas.registrarMarco(req.params.id, req.auth.user, req.body?.tipo, req.body?.evidencia)));
  router.use((e, _req, res, _next) => res.status(400).json({
    ok: false,
    error: "upload_invalido",
    message: "Envie um PDF de até 5 MB."
  }));
  return router;
}
