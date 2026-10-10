// O perfil sugere um local. O fato informado na operação tem precedência.
// Este resolvedor não determina município de incidência do ISS.
export function localDaPrestacao({ servico, perfil, municipioEmissor }) {
  for (const [valor, fonte] of [[servico?.cLocPrestacao, 'OPERACAO'], [perfil?.cLocPrestacao, 'PERFIL']]) {
    if (valor == null || String(valor).trim() === '') continue;
    const codigo = String(valor).trim();
    if (!/^\d{7}$/.test(codigo)) throw Object.assign(new Error('Confira o município da prestação informado na operação ou no perfil.'), { code: 'NFSE_LOCAL_PRESTACAO_INVALIDO' });
    return { codigo, fonte, assumido: false };
  }
  return { codigo: municipioEmissor || null, fonte: 'MUNICIPIO_EMISSOR', assumido: true };
}
