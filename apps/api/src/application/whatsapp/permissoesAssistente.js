// O QUE UM NÚMERO PODE PEDIR AO ASSISTENTE.
//
// Estas permissões complementam o RBAC do portal. A função só fica disponível quando os dois
// portões permitem: o contato recebeu autorização explícita nesta lista E o usuário ligado ao
// número tem o papel mínimo da operação. Lista vazia significa somente conversa/encaminhamento.

export const PERMISSOES_ASSISTENTE = Object.freeze({
  GUIAS: "GUIAS",
  NOTAS_DANFSE: "NOTAS_DANFSE",
  DOCUMENTOS_EMPRESA: "DOCUMENTOS_EMPRESA",
  SITUACAO_FISCAL: "SITUACAO_FISCAL",
  RECALCULO_GUIA: "RECALCULO_GUIA",
  EMISSAO_NFSE: "EMISSAO_NFSE",
  CANCELAMENTO_NFSE: "CANCELAMENTO_NFSE",
});

export const TODAS_PERMISSOES_ASSISTENTE = Object.freeze(Object.values(PERMISSOES_ASSISTENTE));
const CONHECIDAS = new Set(TODAS_PERMISSOES_ASSISTENTE);

export function normalizarPermissoesAssistente(valor) {
  if (!Array.isArray(valor)) return [];
  const normalizadas = [...new Set(valor.map((item) => String(item || "").trim().toUpperCase()).filter((item) => CONHECIDAS.has(item)))];
  // Recalcular exige escolher uma guia; cancelar exige localizar uma nota. As permissões-base são
  // incluídas pelo servidor para que uma configuração parcial nunca produza uma função impossível.
  if (normalizadas.includes(PERMISSOES_ASSISTENTE.RECALCULO_GUIA) && !normalizadas.includes(PERMISSOES_ASSISTENTE.GUIAS)) {
    normalizadas.push(PERMISSOES_ASSISTENTE.GUIAS);
  }
  if (normalizadas.includes(PERMISSOES_ASSISTENTE.CANCELAMENTO_NFSE) && !normalizadas.includes(PERMISSOES_ASSISTENTE.NOTAS_DANFSE)) {
    normalizadas.push(PERMISSOES_ASSISTENTE.NOTAS_DANFSE);
  }
  return normalizadas;
}

export function permissoesAssistenteInvalidas(valor) {
  if (!Array.isArray(valor)) return ["FORMATO_INVALIDO"];
  return [...new Set(valor.map((item) => String(item || "").trim().toUpperCase()).filter((item) => !CONHECIDAS.has(item)))];
}

export function temPermissaoAssistente(sessaoOuContato, permissao) {
  const lista = normalizarPermissoesAssistente(sessaoOuContato?.permissoesAssistente);
  return lista.includes(String(permissao || "").toUpperCase());
}
