// Um comprovante identificado pelo documento/CNPJ consultado descreve o pagamento,
// mesmo quando o documento de cobrança foi atualizado depois.
export function dataDoComprovante(comprovante) {
  const valor = comprovante?.dataArrecadacaoBR || comprovante?.dataArrecadacao;
  if (!valor) return null;
  if (valor instanceof Date) return Number.isFinite(valor.getTime()) ? valor : null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor));
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(String(valor));
  if (!br && !iso) return null;
  const [ano, mes, dia] = br ? [Number(br[3]), Number(br[2]), Number(br[1])] : iso.slice(1, 4).map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? data : null;
}

export function comprovanteParaRegistro(c) {
  if (!c) return null;
  const data = dataDoComprovante(c);
  return {
    dataArrecadacao: data ? `${String(data.getUTCDate()).padStart(2, "0")}/${String(data.getUTCMonth() + 1).padStart(2, "0")}/${data.getUTCFullYear()}` : null,
    principal: c.principal ?? null, juros: c.juros ?? null, multa: c.multa ?? null,
    total: c.total ?? null, meioPagamento: c.meioPagamento ?? null, confiavel: c.confiavel === true,
  };
}
