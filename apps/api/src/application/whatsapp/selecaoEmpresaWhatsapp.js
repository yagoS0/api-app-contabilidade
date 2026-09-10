import { PESO_PAPEL_CLIENTE } from '../nfse/emissaoClienteAutorizacao.js';

// Regra pura. Candidatas vêm do vínculo ESTRITO do telefone; nome/CNPJ apenas escolhem
// entre elas. A seleção não concede função nem substitui a revalidação do contato.
const normalizar = (valor) => String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limpar = (valor) => String(valor ?? '').trim();
const digitos = (valor) => String(valor ?? '').replace(/\D/g, '');
const ID_PREFIXO = 'altan.company.';

/** Não confunde telefone conhecido sem acesso com um lead desconhecido. */
export function empresasAutorizadas(vinculo) {
  const base = { empresas: [], userId: null, bloqueado: false, motivo: null, descartadas: [] };
  if (!['VINCULADO', 'AMBIGUO'].includes(vinculo?.situacao)) return { ...base, motivo: 'SEM_VINCULO' };
  if (vinculo.leitura && vinculo.leitura !== 'ESTRITA') return { ...base, bloqueado: true, motivo: 'LEITURA_NAO_ESTRITA' };
  const cadastradas = Array.isArray(vinculo.empresas) ? vinculo.empresas : [];
  const ids = cadastradas.map((e) => e.portalClientId).filter(Boolean);
  if (vinculo.ambiguidades?.includes('PESSOA') || cadastradas.some((e) => e.pessoaAmbigua || e.contatos?.length > 1)
    || new Set(ids).size !== ids.length) return { ...base, bloqueado: true, motivo: 'PESSOA_AMBIGUA' };
  // Mesmo nome e telefone não comprovam que contas diferentes pertencem à mesma pessoa.
  const pessoas = new Set(cadastradas.flatMap((e) => (e.contatos || []).map((c) => c.userId).filter(Boolean)));
  if (pessoas.size > 1) return { ...base, bloqueado: true, motivo: 'RESPONSAVEIS_DIFERENTES' };
  for (const empresa of cadastradas) {
    const contato = empresa.contatos?.length === 1 ? empresa.contatos[0] : null;
    const papel = limpar(contato?.papelRbac).toUpperCase();
    let motivo = null;
    if (!empresa.portalClientId) motivo = 'SEM_EMPRESA';
    else if (!contato?.userId) motivo = 'SEM_PESSOA';
    else if (contato.statusRbac !== 'ACTIVE') motivo = 'VINCULO_INATIVO';
    else if (!Object.hasOwn(PESO_PAPEL_CLIENTE, papel)) motivo = 'PAPEL_NAO_AUTORIZADO';
    if (motivo) { base.descartadas.push({ portalClientId: empresa.portalClientId || null, motivo }); continue; }
    base.empresas.push({ ...empresa, userId: String(contato.userId), contatoId: contato.contatoId, papelRbac: papel });
  }
  base.userId = base.empresas[0]?.userId || null;
  base.motivo = base.empresas.length ? null : 'SEM_EMPRESAS_AUTORIZADAS';
  return base;
}

function cnpjFormatado(valor) {
  const d = digitos(valor);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : 'CNPJ não informado';
}

function empresasNaOrdem(empresas, contexto) {
  if (!Array.isArray(contexto?.empresaIdsOferecidos)) return empresas;
  // Mantém inclusive posições revogadas: nunca transforma o antigo número 2 em outra empresa.
  return contexto.empresaIdsOferecidos.map((id) => empresas.find((e) => e.portalClientId === id) || null);
}

export function opcoesSelecaoEmpresa({ empresas = [], contexto = {} } = {}) {
  return empresasNaOrdem(empresas, contexto).flatMap((empresa, i) => empresa ? [{
    id: `${ID_PREFIXO}${contexto.id}.${contexto.versao}.${empresa.portalClientId}`,
    portalClientId: empresa.portalClientId,
    numero: i + 1,
    titulo: `${i + 1}. ${limpar(empresa.razao) || 'Empresa'}`.slice(0, 64),
    descricao: cnpjFormatado(empresa.cnpj),
    rotulo: `${i + 1}. ${limpar(empresa.razao) || 'Empresa'} · ${cnpjFormatado(empresa.cnpj)}`,
  }] : []);
}

export function textoSelecaoEmpresa({ empresas = [], contexto = {} } = {}) {
  const atual = empresas.find((e) => e.portalClientId === contexto.portalClientId);
  return [atual ? `Por qual empresa deseja continuar? A seleção anterior era ${atual.razao || 'a empresa indicada'}.` : 'Por qual empresa deseja atendimento?',
    ...opcoesSelecaoEmpresa({ empresas, contexto }).map((o) => o.rotulo),
    'Escolha pelo número, nome cadastrado ou CNPJ.'].join('\n');
}

