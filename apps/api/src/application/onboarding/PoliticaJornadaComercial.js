import { OnboardingError } from "./OnboardingService.js";
import { pendenciasDiagnosticoComercial } from "../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";

const encerrados = ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"];
export function montarJornadaComercial({ onboarding: o, jornada: j = {}, atendimento, propostas = [], contratos = [], marcos = [] }, agora = new Date()) {
  const abertura = o.origem === "ABERTURA";
  const proposta = propostas.find(p => p.status === "ACEITA" && !p.revogadaEm) || propostas.find(p => !p.revogadaEm);
  const contrato = contratos.find(c => c.propostaId === proposta?.id);
  const aceita = proposta?.status === "ACEITA";
  const assinado = aceita && contrato?.status === "ASSINADO_CONFERIDO";
  const pagamento = assinado && marcos.find(e => e.tipo === "PAGAMENTO_HONORARIOS_CONFERIDO" && e.dados?.contratoId === contrato.id);
  const analises = (j.analises || []).filter(a => a.cnpj === o.cnpj);
  const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA");
  const cadastroConferido = j.publicaConferida && (publica || j.publicaConferencia?.modo === "MANUAL" && j.publicaConferencia?.cnpj === o.cnpj);
  const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
  const autorizacao = atendimento?.autorizacao;
  const autorizada = atendimento?.representanteVerificadoEm && autorizacao?.cnpj === o.cnpj && autorizacao.estado === "ATIVA" && new Date(autorizacao.prova?.validUntil) > agora;
  const dispensa = Boolean(j.diagnostico?.dados?.dispensaConsultaPrivada);
  const diagnosticoPendencias = pendenciasDiagnosticoComercial(j.diagnostico?.dados, o.origem);
  const diagnosticoConferido = Boolean(j.diagnostico && !diagnosticoPendencias.length);
  const passos = [];
  const add = (id, titulo, concluido, instrucao, pendencias = []) => passos.push({ id, titulo, concluido: Boolean(concluido), instrucao, pendencias });
  if (abertura) add("cadastro", "Entender a abertura", !j.dadosPendentes?.length, "Confira os dados iniciais da abertura.", j.dadosPendentes || []);
  else {
    add("publica", "Conferir o CNPJ", cadastroConferido, "Consulte os dados ou registre a conferência manual com fonte e evidência.", cadastroConferido ? [] : ["Dados cadastrais conferidos por consulta ou manualmente"]);
    add("autorizacao", "Obter autorização", dispensa || autorizada || fiscal && atendimento?.representanteVerificadoEm && autorizacao?.cnpj === o.cnpj, "Confira o representante e verifique a procuração aplicável.", autorizada || dispensa ? [] : ["Procuração vigente e representante conferido"]);
    add("fiscal", "Consultar situação fiscal", dispensa || fiscal && j.fiscalConferido, dispensa ? "O contador registrou um escopo limitado, sem consulta privada." : "Solicite e confira o PDF e a tabela fiscal.", j.fiscalConferido || dispensa ? [] : ["Relatório fiscal conferido"]);
  }
  add("diagnostico", abertura ? "Conferir viabilidade e escopo" : "Definir serviços necessários", diagnosticoConferido, "Confira o roteiro e registre a devolutiva em três blocos, mantendo visíveis as pendências.", diagnosticoPendencias);
  add("devolutiva", "Apresentar os serviços", j.devolutiva?.concluida, "Confira e apresente os serviços ao interessado.", j.devolutiva?.concluida ? [] : ["Devolutiva enviada ou apresentada com evidência"]);
  add("proposta", "Valores e aceite da proposta", aceita, "Revise a proposta e envie para aceite.", aceita ? [] : ["Aceite da versão e opção corretas"]);
  add("contrato", "Contrato e assinatura", assinado, "Anexe e confira o contrato assinado.", assinado ? [] : ["Assinatura conferida"]);
  add("pagamento", "Conferir pagamento", pagamento, "Registre o pagamento do contrato correspondente.", pagamento ? [] : ["Pagamento do contrato conferido"]);
  const inicio = aceita ? passos.findIndex(p => p.id === "contrato") : 0;
  const indiceAtual = passos.findIndex((p, i) => i >= inicio && !p.concluido);
  passos.forEach((p, i) => { p.anterior = Boolean(aceita && i < inicio && !p.concluido); p.acessivel = indiceAtual < 0 || i <= indiceAtual; });
  const encerrado = encerrados.includes(o.status);
  const finalPermitida = !encerrado && Boolean(diagnosticoConferido && j.devolutiva?.concluida && (abertura ? !j.dadosPendentes?.length : cadastroConferido && (dispensa || fiscal && j.fiscalConferido)));
  return { passos, atual: indiceAtual < 0 ? "conclusao" : passos[indiceAtual].id, indiceAtual, abertura, nome: { ABERTURA: "Abertura", TRANSFERENCIA: "Transferência", INATIVA: "Empresa parada" }[o.origem],
    proposta, contrato, pagamento, publica, fiscal, encerrado, versao: o.versao, pendencias: indiceAtual < 0 ? [] : passos[indiceAtual].pendencias,
    comandosPermitidos: { diagnosticoLimitado: !encerrado && !abertura && Boolean(cadastroConferido), gerarRascunho: !encerrado, aprovarProposta: finalPermitida && !aceita, enviarProposta: finalPermitida && !aceita, conferirPagamento: !encerrado && Boolean(assinado), concluirAvulso: !encerrado && Boolean(pagamento && contrato?.dados?.opcao?.recorrente === false) } };
}

export async function exigirPropostaDefinitiva({ db, ficha, user }) {
  const { criarJornadaLead } = await import("./JornadaLeadService.js");
  const jornada = await criarJornadaLead({ db }).carregar(ficha.id, user);
  const politica = montarJornadaComercial({ onboarding: ficha, jornada });
  if (!politica.comandosPermitidos.aprovarProposta) throw new OnboardingError("jornada_pendente", "Confira o diagnóstico atual e a apresentação dos serviços antes de aprovar ou enviar a proposta definitiva.", 409);
  return jornada;
}

export async function exigirContratoAvulsoConcluivel(db, onboardingId) {
  const contrato = await db.contratoComercial.findFirst({ where: { onboardingId, status: "ASSINADO_CONFERIDO", proposta: { status: "ACEITA", revogadaEm: null } }, include: { proposta: true } });
  if (!contrato || contrato.dados?.opcao?.recorrente !== false || contrato.proposta?.opcaoAceita !== contrato.dados?.opcao?.chave) throw new OnboardingError("modalidade_invalida", "Confira o contrato avulso assinado da proposta aceita.", 409);
  const pagamento = await db.onboardingEvento.findFirst({ where: { onboardingId, tipo: "PAGAMENTO_HONORARIOS_CONFERIDO", dados: { path: ["contratoId"], equals: contrato.id } } });
  if (!pagamento) throw new OnboardingError("pagamento_pendente", "Confira o pagamento deste contrato antes de concluir o serviço.", 409);
  return contrato;
}
