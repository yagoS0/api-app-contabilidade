

export const campoComercial = {
  width: "100%",
  padding: 8,
  marginBlock: 5,
  background: "var(--bg-subtle)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 5
};

export const reais = c => c == null ? "A confirmar" : (c / 100).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const apresentacao = {
  PESSOA_FISICA: "Pessoa física", ABERTURA: "Abertura", TRANSFERENCIA: "Transferência", INATIVA: "Empresa parada", RECEBIDO: "Recebido", EM_TRILHA: "Em acompanhamento", DESISTIU: "Desistiu", CONVERTIDO: "Na carteira", CONCLUIDO_AVULSO: "Serviço avulso concluído", RASCUNHO: "Rascunho", APROVADA: "Aprovada", ENVIADA: "Enviada", ACEITA: "Aceita",
  MINUTA: "Minuta", AGUARDANDO_ASSINATURA: "Aguardando assinatura", ASSINADO_CONFERIDO: "Assinatura conferida",
  PENDENTE: "Pendente", PROCESSANDO: "Em processamento", AGUARDANDO: "Aguardando",
  CONCLUIDA: "Concluída", CONCLUIDO: "Concluído", ERRO: "Falha", FALHOU: "Falhou", INCERTO: "Resultado incerto",
  NAO_SEI: "Não sei", NAO_APLICAVEL: "Não aplicável", SIMPLES: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real", AVULSO: "Serviço avulso",
  RECORRENTE: "Contabilidade mensal", COMPARAR: "Comparar opções",
};
export function textoComercial(valor) {
  if (valor == null || valor === "") return "Não informado";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  // Valores novos continuam identificáveis; não são classificados como sucesso.
  return Object.hasOwn(apresentacao, valor) ? apresentacao[valor] : String(valor);
}
export function rotuloDadoComercial(chave) {
  const nomes = { cpf: "CPF", cnpj: "CNPJ", cep: "CEP", uf: "UF", email: "E-mail" };
  return nomes[chave] || chave.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
}
