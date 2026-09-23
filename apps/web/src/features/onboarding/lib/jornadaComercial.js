import { pendenciasDiagnosticoComercial } from "../../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js";
const nomes = { ABERTURA: "Abertura", TRANSFERENCIA: "Transferência", INATIVA: "Empresa parada" };
const existe = v => Boolean(String(v || "").trim());

export function montarJornada(estado, agora = Date.now()) {
  const o = estado.onboarding, d = o.dados || {}, j = estado.jornada || {};
  const abertura = o.origem === "ABERTURA";
  const analises = (j.analises || []).filter(a => a.cnpj === o.cnpj);
  const publica = analises.find(a => a.tipo === "PUBLICA" && a.status === "CONCLUIDA");
  const fiscal = analises.find(a => a.tipo === "SITFIS" && a.status === "CONCLUIDA" && a.resultado?.relatorioDisponivel);
  const proposta = (estado.propostas || []).find(p => !p.revogadaEm);
  const aceita = proposta?.status === "ACEITA";
  const contrato = (estado.contratos || []).find(c => c.propostaId === proposta?.id);
  const assinado = aceita && contrato?.status === "ASSINADO_CONFERIDO";
  const pagamento = assinado && (estado.marcos || []).find(m => m.tipo === "PAGAMENTO_HONORARIOS_CONFERIDO" && m.dados?.contratoId === contrato.id);
  const pendentes = j.dadosPendentes || (abertura ? [[o.responsavelNome || d.responsavelNome, "Nome do responsável"], [d.atividadePretendida, "Atividade pretendida"], [d.municipioAtendimento || d.municipioPretendido, "Município da sede"], [d.enderecoPretendido, "Endereço para viabilidade"]].filter(([v]) => !existe(v)).map(([,n]) => n) : o.cnpj ? [] : ["CNPJ"]);
  const autorizacao = estado.atendimento?.autorizacao;
  const autorizada = Boolean(estado.atendimento?.representanteVerificadoEm && autorizacao?.cnpj === o.cnpj && autorizacao.estado === "ATIVA"
    && new Date(autorizacao.prova?.validUntil).getTime() > agora);
  const passos = [];
  const add = (id, titulo, concluido, instrucao, pendencias = []) => passos.push({ id, titulo, concluido: Boolean(concluido), instrucao, pendencias });
  if (abertura) add("cadastro", "Entender a abertura", !pendentes.length, "Registre a atividade e o endereço que serão analisados. Você pode preencher pela conversa ou enviar o formulário ao lead.", pendentes);
  else {
    add("publica", "Consultar o CNPJ", publica && j.publicaConferida, "Peça o CNPJ e confira razão social, atividade, endereço e situação cadastral.", j.publicaConferida ? [] : [publica ? "Conferir os dados retornados antes de continuar" : "Consulta pública concluída para o CNPJ deste atendimento"]);
    add("autorizacao", "Obter autorização", autorizada || (fiscal && estado.atendimento?.representanteVerificadoEm && autorizacao?.cnpj === o.cnpj), "Envie o passo a passo, confira o representante e verifique a procuração. A mensagem enviada não comprova autorização.", autorizada ? [] : ["Representante conferido e procuração verificada para SITFIS"]);
    add("fiscal", "Consultar situação fiscal", fiscal && j.fiscalConferido, "Solicite a análise, aguarde o resultado e confira o PDF e a tabela antes de definir o serviço.", j.fiscalConferido ? [] : [fiscal ? "Conferir o relatório antes de continuar" : "Relatório fiscal disponível para conferência"]);
  }
  const pendenciasDiagnostico = pendenciasDiagnosticoComercial(j.diagnostico?.dados, o.origem);
  add("diagnostico", abertura ? "Conferir viabilidade e escopo" : nomes[o.origem] === "Transferência" ? "Definir transferência e regularização" : "Definir regularização", j.diagnostico && !pendenciasDiagnostico.length,
    abertura ? "Registre a conferência do endereço, da atividade e das exigências de abertura. Descreva condições ainda a confirmar sem prometer viabilidade não verificada." : "Descreva as pendências encontradas e os serviços necessários. Separe regularização pontual da contabilidade mensal.", pendenciasDiagnostico);
  add("devolutiva", "Apresentar os serviços ao lead", j.devolutiva?.concluida, abertura ? "Confira e envie a mensagem com a análise da abertura e os serviços propostos." : "Confira a devolutiva. O envio inclui o relatório fiscal em PDF e a mensagem com as pendências e os serviços.", j.devolutiva?.concluida ? [] : [j.devolutiva?.incerta ? "Envio sem confirmação: confira o histórico." : "Devolutiva enviada ao lead"]);
  const expirou = proposta && !aceita && new Date(proposta.expiraEm).getTime() <= agora;
  add("proposta", "Valores e aceite da proposta", aceita, "Escolha avulso, contabilidade mensal ou comparação. Confira os valores, aprove a versão e envie a proposta para o aceite do lead.", aceita ? [] : [expirou ? "A proposta expirou. Prepare outra versão." : proposta?.status === "ENVIADA" ? "Aguardando o aceite do lead no link" : "Proposta revisada, enviada e aceita"]);
  add("contrato", "Contrato e assinatura", assinado, "Escolha o modelo aprovado, confira os campos preenchidos e envie o PDF. Oriente a assinatura gov.br, anexe o arquivo devolvido e confira as assinaturas.", assinado ? [] : ["Contrato da proposta aceita com assinatura conferida"]);
  add("pagamento", "Conferir pagamento", pagamento, "Registre a evidência do pagamento deste contrato. A integração de cobrança será implementada depois.", pagamento ? [] : ["Pagamento conferido pelo escritório"]);
  // Casos já contratados continuam de onde estão; não afirmar que análises antigas foram registradas.
  const inicio = aceita ? passos.findIndex(p => p.id === "contrato") : 0;
  passos.forEach((p, i) => { p.anterior = aceita && i < inicio && !p.concluido; });
  const indiceAtual = passos.findIndex((p, i) => i >= inicio && !p.concluido);
  const atual = indiceAtual < 0 ? "conclusao" : passos[indiceAtual].id;
  passos.forEach((p, i) => { p.acessivel = indiceAtual < 0 || i <= indiceAtual; });
  return { passos, atual, indiceAtual, publica, fiscal, proposta, contrato, pagamento, abertura, nome: nomes[o.origem] || o.origem,
    encerrado: ["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(o.status) };
}
