import { pendenciasDiagnosticoComercial } from "../../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";
import { projetarContratacao, resumirContratacao, contratoAptoPagamento } from "../../../../../../packages/shared/src/onboarding/contratacaoComercial.js";
const nomes = { PESSOA_FISICA: "Pessoa física", ABERTURA: "Abertura", TRANSFERENCIA: "Transferência", INATIVA: "Empresa parada" };
const existe = v => Boolean(String(v || "").trim());

export const etapaSatisfeita = etapa => Boolean(etapa.concluidaEm || etapa.evidencias?.some(e => e.satisfaz));

export function montarJornada(estado, agora = Date.now()) {
  if (estado.jornada?.projecao) {
    const projecao = estado.jornada.projecao;
    // Completar somente metadados de apresentação de respostas compatíveis.
    // Etapa, acessibilidade e evidências continuam integralmente do servidor.
    return {
      ...projecao,
      nome: projecao.nome || nomes[estado.onboarding?.origem] || 'Atendimento',
      abertura: projecao.abertura ?? estado.onboarding?.origem === 'ABERTURA',
      pessoaFisica: projecao.pessoaFisica ?? estado.onboarding?.origem === 'PESSOA_FISICA',
    };
  }
  // Compatibilidade com respostas anteriores e demonstração; servidor atual é soberano.
  const o = estado.onboarding, d = o.dados || {}, j = estado.jornada || {};
  const abertura = o.origem === "ABERTURA", pessoaFisica = o.origem === "PESSOA_FISICA";
  const analises = (j.analises || []).filter(a => a.cnpj === o.cnpj);
  const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA");
  const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
  const cadastroConferido = Boolean(j.publicaConferida && (publica || j.publicaConferencia?.cnpj === o.cnpj));
  const contratacao = projetarContratacao(estado);
  const { proposta, contrato, pagamento } = contratacao;
  const aceita = proposta?.status === "ACEITA";
  const contratoAprovado = contratoAptoPagamento(proposta, contrato);
  const pendentes = j.dadosPendentes || (pessoaFisica ? [[o.responsavelNome || d.responsavelNome, "Nome"], [d.servicoSolicitado, "Serviço solicitado"]].filter(([v]) => !existe(v)).map(([, n]) => n) : abertura ? [[o.responsavelNome || d.responsavelNome, "Nome do responsável"], [d.atividadePretendida, "Atividade pretendida"], [d.municipioAtendimento || d.municipioPretendido, "Município da sede"], [d.enderecoPretendido, "Endereço para viabilidade"]].filter(([v]) => !existe(v)).map(([,n]) => n) : o.cnpj ? [] : ["CNPJ"]);
  const autorizacao = estado.atendimento?.autorizacao;
  const autorizada = Boolean((estado.atendimento?.representanteVerificadoEm || autorizacao?.consultaAutorizadaPor) && autorizacao?.cnpj === o.cnpj && autorizacao.estado === "ATIVA"
    && new Date(autorizacao.prova?.validUntil).getTime() > agora);
  const passos = [];
  const add = (id, titulo, concluido, instrucao, pendencias = []) => passos.push({ id, titulo, concluido: Boolean(concluido), instrucao, pendencias });
  if (pessoaFisica) add("cadastro", "Pessoa e serviço", !pendentes.length, "Confira o contato e o serviço solicitado.", pendentes);
  else if (abertura) add("cadastro", "Entender a abertura", !pendentes.length, "Registre a atividade e o endereço que serão analisados. Você pode preencher pela conversa ou enviar o formulário ao lead.", pendentes);
  else {
    add("publica", "Consultar o CNPJ", cadastroConferido, "Peça o CNPJ e confira razão social, atividade, endereço e situação cadastral.", cadastroConferido ? [] : [publica ? "Conferir os dados retornados antes de continuar" : "Consulta pública concluída para o CNPJ deste atendimento"]);
    const manual = autorizacao?.cnpj === o.cnpj && autorizacao?.validacaoManual?.atorId && autorizacao.validacaoManual?.registradaEm;
    add("autorizacao", "Obter autorização", manual || autorizada || (fiscal && estado.atendimento?.representanteVerificadoEm && autorizacao?.cnpj === o.cnpj), "Consulte a procuração ou registre a validação manual, sem comprovar poderes oficiais.", autorizada || manual ? [] : ["Procuração consultada ou validada manualmente"]);
    add("fiscal", "Consultar situação fiscal", j.fiscalAlternativa || fiscal && j.fiscalConferido, "Confira a situação fiscal ou registre a limitação da análise.", j.fiscalConferido || j.fiscalAlternativa ? [] : ["Situação fiscal pendente"]);
  }
  const pendenciasDiagnostico = pendenciasDiagnosticoComercial(j.diagnostico?.dados, o.origem);
  add("diagnostico", pessoaFisica ? "Definir o serviço pessoal" : abertura ? "Conferir viabilidade e escopo" : nomes[o.origem] === "Transferência" ? "Definir transferência e regularização" : "Definir regularização", j.diagnostico && !pendenciasDiagnostico.length,
    pessoaFisica ? "Descreva o serviço solicitado, o escopo e as condições que precisam ser confirmadas." : abertura ? "Registre a conferência do endereço, da atividade e das exigências de abertura. Descreva condições ainda a confirmar sem prometer viabilidade não verificada." : "Descreva as pendências encontradas e os serviços necessários. Separe regularização pontual da contabilidade mensal.", pendenciasDiagnostico);
  add("devolutiva", "Apresentar os serviços ao lead", j.devolutiva?.concluida, pessoaFisica ? "Apresente o escopo e as condições do serviço pessoal." : abertura ? "Confira e envie a mensagem com a análise da abertura e os serviços propostos." : "Confira a devolutiva. O envio inclui o relatório fiscal em PDF e a mensagem com as pendências e os serviços.", j.devolutiva?.concluida ? [] : [j.devolutiva?.incerta ? "Envio sem confirmação: confira o histórico." : "PDF conferido pelo contador"]);
  const expirou = proposta && !aceita && new Date(proposta.expiraEm).getTime() <= agora;
  add("proposta", "Valores e aceite da proposta", aceita, pessoaFisica ? "Confira os honorários e o escopo do serviço pessoal, aprove e apresente a proposta." : "Escolha avulso, contabilidade mensal ou comparação. Confira os valores, aprove a versão e envie a proposta para o aceite do lead.", aceita ? [] : [expirou ? "A proposta expirou. Prepare outra versão." : proposta?.status === "ENVIADA" ? "Aguardando o aceite do lead no link" : "Proposta revisada, enviada e aceita"]);
  add("contrato", "Contrato", contratoAprovado, "Confira o contrato da proposta aceita. A assinatura permanece registrável.", contratoAprovado ? [] : ["Contrato aprovado"]);
  add("pagamento", "Conferir pagamento", pagamento, "Registre a evidência do pagamento deste contrato. A integração de cobrança será implementada depois.", pagamento ? [] : ["Pagamento conferido pelo escritório"]);
  // Casos já contratados continuam de onde estão; não afirmar que análises antigas foram registradas.
  const inicio = aceita ? passos.findIndex(p => p.id === "contrato") : 0;
  passos.forEach((p, i) => { p.anterior = aceita && i < inicio && !p.concluido; });
  const indiceAtual = passos.findIndex((p, i) => i >= inicio && !p.concluido);
  const atual = indiceAtual < 0 ? "conclusao" : passos[indiceAtual].id;
  passos.forEach((p, i) => { p.acessivel = indiceAtual < 0 || i <= indiceAtual; });
  return { contratacao: resumirContratacao(contratacao), passos, atual, indiceAtual, publica, fiscal, proposta, contrato, pagamento, abertura, pessoaFisica, nome: nomes[o.origem] || o.origem,
    encerrado: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(o.status) };
}
