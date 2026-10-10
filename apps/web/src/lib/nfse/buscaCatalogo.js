import { normalizarParaBusca } from '../servicosNacionais/servicoNacional';

const compacto = texto => normalizarParaBusca(texto).replace(/[^a-z0-9]/g, '');

export function itemDoCatalogo(itens, valor) {
  const codigo = compacto(valor);
  return codigo ? itens.find(item => compacto(item.codigo) === codigo) : undefined;
}

export function buscarCatalogo(itens, termo, limite = 12) {
  const tokens = normalizarParaBusca(termo).trim().split(/\s+/).filter(Boolean);
  const encontrados = itens.filter(item => {
    const texto = normalizarParaBusca(`${item.codigo} ${item.descricao || ''} ${item.detalhe || ''}`);
    return tokens.every(token => texto.includes(token) || (compacto(token) && compacto(item.codigo).includes(compacto(token))));
  });
  const exato = itemDoCatalogo(encontrados, termo);
  if (exato) {
    encontrados.splice(encontrados.indexOf(exato), 1);
    encontrados.unshift(exato);
  }
  return { itens: encontrados.slice(0, limite), total: encontrados.length };
}
