import { identificarOrigemComercial, interpretarColetaComercial, responderDuvidaComercial } from './interpretacaoComercialWhatsapp.js';

const normalizar = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const INTENCOES_PREATENDIMENTO = ['ABERTURA', 'TRANSFERENCIA', 'INATIVA', 'PLANEJAMENTO', 'GESTAO'];
export const origemDaIntencao = i => ['ABERTURA', 'TRANSFERENCIA', 'INATIVA'].includes(i) ? i : null;
const palavras = { ABRIR: 'ABERTURA', CONTADOR: 'TRANSFERENCIA', IMPOSTO: 'PLANEJAMENTO', MARGEM: 'GESTAO', DRE: 'GESTAO' };
const novosBotoes = { 'altan.comercial.planejamento.v1': 'PLANEJAMENTO', 'altan.comercial.gestao.v1': 'GESTAO' };

export function identificarIntencaoComercial(texto, interacao) {
  const id = typeof interacao === 'string' ? interacao : interacao?.id || interacao?.button_reply?.id || interacao?.list_reply?.id;
  if (id) return novosBotoes[id] || identificarOrigemComercial('', interacao);
  const raw = String(texto || '').trim(), t = normalizar(raw);
  const palavra = raw.toUpperCase();
  if (palavras[palavra]) return palavras[palavra];
  const origem = identificarOrigemComercial(raw);
  if (origem) return origem;
  if (/\b(?:nao|nem) (?:quero |preciso de |busco )?(?:planejamento|analise|gestao|dre|reduzir|pagar menos)\b/.test(t)) return null;
  if (/\bplanejamento tributario\b|\b(?:reduzir|diminuir|pagar menos|revisar)\b.{0,25}\b(?:impostos?|tributos?|tributacao|carga tributaria)\b|\b(?:pago|pagando)\b.{0,15}\b(?:muito|demais)\b.{0,15}\bimpostos?\b/.test(t)) return 'PLANEJAMENTO';
  if (/\b(?:entender|analisar|melhorar|conhecer|preciso|quero)\b.{0,35}\b(?:margem|resultado|lucro|dre|gestao financeira)\b/.test(t)) return 'GESTAO';
  return null;
}

export function mensagemDeValor(pre) {
  const t = normalizar(pre.necessidade);
  if (pre.intencao === 'TRANSFERENCIA' && /so (?:manda|envia)|apenas.{0,15}guias|relatorios?|resultado|acompanhamento/.test(t)) return 'Além das obrigações contábeis, a Altan oferece acompanhamento para entender os resultados do negócio, conforme o serviço contratado. O contador pode explicar como isso se aplica à sua empresa.';
  return ({
    ABERTURA: 'A Altan pode orientar a abertura e ajudar a organizar os primeiros passos da empresa. O contador vai entender o que faz sentido para sua atividade.',
    TRANSFERENCIA: 'Podemos entender o que você sente falta hoje e mostrar como funciona nosso atendimento e acompanhamento contábil.',
    INATIVA: 'Podemos ajudar você a entender a situação da empresa e os próximos passos, antes de definir qualquer serviço de regularização.',
    PLANEJAMENTO: 'Podemos analisar sua atividade e a tributação para avaliar alternativas. O contador precisa conferir o caso antes de falar em economia.',
    GESTAO: 'Podemos ajudar a transformar os números da empresa em informações para entender resultados e margem, conforme o acompanhamento contratado.',
  })[pre.intencao];
}

