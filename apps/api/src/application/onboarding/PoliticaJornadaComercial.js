import { OnboardingError } from "./OnboardingService.js";
import { projetarContratacao, resumirContratacao, contratoAptoPagamento, pagamentoDoContrato, contextoContrato } from "../../../../../packages/shared/src/onboarding/contratacaoComercial.js";
import { pendenciasDiagnosticoComercial } from "../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";

const encerrados = ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"];
export function procuracaoManualVigente(ficha, validacao) {
  return Boolean(ficha.cnpj && validacao?.cnpj === ficha.cnpj && validacao?.atorId && validacao?.registradaEm
    && (validacao.cadastroRevisao || 0) === (ficha.dados?.cadastroRevisao || 0));
}
export function montarJornadaComercial({ onboarding: o, jornada: j = {}, atendimento, propostas = [], contratos = [], marcos = [] }, agora = new Date()) {
  const abertura = o.origem === "ABERTURA", pessoaFisica = o.origem === "PESSOA_FISICA";
  const contratacao = projetarContratacao({ onboarding: o, propostas, contratos, marcos });
  const { proposta, contrato, pagamento } = contratacao;
  const aceita = proposta?.status === "ACEITA";
  const contratoAprovado = contratoAptoPagamento(proposta, contrato);
  const cobranca = contratoAprovado ? marcos.find(m => m.tipo === 'COBRANCA_EXTERNA_REGISTRADA' && m.dados?.contratoId === contrato.id && m.dados?.contextoContrato === contextoContrato(proposta, contrato)) || null : null;
  const analises = (j.analises || []).filter(a => a.cnpj === o.cnpj);
  const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA");
  const cadastroConferido = j.publicaConferida && (publica || j.publicaConferencia?.cnpj === o.cnpj);
  const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
  const autorizacao = atendimento?.autorizacao;
  const autorizada = (atendimento?.representanteVerificadoEm || autorizacao?.consultaAutorizadaPor) && autorizacao?.cnpj === o.cnpj && autorizacao.estado === "ATIVA" && new Date(autorizacao.prova?.validUntil) > agora;
  const manualFicha = o.dados?.procuracaoManual;
  const manual = procuracaoManualVigente(o, manualFicha) || autorizacao?.cnpj === o.cnpj && procuracaoManualVigente(o, autorizacao?.validacaoManual);
  const dispensa = Boolean(j.fiscalAlternativa || j.diagnostico?.dados?.dispensaConsultaPrivada);
  const diagnosticoPendencias = pendenciasDiagnosticoComercial(j.diagnostico?.dados, o.origem);
  const diagnosticoConferido = Boolean(j.diagnostico && !diagnosticoPendencias.length);
  const passos = [];
  const add = (id, titulo, concluido, instrucao, pendencias = []) => passos.push({ id, titulo, concluido: Boolean(concluido), instrucao, pendencias });
  if (pessoaFisica) add("cadastro", "Pessoa e serviço", !j.dadosPendentes?.length, "Confira o contato e o serviço solicitado.", j.dadosPendentes || []);
  else if (abertura) add("cadastro", "Entender a abertura", !j.dadosPendentes?.length, "Confira os dados iniciais da abertura.", j.dadosPendentes || []);
  else {
    add("publica", "Conferir o CNPJ", cadastroConferido, "Consulte os dados ou registre a conferência manual com fonte e evidência.", cadastroConferido ? [] : ["Dados cadastrais conferidos por consulta ou manualmente"]);
    add("autorizacao", "Obter autorização", manual || dispensa || autorizada || fiscal && atendimento?.representanteVerificadoEm && autorizacao?.cnpj === o.cnpj, "Consulte a procuração ou registre a validação manual, sem comprovar poderes oficiais.", manual || autorizada || dispensa ? [] : ["Procuração consultada ou validada manualmente"]);
    add("fiscal", "Consultar situação fiscal", dispensa || fiscal, dispensa ? "O contador registrou um escopo limitado, sem consulta privada." : "Consulte o relatório; confira os resultados no diagnóstico.", fiscal || dispensa ? [] : ["Relatório fiscal disponível"]);
  }
  add("diagnostico", pessoaFisica ? "Definir o serviço pessoal" : abertura ? "Conferir viabilidade e escopo" : "Definir serviços necessários", diagnosticoConferido, pessoaFisica ? "Descreva o serviço solicitado, o escopo e as condições que precisam ser confirmadas." : "Confira o roteiro e registre a devolutiva em três blocos, mantendo visíveis as pendências.", diagnosticoPendencias);
  add("devolutiva", "Conferir apresentação", j.devolutiva?.concluida, "Confira o PDF para preparar a proposta. O envio ao cliente é opcional.", j.devolutiva?.concluida ? [] : ["Conferência do PDF pelo contador"]);
  add("proposta", "Valores e aceite da proposta", aceita, "Revise a proposta e envie para aceite.", aceita ? [] : ["Aceite da versão e opção corretas"]);
  add("contrato", "Contrato", contratoAprovado, "Confira o contrato da proposta aceita. A assinatura permanece registrável.", contratoAprovado ? [] : ["Contrato aprovado"]);
  add("pagamento", "Conferir pagamento", pagamento, "Registre o pagamento do contrato correspondente.", pagamento ? [] : ["Pagamento do contrato conferido"]);
  const inicio = aceita ? passos.findIndex(p => p.id === "contrato") : 0;
  const indiceAtual = passos.findIndex((p, i) => i >= inicio && !p.concluido);
  passos.forEach((p, i) => { p.anterior = Boolean(aceita && i < inicio && !p.concluido); p.acessivel = indiceAtual < 0 || i <= indiceAtual; });
  const encerrado = encerrados.includes(o.status);
  const finalPermitida = !encerrado && Boolean(diagnosticoConferido && j.devolutiva?.concluida && ((abertura || pessoaFisica) ? !j.dadosPendentes?.length : cadastroConferido && (dispensa || fiscal && j.fiscalConferido)));
  return { contratacao: resumirContratacao(contratacao), passos, atual: indiceAtual < 0 ? "conclusao" : passos[indiceAtual].id, indiceAtual, abertura, pessoaFisica, nome: { PESSOA_FISICA: "Pessoa física", ABERTURA: "Abertura", TRANSFERENCIA: "Transferência", INATIVA: "Empresa parada" }[o.origem],
    proposta, contrato, pagamento, cobranca, publica, fiscal, encerrado, versao: o.versao, pendencias: indiceAtual < 0 ? [] : passos[indiceAtual].pendencias,
    comandosPermitidos: { diagnosticoLimitado: !encerrado && !abertura && !pessoaFisica && Boolean(cadastroConferido), gerarRascunho: !encerrado, aprovarProposta: finalPermitida && !aceita, enviarProposta: finalPermitida && !aceita, conferirPagamento: !encerrado && contratoAprovado, concluirAvulso: !encerrado && Boolean(pagamento && contrato?.dados?.opcao?.recorrente === false) } };
}

