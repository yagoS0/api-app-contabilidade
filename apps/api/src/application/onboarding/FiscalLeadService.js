import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/db/prisma.js";
import { consultarCnpj } from "../tomador/consultaCnpj.js";
import { SerproProcurationService } from "../fiscal/serpro/SerproProcurationService.js";
import { comContextoSerpro } from "../fiscal/serpro/serproCallContext.js";
import { criarServicoComercial, exigirEscopo, procuracaoHabilitaSitfis } from "./ComercialService.js";
import { exigirGestor } from "./RecursosComerciaisService.js";
import { OnboardingError } from "./OnboardingService.js";
import { encerrado } from "./LeadService.js";
import { INTEGRACAO_FISCAL_LEADS } from "../../config.js";
export async function consultarPublicaLead(onboardingId, {
  db = prisma,
  consultar = consultarCnpj,
  agora = new Date()
} = {}) {
  const r = await db.onboarding.findUnique({
    where: {
      id: onboardingId
    }
  });
  if (!r?.cnpj || encerrado(r)) throw new OnboardingError("cnpj_ausente", "Informe o CNPJ antes da consulta.");
  const ultima = await db.onboardingAnalise.findFirst({
    where: {
      onboardingId,
      cnpj: r.cnpj,
      tipo: "PUBLICA",
      status: "CONCLUIDA",
      createdAt: {
        gte: new Date(agora.getTime() - 3600000)
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  if (ultima) return ultima.resultado;
  const out = await consultar(r.cnpj);
  if (!out.ok) throw new OnboardingError("consulta_indisponivel", "Não consegui consultar os dados públicos agora. O contador pode conferir.", 502);
  const b = out.bruto || {};
  const resultado = {
    fonte: "BrasilAPI",
    consultadoEm: agora.toISOString(),
    razaoSocial: b.razao_social || out.tomador?.nome || null,
    situacaoCadastral: b.descricao_situacao_cadastral || null,
    cnaePrincipal: b.cnae_fiscal || null,
    municipio: b.municipio || null,
    uf: b.uf || null,
    mensagem: "Dados públicos não comprovam regularidade fiscal."
  };
  const atual = await db.onboarding.findUnique({
    where: {
      id: onboardingId
    }
  });
  if (atual.cnpj !== r.cnpj) throw new OnboardingError("cnpj_alterado", "O CNPJ mudou durante a consulta.", 409);
  await db.onboardingAnalise.create({
    data: {
      onboardingId,
      cnpj: r.cnpj,
      tipo: "PUBLICA",
      status: "CONCLUIDA",
      resultado,
      criadoPorId: "SISTEMA_COMERCIAL"
    }
  });
  return resultado;
}
export function criarFiscalLead({
  db = prisma,
  procura = cnpj => new SerproProcurationService().checkCnpjProcuration({
    cnpj
  }),
  comercial = criarServicoComercial({
    db
  }),
  flag = INTEGRACAO_FISCAL_LEADS
} = {}) {
  async function verificarRepresentante(id, user, evidencia) {
    exigirGestor(user);
    const r = await exigirEscopo(id, user, db);
    if (!r.cnpj || typeof evidencia !== "string" || evidencia.trim().length < 10 || evidencia.length > 2000) throw new OnboardingError("representante_incompleto", "Confirme CNPJ e registre como verificou o representante.");
    const out = await db.atendimentoLead.updateMany({
      where: {
        onboardingId: id,
        encerradoEm: null,
        onboarding: {
          cnpj: r.cnpj,
          versao: r.versao
        }
      },
      data: {
        representanteVerificadoEm: new Date(),
        representanteVerificadoPor: user.id,
        evidenciaRepresentante: evidencia,
        autorizacao: {
          estado: "AGUARDANDO_OUTORGA",
          cnpj: r.cnpj
        }
      }
    });
    if (!out.count) throw new OnboardingError("atendimento_ausente", "Vincule a conversa ao atendimento.", 409);
  }
  async function enfileirar(id, user, tipo) {
    exigirGestor(user);
    const r = await exigirEscopo(id, user, db);
    if (!flag) throw new OnboardingError("FISCAL_LEADS_OFF", "O piloto de consultas fiscais de leads está desligado.", 409);
    if (!["PROCURACAO", "SITFIS"].includes(tipo) || !r.cnpj || encerrado(r)) throw new OnboardingError("consulta_invalida", "Confira CNPJ e tipo de consulta.");
    const a = await db.atendimentoLead.findFirst({
      where: {
        onboardingId: id,
        encerradoEm: null
      }
    });
    if (!a?.representanteVerificadoEm || a.autorizacao?.cnpj !== r.cnpj) throw new OnboardingError("representante_nao_verificado", "Confira a identidade e a representação antes da consulta privada.", 409);
    if (tipo === "SITFIS" && (a.autorizacao?.estado !== "ATIVA" || !procuracaoHabilitaSitfis(a.autorizacao?.prova))) throw new OnboardingError("procuracao_nao_verificada", "Verifique primeiro uma procuração vigente para SITFIS.", 409);
    return db.$transaction(async tx => {
      await tx.onboarding.update({
        where: {
          id
        },
        data: {
          updatedAt: new Date()
        }
      });
      const existente = await tx.trabalhoFiscalLead.findFirst({
        where: {
          onboardingId: id,
          cnpj: r.cnpj,
          tipo,
          status: {
            in: ["PENDENTE", "PROCESSANDO", "AGUARDANDO"]
          }
        }
      });
      if (existente) return existente;
      return tx.trabalhoFiscalLead.create({
        data: {
          onboardingId: id,
          cnpj: r.cnpj,
          tipo,
          criadoPor: user.id
        }
      });
    });
  }
  async function processarUmaVez() {
    if (!flag) return {
      processados: 0
    };
    const agora = new Date();
    // Expiração no meio de uma operação paga é indeterminada: não repetir a consulta sozinha.
    await db.trabalhoFiscalLead.updateMany({
      where: {
        status: "PROCESSANDO",
        leaseAte: {
          lte: agora
        }
      },
      data: {
        status: "INDETERMINADO",
        resultado: {
          mensagem: "Execução interrompida; o contador deve conferir antes de repetir."
        }
      }
    });
    const jobs = await db.trabalhoFiscalLead.findMany({
      where: {
        status: {
          in: ["PENDENTE", "AGUARDANDO"]
        },
        tentativas: {
          lt: 4
        },
        proximaTentativaEm: {
          lte: agora
        }
      },
      take: 3,
      orderBy: {
        createdAt: "asc"
      }
    });
    for (const j of jobs) {
      const token = randomUUID();
      const reserva = await db.trabalhoFiscalLead.updateMany({
        where: {
          id: j.id,
          status: j.status,
          tentativas: j.tentativas
        },
        data: {
          status: "PROCESSANDO",
          reservaToken: token,
          leaseAte: new Date(Date.now() + 300000),
          tentativas: {
            increment: 1
          }
        }
      });
      if (!reserva.count) continue;
      let status = "CONCLUIDO",
        resultado;
      try {
        const r = await db.onboarding.findUnique({
          where: {
            id: j.onboardingId
          }
        });
        const a = await db.atendimentoLead.findFirst({
          where: {
            onboardingId: j.onboardingId,
            encerradoEm: null
          }
        });
        const user = await db.user.findUnique({
          where: {
            id: j.criadoPor
          }
        });
        exigirGestor(user);
        if (!r || r.cnpj !== j.cnpj || encerrado(r) || !a?.representanteVerificadoEm || a.autorizacao?.cnpj !== j.cnpj) throw new OnboardingError("escopo_alterado", "CNPJ, representante ou atendimento mudou.", 409);
        if (j.tipo === "PROCURACAO") {
          const p = await comContextoSerpro({
            origem: "lead_procuracao",
            userId: user.id
          }, () => procura(j.cnpj));
          const prova = {
            status: p.status,
            validUntil: p.validUntil,
            systems: p.systems,
            checkedAt: p.checkedAt,
            procuradorCnpj: p.procuradorCnpj
          };
          const estado = procuracaoHabilitaSitfis(p) ? "ATIVA" : p.status === "REVOGADA" ? "REVOGADA" : "BLOQUEADA";
          const atual = await db.onboarding.findUnique({
            where: {
              id: j.onboardingId
            }
          });
          if (atual.cnpj !== j.cnpj) throw new OnboardingError("cnpj_alterado", "O CNPJ mudou.", 409);
          await db.atendimentoLead.updateMany({
            where: {
              id: a.id,
              representanteVerificadoEm: a.representanteVerificadoEm
            },
            data: {
              autorizacao: {
                estado,
                cnpj: j.cnpj,
                prova
              }
            }
          });
          resultado = {
            estado,
            mensagem: estado === "ATIVA" ? "Procuração verificada. A consulta SITFIS pode ser solicitada." : "Autorização insuficiente ou não vigente."
          };
        } else {
          const out = await comercial.analisar(j.onboardingId, user, "SITFIS");
          resultado = {
            analiseId: out.analise?.id,
            mensagem: out.analise?.resultado?.mensagem || "Consulta registrada."
          };
          status = out.analise?.status === "PROCESSANDO" ? j.tentativas < 3 ? "AGUARDANDO" : "EXIGE_REVISAO" : out.analise?.status === "CONCLUIDA" ? "CONCLUIDO" : "FALHOU";
        }
      } catch (e) {
        status = "FALHOU";
        resultado = {
          codigo: e.code || "consulta_falhou",
          mensagem: e instanceof OnboardingError ? e.message : "Não foi possível concluir. Confira antes de repetir."
        };
      }
      await db.trabalhoFiscalLead.updateMany({
        where: {
          id: j.id,
          reservaToken: token,
          status: "PROCESSANDO"
        },
        data: {
          status,
          resultado,
          leaseAte: null,
          proximaTentativaEm: new Date(Date.now() + 120000)
        }
      });
    }
    return {
      processados: jobs.length
    };
  }
  return {
    verificarRepresentante,
    enfileirar,
    processarUmaVez
  };
}