function nomesDaEmpresa(empresa) {
  return [empresa.razao, empresa.nomeFantasia, ...(Array.isArray(empresa.aliases) ? empresa.aliases : [])]
    .filter((v) => typeof v === 'string' && limpar(v)).map(normalizar);
}

function iguaisAoTexto(empresas, texto) {
  const t = normalizar(texto).replace(/[.!?]+$/, '').trim();
  const documento = t.replace(/^cnpj\s*[:=]?\s*/, '');
  const apenasDocumento = /^[\d.\/\-\s]+$/.test(documento) && digitos(documento).length === 14;
  return empresas.filter((e) => nomesDaEmpresa(e).includes(t)
    || (apenasDocumento && digitos(e.cnpj).length === 14 && digitos(e.cnpj) === digitos(documento)));
}

// Limites explícitos após a empresa, sem casar pedaços de nome. O trecho inteiro é
// tentado primeiro para não cortar uma razão social que contenha "para" ou vírgula.
function empresaNoTrecho(empresas, trecho) {
  const pontos = [trecho.length];
  const limites = /[,;\n]|\s+(?:para|pra|pro)\s+|\s+(?:valor|servi[cç]o|descri[cç][aã]o|compet[eê]ncia)\s*[:=]|\s+(?:de|do|da)\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|m[eê]s|\d{2}\/\d{4})\b/giu;
  for (const m of trecho.matchAll(limites)) pontos.push(m.index);
  for (const fim of [...new Set(pontos)].sort((a, b) => b - a)) {
    const encontradas = iguaisAoTexto(empresas, trecho.slice(0, fim));
    if (encontradas.length) return { empresas: encontradas, tamanho: fim };
  }
  return { empresas: [], tamanho: 0 };
}

function mencoesExplicitas(empresas, texto) {
  const mencoes = [];
  // "Para a Lente" é tomador. Só preposições de emissor entram neste detector.
  const padroes = [
    { tipo: 'TROCA', re: /^(?:(?:quero|preciso|vamos)\s+)?(?:trocar|mudar)(?:\s+(?:a|de)\s+empresa)?\s+para\s+(?:(?:a\s+)?empresa\s+|a\s+)?/iu },
    { tipo: 'ESCOLHA', re: /^(?:escolho|seleciono|selecionar|continuar\s+(?:com|na)|(?:empresa(?:\s+emissora)?|emissora?)\s*[:=])\s*(?:(?:a\s+)?empresa\s+|a\s+)?/iu },
    { tipo: 'EMISSOR', re: /\b(?:pela|pelo|em\s+nome\s+(?:da|de))\s+(?:(?:a\s+)?empresa\s+)?/giu },
    { tipo: 'CONSULTA', re: /\b(?:guias?|das|documentos?|notas?|saldo|d[eé]bitos)\s+(?:da|do|de)\s+(?:(?:a\s+)?empresa\s+)?/giu },
  ];
  for (const { tipo, re } of padroes) {
    const encontrados = re.global ? [...texto.matchAll(re)] : [re.exec(texto)].filter(Boolean);
    for (const m of encontrados) {
      if (tipo === 'CONSULTA' && !ehConsultaExplicita(texto)) continue;
      if (tipo === 'EMISSOR' && m.index !== 0) {
        const antes = normalizar(texto.slice(0, m.index).split(/[;\n]/).at(-1));
        if (!/^(?:(?:oi|ola|bom dia|boa tarde|boa noite)[,! ]+)?(?:(?:eu )?(?:quero|preciso|gostaria de|pode|vamos) )?(?:emitir|emita|emissao)\b/.test(antes)
          || /(?:tomador|cliente|descricao|servico|valor|competencia)\s*[:=]/.test(antes)) continue;
      }
      const inicio = m.index + m[0].length;
      const escolha = empresaNoTrecho(empresas, texto.slice(inicio));
      const objeto = tipo === 'CONSULTA' ? /^(?:guias?|das|documentos?|notas?|saldo|d[eé]bitos)\b/iu.exec(m[0])?.[0] || '' : '';
      mencoes.push({ tipo, ...escolha, inicio: m.index + objeto.length, fim: inicio + escolha.tamanho });
    }
  }
  return mencoes;
}

