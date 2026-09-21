// Projeções são calculadas pelo servidor. O legado conserva seus dados sem adivinhar leads.
export const RELACIONAMENTOS = Object.freeze({ CLIENTE: "Cliente", LEAD: "Lead", A_IDENTIFICAR: "A identificar" });

export function relacionamentoDaConversa(conversa) {
  const informado = conversa?.relacionamento?.tipo;
  const tipo = Object.hasOwn(RELACIONAMENTOS, informado) ? informado : "A_IDENTIFICAR";
  const motivo = conversa?.relacionamento?.motivo;
  const motivos = { CONTATO_ATIVO_CADASTRADO: "Contato ativo no cadastro de uma empresa da carteira.", SOLICITACAO_COMERCIAL_CONFIRMADA: "Há uma solicitação comercial em andamento.", CADASTRO_ANTERIOR: "Há um cadastro anterior. Confira o vínculo atual antes de continuar.", SEM_EVIDENCIA_DE_RELACIONAMENTO: "Ainda não há informações suficientes para definir o relacionamento." };
  return { tipo, rotulo: RELACIONAMENTOS[tipo], motivo: motivos[motivo] || "Classificação ainda não conferida." };
}

export function chaveDoInterlocutor(c) {
  return c?.interlocutorId || c?.identidade?.interlocutorId || c?.atendimento?.interlocutorId || c?.atendimento?.id || c?.id;
}

export function nomeDaSolicitacao(c) {
  const s = c?.solicitacaoComercial;
  if (!s) return null;
  return ({ ABERTURA: "Nova abertura", TRANSFERENCIA: "Transferência", INATIVA: "Empresa parada" })[s.origem || s.tipo] || "Atendimento comercial";
}

export function podeAtendimentoComercial(c) {
  return c?.capacidades?.podeCriarCasoComercial !== false && c?.capacidades?.comercial !== false;
}

export function canaisDaConversa(c) {
  if (Array.isArray(c?.canais) && c.canais.length) return c.canais;
  return [{ id: c?.canalId || "principal", nome: "Principal", conversaId: c?.id, janela: c?.janela }];
}

// A primeira abertura acompanha a entrada mais recente. Durante a edição, a escolha
// fica fixada no compositor: polling nunca move um rascunho para outro remetente.
export function canalInicialDaConversa(c) {
  const canais = canaisDaConversa(c);
  if (c?.relacionamento?.tipo === "LEAD") return canalComercialDaConversa(c)?.id;
  const recebidos = canais.filter(canal => Number.isFinite(Date.parse(canal.janela?.instante)))
    .sort((a, b) => Date.parse(b.janela.instante) - Date.parse(a.janela.instante));
  return recebidos[0]?.id || canais.find(canal => canal.id === c?.canalId)?.id || canais[0]?.id;
}

export function canalComercialDaConversa(c) {
  return canaisDaConversa(c).find(canal => canal.id === "comercial" || String(canal.finalidade || canal.chave).toUpperCase() === "COMERCIAL");
}

export function chaveDoRascunho(c, { canalId, modo = "MENSAGEM", escopo = null } = {}) {
  // Uma nota para a empresa A nunca passa a pertencer à B por uma troca de contexto.
  return JSON.stringify([chaveDoInterlocutor(c), canalId || c?.canalId || "principal", modo,
    modo === "NOTA" ? escopo?.atendimentoLeadId || escopo?.portalClientId || escopo?.id || null : null]);
}

export function escoposDeNota(c) {
  if (Array.isArray(c?.capacidades?.escoposNotas)) return c.capacidades.escoposNotas;
  // Só oferecer os escopos explicitamente autorizados pelo servidor novo.
  return [];
}
