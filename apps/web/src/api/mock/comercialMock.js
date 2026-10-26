import { formatarEnderecoAbertura } from '@contabilidade/shared/onboarding';
import { montarJornada } from '../../features/onboarding/lib/jornadaComercial';
import { contratoAptoPagamento, contextoContrato, pagamentoDoContrato, urlCobrancaSegura } from '../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
// Demonstração local, sem consultas fiscais, mensagens externas ou assinatura real.
import { normalizarDiagnosticoComercial, textoDaDevolutiva } from "../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";
export function criarMockComercial({
  onboardings,
  persistir,
  estadoContratacao = {},
  prepararConversa = null,
  atendimentosIniciais = []
}) {
  const recursos = [],
    atendimentos = new Map(atendimentosIniciais.map(a => [a.conversaId, JSON.parse(JSON.stringify(a))])),
    historicoAtendimentos = [],
    propostas = estadoContratacao.propostas ||= new Map(),
    contratos = estadoContratacao.contratos ||= new Map(),
    links = estadoContratacao.links ||= new Map(),
    docs = estadoContratacao.docs ||= new Map(),
    fichasAvulsas = estadoContratacao.fichasAvulsas ||= new Map();
  const uid = () => crypto.randomUUID(),
    agora = () => new Date().toISOString();
  const ficha = id => {
    const o = onboardings.get(id);
    if (!o) throw Error("Ficha não encontrada.");
    // Fichas criadas pelo formulário antigo da demonstração não tinham versão.
    if (!Number.isInteger(o.versao)) o.versao = 0;
    return o;
  };
  // As mesmas chaves materiais da jornada real; a demonstração só registra
  // diagnósticos de abertura e nunca possui uma consulta fiscal concluída.
  const perfilDaAnalise = o => Object.fromEntries(Object.entries({ regime: o.dados?.regimeAtual || o.dados?.regimePretendido, qtdFuncionarios: o.dados?.qtdFuncionarios, notasRecebidasMes: o.dados?.notasRecebidasMes, consultoriaMensal: o.dados?.consultoriaMensal, pretendeReativar: o.dados?.pretendeReativar }).filter(([, v]) => v != null && v !== ""));
  const contextoDiagnostico = (o, perfil = o.diagnosticoDemonstracao?.dados?.perfilConferido) => JSON.stringify([
    o.origem, o.cnpj || null, o.fiscalAlternativaMock?.id || null, o.publicaConferenciaMock?.id || null,
    o.dados?.atividadePretendida || null,
    o.dados?.enderecoAbertura?.cidade || o.dados?.municipioAtendimento || o.dados?.municipioPretendido || null,
    formatarEnderecoAbertura(o.dados?.enderecoAbertura) || o.dados?.enderecoPretendido || null,
    ...((o.dados?.socios?.length || o.dados?.titular?.length) ? ['PESSOAS', o.dados?.tipoEmpresa || null, o.dados?.socios || [], o.dados?.titular || []] : []),
    ...(o.origem === "PESSOA_FISICA" ? [o.dados?.servicoSolicitado || null, o.dados?.responsavelCpf || null, o.responsavelNome || o.dados?.responsavelNome || null] : []),
    ...(perfil ? [Object.keys(perfil).sort().map(k => [k, perfilDaAnalise(o)[k] ?? null])] : [])
  ]);
  const diagnosticoAtual = o => o.diagnosticoDemonstracao?.dados?.contexto === contextoDiagnostico(o)
    ? o.diagnosticoDemonstracao : null;
  const snapshot = o => ({
    moeda: "BRL",
    destinatario: o.responsavelNome || "Interessado de demonstração",
    condicoes: "DEMONSTRAÇÃO: valores e condições fictícios. Nenhum serviço é contratado neste ambiente.",
    pendencias: [],
    opcoes: o.origem === "PESSOA_FISICA" || o.dados?.modalidadeServico === "AVULSO" ? [{
      chave: "AVULSO",
      titulo: o.origem === "PESSOA_FISICA" ? "Serviço pessoal (demonstração)" : "Somente abertura (demonstração)",
      unicoCentavos: 100000,
      mensalCentavos: 0,
      recorrente: false,
      escopo: "Serviço avulso demonstrativo"
    }] : [{
      chave: "AVULSO",
      titulo: o.origem === "PESSOA_FISICA" ? "Serviço pessoal (demonstração)" : "Somente abertura (demonstração)",
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
    async baixarApresentacaoComercial() { throw Error("Demonstração: o PDF de apresentação não está disponível. Nenhum documento foi emitido ou enviado."); },
    async baixarTabelaFiscalLead() { throw Error("Demonstração: não há relatório fiscal real para baixar."); },
    async comercial(path, body, method = "POST") {
      if (path === '/canais-comerciais') return { canais: [{ id: 'comercial', chave: 'Comercial · demonstração' }] };
      const acompanhamento = /^\/onboardings\/([^/]+)\/(acompanhamento|contato(?:\/vincular)?|retorno)$/.exec(path);
      if (acompanhamento) {
        const id = decodeURIComponent(acompanhamento[1]), o = onboardings.get(id);
        if (!o) throw new Error('Oportunidade não encontrada.');
        if (acompanhamento[2] === 'acompanhamento') {
          return { retorno: o.retornoComercial || null, conversaId: o.contatoComercialMock ? o.conversaComercialId : null, versao: o.versao || 0 };
        }
        if (['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'].includes(o.status)) throw new Error('Esta oportunidade está encerrada.');
        if (acompanhamento[2] === 'retorno') {
          if (!body?.acao?.trim() || !Number.isFinite(Date.parse(body.quando))) throw new Error('Informe a próxima ação e a data.');
          if (body.versao !== (o.versao || 0)) throw new Error('A ficha mudou. Atualize antes de salvar.');
          o.versao = (o.versao || 0) + 1;
          o.retornoComercial = { dados: { acao: body.acao.trim(), quando: body.quando, responsavelNome: 'Equipe de demonstração' } };
          persistir(); return { retorno: o.retornoComercial, versao: o.versao };
        }
        if (body?.autorizado !== true || String(body.evidencia || '').trim().length < 5 || String(body.evidencia || '').trim().length > 500 || String(body.nome || '').trim().length < 2 || String(body.nome || '').trim().length > 120 || !/^\d{10,15}$/.test(String(body.telefone).replace(/\D/g, '')) || body.canalId !== 'comercial') throw new Error('Confira o contato, o canal e a autorização.');
        if (!prepararConversa) throw new Error('Preparação de conversa indisponível nesta demonstração.');
        const neutro = acompanhamento[2] === 'contato/vincular';
        const anterior = o.contatoComercialMock;
        const caso = o.conversaComercialId && atendimentos.get(o.conversaComercialId);
        if (caso?.triagem?.contatoRevogado) throw new Error('Este contato pediu para não receber mensagens.');
        if (anterior && (String(anterior.telefone).replace(/\D/g, '') !== String(body.telefone).replace(/\D/g, '') || anterior.canalId !== body.canalId)) throw new Error('Há outro contato vinculado. Confira antes de continuar.');
        const existente = Boolean(anterior && o.conversaComercialId);
        const conversaId = prepararConversa(o, body, { neutro });
        if (existente) return { conversaId, atendimentoId: `caso-${o.id}`, existente: true };
        o.conversaComercialId = conversaId;
        o.contatoComercialMock = { ...body, vinculoNeutro: neutro };
        atendimentos.set(conversaId, { id: `caso-${o.id}`, conversaId, onboardingId: o.id, triagem: { contatoAutorizado: body } });
        persistir(); return { conversaId, atendimentoId: `caso-${o.id}`, existente: false };
      }
      const excluir = /^\/recursos\/([^/]+)$/.exec(path);
      if (method === "DELETE" && excluir) {
        const indice = recursos.findIndex(r => r.id === decodeURIComponent(excluir[1]) && r.versao === body?.versao && !r.aprovadoEm);
        if (indice < 0) throw Error("Este rascunho mudou, já foi excluído ou foi aprovado. Atualize a biblioteca.");
        recursos.splice(indice, 1);
        return { ok: true, excluido: true };
      }
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
        if (body?.reiniciarAtendimentoId) {
          if (a?.id !== body.reiniciarAtendimentoId) throw Error("O atendimento mudou. Recarregue.");
          historicoAtendimentos.push({ ...a, encerradoEm: agora(), onboarding: a.onboardingId ? ficha(a.onboardingId) : null });
          a = null;
        }
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
          anteriores: historicoAtendimentos.filter(x => x.conversaId === m[1]),
          configuracao: { consultasFiscais: false },
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
      if (suffix === '/cadastro/consulta') throw Error('Demonstração offline: nenhuma consulta CNPJ foi realizada. Preencha o cadastro manualmente.');
      if (suffix === '/cadastro') {
        if (body?.versao !== o.versao || !/^\d{14}$/.test(body?.cnpj || '')) throw Error('Confira CNPJ e versão da ficha.');
        const empresa = body.origem === 'CONSULTA' ? o.dados?.cadastroCnpj?.empresa : body.empresa;
        if (!empresa || ['razaoSocial', 'naturezaJuridica', 'porte', 'cnaePrincipal'].some(k => !String(empresa[k] || '').trim())) throw Error('Complete razão social, natureza jurídica, porte e CNAE.');
        const endereco = typeof empresa.endereco === 'object' ? empresa.endereco : { logradouro: empresa.endereco, municipio: empresa.municipio, uf: empresa.uf };
        if (['logradouro', 'municipio', 'uf'].some(k => !String(endereco?.[k] || '').trim())) throw Error('Complete o endereço, município e UF.');
        o.cnpj = body.cnpj; o.dados = { ...o.dados, cnpj: body.cnpj, razaoSocial: empresa.razaoSocial, nomeFantasia: empresa.nomeFantasia || '', cadastroCnpj: { cnpj: body.cnpj, empresa: JSON.parse(JSON.stringify(empresa)), origem: 'MANUAL', consultaRealizada: false } };
        o.publicaConferenciaMock = { id: uid(), dados: { cnpj: o.cnpj, fonte: 'Cadastro manual de demonstração', evidencia: 'Cadastro fictício conferido localmente; nenhuma consulta realizada.' } };
        o.versao++; persistir(); return { ok: true, versao: o.versao, dados: o.dados, cadastroCnpj: o.dados.cadastroCnpj };
      }
      if (suffix === '/documentos-chat') return { arquivos: [], temMais: false, versao: o.versao };
      if (suffix === '/apresentacao') {
        const diagnostico = diagnosticoAtual(o);
        if (!diagnostico) throw Error('Diagnóstico alterado. Confira os dados atuais.');
        return { diagnosticoId: diagnostico.id, conteudoHash: `demo:${diagnostico.id}:${o.versao}`, envio: { estado: 'NAO_ENVIADO' }, demonstracao: true, pdfDisponivel: false };
      }
      if (/^\/apresentacao\/[^/]+\/enviar$/.test(suffix) || /^\/contratos\/[^/]+\/enviar$/.test(suffix)) throw Error('Demonstração: nenhum documento será enviado a clientes.');
      if (/^\/apresentacao\/[^/]+\/conferir$/.test(suffix)) throw Error('PDF indisponível na demonstração. Não é possível confirmar a conferência sem o documento.');
      if (/^\/contratos\/[^/]+\/envio$/.test(suffix)) {
        const contrato = contratos.get(suffix.split('/')[2]);
        if (!contrato || contrato.onboardingId !== o.id) throw Error('Contrato indisponível nesta ficha.');
        return { contratoId: contrato.id, conteudoHash: `demo:${contrato.id}:${contrato.aprovadoEm}`, envio: { estado: 'NAO_ENVIADO' } };
      }
      if (suffix === '/jornada/cobranca-envio') {
        if (body.modo !== 'EXTERNO') throw Error('Demonstração: nenhuma cobrança será enviada a clientes.');
        const cobranca = o.marcosComerciais?.find(m => m.id === body.cobrancaId && m.tipo === 'COBRANCA_EXTERNA_REGISTRADA');
        if (body.versao !== o.versao || !cobranca || cobranca.dados.contratoId !== body.contratoId || !['WHATSAPP','EMAIL','OUTRO'].includes(body.canal)) throw Error('Confira a cobrança e a versão da ficha.');
        o.marcosComerciais.push({ id: uid(), tipo: 'COBRANCA_ENVIO_EXTERNO_INFORMADO', atorId: 'contador-demonstracao', createdAt: agora(), dados: { ...body, demonstracao: true, entregaComprovada: false } });
        o.versao++; persistir(); return { ok: true, demonstracao: true };
      }
      if (suffix === "/fiscal") return { relatorios: [], consumo: { gpt: { disponivel: false }, serpro: { concluidas: 0, pendentes: 0, erros: 0, custoConfirmado: null } }, bloqueio: { mensagem: "Demonstração: nenhuma consulta fiscal real foi realizada." } };
      if (suffix.startsWith("/fiscal/")) throw Error("Demonstração: não há relatório fiscal real para revisar ou enviar.");
      if (!suffix) { const estado = {
        ok: true,
        onboarding: {
          ...o
        },
        configuracao: { consultasFiscais: false },
        atendimento: a ? {
          ...a,
          triagem: {
            ...a.triagem,
            ...([...(o.eventos || [])].reverse().find(e => e.tipo === "ATENDIMENTO_RETOMADO") ? {
              retomadaManual: { bloqueiaAutomacao: true, em: [...o.eventos].reverse().find(e => e.tipo === "ATENDIMENTO_RETOMADO").createdAt },
            } : {}),
          },
        } : o.procuracaoManualMock ? { autorizacao: { cnpj: o.cnpj, estado: 'NAO_VERIFICADA', validacaoManual: o.procuracaoManualMock } } : null,
        jornada: { cobranca: [...(o.marcosComerciais || [])].reverse().find(m => m.tipo === 'COBRANCA_EXTERNA_REGISTRADA') || null, analises: [], diagnostico: diagnosticoAtual(o),
          diagnosticoDesatualizado: Boolean(o.diagnosticoDemonstracao && !diagnosticoAtual(o)),
          diagnosticoAnterior: !diagnosticoAtual(o) ? o.diagnosticoDemonstracao?.dados || null : null,
          diagnosticoAnteriorId: !diagnosticoAtual(o) ? o.diagnosticoDemonstracao?.id || null : null,
          publicaConferida: o.publicaConferenciaMock?.dados?.cnpj === o.cnpj, publicaConferencia: o.publicaConferenciaMock ? { ...o.publicaConferenciaMock.dados, modo: 'MANUAL', id: o.publicaConferenciaMock.id } : null, fiscalConferido: false,
          fiscalAlternativa: o.fiscalAlternativaMock?.dados?.cnpj === o.cnpj ? o.fiscalAlternativaMock : null,
          devolutiva: { partes: [], concluida: Boolean(diagnosticoAtual(o) && o.apresentacaoDemonstracao?.diagnosticoId === diagnosticoAtual(o).id), incerta: false } },
        propostas: [...propostas.values()].filter(p => p.onboardingId === o.id).reverse(),
        contratos: [...contratos.values()].filter(c => c.onboardingId === o.id),
        documentos: [...docs.values()].filter(d => d.onboardingId === o.id).map(documento => { const dados = { ...documento }; delete dados.file; return dados; }),
        trabalhos: [],
        marcos: o.marcosComerciais || []
      }; estado.jornada.projecao = montarJornada(estado); return estado; }
      if (suffix === "/ficha-avulsa") return { ok: true, fichaAvulsa: fichasAvulsas.get(o.id) || null };
      if (['/jornada/fiscal-alternativa', '/procuracao/manual', '/jornada/cobranca-externa', '/jornada/pagamento'].includes(suffix)
        && ['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'].includes(o.status)) throw Error('Atendimento encerrado.');
      if (suffix === '/procuracao/manual') {
        if (!/^\d{14}$/.test(o.cnpj || '') || body.confirmada !== true || !Number.isInteger(body.versao)) throw Error('Confira CNPJ, atendimento e confirmação.');
        const anterior = a ? a.autorizacao?.cnpj === o.cnpj && a.autorizacao?.validacaoManual : o.procuracaoManualMock;
        if (anterior?.fichaVersao === body.versao && o.versao === body.versao + 1) return { validacao: anterior };
        if (body.versao !== o.versao) throw Error('Ficha alterada.');
        const validacao = { origem: 'MANUAL', atorId: 'contador-demonstracao', registradaEm: agora(), fichaVersao: body.versao, cnpj: o.cnpj, provaOficial: false, limitacao: 'Validação manual demonstrativa, sem prova oficial.' };
        if (a) a.autorizacao = { ...(a.autorizacao?.cnpj === o.cnpj ? a.autorizacao : { cnpj: o.cnpj, estado: 'NAO_VERIFICADA' }), validacaoManual: validacao };
        else o.procuracaoManualMock = validacao;
        o.versao++; persistir(); return { validacao };
      }
      if (suffix === '/jornada/fiscal-alternativa') {
        if (!/^\d{14}$/.test(o.cnpj || '') || ['ABERTURA', 'PESSOA_FISICA'].includes(o.origem) || !Number.isInteger(body.versao)
          || !['MANUAL', 'PULADA'].includes(body.modo) || body.modo === 'MANUAL' && (typeof body.informacao !== 'string' || !body.informacao.trim() || body.informacao.length > 4000)) throw Error('Confira os dados fiscais.');
        const dados = { cnpj: o.cnpj, origemFicha: o.origem, fichaVersao: body.versao, modo: body.modo, origem: 'CONTADOR', consultaOficialValida: false,
          informacao: body.modo === 'MANUAL' ? body.informacao.trim() : null, limitacao: body.modo === 'MANUAL' ? 'Situação fiscal informada manualmente, sem consulta oficial válida. Não comprova regularidade fiscal.' : 'Etapa fiscal pulada, sem consulta oficial válida. Situação e regularidade fiscal não verificadas.' };
        if (JSON.stringify(o.fiscalAlternativaMock?.dados) === JSON.stringify(dados)) return { registro: o.fiscalAlternativaMock };
        if (body.versao !== o.versao) throw Error('Ficha alterada.');
        o.fiscalAlternativaMock = { id: uid(), atorId: 'contador-demonstracao', createdAt: agora(), dados };
        o.versao++; persistir(); return { registro: o.fiscalAlternativaMock };
      }
      if (suffix === '/jornada/cobranca-externa') {
        const c = contratos.get(body.contratoId), p = propostas.get(c?.propostaId);
        const url = body.url == null ? null : urlCobrancaSegura(body.url);
        if (!Number.isInteger(body.versao) || !contratoAptoPagamento(p, c) || c.onboardingId !== o.id || p.versao !== body.propostaVersao
          || !Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0 || typeof body.referencia !== 'string' || body.referencia.trim().length < 3 || body.referencia.length > 2000
          || body.url != null && !url || !url && !body.documentoId || body.documentoId != null && docs.get(body.documentoId)?.onboardingId !== o.id) throw Error('Confira a cobrança externa e seus vínculos.');
        const dados = { contratoId: c.id, propostaId: p.id, propostaVersao: p.versao, contextoContrato: contextoContrato(p, c), fichaVersao: body.versao,
          valorCentavos: body.valorCentavos, referencia: body.referencia.trim(), url, documentoId: body.documentoId || null, origem: 'EXTERNA', pagamentoConfirmado: false };
        const anterior = o.marcosComerciais?.find(m => m.tipo === 'COBRANCA_EXTERNA_REGISTRADA' && JSON.stringify(m.dados) === JSON.stringify(dados));
        if (anterior) return { cobranca: anterior };
        if (body.versao !== o.versao) throw Error('Ficha alterada.');
        const cobranca = { id: uid(), tipo: 'COBRANCA_EXTERNA_REGISTRADA', atorId: 'contador-demonstracao', createdAt: agora(), dados };
        o.marcosComerciais = [...(o.marcosComerciais || []), cobranca]; o.versao++; persistir(); return { cobranca };
      }
      if (suffix === "/jornada/apresentacao") {
        if (body.versao !== o.versao || !diagnosticoAtual(o) || body.diagnosticoId !== diagnosticoAtual(o).id || body.meio?.trim().length < 3 || body.evidencia?.trim().length < 3) throw Error("Confira a versão, o diagnóstico e a evidência da apresentação.");
        o.apresentacaoDemonstracao = { ...body, id: uid(), createdAt: agora() }; persistir(); return { ok: true, apresentacao: o.apresentacaoDemonstracao };
      }
      if (suffix === "/jornada/diagnostico") {
        if (body.versao !== o.versao) throw Error("Ficha alterada. Atualize antes de salvar.");
        if (!["ABERTURA", "PESSOA_FISICA"].includes(o.origem) && (o.publicaConferenciaMock?.dados?.cnpj !== o.cnpj || o.fiscalAlternativaMock?.dados?.cnpj !== o.cnpj)) throw Error("Confira o cadastro e registre a limitação fiscal demonstrativa.");
        if (typeof body.servicos !== "string" || body.servicos.trim().length < 10) throw Error("Preencha o diagnóstico e o escopo.");
        const estruturado = normalizarDiagnosticoComercial({ ...body, roteiro: { ...body.roteiro, dados: { ...body.roteiro?.dados, funcionariosClt: o.dados?.qtdFuncionarios, documentosEntradaMes: o.dados?.notasRecebidasMes } } }, o.origem);
        if (Object.hasOwn(body, "diagnosticoBaseId") && body.diagnosticoBaseId !== (o.diagnosticoDemonstracao?.id || null)) throw Error("Outro atendente alterou o diagnóstico. Recarregue antes de salvar.");
        const perfilConferido = perfilDaAnalise(o);
        const dados = { ...estruturado, perfilConferido, contexto: contextoDiagnostico(o, perfilConferido), fichaVersao: o.versao, achados: Object.values(estruturado.devolutiva).join("\n\n"), servicos: body.servicos,
          fiscalAlternativa: o.fiscalAlternativaMock || null, dispensaConsultaPrivada: o.fiscalAlternativaMock?.dados?.limitacao || null };
        const texto = textoDaDevolutiva(dados, { pessoaFisica: o.origem === "PESSOA_FISICA" });
        if (texto.length > 3800) throw Error("Resuma a devolutiva para até 3.800 caracteres.");
        o.diagnosticoDemonstracao = { id: uid(), dados: { ...dados, texto: `DEMONSTRAÇÃO — ${texto}` } };
        persistir(); return { diagnostico: o.diagnosticoDemonstracao };
      }
      if (suffix === "/jornada/devolutiva") throw Error("Demonstração: nenhuma mensagem ou PDF será enviado a clientes.");
      if (suffix === '/jornada/conferencia') {
        if (body.tipo !== 'PUBLICA' || !body.manual || body.analiseId != null || body.versao !== o.versao || !/^\d{14}$/.test(o.cnpj || '')
          || typeof body.manual.fonte !== 'string' || body.manual.fonte.trim().length < 3 || body.manual.fonte.length > 300
          || typeof body.manual.evidencia !== 'string' || body.manual.evidencia.trim().length < 10 || body.manual.evidencia.length > 2000) throw Error('Confira os dados cadastrais manuais.');
        o.publicaConferenciaMock = { id: uid(), dados: { ...body.manual, cnpj: o.cnpj, origem: o.origem } };
        o.versao++; persistir(); return { conferencia: o.publicaConferenciaMock };
      }
      if (suffix === "/jornada/pagamento") {
        const c = contratos.get(body.contratoId);
        const p = propostas.get(c?.propostaId);
        if (!contratoAptoPagamento(p, c) || c.onboardingId !== o.id || p.versao !== body.propostaVersao || !c.aprovadoEm || new Date(c.aprovadoEm).toISOString() !== body.contratoRevisao
          || body.confirmado !== true || !Number.isInteger(body.versao) || !Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0 || typeof body.referencia !== 'string' || body.referencia.trim().length < 3 || body.referencia.length > 2000) throw Error('Confira o recebimento e a revisão do contrato.');
        const anterior = o.marcosComerciais?.find(m => m.tipo === 'PAGAMENTO_HONORARIOS_CONFERIDO' && m.dados?.contratoId === c.id);
        if (anterior) {
          if (pagamentoDoContrato(p, c, [anterior]) && (anterior.dados.politica !== 'R35' || anterior.dados.valorCentavos === body.valorCentavos && anterior.dados.referencia === body.referencia.trim())) return { marco: anterior };
          throw Error('Confirmação anterior diferente.');
        }
        if (body.versao !== o.versao) throw Error('Ficha alterada.');
        const marco = { id: uid(), tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO', atorId: 'contador-demonstracao', createdAt: agora(), dados: { contratoId: c.id, propostaId: p.id, propostaVersao: p.versao, fichaVersao: body.versao, contextoContrato: contextoContrato(p, c), politica: 'R35', confirmadoEm: agora(), valorCentavos: body.valorCentavos, referencia: body.referencia.trim(), origem: 'CONFERENCIA_MANUAL' } };
        o.marcosComerciais = [...(o.marcosComerciais || []), marco]; o.versao++; o.faseComercial = 'CONTRATADO';
        persistir(); return { marco };
      }
      if (suffix === "/marcos") {
        if (!['DOCUMENTACAO_CONFERIDA', 'ANALISE_REVISADA'].includes(body.tipo)) throw Error('Use o comando específico.');
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
          if (["responsavelNome", "cnpj"].includes(op.campo)) o[op.campo] = o.dados[op.campo] || null;
        }
        o.versao = (o.versao || 0) + 1;
        persistir();
        return {
          ok: true,
          onboarding: o
        };
      }
      if (suffix === "/propostas") {
        for (const anterior of propostas.values()) if (anterior.onboardingId === o.id) anterior.revogadaEm = agora();
        const p = {
          id: uid(),
          onboardingId: o.id,
          versao: [...propostas.values()].filter(p => p.onboardingId === o.id).length + 1,
          status: "RASCUNHO",
          expiraEm: new Date(Date.now() + 604800000).toISOString(),
          snapshot: snapshot({ ...o, dados: { ...o.dados, ...(body.ajustes?.modalidadeServico ? { modalidadeServico: body.ajustes.modalidadeServico } : {}) } })
        };
        const modalidade = body.ajustes?.modalidadeServico || o.dados?.modalidadeServico;
        if (o.origem !== 'PESSOA_FISICA' && !['AVULSO', 'RECORRENTE', 'COMPARAR'].includes(modalidade)) {
          p.snapshot.opcoes = []; p.snapshot.pendencias.push('A equipe deve definir a modalidade de serviço na proposta.');
        }
        if (['RECORRENTE', 'COMPARAR'].includes(modalidade)) {
          const consultoria = body.ajustes?.consultoriaMensal ?? o.dados?.consultoriaMensal;
          p.snapshot.perfil = { consultoriaMensal: typeof consultoria === 'boolean' ? consultoria : null };
          if (typeof consultoria !== 'boolean') p.snapshot.pendencias.push('Conferir consultoria mensal com o catálogo.');
          if (!(o.dados?.regimeAtual || o.dados?.regimePretendido) || o.dados?.notasRecebidasMes == null) p.snapshot.pendencias.push('Conferir regime e volume de documentos internamente.');
        }
        propostas.set(p.id, p);
        persistir();
        return {
          ok: true,
          proposta: p
        };
      }
      const pm = /^\/propostas\/([^/]+)\/(aprovar|link|enviar|contrato)$/.exec(suffix);
      if (pm) {
        const p = propostas.get(pm[1]);
        if (!p || p.onboardingId !== o.id) throw Error("Proposta não encontrada.");
        if (pm[2] === "aprovar") { if (p.snapshot.pendencias?.length) throw Error('Confira as pendências da proposta.'); p.status = "APROVADA"; persistir(); }
        if (pm[2] === "link") {
          const token = uid();
          links.set(token, p.id);
          persistir();
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
              politicaContratacao: 'R35',
              opcao: p.snapshot.opcoes.find(x => x.chave === p.opcaoAceita)
            }
          };
          contratos.set(c.id, c);
          persistir();
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
        if (!c || c.onboardingId !== o.id) throw Error("Contrato não encontrado.");
        const p = propostas.get(c.propostaId);
        if (p?.status !== 'ACEITA' || p.revogadaEm || p.opcaoAceita !== c.dados?.opcao?.chave) throw Error("Confira o contrato correspondente à opção aceita e vigente.");
        if (c.status !== (cm[2] === 'aprovar' ? 'MINUTA' : 'AGUARDANDO_ASSINATURA')) throw Error("Contrato fora da etapa esperada.");
        if (cm[2] === "assinatura" && docs.get(body.documentoId)?.onboardingId !== o.id) throw Error("Selecione o documento demonstrativo desta ficha.");
        c.status = cm[2] === "aprovar" ? "AGUARDANDO_ASSINATURA" : "ASSINADO_CONFERIDO";
        if (cm[2] === 'aprovar') c.aprovadoEm = agora();
        if (cm[2] === 'assinatura') {
          c.documentoAssinadoId = body.documentoId;
          c.assinaturaConferidaEm = agora();
          c.assinaturaConferidaPor = 'contador-demonstracao';
          o.versao = (o.versao || 0) + 1;
        }
        persistir();
        return {
          ok: true
        };
      }
      if (suffix === "/concluir-avulso") {
        if (![...contratos.values()].some(c => c.onboardingId === o.id && c.dados.opcao?.recorrente === false && pagamentoDoContrato(propostas.get(c.propostaId), c, o.marcosComerciais))) throw Error("Confira o contrato avulso e o pagamento primeiro.");
        if (o.origem === "ABERTURA" && !fichasAvulsas.has(o.id)) throw Error("Salve a ficha e o dossiê do serviço avulso antes de concluir.");
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
        persistir();
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
      persistir();
      return {
        documento: {
          id: d.id,
          nome: d.nome
        }
      };
    },
    async salvarFichaAvulsa(id, body) {
      const o = ficha(id);
      const c = [...contratos.values()].find(c => c.onboardingId === id && c.dados.opcao?.recorrente === false && pagamentoDoContrato(propostas.get(c.propostaId), c, o.marcosComerciais));
      if (!c) throw Error("Confira o contrato avulso e o pagamento.");
      if (o.origem !== "ABERTURA" || body.versao !== o.versao || ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(o.status)) throw Error("Use uma abertura avulsa atualizada ainda em execução.");
      const d = body.dados;
      if (!/^\d{14}$/.test(d?.cnpj || "") || !d.razaoSocial || !d.cnaePrincipal || !["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"].includes(d.regimeTributario) || ["rua", "numero", "bairro", "cidade", "uf", "cep"].some(k => !d.endereco?.[k])) throw Error("Preencha CNPJ, razão social, CNAE, regime e endereço conferidos.");
      const anterior = fichasAvulsas.get(id);
      const f = { id: anterior?.id || uid(), onboardingId: id, cnpj: d.cnpj, dados: d, versao: (anterior?.versao || 0) + 1, documentos: [...docs.values()].filter(x => x.onboardingId === id).map(documento => { const dados = { ...documento }; delete dados.file; return dados; }), modalidade: "AVULSO", contabilidadeAtiva: false, portalHabilitado: false };
      fichasAvulsas.set(id, f); o.versao++; persistir(); return { ok: true, fichaAvulsa: f };
    },
    async baixarDocumentoFichaAvulsa(id, documentoId) {
      const f = fichasAvulsas.get(id), d = docs.get(documentoId);
      if (!f?.documentos.some(x => x.id === documentoId) || !d?.file) throw Error("Documento não encontrado nesta ficha.");
      return d.file;
    },
    async baixarDocumentoComercial(_id, doc) {
      const d = docs.get(doc);
      if (!d?.file) throw Error("Arquivo demonstrativo indisponível após recarga. Anexe novamente para baixar.");
      return d.file;
    },
    async baixarContratoComercial() {
      throw Error("Geração de PDF disponível no ambiente real. Este contrato é apenas demonstrativo.");
    }
  };
}
