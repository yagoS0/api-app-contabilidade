export function resumoConsultaPagamentoLote(res = {}) {
  const paid = Number(res.paid || 0);
  const errors = Number(res.errors || 0);
  const indeterminados = Number(res.indeterminados || 0);
  const divergentes = Number(res.divergentes || 0);
  const naoAplicavel = Number(res.naoAplicavel || 0) + Number(res.semDoc || 0);
  const incompleta = res.cobertura === "PARCIAL" || res.qualidadeConsulta === "PARCIAL"
    || indeterminados > 0 || divergentes > 0 || naoAplicavel > 0;
  const partes = [`${paid} pagamento(s) confirmado(s)`];
  if (res.naoLocalizado || res.open) partes.push(`${res.naoLocalizado || res.open} não localizado(s) até a consulta`);
  if (indeterminados) partes.push(`${indeterminados} inconclusivo(s)`);
  if (divergentes) partes.push(`${divergentes} com divergência`);
  if (naoAplicavel) partes.push(`${naoAplicavel} sem consulta aplicável`);
  if (errors) partes.push(`${errors} com falha de consulta`);
  const message = res.mensagem || (!res.total ? "Sem guias a consultar" : partes.join("; ") + ".");
  return { ok: !res.pagtowebDisabled && !errors && !incompleta, message, parcial: incompleta };
}