/** Pré-atendimento termina na equipe. Campos da ficha e contratação não são requisitos. */
export function prepararPreatendimento({ texto, intencao, anterior = {}, dadosFicha = {}, nomeConhecido = null, campoAnterior = null, mensagemId }) {
  const raw = String(texto || '').trim(), t = normalizar(raw);
  const origem = origemDaIntencao(intencao);
  const pre = { ...anterior, versao: 1, intencao, dadosInformados: { ...(anterior.dadosInformados || {}) } };
  const campo = anterior.campoEsperado || ({ responsavelNome: 'nome', atividadePretendida: 'atividade', municipioAtendimento: 'cidade', motivoTroca: 'necessidade' })[campoAnterior];
  const campoFicha = ({ nome: 'responsavelNome', atividade: 'atividadePretendida', cidade: 'municipioAtendimento', necessidade: intencao === 'TRANSFERENCIA' ? 'motivoTroca' : null })[campo];
  const palavraDeEntrada = palavras[raw.toUpperCase()] === intencao;
  const leitura = interpretarColetaComercial({ texto: palavraDeEntrada ? '' : raw, origem: origem || 'ABERTURA', campoEsperado: campoFicha, dadosAtuais: dadosFicha });
  const capturados = Object.fromEntries(leitura.operacoes.filter(o => o.acao === 'set').map(o => [o.campo, o.valor]));
  if (!origem) {
    const cnpj = interpretarColetaComercial({ texto: raw, origem: 'TRANSFERENCIA' }).operacoes.find(o => o.campo === 'cnpj' && o.acao === 'set');
    if (cnpj) capturados.cnpj = cnpj.valor;
  }
  Object.assign(pre.dadosInformados, capturados);
  pre.nome ||= dadosFicha.responsavelNome || nomeConhecido || null;
  pre.atividade ||= dadosFicha.atividadePretendida || null;
  pre.cidade ||= dadosFicha.municipioAtendimento || null;
  pre.necessidade ||= dadosFicha.motivoTroca || null;
  if (capturados.responsavelNome) pre.nome = capturados.responsavelNome;
  if (capturados.atividadePretendida) pre.atividade = capturados.atividadePretendida;
  if (capturados.municipioAtendimento) pre.cidade = capturados.municipioAtendimento;
  if (capturados.motivoTroca) pre.necessidade = capturados.motivoTroca;
  const social = leitura.aguardar || leitura.retomada || leitura.humano || leitura.reinicio;
  const duvida = leitura.resposta || responderDuvidaComercial(raw, { origem });
  const desconhecido = /^(?:(?:eu |ainda )?nao (?:sei|lembro|tenho certeza|tenho ideia)|a definir)(?: dizer| informar| agora| ainda)?[.!]*$/.test(t);
  // Usar o extrator de atividade também para empresa existente, sem reclassificar a ficha.
  if (!social) {
    const atividade = interpretarColetaComercial({ texto: raw, origem: 'ABERTURA' }).operacoes.find(o => o.campo === 'atividadePretendida')?.valor;
    const tipoEmpresa = raw.match(/\b(?:tenho|somos|trabalho (?:em|com)|minha empresa [ée]|[ée])\s+(?:(?:um|uma)\s+)?((?:cl[íi]nica|loja|com[ée]rcio|restaurante|ag[êe]ncia|consult[óo]rio|empresa de|neg[óo]cio de|presta[çc][ãa]o de servi[çc]os)[^;\n.!?]{0,100})/i)?.[1];
    if (atividade || tipoEmpresa) pre.atividade = atividade || tipoEmpresa.split(/\s+e\s+(?=quero|preciso|meu|minha|pago|n[ãa]o)/i)[0].trim();
    const motivo = raw.match(/\b(?:porque|pois|motivo\s*:|problema\s*:)\s*([^;\n]+)/i)?.[1];
    const queixa = /\b(?:meu contador|contabilidade atual)\b.{0,50}\b(?:so |nao |demora|erra|atras)|\bnao (?:me |nos )?respondem\b|\b(?:pago muito|pagar menos|nao sei (?:o que fazer|como resolver)|dar baixa|reativar|encerrar a empresa)\b/.test(t);
    if (motivo || queixa) pre.necessidade = (motivo || raw).slice(0, 700);
    if (!duvida && !desconhecido && !raw.includes('?') && campo && !Object.keys(capturados).length && !identificarIntencaoComercial(raw) && raw.length <= 700 && !/^(?:sim|nao|quero|preciso|pode|ja mandei|ja informei|vamos|ainda nao|nao sei)\b/.test(t)) {
      if (campo === 'atividade' && !/^[\d\s./-]+$/.test(raw)) pre.atividade = raw;
      if (campo === 'necessidade') pre.necessidade = raw;
      if (campo === 'cidade') pre.cidade = capturados.municipioAtendimento || raw;
    }
    const origemDeclarada = raw.match(/\b(?:vim|cheguei|conheci voc[êe]s)\s+(?:pelo?|pela|do|da|por)\s+(TikTok|Instagram|indica[çc][ãa]o|Google|YouTube)\b/i)?.[1];
    if (origemDeclarada) pre.origemDeclarada = origemDeclarada;
    if (/\b(?:urgente|urgencia|o quanto antes|esta semana|essa semana)\b/.test(t)) pre.urgencia = raw.slice(0, 300);
    if (/\b(?:agendar|marcar (?:uma )?(?:conversa|reuniao)|videochamada)\b/.test(t)) pre.preferenciaContato = 'Solicitou agendamento — a confirmar pela equipe';
  }
  const palavra = raw.toUpperCase();
  if (palavras[palavra] && identificarIntencaoComercial(raw)) pre.palavraEntrada ||= palavra;
  // Guardar o relato sem transformar perguntas ou o perfil observado em dados fiscais confirmados.
  if (raw && !social) pre.ultimoRelato = raw.slice(0, 1000);
  pre.mensagensIds = [...new Set([...(pre.mensagensIds || []), mensagemId].filter(Boolean))].slice(-8);
  const perguntas = {
    nome: 'Como você se chama?',
    atividade: intencao === 'ABERTURA' ? 'Qual atividade você pretende exercer?' : 'Qual é a atividade da sua empresa?',
    cidade: 'Em qual cidade a empresa vai funcionar? Se ainda não definiu, tudo bem.',
    necessidade: intencao === 'TRANSFERENCIA' ? 'O que você gostaria de melhorar em relação ao contador atual?' : 'O que aconteceu com a empresa e o que você gostaria de resolver?',
  };
  const ordem = intencao === 'ABERTURA' ? ['nome', 'atividade', 'cidade']
    : ['TRANSFERENCIA', 'INATIVA'].includes(intencao) ? ['necessidade', 'nome'] : ['atividade', 'nome'];
  const conhecido = ordem.every(k => pre[k]);
  const campoSeguinte = ordem.find(k => !pre[k]) || null;
  // Três perguntas no máximo, sem penalizar pausas. Dúvida complexa ou desconhecimento segue ao humano.
  const encaminhar = Boolean(leitura.humano || leitura.reinicio || desconhecido || pre.preferenciaContato || conhecido
    || anterior.perguntasFeitas >= 3 || pre.necessidade && (intencao === 'TRANSFERENCIA' || intencao === 'INATIVA'));
  pre.campoEsperado = encaminhar ? null : campoSeguinte;
  pre.perguntasFeitas = (anterior.perguntasFeitas || 0) + (!encaminhar && !social && campoSeguinte ? 1 : 0);
  const operacoes = origem ? leitura.operacoes : [];
  return { pre, operacoes, leitura, encaminhar, pergunta: perguntas[campoSeguinte] || null,
    resposta: duvida && !/CNPJ parece/.test(duvida) ? duvida : duvida ? 'Deixei o número informado no histórico para o contador conferir; isso não impede o atendimento.' : null };
}
