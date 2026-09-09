// Demonstração local, sem consultas fiscais, mensagens externas ou assinatura real.
export function criarMockComercial({
  onboardings,
  persistir
}) {
  const recursos = [],
    atendimentos = new Map(),
    propostas = new Map(),
    contratos = new Map(),
    links = new Map(),
    docs = new Map();
  const uid = () => crypto.randomUUID(),
    agora = () => new Date().toISOString();
  const ficha = id => {
    const o = onboardings.get(id);
    if (!o) throw Error("Ficha não encontrada.");
    return o;
  };
  const snapshot = o => ({
    moeda: "BRL",
    destinatario: o.responsavelNome || "Interessado de demonstração",
    condicoes: "DEMONSTRAÇÃO: valores e condições fictícios. Nenhum serviço é contratado neste ambiente.",
    pendencias: [],
    opcoes: o.dados?.modalidadeServico === "AVULSO" ? [{
      chave: "AVULSO",
      titulo: "Somente abertura (demonstração)",
      unicoCentavos: 100000,
      mensalCentavos: 0,
      recorrente: false,
      escopo: "Serviço avulso demonstrativo"
    }] : [{
      chave: "AVULSO",
      titulo: "Somente abertura (demonstração)",
      unicoCentavos: 100000,
      mensalCentavos: 0,
      recorrente: false,
      escopo: "Serviço avulso demonstrativo"
    }, {
      chave: "RECORRENTE",
      titulo: "Abertura e contabilidade (demonstração)",
      unicoCentavos: 100000,
      mensalCentavos: 50000,
      recorrente: true,
      escopo: "Contabilidade mensal demonstrativa"
    }]
  });
  return {
    async comercial(path, body) {
      if (path === "/recursos/iniciar") {
        if (!recursos.length) recursos.push({
          id: uid(),
          tipo: "ORIENTACAO",
          chave: "cnpj",
          titulo: "Pedir CNPJ",
          texto: "Qual é o CNPJ da empresa? Vamos conferir os dados públicos antes da análise.",
          dados: {},
          versao: 1,
          aprovadoEm: null
        }, {
          id: uid(),
          tipo: "CONTRATO",
          chave: "modelo-demo",
          titulo: "Modelo de demonstração",
          texto: "CONTRATO FICTÍCIO — {{nome}} — {{servico}} — {{honorarios}}",
          dados: {
            recorrente: false,
            permitePreCnpj: true
          },
          versao: 1,
          aprovadoEm: null
        });
        return {
          ok: true,
          recursos: [...recursos]
        };
      }
      if (path === "/recursos") {
        if (body) {
          const recurso = {
            ...body,
            id: uid(),
            versao: Math.max(0, ...recursos.filter(r => r.chave === body.chave).map(r => r.versao)) + 1,
            aprovadoEm: null
          };
          recursos.push(recurso);
          return {
            ok: true,
            recurso
          };
        }
        return {
          ok: true,
          recursos: [...recursos]
        };
      }
      let m = /^\/recursos\/([^/]+)\/(aprovar|previa)$/.exec(path);
      if (m) {
        const r = recursos.find(r => r.id === m[1]);
        if (!r) throw Error("Texto não encontrado.");
        if (m[2] === "aprovar") r.aprovadoEm = agora();
        return {
          ok: true,
          recurso: r,
          previa: {
            texto: r.texto
          }
        };
      }
      m = /^\/conversas\/([^/]+)(\/iniciar)?$/.exec(path);
      if (m) {
        let a = atendimentos.get(m[1]);
        if (body && !a) {
          a = {
            id: uid(),
            conversaId: m[1],
            onboardingId: null,
            autorizacao: {}
          };
          atendimentos.set(m[1], a);
        }
        if (body?.onboardingId) {
          ficha(body.onboardingId);
          if (a.onboardingId && a.onboardingId !== body.onboardingId) throw Error("Conversa já vinculada.");
          a.onboardingId = body.onboardingId;
        }
        if (body?.origem && !a.onboardingId) {
          const o = {
            id: uid(),
            origem: body.origem,
            dados: {},
            fontesDados: {},
            versao: 0,
            status: "RASCUNHO",
            origemPreenchimento: "ESCRITORIO",
            createdAt: agora(),
            updatedAt: agora(),
            etapas: []
          };
          onboardings.set(o.id, o);
          a.onboardingId = o.id;
          persistir();
        }
        return {
          ok: true,
          atendimento: a ? {
            ...a,
            onboarding: a.onboardingId ? ficha(a.onboardingId) : null
          } : null
        };
      }
      m = /^\/onboardings\/([^/]+)(.*)$/.exec(path);
      if (!m) throw Error("Ação indisponível na demonstração.");
      const o = ficha(m[1]),
        suffix = m[2],
        a = [...atendimentos.values()].find(a => a.onboardingId === o.id);
      if (!suffix) return {
        ok: true,
        onboarding: {
          ...o
        },
        atendimento: a || null,
        propostas: [...propostas.values()].filter(p => p.onboardingId === o.id),
        contratos: [...contratos.values()].filter(c => c.onboardingId === o.id),
        documentos: [...docs.values()].filter(d => d.onboardingId === o.id).map(({
          file,
          ...d
        }) => d),
        trabalhos: [],
        marcos: o.marcosComerciais || []
      };
      if (suffix === "/marcos") {
        o.marcosComerciais = [...(o.marcosComerciais || []), {
          id: uid(),
          tipo: body.tipo,
          createdAt: agora(),
          dados: {
            evidencia: body.evidencia
          }
        }];
        persistir();
        return {
          ok: true
        };
      }
      if (suffix === "/campos") {
        if (body.versao !== (o.versao || 0)) throw Error("Ficha alterada. Atualize antes de salvar.");
        for (const op of body.operacoes) {
          if (op.acao === "unset") delete o.dados[op.campo];else o.dados[op.campo] = op.valor;
        }
        o.versao = (o.versao || 0) + 1;
        Object.assign(o, {
          responsavelNome: o.dados.responsavelNome,
          cnpj: o.dados.cnpj
        });
        persistir();
        return {
          ok: true,
          onboarding: o
        };
      }
      if (suffix === "/propostas") {
        const p = {
          id: uid(),
          onboardingId: o.id,
          versao: [...propostas.values()].filter(p => p.onboardingId === o.id).length + 1,
          status: "RASCUNHO",
          expiraEm: new Date(Date.now() + 604800000).toISOString(),
          snapshot: snapshot(o)
        };
        propostas.set(p.id, p);
        return {
          ok: true,
          proposta: p
        };
      }
      const pm = /^\/propostas\/([^/]+)\/(aprovar|link|enviar|contrato)$/.exec(suffix);
      if (pm) {
        const p = propostas.get(pm[1]);
        if (!p || p.onboardingId !== o.id) throw Error("Proposta não encontrada.");
        if (pm[2] === "aprovar") p.status = "APROVADA";
        if (pm[2] === "link") {
          const token = uid();
          links.set(token, p.id);
          return {
            ok: true,
            token
          };
        }
        if (pm[2] === "enviar") throw Error("Demonstração: nenhuma mensagem será enviada. Use o link para conferir o fluxo nesta sessão.");
        if (pm[2] === "contrato") {
          if (p.status !== "ACEITA") throw Error("Aceite a proposta demonstrativa primeiro.");
          const c = {
            id: uid(),
            onboardingId: o.id,
            propostaId: p.id,
            status: "MINUTA",
            texto: "CONTRATO FICTÍCIO — apenas demonstração",
            dados: {
              opcao: p.snapshot.opcoes.find(x => x.chave === p.opcaoAceita)
            }
          };
          contratos.set(c.id, c);
          return {
            ok: true,
            contrato: c
          };
        }
        return {
          ok: true,
          proposta: p
        };
      }
      const cm = /^\/contratos\/([^/]+)\/(aprovar|assinatura)$/.exec(suffix);
      if (cm) {
        const c = contratos.get(cm[1]);
        if (!c) throw Error("Contrato não encontrado.");
        if (cm[2] === "assinatura" && !docs.has(body.documentoId)) throw Error("Selecione o documento demonstrativo.");
        c.status = cm[2] === "aprovar" ? "AGUARDANDO_ASSINATURA" : "ASSINADO_CONFERIDO";
        return {
          ok: true
        };
      }
      if (suffix === "/concluir-avulso") {
        if (![...contratos.values()].some(c => c.onboardingId === o.id && c.status === "ASSINADO_CONFERIDO" && !c.dados.opcao?.recorrente)) throw Error("Confira o contrato avulso primeiro.");
        o.status = "CONCLUIDO_AVULSO";
        persistir();
        return {
          ok: true
        };
      }
      if (suffix === "/representante") {
        if (a) a.representanteVerificadoEm = agora();
        return {
          ok: true
        };
      }
      if (suffix === "/consultas") throw Error("Demonstração: consultas fiscais reais estão desabilitadas.");
      if (suffix === "/marcos") return {
        ok: true
      };
      throw Error("Ação indisponível na demonstração.");
    },
    async propostaPublica(token, aceite) {
      const p = propostas.get(links.get(token));
      if (!p) throw Error("Link demonstrativo válido apenas nesta sessão.");
      if (aceite) {
        if (!aceite.confirmado || aceite.versao !== p.versao || !p.snapshot.opcoes.some(o => o.chave === aceite.opcao)) throw Error("Confira a opção.");
        p.status = "ACEITA";
        p.opcaoAceita = aceite.opcao;
      }
      return {
        proposta: {
          ...p.snapshot,
          versao: p.versao,
          status: p.status,
          expiraEm: p.expiraEm,
          opcaoAceita: p.opcaoAceita
        }
      };
    },
    async enviarOrientacaoWhatsapp() {
      throw Error("Demonstração: nenhuma mensagem externa será enviada.");
    },
    async documentoComercial(id, file) {
      ficha(id);
      const d = {
        id: uid(),
        onboardingId: id,
        nome: file.name,
        file
      };
      docs.set(d.id, d);
      return {
        documento: {
          id: d.id,
          nome: d.nome
        }
      };
    },
    async baixarDocumentoComercial(_id, doc) {
      const d = docs.get(doc);
      if (!d) throw Error("Documento ausente.");
      return d.file;
    },
    async baixarContratoComercial() {
      throw Error("Geração de PDF disponível no ambiente real. Este contrato é apenas demonstrativo.");
    }
  };
}
