import { cpfTemDvValido } from '../../utils/cpf.js';
import { lerValorDaPlanilha } from '../nfse/lote/celulasLote.js';
import { RE_CONFIRMACAO } from './confirmacaoPendente.js';

// Máquina pura: não consulta, persiste, envia, calcula tributos nem executa confirmação.
// O integrador fornece apenas tomadores/perfis autorizados e roda os helpers externos.
// Estado JSON: status COLETANDO | PRONTO | REVISAO | PAUSADO | CANCELADO | EQUIPE.
// Após preparar a pendência, o integrador define status/etapa = REVISAO.
// PREPARAR_TOMADOR recebe de volta atualizarColeta({tomadorPreparado: resultadoDoHelper}).
// invalidarConfirmacao exige invalidar o resumo anterior ANTES de enviar a nova pergunta.
const ETAPAS = { tomadorDoc: 'TOMADOR', descricao: 'DESCRICAO', valor: 'VALOR', competencia: 'COMPETENCIA', perfilId: 'PERFIL' };
const ROTULOS = {
  cpf: 'tomadorDoc', cnpj: 'tomadorDoc', 'cpf/cnpj': 'tomadorDoc', documento: 'tomadorDoc', cliente: 'tomadorDoc', tomador: 'tomadorDoc',
  nome: 'tomadorNome', 'razao social': 'tomadorNome', email: 'tomadorEmail', 'e-mail': 'tomadorEmail',
  descricao: 'descricao', servico: 'descricao', valor: 'valor', competencia: 'competencia', perfil: 'perfilId',
  cep: 'endereco.CEP', rua: 'endereco.xLgr', logradouro: 'endereco.xLgr', numero: 'endereco.nro', nro: 'endereco.nro',
  complemento: 'endereco.xCpl', bairro: 'endereco.xBairro', endereco: 'endereco.CEP',
};
const CAMPOS_ENDERECO = ['CEP', 'cMun', 'xLgr', 'nro', 'xCpl', 'xBairro'];
const CAMPOS_TOMADOR = ['tomadorNome', 'tomadorEmail', ...CAMPOS_ENDERECO.map((c) => `endereco.${c}`)];
const NORM = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const LIMPO = (v) => String(v ?? '').trim();
const clonar = (v) => JSON.parse(JSON.stringify(v));
const valorEm = (dados, campo) => campo.startsWith('endereco.') ? dados.endereco?.[campo.slice(9)] : dados[campo];
const etapaDoCampo = (campo) => ETAPAS[campo] || campo;
const campoDaEtapa = (etapa) => Object.keys(ETAPAS).find((k) => ETAPAS[k] === etapa) || etapa;

