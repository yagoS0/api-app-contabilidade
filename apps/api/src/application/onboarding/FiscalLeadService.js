import { trabalhoFiscalAnteriorARetomada } from './automacaoComercialDoCaso.js';
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
import { exigirConversaDoCaso } from "./ContextoComercialService.js";
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
    fonte: out.fonte === "BRASILAPI" ? "BrasilAPI" : out.fonte === "MINHA_RECEITA" ? "Minha Receita" : "Dados públicos de CNPJ (provedor não informado)",
    consultadoEm: agora.toISOString(),
    razaoSocial: b.razao_social || out.tomador?.nome || null,
    situacaoCadastral: b.descricao_situacao_cadastral || null,
    cnaePrincipal: b.cnae_fiscal || null,
    atividadePrincipal: b.cnae_fiscal_descricao || null,
    endereco: [b.logradouro, b.numero, b.complemento, b.bairro, b.cep].filter(Boolean).join(", ") || null,
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
  const conferirIdentidade = async atendimento => {
    if (!atendimento?.interlocutorId) return; // atendimento anterior à migração
    const conversa = await db.conversaWhatsapp.findUnique({ where: { id: atendimento.conversaId } });
    await exigirConversaDoCaso(atendimento, conversa, db);
  };
  async function verificarRepresentante(id, user, evidencia) {
    exigirGestor(user);
    const r = await exigirEscopo(id, user, db);
    if (!r.cnpj || typeof evidencia !== "string" || evidencia.trim().length < 10 || evidencia.length > 2000) throw new OnboardingError("representante_incompleto", "Confirme CNPJ e registre como verificou o representante.");
    const atendimento = await db.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
    if (!atendimento) throw new OnboardingError("atendimento_ausente", "Vincule a conversa ao atendimento.", 409);
    await conferirIdentidade(atendimento);
    const out = await db.atendimentoLead.updateMany({
      where: {
        id: atendimento.id,
        representanteVerificadoEm: atendimento.representanteVerificadoEm,
        autorizacao: { equals: atendimento.autorizacao || {} },
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
        autorizacao: atendimento.autorizacao?.cnpj === r.cnpj ? atendimento.autorizacao : { estado: "AGUARDANDO_OUTORGA", cnpj: r.cnpj }
      }
    });
    if (!out.count) throw new OnboardingError("atendimento_alterado", "O atendimento mudou durante a conferência. Recarregue antes de registrar novamente.", 409);
  }
  async function validarProcuracaoManual(id, user, body = {}) {
    exigirGestor(user);
    if (!Number.isInteger(body.versao) || body.versao < 0 || body.confirmada !== true) throw new OnboardingError('validacao_invalida', 'Confirme a validação manual e a versão da ficha.');
    return db.$transaction(async tx => {
      const r = await exigirEscopo(id, user, tx);
      if (!/^\d{14}$/.test(r.cnpj || '') || encerrado(r)) throw new OnboardingError('consulta_invalida', 'Confira o CNPJ e o atendimento.');
      const reserva = await tx.onboarding.updateMany({ where: { id, versao: r.versao }, data: { updatedAt: new Date() } });
      if (!reserva.count) throw new OnboardingError('atendimento_alterado', 'A ficha mudou.', 409);
      const a = await tx.atendimentoLead.findFirst({ where: { onboardingId: id, encerradoEm: null } });
      if (a) await conferirIdentidade(a);
      const anterior = r.dados?.procuracaoManual || (a?.autorizacao?.cnpj === r.cnpj && a?.autorizacao?.validacaoManual);
      if (anterior?.cnpj === r.cnpj && (anterior.cadastroRevisao || 0) === (r.dados?.cadastroRevisao || 0) && anterior?.fichaVersao === body.versao && r.versao === body.versao + 1) return anterior;
      if (r.versao !== body.versao) throw new OnboardingError('atendimento_alterado', 'A ficha mudou.', 409);
      const validacaoManual = { origem: 'MANUAL', atorId: user.id, registradaEm: new Date().toISOString(), fichaVersao: body.versao,
        cnpj: r.cnpj, cadastroRevisao: r.dados?.cadastroRevisao || 0, provaOficial: false, limitacao: 'Validação declarada pelo contador; não comprova validade nem poderes aceitos pelo SERPRO.' };
      const atualizada = await tx.onboarding.updateMany({ where: { id, versao: body.versao }, data: { dados: { ...(r.dados || {}), procuracaoManual: validacaoManual }, versao: { increment: 1 } } });
      if (!atualizada.count) throw new OnboardingError('atendimento_alterado', 'A ficha mudou.', 409);
      const gravada = a ? await tx.atendimentoLead.updateMany({ where: { id: a.id, onboardingId: id, encerradoEm: null, autorizacao: { equals: a.autorizacao || {} } },
        data: { autorizacao: { ...(a.autorizacao?.cnpj === r.cnpj ? a.autorizacao : { cnpj: r.cnpj, estado: 'NAO_VERIFICADA' }), validacaoManual } } }) : { count: 1 };
      if (!gravada.count) throw new OnboardingError('atendimento_alterado', 'A autorização mudou.', 409);
      await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'PROCURACAO_VALIDADA_MANUALMENTE', atorId: user.id, dados: validacaoManual } });
      return validacaoManual;
    });
  }
  async function enfileirar(id, user, tipo, body = {}) {
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
    const autorizacaoExplicita = tipo === 'PROCURACAO' && body.autorizada === true && body.versao === r.versao;
    const autorizacaoInterna = a?.autorizacao?.cnpj === r.cnpj && a.autorizacao?.consultaAutorizadaPor;
    if (!a || (!autorizacaoExplicita && (!a.representanteVerificadoEm && !autorizacaoInterna || a.autorizacao?.cnpj !== r.cnpj))) throw new OnboardingError("representante_nao_verificado", "Autorize explicitamente a consulta na revisão atual da ficha.", 409);
    await conferirIdentidade(a);
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
      const fichaAtual = await tx.onboarding.findUnique({ where: { id } });
      if (!fichaAtual || fichaAtual.versao !== r.versao || encerrado(fichaAtual)) throw new OnboardingError("atendimento_alterado", "A ficha mudou. Confira antes de solicitar uma consulta.", 409);
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
      if (autorizacaoExplicita) {
        const autorizacao = { ...(a.autorizacao?.cnpj === r.cnpj ? a.autorizacao : { cnpj: r.cnpj, estado: 'NAO_VERIFICADA' }),
          consultaAutorizadaPor: user.id, consultaAutorizadaEm: new Date().toISOString(), fichaVersao: r.versao };
        const gravada = await tx.atendimentoLead.updateMany({ where: { id: a.id, onboardingId: id, encerradoEm: null, autorizacao: { equals: a.autorizacao || {} } }, data: { autorizacao } });
        if (!gravada.count) throw new OnboardingError('atendimento_alterado', 'A autorização mudou.', 409);
        await tx.onboardingEvento.create({ data: { onboardingId: id, tipo: 'CONSULTA_PROCURACAO_AUTORIZADA', atorId: user.id, dados: { cnpj: r.cnpj, fichaVersao: r.versao } } });
      }
      return tx.trabalhoFiscalLead.create({
        data: {
          onboardingId: id,
          cnpj: r.cnpj,
          tipo,
          criadoPor: user.id,
          ...(autorizacaoExplicita ? { resultado: { fichaVersao: r.versao, autorizadaPor: user.id } } : {})
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
        await exigirEscopo(j.onboardingId, user, db);
        if (j.resultado?.fichaVersao != null && r?.versao !== j.resultado.fichaVersao) throw new OnboardingError('escopo_alterado', 'A revisão autorizada para a consulta mudou.', 409);
        if (trabalhoFiscalAnteriorARetomada(a, j)) throw new OnboardingError('retomada_manual', 'Confira a ficha antes de uma nova consulta.', 409);
        if (!r || r.cnpj !== j.cnpj || encerrado(r) || (!a?.representanteVerificadoEm && !a?.autorizacao?.consultaAutorizadaPor) || a.autorizacao?.cnpj !== j.cnpj) throw new OnboardingError("escopo_alterado", "CNPJ, autorização interna ou atendimento mudou.", 409);
        await conferirIdentidade(a);
        if (j.tipo === "PROCURACAO") {
          const p = await comContextoSerpro({
            origem: "lead_procuracao",
            acaoId: j.onboardingId,
            userId: user.id
          }, () => procura(j.cnpj));
          const prova = {
            origem: 'SERPRO',
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
          await conferirIdentidade(a);
          const gravada = await db.atendimentoLead.updateMany({
            where: {
              id: a.id,
              encerradoEm: null,
              autorizacao: { equals: a.autorizacao || {} },
              onboarding: { cnpj: j.cnpj, status: r.status, versao: r.versao },
              representanteVerificadoEm: a.representanteVerificadoEm
            },
            data: {
              autorizacao: {
                ...a.autorizacao,
                estado,
                cnpj: j.cnpj,
                prova
              }
            }
          });
          if (!gravada.count) throw new OnboardingError("escopo_alterado", "O atendimento mudou durante a verificação. Confira antes de consultar.", 409);
          resultado = {
            estado,
            mensagem: estado === "ATIVA" ? "Procuração verificada. A consulta SITFIS pode ser solicitada." : "Autorização insuficiente ou não vigente."
          };
        } else {
          const out = await comercial.analisar(j.onboardingId, user, "SITFIS", { versaoEsperada: r.versao });
          resultado = {
            analiseId: out.analise?.id,
            mensagem: out.analise?.resultado?.mensagem || "Consulta registrada.",
            ...(out.analise?.resultado?.codigo ? { codigo: out.analise.resultado.codigo } : {}),
            ...(out.analise?.resultado?.tentarNovamenteEm ? { tentarNovamenteEm: out.analise.resultado.tentarNovamenteEm } : {})
          };
          status = out.analise?.status === "PROCESSANDO" ? j.tentativas < 3 ? "AGUARDANDO" : "EXIGE_REVISAO" : out.analise?.status === "CONCLUIDA" ? "CONCLUIDO" : "FALHOU";
        }
      } catch (e) {
        status = "FALHOU";
        resultado = {
          codigo: e.code || "consulta_falhou",
          mensagem: e instanceof OnboardingError ? e.message : "Não foi possível concluir. Confira antes de repetir."
        };
        if (e.extra?.tentarNovamenteEm) resultado.tentarNovamenteEm = e.extra.tentarNovamenteEm;
        const espera = Number(e.detalhe?.segundosRestantes);
        if (e.code === "SERPRO_CHAMADA_REPETIDA" && Number.isFinite(espera) && espera > 0) {
          resultado.tentarNovamenteEm = new Date(Date.now() + Math.ceil(espera) * 1000).toISOString();
          resultado.mensagem = `Consulta realizada há pouco. Nova conferência após ${Math.ceil(espera)} segundos.`;
        }
      }
      let proximaTentativaEm = new Date(Date.now() + 120000);
      if (j.resultado?.fichaVersao != null) resultado = { ...resultado, fichaVersao: j.resultado.fichaVersao, autorizadaPor: j.resultado.autorizadaPor };
      const prazo = new Date(resultado?.tentarNovamenteEm).getTime();
      // Somente recusas conhecidas, anteriores à rede, entram em espera. Resultado
      // incerto, limite de consumo e falta de PDF continuam exigindo ação humana.
      if (status === "FALHOU" && (resultado?.codigo === "aguarde_consulta" || (resultado?.codigo === "SERPRO_CHAMADA_REPETIDA" && Number.isFinite(prazo)))) {
        status = j.tentativas < 3 ? "AGUARDANDO" : "EXIGE_REVISAO";
        if (Number.isFinite(prazo) && prazo > Date.now()) proximaTentativaEm = new Date(prazo);
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
          proximaTentativaEm
        }
      });
    }
    return {
      processados: jobs.length
    };
  }
  return {
    validarProcuracaoManual,
    verificarRepresentante,
    enfileirar,
    processarUmaVez
  };
}
