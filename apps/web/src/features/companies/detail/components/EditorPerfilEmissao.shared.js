

export function corpoDoPerfil(form, campos) {
  const corpo = { nome: form.nome?.trim(), ativo: form.ativo !== false, padrao: form.ativo !== false && form.padrao === true };
  if (Object.prototype.hasOwnProperty.call(form, 'categoriaObrigacaoIbscbs')) corpo.categoriaObrigacaoIbscbs = form.categoriaObrigacaoIbscbs || null;
  for (const { id } of campos) {
    const valor = form[id];
    corpo[id] = valor == null || valor === "" ? null
      : id === "retencaoFederalArt30" ? String(valor) === "true"
        : id === "pAliq" ? String(valor).replace(",", ".") : String(valor).trim();
  }
  return corpo;
}
