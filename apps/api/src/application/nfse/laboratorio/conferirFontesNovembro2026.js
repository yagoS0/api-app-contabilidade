import { DOMParser } from '@xmldom/xmldom';
import { prepararDpsNovembro2026Offline } from './dpsNovembro2026.js';
import { unico } from './xmlEstruturaOffline.js';
import { criarClienteCadastroPublico } from '../cadastroPublicoClient.js';
import { consultarCep } from '../../tomador/consultarCep.js';
import { carregarMunicipiosIbge } from '../lote/municipiosIbge.js';
const campo = (n,k) => n && unico(n,k,false)?.textContent;
const normalizar = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();

// Orquestração explícita de consultas cadastrais, separada do preparador puro e do emissor.
// Não transforma a fotografia atual em evidência de vigência, nem altera o XML/cadastro.
export async function conferirFontesNovembro2026(entrada, { cadastroCnpj = criarClienteCadastroPublico(), cep = consultarCep,
  carregarMunicipios = carregarMunicipiosIbge, agora = () => new Date() } = {}) {
  // Recusa produção, 2027 e assinatura ANTES de qualquer consulta externa.
  const preparacao = prepararDpsNovembro2026Offline(entrada);
  const doc = new DOMParser().parseFromString(preparacao.xml,'application/xml');
  const inf = unico(doc.documentElement,'infDPS');
  const municipios = await carregarMunicipios();
  const consultas = [], cacheCnpj = new Map(), cacheCep = new Map();
  for (const papel of ['toma','dest']) {
    const pessoa = unico(inf,papel,false);
    if (!pessoa) continue;
    const cnpj = campo(pessoa,'CNPJ'), end = unico(pessoa,'end',false), nac = end && unico(end,'endNac',false);
    let cadastro = { ok: false, fonte: null, motivo: 'CPF_OU_EXTERIOR_NAO_SUPORTADO', vigenciaComprovada: false };
    if (cnpj) {
      if (!cacheCnpj.has(cnpj)) cacheCnpj.set(cnpj, await cadastroCnpj.consultar(cnpj, { municipios }));
      cadastro = cacheCnpj.get(cnpj);
    }
    let postal = { ok: false, motivo: 'SEM_CEP_NACIONAL', vigenciaComprovada: false };
    if (nac) {
      const codigo = campo(nac,'CEP');
      if (!cacheCep.has(codigo)) cacheCep.set(codigo, await cep(codigo,{ municipios }));
      const r = cacheCep.get(codigo);
      postal = { ok: r.ok, fonte: 'VIACEP', consultadoEm: agora().toISOString(), vigenciaComprovada: false,
        motivo: r.motivo || null, municipio: r.endereco?.cMun || null,
        coincideMunicipioXml: r.ok && r.endereco?.cMun ? r.endereco.cMun === campo(nac,'cMun') : null };
    }
    const encontrados = cadastro.ok ? municipios.filter(m => normalizar(m[1]) === normalizar(cadastro.municipioDescricao) && normalizar(m[2]) === normalizar(cadastro.uf)) : [];
    const municipioRfb = encontrados.length === 1 ? String(encontrados[0][0]) : null;
    consultas.push({ papel, cadastro: { ...cadastro, municipioIbge: municipioRfb,
      coincideMunicipioXml: municipioRfb && nac ? municipioRfb === campo(nac,'cMun') : null }, postal });
  }
  return { ...preparacao, somenteOffline: false, consultasCadastrais: consultas, transmitido: false,
    liberadoParaEmissao: false, pendencias: [...new Set([...preparacao.pendencias,
      'CADASTRO_RFB_POR_COMPETENCIA', 'CEP_POR_COMPETENCIA', ...consultas.flatMap(c => [c.cadastro.ok ? null : c.cadastro.motivo,c.postal.ok ? null : c.postal.motivo]).filter(Boolean)])] };
}
