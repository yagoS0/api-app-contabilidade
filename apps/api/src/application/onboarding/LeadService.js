import { prisma } from "../../infrastructure/db/prisma.js";
import { OnboardingError, extrairColunas } from "./OnboardingService.js";
import { descritorDe, podarInvisiveis } from "@contabilidade/shared/onboarding";
const erro = (code, message, status = 409) => new OnboardingError(code, message, status);
export const ORIGENS_LEAD = ["ABERTURA", "TRANSFERENCIA", "INATIVA"];
export const encerrado = r => ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(r?.status);

// A mesma linha da conversa serializa criação humana, IA e retentativas de webhook.
export async function iniciarAtendimento({
  conversaId,
  origem = null,
  onboardingId = null,
  atorId = null,
  client = prisma
}) {
  if (origem && !ORIGENS_LEAD.includes(origem)) throw erro("origem_invalida", "Confira o motivo do atendimento.", 400);
  return client.$transaction(async tx => {
    const trava = await tx.conversaWhatsapp.updateMany({
      where: {
        id: conversaId,
        portalClientId: null,
        excluidaEm: null
      },
      data: {
        updatedAt: new Date()
      }
    });
    if (!trava.count) throw erro("lead_indisponivel", "Esta conversa não é um lead ativo.");
    const conversa = await tx.conversaWhatsapp.findUnique({
      where: {
        id: conversaId
      }
    });
    if (String(conversa.chaveEscopo).startsWith("legado:")) throw erro("lead_indisponivel", "Abra a conversa atual.");
    const entrada = await tx.mensagemWhatsapp.findFirst({
      where: {
        conversaId,
        direcao: "in"
      }
    });
    if (!entrada) throw erro("sem_entrada", "O interessado precisa ter escrito antes.");
    let lead = await tx.atendimentoLead.findFirst({
      where: {
        conversaId,
        encerradoEm: null
      },
      include: {
        onboarding: true
      }
    });
    if (lead?.onboarding && encerrado(lead.onboarding)) {
      await tx.atendimentoLead.update({
        where: {
          id: lead.id
        },
        data: {
          encerradoEm: new Date()
        }
      });
      lead = null;
    }
    if (!lead) lead = await tx.atendimentoLead.create({
      data: {
        conversaId
      },
      include: {
        onboarding: true
      }
    });
    if (onboardingId) {
      if (!atorId) throw erro("vinculo_manual", "O contador precisa conferir o vínculo.", 403);
      if (lead.onboardingId && lead.onboardingId !== onboardingId) throw erro("atendimento_ja_vinculado", "Esta conversa já tem uma ficha ativa.");
      if (lead.onboardingId === onboardingId) return lead;
      const travaFicha = await tx.onboarding.updateMany({
        where: {
          id: onboardingId,
          status: {
            notIn: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"]
          }
        },
        data: {
          updatedAt: new Date()
        }
      });
      if (!travaFicha.count) throw erro("ficha_indisponivel", "Selecione uma ficha ainda em atendimento.");
      const outro = await tx.atendimentoLead.findFirst({
        where: {
          onboardingId,
          encerradoEm: null
        }
      });
      if (outro) throw erro("ficha_ja_vinculada", "Esta ficha já está vinculada a outra conversa.");
      lead = await tx.atendimentoLead.update({
        where: {
          id: lead.id
        },
        data: {
          onboardingId
        },
        include: {
          onboarding: true
        }
      });
      await tx.onboardingEvento.create({
        data: {
          onboardingId,
          tipo: "CONVERSA_VINCULADA",
          atorId,
          dados: {
            conversaId,
            atendimentoId: lead.id,
            vinculoConferido: true
          }
        }
      });
    }
    if (!lead.onboardingId && origem) {
      const dados = {
        responsavelTelefone: conversa.telefoneE164
      };
      const onboarding = await tx.onboarding.create({
        data: {
          origem,
          dados,
          ...extrairColunas(origem, dados),
          origemPreenchimento: atorId ? "ESCRITORIO" : "WHATSAPP",
          criadoPorId: atorId,
          fontesDados: {
            responsavelTelefone: {
              fonte: "WHATSAPP",
              mensagemId: entrada.id
            }
          }
        }
      });
      lead = await tx.atendimentoLead.update({
        where: {
          id: lead.id
        },
        data: {
          onboardingId: onboarding.id
        },
        include: {
          onboarding: true
        }
      });
      await tx.onboardingEvento.create({
        data: {
          onboardingId: onboarding.id,
          tipo: "CONVERSA_VINCULADA",
          atorId,
          dados: {
            conversaId,
            atendimentoId: lead.id
          }
        }
      });
    }
    return lead;
  });
}
export function aplicarCampos(origem, atual, operacoes) {
  if (!Array.isArray(operacoes) || operacoes.length > 30) throw erro("campos_invalidos", "Informe até 30 alterações.", 400);
  const dados = {
    ...atual
  };
  for (const op of operacoes) {
    const d = descritorDe(origem, op.campo);
    if (!d || !["set", "unset"].includes(op.acao)) throw erro("campo_invalido", "Campo não permitido.", 400);
    if (op.acao === "unset") {
      delete dados[op.campo];
      continue;
    }
    const v = op.valor;
    if (v === null || v === undefined || JSON.stringify(v).length > 5000) throw erro("valor_invalido", "Confira o valor informado.", 400);
    if (d.tipo === "booleano" && typeof v !== "boolean") throw erro("valor_invalido", "Informe sim ou não.", 400);
    if (["inteiro", "moeda"].includes(d.tipo) && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || d.tipo === "inteiro" && !Number.isInteger(v))) throw erro("valor_invalido", "Informe um número válido.", 400);
    if (d.opcoes && !d.opcoes.some(o => o.valor === v)) throw erro("valor_invalido", "Escolha uma opção válida.", 400);
    if (!["booleano", "inteiro", "moeda", "lista"].includes(d.tipo) && typeof v !== "string") throw erro("valor_invalido", "Informe um texto.", 400);
    if (d.tipo === "cnpj" && !/^\d{14}$/.test(v.replace(/\D/g, ""))) throw erro("cnpj_invalido", "Confira os 14 dígitos do CNPJ.", 400);
    if (d.tipo === "lista" && !Array.isArray(v)) throw erro("valor_invalido", "Informe uma lista completa.", 400);
    dados[op.campo] = v;
  }
  return podarInvisiveis(origem, dados);
}
export async function registrarCampos({
  onboardingId,
  versao,
  operacoes,
  mensagemId = null,
  mensagensIds = null,
  atorId = null,
  fonte = "WHATSAPP",
  client = prisma
}) {
  return client.$transaction(async tx => {
    const r = await tx.onboarding.findUnique({
      where: {
        id: onboardingId
      }
    });
    if (!r || encerrado(r) || r.versao !== versao) throw erro("formulario_alterado", "A ficha mudou. Releia antes de registrar.");
    if (mensagemId) {
      const entrada = await tx.mensagemWhatsapp.findFirst({
        where: {
          id: mensagemId,
          direcao: "in",
          conversa: {
            atendimentosLead: {
              some: {
                onboardingId,
                encerradoEm: null
              }
            }
          }
        }
      });
      if (!entrada) throw erro("mensagem_fora_do_escopo", "Mensagem não pertence ao atendimento.", 403);
    }
    if (mensagensIds !== null) {
      if (!mensagemId || !Array.isArray(mensagensIds) || !mensagensIds.length || mensagensIds.length > 12 || !mensagensIds.includes(mensagemId) || mensagensIds.some(id => typeof id !== "string") || new Set(mensagensIds).size !== mensagensIds.length) throw erro("mensagem_fora_do_escopo", "Confira as mensagens de origem.", 403);
      const entradas = await tx.mensagemWhatsapp.findMany({ where: { id: { in: mensagensIds }, direcao: "in", conversa: { atendimentosLead: { some: { onboardingId, encerradoEm: null } } } }, select: { id: true } });
      if (entradas.length !== mensagensIds.length) throw erro("mensagem_fora_do_escopo", "Mensagens não pertencem ao atendimento.", 403);
    }
    const dados = aplicarCampos(r.origem, r.dados || {}, operacoes);
    const fontesDados = {
      ...(r.fontesDados || {})
    };
    for (const op of operacoes) fontesDados[op.campo] = {
      fonte,
      mensagemId,
      ...(mensagensIds ? { mensagensIds } : {}),
      atorId,
      conferido: Boolean(atorId),
      em: new Date().toISOString(),
      acao: op.acao
    };
    const salva = await tx.onboarding.updateMany({
      where: {
        id: onboardingId,
        versao
      },
      data: {
        dados,
        fontesDados,
        ...extrairColunas(r.origem, dados),
        versao: {
          increment: 1
        }
      }
    });
    if (!salva.count) throw erro("formulario_alterado", "A ficha mudou. Releia antes de registrar.");
    if (r.cnpj !== extrairColunas(r.origem, dados).cnpj) {
      await tx.atendimentoLead.updateMany({
        where: {
          onboardingId
        },
        data: {
          autorizacao: {},
          representanteVerificadoEm: null,
          representanteVerificadoPor: null,
          evidenciaRepresentante: null
        }
      });
    }
    await tx.onboardingEvento.create({
      data: {
        onboardingId,
        tipo: "CAMPOS_REGISTRADOS",
        atorId,
        dados: {
          mensagemId,
          ...(mensagensIds ? { mensagensIds } : {}),
          fonte,
          campos: operacoes.map(o => o.campo),
          versao: versao + 1
        }
      }
    });
    return tx.onboarding.findUnique({
      where: {
        id: onboardingId
      }
    });
  });
}
export function proximaPergunta(r) {
  if (!r) return {
    campo: "origem",
    pergunta: "Você quer abrir uma empresa, trocar de contador ou resolver a situação de uma empresa parada?"
  };
  const mensal = r.dados?.modalidadeServico !== "AVULSO" ? ["qtdFuncionarios", "notasRecebidasMes"] : [];
  const ordem = r.origem === "ABERTURA" ? ["responsavelNome", "atividadePretendida", "municipioAtendimento", "modalidadeServico", ...mensal, "enderecoPretendido"] : ["cnpj", "responsavelNome", ...(r.origem === "INATIVA" ? ["paradaDesde", "pretendeReativar"] : ["motivoTroca"]), "modalidadeServico", ...mensal];
  const perguntas = {
    responsavelNome: "Como você se chama?", cnpj: "Qual é o CNPJ da empresa?",
    atividadePretendida: "Qual atividade você pretende exercer?", municipioAtendimento: "Em qual cidade e estado pretende atender?",
    modalidadeServico: r.origem === "ABERTURA" ? "Você quer apenas a abertura ou também a contabilidade mensal? Podemos preparar as duas opções para comparar." : "Você procura um serviço pontual ou também acompanhamento contábil mensal? Podemos comparar as opções.",
    qtdFuncionarios: "A empresa terá funcionários? Se sim, quantos, sem contar os sócios?",
    notasRecebidasMes: "Tem uma ideia de quantas notas de compras e serviços a empresa recebe por mês? Tudo bem se ainda não souber.",
    enderecoPretendido: "Já tem um endereço pensado para a empresa? Pode informar o que souber.",
    paradaDesde: "Desde quando a empresa está sem movimentação?", pretendeReativar: "Você pretende voltar a usar a empresa ou quer avaliar o encerramento?",
    motivoTroca: "O que está motivando a troca de contador?",
  };
  for (const campo of ordem) {
    const d = descritorDe(r.origem, campo);
    if (d && (r.dados?.[campo] === undefined || r.dados?.[campo] === "" || r.dados?.[campo] === null)) return {
      campo,
      pergunta: perguntas[campo] || d.rotulo + "?",
      opcoes: d.opcoes
    };
  }
  return {
    campo: null,
    pergunta: "Já temos os dados iniciais. O contador vai conferir o escopo e preparar as opções de proposta."
  };
}