export async function exigirPropostaDefinitiva({ db, ficha, user }) {
  const { criarJornadaLead } = await import("./JornadaLeadService.js");
  const jornada = await criarJornadaLead({ db }).carregar(ficha.id, user);
  const politica = montarJornadaComercial({ onboarding: ficha, jornada });
  if (!politica.comandosPermitidos.aprovarProposta) throw new OnboardingError("jornada_pendente", "Confira o diagnóstico atual e a apresentação dos serviços antes de aprovar ou enviar a proposta definitiva.", 409);
  return jornada;
}

export async function exigirContratoAvulsoConcluivel(db, onboardingId) {
  const contrato = await db.contratoComercial.findFirst({ where: { onboardingId, status: { in: ['AGUARDANDO_ASSINATURA', 'ASSINADO_CONFERIDO'] }, proposta: { status: "ACEITA", revogadaEm: null } }, include: { proposta: true } });
  if (!contratoAptoPagamento(contrato?.proposta, contrato) || contrato.dados?.opcao?.recorrente !== false) throw new OnboardingError("modalidade_invalida", "Confira o contrato avulso aprovado da proposta aceita.", 409);
  const pagamento = await db.onboardingEvento.findFirst({ where: { onboardingId, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { path: ["contratoId"], equals: contrato.id } } });
  if (!pagamentoDoContrato(contrato.proposta, contrato, pagamento ? [pagamento] : [])) throw new OnboardingError("pagamento_pendente", "Confira o pagamento deste contrato antes de concluir o serviço.", 409);
  return contrato;
}
