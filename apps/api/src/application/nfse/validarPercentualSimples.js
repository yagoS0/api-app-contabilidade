export function validarPercentualSimples(valor, exigido) {
  const n = valor == null || valor === '' ? null : Number(valor);
  if (exigido && (n === null || !Number.isFinite(n) || n < 0 || n > 100)) {
    throw Object.assign(new Error('Informe um percentual do Simples entre 0 e 100 para esta nota.'), {
      code: 'MISSING_P_TOT_TRIB_SN',
      correcao: 'Confira o percentual sugerido pela apuração/PGDAS-D ou informe o percentual validado para a competência.',
    });
  }
  return n;
}
