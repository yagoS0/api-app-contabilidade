import tabela from './dados/municipiosTom.data.js';
import { normalizarParaBusca } from './consultaTomador.js';

/** Conversão por relação oficial; nome e UF nunca servem para adivinhar código. */
export function municipioSerpro(endereco, municipios) {
  const codigo = String(endereco?.municipio?.codigo ?? '').trim();
  if (!/^\d{1,4}$/.test(codigo) || !Array.isArray(municipios)) return null;
  const relacao = tabela[String(Number(codigo))];
  if (!relacao) return null;
  const [ibge, nomeTom, nomeIbge, uf] = relacao;
  const nome = normalizarParaBusca(endereco?.municipio?.descricao);
  if (String(endereco?.uf ?? '').trim().toUpperCase() !== uf
      || ![nomeTom, nomeIbge].some(n => normalizarParaBusca(n) === nome)) return null;
  const atual = municipios.find(m => String(m?.[0]) === ibge);
  if (!atual || atual[2] !== uf || normalizarParaBusca(atual[1]) !== normalizarParaBusca(nomeIbge)) return null;
  return { codigo_municipio_ibge: ibge, municipio: atual[1], uf };
}