function ehConsultaExplicita(texto) {
  const t = normalizar(texto);
  if (/(?:descricao|servico|tomador|cliente|documento|valor|competencia)\s*[:=]/.test(t)) return false;
  return /^(?:(?:oi|ola|bom dia|boa tarde|boa noite)[,! ]+)?(?:(?:pode |quero |preciso |gostaria |me |manda |mande |envie |enviar |consultar |ver |mostre |listar |qual |quais |quanto |tenho |duvida |essa |esta |a |as |o |os |por favor )[^;\n]*)?(?:guias?|das|documentos?|notas?|saldo|debitos)\b/.test(t);
}

function novoPedido(texto, interacaoId) {
  return String(interacaoId || '').startsWith('altan.client.')
    || /\b(?:guias?|das|d[eé]bitos|documentos?|emitir|emiss[aã]o|notas?|nfs-?e|recalcular|situa[cç][aã]o\s+fiscal|quanto\s+(?:devo|tenho)|quero|preciso|gostaria)\b/iu.test(texto);
}

function consultaDeTodas(texto) {
  const t = normalizar(texto).replace(/[.!?]+$/, '').trim();
  return /^(?:(?:pode |quero |preciso (?:de |das )?|gostaria (?:de |das )?)?(?:me )?(?:mandar|manda|mandar-me|envie|enviar|consultar|ver|mostre|listar)?\s*(?:as )?)?guias (?:de|das) todas(?: as empresas)?(?:,? por favor)?$/.test(t);
}

const codigoDeAto = (texto) => /^(?:confirmar|cancelar)\b/iu.test(limpar(texto));

/**
 * `pedido` preserva o texto inicial, nunca uma confirmação fiscal para reprodução.
 * `textoOperacao` remove a indicação da empresa, preservando objeto e tomador. O core mantém
 * a versão/empresa, pausa rascunhos e revalida permissões antes de qualquer efeito.
 * `empresaCitadaId` só pode vir de referência ao wamid verificada pelo core.
 */
