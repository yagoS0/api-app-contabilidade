// O estado do certificado A1 da empresa — uma leitura só para card, tabela e filtro.
//
// POR QUE UMA FUNÇÃO SÓ
// A mesma conta ("tem cert? venceu?") estava escrita em três lugares (card, popover da tabela,
// filtro do dashboard), e o filtro fazia a versão mais pobre: olhava só a presença, então empresa
// com A1 VENCIDO aparecia em "com certificado" — exatamente a empresa que não captura NFS-e.
//
// ⚠ `certExpiresAt` nulo com cert presente conta como ATIVO: é upload legado, do tempo em que a
// validade não era extraída. Tratar como vencido acenderia alerta em empresa que está em dia.

export const CERT_ESTADOS = {
  ativo:    { chave: "ativo" },
  vencido:  { chave: "vencido" },
  ausente:  { chave: "ausente" },
};

export function estadoCertificado(company, agora = Date.now()) {
  const legacy = company?.legacyCompany || null;
  const temCert = Boolean(legacy?.certStorageKey);
  const expiraEm = legacy?.certExpiresAt ? new Date(legacy.certExpiresAt) : null;
  const dataValida = expiraEm && !Number.isNaN(expiraEm.getTime());
  const vencido = temCert && dataValida && expiraEm.getTime() < agora;

  if (!temCert) {
    return {
      chave: "ausente", ativo: false, expiraEm: null,
      // Cinza, não âmbar: pela regra de ouro âmbar é ação rápida e vermelho é o que trava o
      // fechamento. Certificado faltando não é nem um nem outro — é configuração pendente.
      cor: "var(--state-neutral)",
      rotulo: "A1",
      titulo: "Empresa sem certificado A1 cadastrado — não é possível capturar NFS-e",
    };
  }
  if (vencido) {
    return {
      chave: "vencido", ativo: false, expiraEm,
      cor: "var(--state-neutral)",
      rotulo: "A1",
      titulo: `Certificado A1 vencido em ${expiraEm.toLocaleDateString("pt-BR")} — renove para voltar a capturar NFS-e`,
    };
  }
  return {
    chave: "ativo", ativo: true, expiraEm: dataValida ? expiraEm : null,
    cor: "var(--state-ok)",
    rotulo: "A1",
    titulo: dataValida
      ? `Certificado A1 ativo — válido até ${expiraEm.toLocaleDateString("pt-BR")}`
      : "Certificado A1 ativo — validade desconhecida (upload legado)",
  };
}
