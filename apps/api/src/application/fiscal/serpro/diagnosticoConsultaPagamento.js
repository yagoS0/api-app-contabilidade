export function diagnosticoConsultaPagamento(error) {
  const code = error?.code || "CONSULTA_FALHOU";
  const mensagens = {
    SERPRO_PAGTOWEB_AUTENTICACAO: "Autenticação recusada. Confira as credenciais e o certificado da integração.",
    SERPRO_PAGTOWEB_SEM_AUTORIZACAO: "Consulta não autorizada. Confira a procuração e as permissões do serviço PAGTOWEB.",
    SERPRO_PAGTOWEB_DOCUMENTO_INVALIDO: "Número do documento ou parâmetros recusados. Confira a identificação da guia.",
    SERPRO_PAGTOWEB_INDISPONIVEL: "SERPRO indisponível. A consulta não confirmou nem negou o pagamento.",
    SERPRO_PAGTOWEB_CONSULTA_NAO_CONCLUIDA: "Retorno do PAGTOWEB não reconhecido. O pagamento permanece sem conclusão nesta consulta.",
    SERPRO_PAGTOWEB_DISABLED: "A consulta PAGTOWEB está desabilitada na integração.",
    DAS_PAGAMENTO_INDISPONIVEL: "O índice do DAS não retornou um estado de pagamento válido.",
  };
  return { mensagem: mensagens[code] || "Consulta não concluída. Confira a integração e o código do erro antes de tentar novamente.",
    ...(Number.isInteger(error?.details?.httpStatus) ? { httpStatus: error.details.httpStatus } : {}),
    ...(error?.details?.codigoSerpro ? { codigoSerpro: error.details.codigoSerpro } : {}) };
}
