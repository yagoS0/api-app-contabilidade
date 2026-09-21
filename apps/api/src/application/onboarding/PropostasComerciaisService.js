import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { OnboardingError } from "./OnboardingService.js";
import { exigirEscopo } from "./ComercialService.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { calcularOpcoes, preencherTexto } from "./CatalogoComercial.js";
import { encerrado } from "./LeadService.js";
import { encryptSecret, decryptSecret } from "../../utils/crypto.js";
import { etapasDaOrigem } from "./etapasTemplate.js";
import { propostaParaCliente } from "./PropostaComercialPdf.js";
import { prepararCamposContrato } from "./ContratoComercialCampos.js";
import { exigirPropostaDefinitiva, exigirContratoAvulsoConcluivel } from "./PoliticaJornadaComercial.js";
const hash = v => crypto.createHash("sha256").update(v).digest("hex");
const erro = (c, m, s = 409) => new OnboardingError(c, m, s);
const evento = (tx, onboardingId, tipo, atorId, dados = {}) => tx.onboardingEvento.create({
  data: {
    onboardingId,
    tipo,
    atorId,
    dados
  }
});
async function conferirDiagnosticoDaProposta(db, proposta) {
  if (!proposta.snapshot?.diagnosticoId || proposta.status === "ACEITA") return;
  const atual = await db.onboardingEvento.findFirst({ where: { onboardingId: proposta.onboardingId, tipo: "JORNADA_DIAGNOSTICO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (atual?.id !== proposta.snapshot.diagnosticoId) throw erro("proposta_desatualizada", "O diagnóstico mudou. Peça uma versão revisada da proposta.");
}
export function criarPropostasComerciais({
  db = prisma,
  agora = () => new Date(),
  cifrar = encryptSecret,
  decifrar = decryptSecret
} = {}) {
  async function painel(id, user) {
    await exigirEscopo(id, user, db);
    const [propostas, contratos, documentos, atendimento, trabalhos] = await Promise.all([db.propostaComercial.findMany({
      where: {
        onboardingId: id
      },
      orderBy: {
        versao: "desc"
      }
    }), db.contratoComercial.findMany({
      where: {
        onboardingId: id
      },
      orderBy: {
        createdAt: "desc"
      }
    }), db.documentoOnboarding.findMany({
      where: {
        onboardingId: id
      },
      select: {
        id: true,
        nome: true,
        mime: true,
        sha256: true,
        createdAt: true
      }
    }), db.atendimentoLead.findFirst({
      where: {
        onboardingId: id,
        encerradoEm: null
      }
    }), db.trabalhoFiscalLead.findMany({
      where: {
        onboardingId: id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20
    })]);
    return {
      propostas: propostas.map(({
        tokenHash,
        ...p
      }) => p),
      contratos,
      documentos,
      atendimento,
      trabalhos,
      marcos: await db.onboardingEvento.findMany({
        where: {
          onboardingId: id,
          tipo: {
            in: ["DOCUMENTACAO_CONFERIDA", "PAGAMENTO_HONORARIOS_CONFERIDO", "ANALISE_REVISADA"]
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 30
      })
    };
  }
  async function gerar(id, user, body = {}) {
    exigirGestor(user);
    return db.$transaction(async tx => {
      const r = await exigirEscopo(id, user, tx);
      if (encerrado(r)) throw erro("onboarding_fechado", "Atendimento encerrado.");
      if (!Number.isInteger(body.versao) || body.versao !== r.versao) throw erro("formulario_alterado", "Recarregue a ficha antes de gerar a proposta.");
      await tx.onboarding.update({
        where: {
          id,
          versao: r.versao
        },
        data: {
          faseComercial: "PROPOSTA"
        }
      });
      const catalogo = await tx.recursoComercial.findFirst({
        where: {
          tipo: "CATALOGO",
          chave: "honorarios",
          aprovadoEm: {
            not: null
          }
        },
        orderBy: {
          versao: "desc"
        }
      });
      if (!catalogo) throw erro("catalogo_nao_aprovado", "Aprove uma versão do catálogo primeiro.");
      const proposta = calcularOpcoes({
        ficha: r,
        catalogo: catalogo.dados,
        ajustes: body.ajustes || {}
      });
      const publica = r.cnpj ? await tx.onboardingAnalise.findFirst({ where: { onboardingId: id, cnpj: r.cnpj, tipo: "PUBLICA", status: "CONCLUIDA" }, orderBy: { createdAt: "desc" } }) : null;
      const anterior = await tx.propostaComercial.findFirst({
        where: {
          onboardingId: id
        },
        orderBy: {
          versao: "desc"
        }
      });
      const p = await tx.propostaComercial.create({
        data: {
          onboardingId: id,
          versao: (anterior?.versao || 0) + 1,
          fichaVersao: r.versao,
          expiraEm: new Date(agora().getTime() + 7 * 86400000),
          snapshot: {
            ...proposta,
            catalogoId: catalogo.id,
            catalogoVersao: catalogo.versao,
            origem: r.origem,
            destinatario: r.responsavelNome || r.razaoSocial || "Interessado",
            cnpj: r.cnpj,
            razaoSocial: r.razaoSocial || r.dados?.razaoSocial || publica?.resultado?.razaoSocial || null,
            perfil: {
              atividade: r.dados?.atividadePretendida || r.dados?.atividadePrincipal || publica?.resultado?.atividadePrincipal || null,
              regime: r.dados?.regimeAtual || r.dados?.regimePretendido || null,
              funcionarios: r.dados?.qtdFuncionarios ?? null,
              notasRecebidasMes: r.dados?.notasRecebidasMes ?? null,
              consultoriaMensal: proposta.opcoes.some(o => o.recorrente) && (r.dados?.consultoriaMensal === true || Number(r.dados?.qtdFuncionarios) >= catalogo.dados.consultoriaIncluidaAPartir)
            },
            servicosConferidos: String(body.ajustes?.escopoAvulso || "").slice(0, 1200),
            criadoPor: user.id
          }
        }
      });
      await evento(tx, id, "PROPOSTA_GERADA", user.id, {
        propostaId: p.id,
        versao: p.versao
      });
      return p;
    });
  }
  async function aprovar(id, propostaId, user) {
    exigirGestor(user);
    return db.$transaction(async tx => {
      const r = await exigirEscopo(id, user, tx);
      const trava = await tx.onboarding.updateMany({
        where: {
          id,
          versao: r.versao
        },
        data: {
          updatedAt: agora()
        }
      });
      if (!trava.count) throw erro("formulario_alterado", "A ficha mudou durante a revisão.");
      const p = await tx.propostaComercial.findFirst({
        where: {
          id: propostaId,
          onboardingId: id
        }
      });
      if (!p || encerrado(r) || p.status !== "RASCUNHO" || p.fichaVersao !== r.versao || p.expiraEm <= agora()) throw erro("proposta_desatualizada", "Gere uma proposta com os dados atuais.");
      if (p.snapshot.pendencias?.length || !p.snapshot.opcoes?.length || p.snapshot.opcoes.some(o => o.unicoCentavos === null || o.mensalCentavos === null)) throw erro("proposta_incompleta", "Resolva as pendências de preço e escopo.");
      if (await tx.propostaComercial.findFirst({ where: { onboardingId: id, status: "ACEITA", revogadaEm: null } })) throw erro("contratacao_ja_aceita", "Existe uma contratação aceita. Preserve-a e inicie outra solicitação para alterar o escopo.");
      const jornada = await exigirPropostaDefinitiva({ db: tx, ficha: r, user });
      await tx.propostaComercial.updateMany({
        where: {
          onboardingId: id,
          id: {
            not: propostaId
          },
          revogadaEm: null,
          status: { not: "ACEITA" }
        },
        data: {
          revogadaEm: agora(),
          tokenHash: null
        }
      });
      const out = await tx.propostaComercial.update({
        where: {
          id: propostaId
        },
        data: {
          status: "APROVADA",
          snapshot: { ...p.snapshot, diagnosticoId: jornada.diagnostico.id, servicosConferidos: jornada.diagnostico.dados.servicos, limitacaoEscopo: jornada.diagnostico.dados.dispensaConsultaPrivada || null, conferenciaCadastro: jornada.diagnostico.dados.conferenciaCadastro || null },
          aprovadaPor: user.id,
          aprovadaEm: agora()
        }
      });
      await evento(tx, id, "PROPOSTA_APROVADA", user.id, {
        propostaId
      });
      return out;
    });
  }
  async function emitirLink(id, propostaId, user) {
    exigirGestor(user);
    const ficha = await exigirEscopo(id, user, db);
    const proposta = await db.propostaComercial.findFirst({ where: { id: propostaId, onboardingId: id, revogadaEm: null } });
    if (!proposta || proposta.fichaVersao !== ficha.versao) throw erro("proposta_indisponivel", "Confira a versão atual da proposta.");
    await conferirDiagnosticoDaProposta(db, proposta);
    const token = crypto.randomBytes(32).toString("base64url");
    const p = await db.propostaComercial.updateMany({
      where: {
        id: propostaId,
        onboardingId: id,
        status: {
          in: ["APROVADA", "ENVIADA"]
        },
        revogadaEm: null,
        expiraEm: {
          gt: agora()
        }
      },
      data: {
        tokenHash: hash(token)
      }
    });
    if (!p.count) throw erro("proposta_indisponivel", "A proposta precisa estar aprovada e vigente.");
    await evento(db, id, "LINK_PROPOSTA_CRIADO", user.id, {
      propostaId
    });
    return {
      token
    }; // Gerar/copiar link não é evidência de envio.
  }
  async function publico(token, aceite = null) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) throw erro("link_invalido", "Link inválido ou expirado.", 404);
    const where = {
      tokenHash: hash(token),
      revogadaEm: null,
      expiraEm: {
        gt: agora()
      },
      status: {
        in: ["APROVADA", "ENVIADA", "ACEITA"]
      }
    };
    const p = await db.propostaComercial.findFirst({
      where
    });
    if (!p) throw erro("link_invalido", "Link inválido ou expirado.", 404);
    if (p.status !== "ACEITA") {
      const ficha = await db.onboarding.findUnique({
        where: {
          id: p.onboardingId
        }
      });
      if (!ficha || encerrado(ficha) || ficha.versao !== p.fichaVersao) throw erro("proposta_desatualizada", "O atendimento foi atualizado. Peça a proposta revisada ao escritório.");
      await conferirDiagnosticoDaProposta(db, p);
    }
    if (aceite) {
      if (aceite.confirmado !== true || aceite.versao !== p.versao || !p.snapshot.opcoes.some(o => o.chave === aceite.opcao)) throw erro("aceite_invalido", "Confira a opção e confirme a proposta.", 400);
      if (p.status === "ACEITA") {
        if (p.opcaoAceita !== aceite.opcao) throw erro("aceite_ja_registrado", "Uma opção já foi aceita. Fale com o escritório.");
      } else await db.$transaction(async tx => {
        const reserva = await tx.onboarding.updateMany({ where: { id: p.onboardingId, versao: p.fichaVersao, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: agora() } });
        if (!reserva.count) throw erro("proposta_alterada", "O atendimento mudou. Reabra a proposta revisada.");
        await conferirDiagnosticoDaProposta(tx, p);
        const mudou = await tx.propostaComercial.updateMany({
          where: {
            ...where,
            id: p.id,
            onboarding: {
              versao: p.fichaVersao,
              status: {
                notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"]
              }
            },
            status: {
              in: ["APROVADA", "ENVIADA"]
            }
          },
          data: {
            status: "ACEITA",
            aceitaEm: agora(),
            opcaoAceita: aceite.opcao,
            aceiteEvidencia: "LINK_PESSOAL"
          }
        });
        if (!mudou.count) throw erro("proposta_alterada", "A proposta mudou. Reabra o link.");
        await evento(tx, p.onboardingId, "PROPOSTA_ACEITA", null, {
          propostaId: p.id,
          opcao: aceite.opcao,
          versao: p.versao
        });
      });
    }
    return {
      proposta: {
        ...propostaParaCliente(p),
        status: aceite ? "ACEITA" : p.status,
        opcaoAceita: aceite?.opcao || p.opcaoAceita
      }
    };
  }
  async function documentoProposta(id, propostaId, user) {
    exigirGestor(user);
    const r = await exigirEscopo(id, user, db);
    const p = await db.propostaComercial.findFirst({ where: { id: propostaId, onboardingId: id, revogadaEm: null } });
    if (!p || (p.status !== "ACEITA" && (p.fichaVersao !== r.versao || encerrado(r) || new Date(p.expiraEm) <= agora()))) throw erro("proposta_indisponivel", "A proposta mudou ou expirou. Gere uma versão com os dados atuais.");
    await conferirDiagnosticoDaProposta(db, p);
    return propostaParaCliente(p);
  }
  async function contrato(id, propostaId, user, body) {
    exigirGestor(user);
    const r = await exigirEscopo(id, user, db);
    const p = await db.propostaComercial.findFirst({
      where: {
        id: propostaId,
        onboardingId: id,
        status: "ACEITA",
        revogadaEm: null
      }
    });
    if (!p || encerrado(r) || p.fichaVersao !== r.versao) throw erro("aceite_ausente", "A proposta precisa ter uma opção aceita com os dados atuais.");
    const modelo = await db.recursoComercial.findUnique({
      where: {
        id: body.modeloId
      }
    });
    const opcao = p.snapshot.opcoes.find(o => o.chave === p.opcaoAceita);
    if (modelo?.tipo !== "CONTRATO" || !modelo.aprovadoEm || modelo.dados.recorrente !== opcao.recorrente || !r.cnpj && modelo.dados.permitePreCnpj !== true) throw erro("modelo_incompativel", "Selecione um modelo aprovado para esta modalidade e identificação do contratante.");
    const institucional = await db.recursoComercial.findFirst({
      where: { tipo: "INSTITUCIONAL", chave: "escritorio", aprovadoEm: { not: null } }, orderBy: { versao: "desc" }
    });
    const dados = prepararCamposContrato({ onboarding: r, proposta: p, modelo, institucional: institucional || {}, variaveis: body.variaveis });
    let texto;
    try {
      texto = preencherTexto(modelo.texto, dados);
    } catch (e) {
      throw erro("contrato_incompleto", e.message);
    }
    return db.contratoComercial.upsert({
      where: {
        propostaId
      },
      create: {
        onboardingId: id,
        propostaId,
        modeloId: modelo.id,
        texto,
        dados: JSON.parse(JSON.stringify({
          variaveis: dados,
          opcao,
          modeloVersao: modelo.versao
        }))
      },
      update: {}
    });
  }
  async function aprovarContrato(id, contratoId, user) {
    exigirGestor(user);
    await exigirEscopo(id, user, db);
    const out = await db.contratoComercial.updateMany({
      where: {
        id: contratoId,
        onboardingId: id,
        status: "MINUTA",
        proposta: {
          revogadaEm: null
        }
      },
      data: {
        status: "AGUARDANDO_ASSINATURA",
        aprovadoEm: agora(),
        aprovadoPor: user.id
      }
    });
    if (!out.count) throw erro("contrato_indisponivel", "Contrato não está em minuta.");
    await evento(db, id, "CONTRATO_APROVADO", user.id, {
      contratoId
    });
  }
  async function salvarDocumento(id, user, arquivo) {
    exigirGestor(user);
    await exigirEscopo(id, user, db);
    if (!arquivo?.buffer?.length || arquivo.buffer.length > 5 * 1024 * 1024 || arquivo.mimetype !== "application/pdf" || arquivo.buffer.subarray(0, 5).toString() !== "%PDF-") throw erro("arquivo_invalido", "Envie um PDF de até 5 MB.", 400);
    const conteudoCifrado = await cifrar(arquivo.buffer.toString("base64"));
    if (!conteudoCifrado) throw erro("cifra_indisponivel", "Não foi possível proteger o documento.", 503);
    return db.$transaction(async tx => {
      const reserva = await tx.onboarding.updateMany({ where: { id, status: { notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"] } }, data: { updatedAt: agora() } });
      if (!reserva.count) throw erro("atendimento_encerrado", "A ficha já foi encerrada. Anexe novos arquivos nos documentos da empresa.");
      const d = await tx.documentoOnboarding.create({
        data: {
          onboardingId: id,
          nome: String(arquivo.originalname || "documento.pdf").replace(/[\r\n\\/]/g, "_").slice(0, 180),
          mime: "application/pdf",
          conteudoCifrado,
          sha256: hash(arquivo.buffer),
          criadoPor: user.id
        }
      });
      await evento(tx, id, "DOCUMENTO_RECEBIDO", user.id, {
        documentoId: d.id,
        sha256: d.sha256
      });
      return {
        id: d.id,
        nome: d.nome,
        sha256: d.sha256
      };
    });
  }
  async function documento(id, documentoId, user) {
    exigirGestor(user);
    await exigirEscopo(id, user, db);
    const d = await db.documentoOnboarding.findFirst({
      where: {
        id: documentoId,
        onboardingId: id
      }
    });
    if (!d) throw erro("documento_ausente", "Documento não encontrado.", 404);
    const plain = await decifrar(d.conteudoCifrado);
    if (!plain) throw erro("documento_indisponivel", "Documento indisponível.", 503);
    return Buffer.from(plain, "base64");
  }
  async function conferirAssinatura(id, contratoId, user, documentoId) {
    exigirGestor(user);
    await exigirEscopo(id, user, db);
    return db.$transaction(async tx => {
      const d = await tx.documentoOnboarding.findFirst({
        where: {
          id: documentoId,
          onboardingId: id
        }
      });
      if (!d) throw erro("documento_ausente", "Anexe e confira o contrato assinado.");
      const out = await tx.contratoComercial.updateMany({
        where: {
          id: contratoId,
          onboardingId: id,
          status: "AGUARDANDO_ASSINATURA",
          proposta: {
            revogadaEm: null
          }
        },
        data: {
          status: "ASSINADO_CONFERIDO",
          documentoAssinadoId: d.id,
          assinaturaConferidaPor: user.id,
          assinaturaConferidaEm: agora()
        }
      });
      if (!out.count) throw erro("contrato_indisponivel", "Contrato não está aguardando assinatura.");
      const contrato = await tx.contratoComercial.findUnique({
        where: {
          id: contratoId
        }
      });
      const ficha = await tx.onboarding.findUnique({
        where: {
          id
        }
      });
      const etapas = contrato.dados.opcao.recorrente ? etapasDaOrigem(ficha.origem) : [{
        chave: "avulso_documentacao",
        titulo: "Conferir documentos do serviço",
        descricao: "Documentos recebidos e exigências do escopo avulso.",
        ordem: 1
      }, {
        chave: "avulso_execucao",
        titulo: "Executar serviço contratado",
        descricao: "Executar somente o escopo da opção avulsa aceita.",
        ordem: 2
      }, {
        chave: "avulso_entrega",
        titulo: "Conferir e entregar resultado",
        descricao: "Registrar a entrega para concluir o atendimento avulso.",
        ordem: 3
      }];
      await tx.onboardingEtapa.createMany({
        data: etapas.map(e => ({
          ...e,
          onboardingId: id
        })),
        skipDuplicates: true
      });
      await tx.onboarding.update({
        where: {
          id
        },
        data: {
          faseComercial: "CONTRATADO",
          ...(ficha.status === "RASCUNHO" ? {
            status: "RECEBIDO",
            enviadoEm: agora()
          } : {})
        }
      });
      await evento(tx, id, "ASSINATURA_CONFERIDA_MANUALMENTE", user.id, {
        contratoId,
        documentoId,
        sha256: d.sha256
      });
    });
  }
  async function concluirAvulso(id, user, evidencia) {
    exigirGestor(user);
    await exigirEscopo(id, user, db);
    if (typeof evidencia !== "string" || evidencia.trim().length < 10 || evidencia.length > 2000) throw erro("evidencia_ausente", "Descreva a entrega do serviço.");
    return db.$transaction(async tx => {
      await tx.onboarding.update({ where: { id }, data: { updatedAt: agora() } });
      const c = await exigirContratoAvulsoConcluivel(tx, id);
      const ficha = await tx.onboarding.findUnique({ where: { id } });
      if (ficha.origem === "ABERTURA" && !await tx.fichaEmpresaAvulsa.findUnique({ where: { onboardingId: id } })) throw erro("ficha_avulsa_pendente", "Confira a ficha da empresa aberta e arquive os documentos antes de concluir a abertura avulsa.");
      const out = await tx.onboarding.updateMany({
        where: {
          id,
          status: {
            notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"]
          }
        },
        data: {
          status: "CONCLUIDO_AVULSO",
          versao: {
            increment: 1
          }
        }
      });
      if (!out.count) throw erro("onboarding_fechado", "Atendimento já encerrado.");
      await tx.atendimentoLead.updateMany({
        where: {
          onboardingId: id,
          encerradoEm: null
        },
        data: {
          encerradoEm: agora()
        }
      });
      await evento(tx, id, "SERVICO_AVULSO_CONCLUIDO", user.id, {
        contratoId: c.id,
        evidencia
      });
    });
  }
  async function registrarMarco(id, user, tipo, evidencia) {
    exigirGestor(user);
    await exigirEscopo(id, user, db);
    if (!["DOCUMENTACAO_CONFERIDA", "PAGAMENTO_HONORARIOS_CONFERIDO", "ANALISE_REVISADA"].includes(tipo) || typeof evidencia !== "string" || evidencia.trim().length < 10 || evidencia.length > 2000) throw erro("marco_invalido", "Informe o fato conferido e a evidência.");
    await evento(db, id, tipo, user.id, {
      evidencia
    });
  }
  return {
    painel,
    gerar,
    aprovar,
    emitirLink,
    publico,
    documentoProposta,
    contrato,
    aprovarContrato,
    salvarDocumento,
    documento,
    conferirAssinatura,
    concluirAvulso,
    registrarMarco
  };
}