function mesAtual(agora) {
  const d = new Date(agora);
  if (!Number.isFinite(d.getTime())) throw new TypeError('agora deve ser uma data válida');
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${partes.find((p) => p.type === 'year').value}-${partes.find((p) => p.type === 'month').value}`;
}

export function ehPedidoDeEmissao(texto) {
  const t = NORM(texto).replace(/[.!]+$/, '').trim();
  return /^(?:(?:oi|ola|bom dia|boa tarde|boa noite)[,! ]+)?(?:(?:eu )?(?:quero|preciso|gostaria de|pode) )?emitir (?:uma |a |nova )?(?:nota(?: fiscal)?|nfs-?e)(?:[, ]+por favor)?(?:$|[.;\n, ]+\s*(?:cpf(?:\/cnpj)?|cnpj|tomador|cliente|documento|valor|servico|descricao|competencia)\s*[:=])/.test(t);
}

function retorno(estado, acao, mensagem = null, extras = {}) {
  return { estado, acao, consumiu: true, mensagem, opcoes: [], invalidarConfirmacao: false, alteracoes: [], ...extras };
}

function opcoesDaEtapa(estado) {
  const titulo = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  if (estado.etapa === 'TOMADOR') return estado.tomadores.map((t) => ({ id: `emis:tomador:${t.id || t.documento}`, titulo: titulo(t.nome ? `${titulo(t.nome).slice(0, 42)} · ${t.documento}` : t.documento) }));
  if (estado.etapa === 'PERFIL') return estado.perfis.map((p) => ({ id: `emis:perfil:${p.id}`, titulo: titulo(p.nome || p.descricao || p.id) }));
  if (estado.etapa === 'COMPETENCIA') return [{ id: 'emis:competencia:atual', titulo: 'Mês atual' }, { id: 'emis:competencia:outra', titulo: 'Outra competência' }];
  return [];
}

function pergunta(estado) {
  const opcoes = opcoesDaEtapa(estado);
  const lista = opcoes.map((o, i) => `${i + 1}. ${o.titulo}`).join('\n');
  const textos = {
    TOMADOR: `Para quem é a nota? Envie o CPF/CNPJ do cliente${lista ? ` ou escolha o número:\n${lista}` : '.'}`,
    DESCRICAO: 'Qual serviço foi prestado? Escreva a descrição que deve aparecer na nota.',
    VALOR: 'Qual é o valor do serviço, em reais? Exemplo: 1500,00.',
    COMPETENCIA: `A competência é o mês atual (${estado.competenciaAtual}) ou outra? Pode responder “atual” ou informar MM/AAAA. Se precisar informar o dia, use DD/MM/AAAA.`,
    PERFIL: `Qual perfil de serviço deseja usar? Escolha pelo nome ou número:\n${lista}`,
    tomadorNome: 'Qual é o nome completo ou a razão social do cliente?',
    tomadorEmail: 'Qual é o e-mail do cliente? Se não houver, responda “sem e-mail”.',
    'endereco.CEP': 'Qual é o CEP do endereço do cliente?',
    'endereco.xLgr': 'Qual é a rua ou o logradouro do endereço do cliente?',
    'endereco.nro': 'Qual é o número do endereço do cliente? Se não houver, responda “sem número”.',
    'endereco.xCpl': 'Qual é o complemento do endereço? Se não houver, responda “sem complemento”.',
    'endereco.xBairro': 'Qual é o bairro do endereço do cliente?',
    REVISAO: 'Confira o resumo enviado. Para executar, use CONFIRMAR e o código desse resumo. Se precisar mudar algo, escreva, por exemplo, “corrigir valor”.',
  };
  return retorno(estado, 'COLETAR', textos[estado.etapa] || 'Diga qual dado deseja corrigir ou escreva “falar com atendente”.', { opcoes: opcoes.slice(0, 10) });
}

function planejar(estado) {
  estado.status = 'COLETANDO';
  if (estado.campoEmCorrecao) estado.etapa = etapaDoCampo(estado.campoEmCorrecao);
  else if (!estado.dados.tomadorDoc) estado.etapa = 'TOMADOR';
  else if (!estado.tomadorPreparado) {
    estado.etapa = 'ENRIQUECER_TOMADOR';
    return retorno(estado, 'PREPARAR_TOMADOR');
  } else if (estado.camposPendentes.length) {
    const campo = estado.camposPendentes[0];
    if (!Object.values(ROTULOS).includes(campo)) {
      estado.status = 'EQUIPE';
      return retorno(estado, 'EQUIPE', 'A equipe precisa conferir um dado do cadastro antes de preparar a nota.');
    }
    estado.etapa = etapaDoCampo(campo);
  } else if (!estado.dados.descricao) estado.etapa = 'DESCRICAO';
  else if (!(estado.dados.valor > 0)) estado.etapa = 'VALOR';
  else if (!estado.dados.competencia) estado.etapa = 'COMPETENCIA';
  else if (estado.perfis.length > 1 && !estado.perfis.some((p) => p.id === estado.dados.perfilId)) estado.etapa = 'PERFIL';
  else {
    estado.etapa = 'PRONTO';
    estado.status = 'PRONTO';
    return retorno(estado, 'PREPARAR_EMISSAO');
  }
  return pergunta(estado);
}

function aplicarPerfis(estado, perfis) {
  estado.perfis = clonar(Array.isArray(perfis) ? perfis : []);
  if (estado.perfis.length === 1) {
    estado.dados.perfilId = estado.perfis[0].id;
    estado.origens.perfilId = 'cadastro';
  } else if (!estado.perfis.some((p) => p.id === estado.dados.perfilId)) {
    delete estado.dados.perfilId;
    delete estado.origens.perfilId;
  }
}

export function iniciarColeta({ agora = new Date(), tomadores = [], perfis = [] } = {}) {
  const estado = { versao: 1, status: 'COLETANDO', etapa: 'TOMADOR', dados: { endereco: {} }, origens: {}, competenciaAtual: mesAtual(agora), tomadorPreparado: false, camposPendentes: [], tomadores: clonar(tomadores.slice(0, 30)), perfis: [] };
  aplicarPerfis(estado, perfis);
  return planejar(estado);
}

function gravar(estado, campo, valor, origem = 'manual') {
  if (campo.startsWith('endereco.')) estado.dados.endereco[campo.slice(9)] = valor;
  else estado.dados[campo] = valor;
  estado.origens[campo] = origem;
  estado.camposPendentes = estado.camposPendentes.filter((c) => c !== campo);
  if (estado.campoEmCorrecao === campo) delete estado.campoEmCorrecao;
}

/** Nunca aceita uma resposta do helper correlacionada a outro documento. O integrador
 * deve ainda rejeitar resultados atrasados pelo id/versão do rascunho persistido. */
export function atualizarColeta({ estado: anterior, tomadorPreparado, camposPendentes, perfis } = {}) {
  const estado = clonar(anterior);
  if (perfis !== undefined) aplicarPerfis(estado, perfis);
  if (tomadorPreparado && typeof tomadorPreparado === 'object') {
    const t = tomadorPreparado.tomador;
    if (t?.cnpjCpf && String(t.cnpjCpf).replace(/\D/g, '') !== estado.dados.tomadorDoc) {
      return retorno(estado, 'COLETAR', 'O cadastro retornado não corresponde ao cliente escolhido. Confira o CPF/CNPJ.');
    }
    if (t) {
      const valores = { tomadorNome: t.nome, tomadorEmail: t.email, ...Object.fromEntries(CAMPOS_ENDERECO.map((c) => [`endereco.${c}`, t.endereco?.[c]])) };
      for (const [campo, valor] of Object.entries(valores)) {
        if (valor === undefined || valor === null) continue;
        const origem = valorEm(estado.dados, campo) === valor && estado.origens[campo] ? estado.origens[campo] : tomadorPreparado.origens?.[campo];
        // Sem proveniência não inventa que o dado veio de consulta ou memória.
        gravar(estado, campo, valor, origem || 'cadastro');
      }
      estado.tomadorPreparado = true;
    }
    if (tomadorPreparado.encaminharEscritorio) {
      estado.status = 'EQUIPE';
      return retorno(estado, 'EQUIPE', 'A equipe precisa conferir o cadastro do endereço antes de preparar a nota.');
    }
    estado.camposPendentes = [...(camposPendentes ?? tomadorPreparado.camposParaPerguntar ?? tomadorPreparado.campos ?? [])];
  } else if (tomadorPreparado === true) estado.tomadorPreparado = true;
  if (camposPendentes !== undefined) estado.camposPendentes = [...camposPendentes];
  return planejar(estado);
}

function ehDuvida(texto) {
  const t = NORM(texto);
  return /[?？]/.test(t) || /^(?:como|quanto|qual|quais|por que|porque|o que|nao sei|tenho (?:uma )?duvida|isso (?:ja|e)|pode (?:me|ser))\b/.test(t);
}

function lerDocumento(texto) {
  const t = LIMPO(texto).replace(/^(?:[ée] (?:o )?|o (?:cnpj|cpf) [ée] )/i, '').trim();
  if (!/^[\d./\- ]+$/.test(t)) return null;
  const d = t.replace(/\D/g, '');
  if (d.length === 14 || (d.length === 11 && cpfTemDvValido(d))) return d;
  return null;
}

function lerValor(texto) {
  const t = LIMPO(texto).replace(/^na verdade[, ]+\s*/i, '').replace(/^(?:(?:o )?valor (?:[ée]|fica em)|fica em|[ée](?: de)?)\s+/i, '').replace(/\s+reais[.!]?$/i, '').trim();
  // A planilha tolera espaços internos; no WhatsApp eles podem separar dois valores.
  if (/\d\s+\d/.test(t)) return null;
  const leitura = lerValorDaPlanilha(t);
  return leitura.ok ? leitura.valor : null;
}

function lerCompetencia(texto, atual) {
  const t = NORM(texto).replace(/[.!]$/, '').trim();
  if (/^(?:atual|mes atual|este mes|esse mes|deste mes|desse mes|neste mes|nesse mes|hoje)$/.test(t)) return atual;
  let ano; let mes; let dia;
  let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
  if (m) [, ano, mes, dia] = m;
  else if ((m = /^(?:(\d{2})\/)?(\d{2})\/(\d{4})$/.exec(t))) [, dia, mes, ano] = m;
  else return null;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia || 1)));
  if (Number(ano) < 1900 || d.getUTCFullYear() !== Number(ano) || d.getUTCMonth() !== Number(mes) - 1 || d.getUTCDate() !== Number(dia || 1)) return null;
  return `${ano}-${mes}${dia ? `-${dia}` : ''}`;
}

function escolher(texto, lista) {
  const t = NORM(texto).replace(/^(?:escolho|opcao|numero|e a|e o|a|o)\s+/, '').trim();
  if (/^\d{1,2}$/.test(t)) return lista[Number(t) - 1] || null;
  const candidatas = lista.filter((o) => NORM(o.nome || o.descricao) === t || (t.length >= 3 && NORM(o.nome || o.descricao).includes(t)));
  return candidatas.length === 1 ? candidatas[0] : null;
}

function validarCampo(campo, texto, estado) {
  if (ehDuvida(texto)) return { ok: false };
  let valor = LIMPO(texto);
  const normal = NORM(valor).replace(/[.!]$/, '');
  if (campo === 'tomadorDoc') valor = lerDocumento(valor) || lerDocumento(escolher(valor, estado.tomadores)?.documento) || null;
  else if (campo === 'valor') valor = lerValor(valor);
  else if (campo === 'competencia') valor = lerCompetencia(valor, estado.competenciaAtual);
  else if (campo === 'perfilId') valor = escolher(valor, estado.perfis)?.id || null;
  else if (campo === 'endereco.CEP') valor = /^\d{5}-?\d{3}$/.test(valor) ? valor.replace('-', '') : null;
  else if (campo === 'endereco.nro') valor = /^(?:sem numero|s\/?n)$/.test(normal) ? 'S/N' : /^\d{1,12}(?:[-/]?[a-z0-9]{1,5})?$/i.test(valor) ? valor : null;
  else if (campo === 'endereco.xCpl' && /^(?:sem complemento|nao tem|nenhum|nao)$/.test(normal)) valor = '';
  else if (campo === 'tomadorEmail') valor = /^(?:sem e-?mail|nao tem)$/.test(normal) ? '' : /^[^\s@]+@[^\s@]+$/.test(valor) ? valor : null;
  else if (!valor || valor.length > (campo === 'descricao' ? 2000 : campo === 'tomadorNome' ? 150 : 100) || /^(?:sim|ok|isso|nao|nao sei|obrigad[oa](?: .*)?|valeu(?: .*)?|me ajuda|pode (?:continuar|seguir)|ola|oi|bom dia|boa tarde|boa noite|menu)$/.test(normal) || !/\p{L}/u.test(valor)) valor = null;
  return { ok: valor !== null, valor };
}

function aplicarCampo(estado, campo, valor) {
  if (campo === 'tomadorDoc' && estado.dados.tomadorDoc !== valor) {
    for (const c of CAMPOS_TOMADOR) {
      if (!c.startsWith('endereco.')) delete estado.dados[c];
      delete estado.origens[c];
    }
    estado.dados.endereco = {};
    estado.camposPendentes = [];
    estado.tomadorPreparado = false;
  }
  if (campo === 'endereco.CEP' && estado.dados.endereco.CEP !== valor) {
    estado.dados.endereco = {};
    for (const c of CAMPOS_ENDERECO) delete estado.origens[`endereco.${c}`];
    estado.tomadorPreparado = false;
  }
  gravar(estado, campo, valor);
}

function camposRotulados(texto) {
  const re = /(?:^|[\n;]|\s)(cpf\/cnpj|cpf|cnpj|documento|cliente|tomador|nome|raz[aã]o social|e-?mail|descri[cç][aã]o|servi[cç]o|valor|compet[eê]ncia|perfil|cep|rua|logradouro|n[uú]mero|nro|complemento|bairro|endere[cç]o)\s*[:=]\s*/gi;
  const encontrados = [...texto.matchAll(re)];
  return encontrados.map((m, i) => ({ campo: ROTULOS[NORM(m[1])], texto: texto.slice(m.index + m[0].length, encontrados[i + 1]?.index ?? texto.length).trim().replace(/[;\n]+$/, '').trim() }));
}

function corrigir(texto) {
  const m = /^(?:corrigir|corrija|corrige|alterar|altere|mudar|mude|muda|trocar|troque|corrigindo)\s+(?:(?:o|a)\s+)?(cpf\/cnpj|cpf|cnpj|cliente|tomador|nome|raz[aã]o social|e-?mail|descri[cç][aã]o|servi[cç]o|valor|compet[eê]ncia|perfil|cep|rua|logradouro|n[uú]mero|complemento|bairro|endere[cç]o)(?:\s*(?::|=)|\s+(?:para|por|[ée]))?\s*(.*)$/i.exec(texto);
  return m ? { campo: ROTULOS[NORM(m[1])], texto: m[2] } : null;
}

function campoNatural(texto) {
  const t = texto.replace(/^na verdade[, ]+\s*/i, '');
  const m = /^(?:(?:o|a)\s+)?(cpf\/cnpj|cpf|cnpj|cliente|tomador|nome|raz[aã]o social|e-?mail|descri[cç][aã]o|servi[cç]o|valor|compet[eê]ncia|perfil|cep|rua|logradouro|n[uú]mero|complemento|bairro)\s+(?:[ée]|fica em|vai ser)\s+(.+)$/i.exec(t);
  return m ? { campo: ROTULOS[NORM(m[1])], texto: m[2] } : null;
}

export function interpretarResposta({ estado: anterior, texto = '', interacao, agora = new Date() } = {}) {
  const estado = clonar(anterior);
  const t = LIMPO(texto);
  const normal = NORM(t).replace(/[.!]$/, '').trim();
  const id = typeof interacao === 'string' ? interacao : interacao?.id || interacao?.button_reply?.id || interacao?.list_reply?.id;
  if (RE_CONFIRMACAO.test(t)) return retorno(estado, 'CONFIRMACAO_EXTERNA', null, { consumiu: false });
  if (/^(?:desistir|desisti|desisto|(?:quero )?cancelar(?: (?:o )?pedido)?|cancela(?: (?:o )?pedido)?|nao quero mais(?: emitir(?: a nota)?)?)$/.test(normal)) {
    estado.status = 'CANCELADO';
    return retorno(estado, 'CANCELAR', 'A coleta foi encerrada.', { invalidarConfirmacao: true });
  }
  const assuntoFiscal = /\b(?:aliquota|iss retido|retencao|tributos?|impostos?|regime|ptottribsn|codigo (?:de )?servico)\s*[:=]/.test(normal)
    || /^(?:mudar|alterar|corrigir) (?:o |a )?(?:iss|aliquota|regime|retencao)\b/.test(normal)
    || (ehDuvida(t) && /\b(?:aliquota|iss|imposto|impostos|retencao|regime|tributos?)\b/.test(normal));
  if (/^(?:(?:quero|preciso|gostaria de) )?(?:falar (?:com (?:um |o |a )?)?|chamar )?(?:atendente|contador|equipe|escritorio|humano)$/.test(normal) || assuntoFiscal) {
    estado.status = 'EQUIPE';
    return retorno(estado, 'EQUIPE', 'A equipe pode ajudar com isso e conferir os dados antes da emissão.');
  }
  const outroPedido = /^(?:(?:por favor[, ]+)?(?:me (?:manda|envia|mande|envie)|manda|envia|quero|preciso(?: de)?))\b.*\b(?:contrato|cartao|guia|das|boleto|certidao|documentos)\b/.test(normal)
    || /^(?:(?:quero|preciso) )?(?:cancelar|recalcular)\b.*\b(?:nota|guia)\b/.test(normal);
  if (/^(?:pausar|pausa|parar|sair|menu|(?:quero )?(?:falar|conversar) livremente|deixa(?:r)? para depois)$/.test(normal) || outroPedido) {
    estado.status = 'PAUSADO';
    return retorno(estado, 'PAUSAR', outroPedido ? null : 'Coleta pausada. Para retomar, escreva “continuar emissão”.', { consumiu: !outroPedido });
  }
  if (estado.status === 'PAUSADO') {
    if (/^(?:continuar|retomar)(?: (?:a )?(?:emissao|nota))?$/.test(normal)) return planejar(estado);
    return retorno(estado, 'PAUSAR', null, { consumiu: false });
  }
  if (['CANCELADO', 'EQUIPE'].includes(estado.status)) return retorno(estado, estado.status === 'EQUIPE' ? 'EQUIPE' : 'CANCELAR', null, { consumiu: false });
  estado.competenciaAtual = mesAtual(agora);

  let campos = camposRotulados(t);
  const correcao = corrigir(t);
  if (correcao && !campos.length) campos = [correcao];
  const natural = campoNatural(t);
  if (natural && !campos.length) campos = [natural];
  if (id) {
    const opcao = opcoesDaEtapa(estado).find((o) => o.id === id);
    if (!opcao) return pergunta(estado);
    if (id === 'emis:competencia:outra') return retorno(estado, 'COLETAR', 'Qual é a competência? Informe MM/AAAA ou DD/MM/AAAA.');
    if (id === 'emis:competencia:atual') campos = [{ campo: 'competencia', texto: 'atual' }];
    else if (estado.etapa === 'TOMADOR') {
      const tomador = estado.tomadores.find((o) => `emis:tomador:${o.id || o.documento}` === id);
      campos = [{ campo: 'tomadorDoc', texto: tomador.documento }];
    } else if (estado.etapa === 'PERFIL') {
      const perfil = estado.perfis.find((p) => `emis:perfil:${p.id}` === id);
      aplicarCampo(estado, 'perfilId', perfil.id);
      return { ...planejar(estado), invalidarConfirmacao: true, alteracoes: ['perfilId'] };
    }
  }
  if (!campos.length && ehDuvida(t)) {
    const explicacao = /competencia/.test(normal) ? 'Competência é o período em que o serviço foi prestado; informe o mês e o ano.' : 'Não alterei os dados. Posso continuar a coleta ou você pode escrever “falar com atendente” para tirar essa dúvida com a equipe.';
    return { ...pergunta(estado), mensagem: `${explicacao}\n\n${pergunta(estado).mensagem}` };
  }
  if (!campos.length && ['REVISAO', 'PRONTO'].includes(estado.status)) {
    const r = pergunta({ ...estado, etapa: 'REVISAO' });
    const valor = /^na verdade[, ]+\s*(.+)$/i.exec(t);
    if (valor && lerValor(valor[1]) !== null) r.mensagem = `Você quer corrigir o valor? Para isso, escreva “valor: ${valor[1]}”. O resumo continua aguardando confirmação.`;
    return r;
  }
  if (!campos.length && ehPedidoDeEmissao(t)) return pergunta(estado);
  if (!campos.length) {
    if (estado.etapa === 'ENRIQUECER_TOMADOR') return retorno(estado, 'COLETAR', 'O cadastro do cliente precisa ser conferido antes de continuar.');
    campos = [{ campo: campoDaEtapa(estado.etapa), texto: t }];
  }
  // Documento e CEP vêm antes dos demais campos para não apagar valores informados
  // na mesma mensagem durante a invalidação do endereço anterior.
  campos.sort((a, b) => (a.campo === 'tomadorDoc' ? -2 : a.campo === 'endereco.CEP' ? -1 : 0) - (b.campo === 'tomadorDoc' ? -2 : b.campo === 'endereco.CEP' ? -1 : 0));
  const alteracoes = [];
  let invalido;
  for (const campo of campos) {
    if (campos.filter((c) => c.campo === campo.campo).length > 1) {
      invalido ||= campo.campo;
      continue;
    }
    const leitura = validarCampo(campo.campo, campo.texto, estado);
    if (!leitura.ok) { invalido ||= campo.campo; continue; }
    if (valorEm(estado.dados, campo.campo) !== leitura.valor) alteracoes.push(campo.campo);
    aplicarCampo(estado, campo.campo, leitura.valor);
  }
  const invalidarConfirmacao = alteracoes.length > 0 || Boolean(correcao) || Boolean(invalido && (camposRotulados(t).length || natural));
  if (invalido) {
    estado.campoEmCorrecao = invalido;
    estado.etapa = etapaDoCampo(invalido);
    estado.status = 'COLETANDO';
    const r = pergunta(estado);
    return { ...r, mensagem: `Não consegui identificar esse dado com segurança. ${r.mensagem}`, invalidarConfirmacao, alteracoes };
  }
  return { ...planejar(estado), invalidarConfirmacao, alteracoes };
}