export function decidirSelecaoEmpresa({ empresas = [], contexto = {}, texto = '', interacao = null, agora = new Date(), empresaCitadaId = null, coletaAtiva = false } = {}) {
  const entrada = limpar(texto);
  const t = normalizar(entrada);
  const interacaoId = typeof interacao === 'string' ? interacao : interacao?.id;
  const guardar = (v) => codigoDeAto(v) ? null : limpar(v) || null;
  const pendente = guardar(contexto.pedidoPendente);
  const pedidoAtual = guardar(entrada);
  const pedir = (motivo, pedido = pedidoAtual || pendente) => ({ acao: 'PERGUNTAR', motivo, pedido });
  if (!empresas.length) return { acao: 'NAO_TRATADO', motivo: 'SEM_EMPRESAS_AUTORIZADAS' };
  const atual = empresas.find((e) => e.portalClientId === contexto.portalClientId);
  const validade = new Date(contexto.expiraEm ?? NaN).getTime();
  const instante = new Date(agora).getTime();
  if (!Number.isFinite(instante)) throw new TypeError('agora deve ser uma data válida');
  const vigente = Boolean(atual && Number.isFinite(validade) && validade > instante);
  const selecionar = (empresa, motivo, pedido = pendente || pedidoAtual, extra = {}) => ({
    acao: 'SELECIONAR', portalClientId: empresa.portalClientId, motivo, pedido, ...extra,
  });
  const continuar = () => ({ acao: 'CONTINUAR', portalClientId: atual.portalClientId, pedido: pedidoAtual });

  if (String(interacaoId || '').startsWith(ID_PREFIXO)) {
    const prefixo = `${ID_PREFIXO}${contexto.id}.${contexto.versao}.`;
    if (!contexto.id || !Number.isSafeInteger(contexto.versao) || !contexto.aguardandoSelecao
      || !Number.isFinite(validade) || validade <= instante || !interacaoId.startsWith(prefixo)) return pedir('SELECAO_EXPIRADA', pendente);
    const id = interacaoId.slice(prefixo.length);
    const empresa = empresas.find((e) => e.portalClientId === id);
    if (!empresa || (Array.isArray(contexto.empresaIdsOferecidos) && !contexto.empresaIdsOferecidos.includes(id))) return pedir('EMPRESA_NAO_AUTORIZADA', pendente);
    return selecionar(empresa, 'BOTAO', pendente);
  }
  if (codigoDeAto(entrada)) return vigente && !contexto.aguardandoSelecao ? continuar() : pedir('CONFIRMACAO_EXIGE_CONTEXTO', null);
  if (consultaDeTodas(entrada)) return { acao: 'TODAS', motivo: 'CONSULTA_EXPLICITA', pedido: pedidoAtual };

  if (/^(?:(?:quero|preciso|vamos)\s+)?(?:trocar|mudar)(?:\s+(?:a|de)\s+empresa)?$/.test(t)
    || /^(?:(?:a|da|pela)\s+)?outra(?:\s+empresa)?$/.test(t)) return pedir('TROCA_SOLICITADA', pendente);

  const mencoes = mencoesExplicitas(empresas, entrada);
  if (mencoes.length) {
    if (mencoes.some((m) => !m.empresas.length)) return pedir('EMPRESA_NAO_IDENTIFICADA');
    const ids = new Set(mencoes.flatMap((m) => m.empresas.map((e) => e.portalClientId)));
    if (ids.size !== 1 || mencoes.some((m) => m.empresas.length !== 1)) return pedir('EMPRESA_AMBIGUA');
    const empresa = mencoes[0].empresas[0];
    const somenteEscolha = mencoes.length === 1 && ['TROCA', 'ESCOLHA'].includes(mencoes[0].tipo) && !limpar(entrada.slice(mencoes[0].fim));
    let textoOperacao = entrada;
    for (const m of [...mencoes].sort((a, b) => b.inicio - a.inicio)) textoOperacao = textoOperacao.slice(0, m.inicio) + textoOperacao.slice(m.fim);
    textoOperacao = textoOperacao.replace(/ +/g, ' ').replace(/\s+([,;])/g, '$1').replace(/^[,;\s]+/, '').trim();
    const acaoOperacao = mencoes.some(m => m.tipo === 'EMISSOR') && /\b(?:emitir|emita|emissao)\b/.test(normalizar(entrada)) ? 'EMISSAO' : null;
    return selecionar(empresa, 'EMPRESA_EXPLICITA', somenteEscolha ? pendente : pedidoAtual, { textoOperacao: somenteEscolha ? pendente : textoOperacao, ...(acaoOperacao ? { acaoOperacao } : {}) });
  }

  // Uma resposta citada é escopo de consulta, nunca autorização para trocar o
  // emissor enquanto a pessoa informa CPF/CNPJ, valor ou outros dados do tomador.
  if (empresaCitadaId && (!coletaAtiva || ehConsultaExplicita(entrada))) {
    const empresa = empresas.find((e) => e.portalClientId === empresaCitadaId);
    return empresa ? selecionar(empresa, 'MENSAGEM_CITADA', pedidoAtual) : pedir('REFERENCIA_NAO_AUTORIZADA');
  }

  if (coletaAtiva && !contexto.aguardandoSelecao) return vigente ? continuar() : pedir('CONTEXTO_EXPIRADO');

  // Na criação do atendimento ainda não houve pergunta nem prazo de seleção.
  // Uma única empresa não precisa de um seletor; atos por código já foram barrados acima.
  if (empresas.length === 1 && !contexto.portalClientId && !Number.isFinite(validade)) return selecionar(empresas[0], 'EMPRESA_UNICA', pedidoAtual || pendente);

  if (contexto.aguardandoSelecao) {
    // Clique vencido não é reaproveitado; uma nova escolha textual expressa a
    // vontade atual e o core deve gerar uma nova versão, nunca revalidar código.
    const numero = /^(?:(?:opcao|numero)\s+)?([1-9]\d{0,2})$/.exec(t);
    if (numero) {
      if (!Number.isFinite(validade) || validade <= instante) return pedir('SELECAO_EXPIRADA', pendente);
      const empresa = empresasNaOrdem(empresas, contexto)[Number(numero[1]) - 1];
      return empresa ? selecionar(empresa, 'NUMERO', pendente) : pedir('OPCAO_INVALIDA', pendente);
    }
    const encontradas = iguaisAoTexto(empresas, entrada.replace(/^(?:a empresa|a|escolho a|escolho)\s+/iu, ''));
    if (encontradas.length === 1) return selecionar(encontradas[0], 'CADASTRO_EXATO', pendente);
    if (encontradas.length > 1) return pedir('EMPRESA_AMBIGUA', pendente);
    return pedir('ESCOLHA_NECESSARIA', pendente || pedidoAtual);
  }

  const encontradas = iguaisAoTexto(empresas, entrada);
  if (encontradas.length === 1) return selecionar(encontradas[0], 'CADASTRO_EXATO', pendente);
  if (encontradas.length > 1) return pedir('EMPRESA_AMBIGUA');
  if (empresas.length === 1) return vigente ? continuar() : selecionar(empresas[0], 'EMPRESA_UNICA', pedidoAtual);
  if (!vigente) return pedir(contexto.portalClientId ? 'CONTEXTO_EXPIRADO' : 'SEM_EMPRESA_SELECIONADA');
  return novoPedido(entrada, interacaoId) ? pedir('NOVO_PEDIDO') : continuar();
}
