import { normalizarDocumento, cnpjTemDvValido } from '@contabilidade/shared/documentos-fiscais';
import { randomUUID } from 'node:crypto';
import { criarConsultaCadastral } from './consultaCadastral.js';
import { tomadorDaReceita } from './consultaTomador.js';

const indisponivel = () => ({ ok: false, motivo: 'consulta_em_andamento', mensagem: 'Consulta em andamento. Aguarde ou preencha os dados manualmente.' });
const camposBasicos = ['cnpj','razao_social','nome_fantasia','descricao_tipo_de_logradouro','logradouro','numero','complemento','bairro','cep','municipio','uf','email','codigo_municipio_ibge','codigo_municipio','descricao_situacao_cadastral','motivo_situacao_cadastral','data_situacao_cadastral'];
camposBasicos.push('cnae_fiscal','cnae_fiscal_descricao','cnaes_secundarios','capital_social','codigo_natureza_juridica','natureza_juridica','porte','descricao_porte','data_inicio_atividade','ddd_telefone_1','ddd_telefone_2');
export function resultadoPorFinalidade(resultado, finalidade, municipios) {
  if (!resultado.ok) return resultado;
  const campos = finalidade === 'CADASTRO' ? [...camposBasicos, 'qsa', 'opcao_pelo_simples', 'opcao_pelo_mei'] : camposBasicos;
  const bruto = Object.fromEntries(campos.filter(k => k in (resultado.bruto || {})).map(k => [k, resultado.bruto[k]]));
  return { ...resultado, bruto, tomador: tomadorDaReceita(bruto, { municipios }), situacao: tomadorDaReceita(bruto).situacao };
}

export function criarConsultaCnpjPersistente({ gratuito, repositorio, serproBasica = null, serproEmpresa = null,
  habilitarPago = false, agora = () => new Date() }) {
  return async (cnpj, { escopo, finalidade = 'EMISSOR', municipios, ...opcoes } = {}) => {
    const documento = normalizarDocumento(cnpj);
    if (!/^\d{14}$/.test(documento) || !cnpjTemDvValido(documento)) return { ok: false, motivo: 'cnpj_invalido', mensagem: 'Confira o CNPJ ou preencha os dados manualmente.' };
    if (typeof escopo !== 'string' || !escopo.trim() || !['EMISSOR','CADASTRO','PUBLICO'].includes(finalidade)) return { ok: false, motivo: 'contexto_invalido', mensagem: 'Selecione a empresa ou abra o cadastro novamente.' };
    const modalidade = finalidade === 'CADASTRO' ? 'EMPRESA' : 'BASICA';
    const chave = { escopo, cnpj: documento, modalidade };
    let lock;
    try {
      lock = await repositorio.adquirir(chave);
      if (lock.cache) return { ...resultadoPorFinalidade(lock.resultado, finalidade, municipios), cache: true };
      if (lock.ocupado) return indisponivel();
    } catch {
      // Banco/migration/cofre ausente: continua gratuito, sem autorização financeira.
      return resultadoPorFinalidade(await gratuito(documento, { ...opcoes, municipios }), finalidade, municipios);
    }
    let resultado;
    try {
      const consulta = criarConsultaCadastral({ consultarGratuito: gratuito,
        serpro: finalidade === 'CADASTRO' ? serproEmpresa : serproBasica,
        habilitarPago: habilitarPago === true && finalidade !== 'PUBLICO', reservas: repositorio,
        modalidade, finalidade: finalidade === 'CADASTRO' ? 'CADASTRO' : 'EMISSOR' });
      resultado = await consulta(documento, { ...opcoes, municipios, escritorioId: escopo, requestKey: randomUUID() });
      resultado = resultadoPorFinalidade({ ...resultado, consultadoEm: agora().toISOString() }, finalidade, municipios);
      // Parcial/negativo: intervalo curto; sucesso básico: 30 dias; cadastro: 7 dias.
      const completo = resultado.ok && resultado.bruto?.razao_social && resultado.bruto?.cep && resultado.bruto?.logradouro
        && (modalidade !== 'EMPRESA' || resultado.fonte === 'SERPRO_EMPRESA');
      const ttl = completo ? (modalidade === 'EMPRESA' ? 7 : 30) * 86400000 : 60000;
      await repositorio.salvar(lock, resultado, ttl);
      return resultado;
    } catch {
      return resultado || { ok: false, motivo: 'indisponivel', mensagem: 'Consulta indisponível. Preencha os dados manualmente.' };
    } finally { await repositorio.liberar(lock).catch(() => {}); }
  };
}
