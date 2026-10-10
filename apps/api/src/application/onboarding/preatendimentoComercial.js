import { identificarOrigemComercial, interpretarColetaComercial, responderDuvidaComercial } from './interpretacaoComercialWhatsapp.js';
import { validarInterpretacaoLead } from '../assistente/interpretacaoLeadIa.js';
import { ORDEM_QUALIFICACAO, perguntasQualificacao, respostaNaturalPermitida } from './qualificacaoComercial.js';

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
export function prepararPreatendimento({ texto, intencao, anterior = {}, dadosFicha = {}, nomeConhecido = null, campoAnterior = null, mensagemId, interpretacaoIa = null, falhaIa = false }) {
  const raw = String(texto || '').trim(), t = normalizar(raw);
  const origem = origemDaIntencao(intencao);
  const pre = { ...anterior, versao: 1, intencao, dadosInformados: { ...(anterior.dadosInformados || {}) }, ...(anterior.evidenciasIa ? { evidenciasIa: { ...anterior.evidenciasIa } } : {}), ...(anterior.evidenciasDeclaradas ? { evidenciasDeclaradas: { ...anterior.evidenciasDeclaradas } } : {}) };
  const campo = anterior.campoEsperado || ({ responsavelNome: 'nome', atividadePretendida: 'atividade', municipioAtendimento: 'cidade', motivoTroca: 'necessidade' })[campoAnterior];
  const campoFicha = ({ nome: 'responsavelNome', atividade: 'atividadePretendida', cidade: 'municipioAtendimento', necessidade: intencao === 'TRANSFERENCIA' ? 'motivoTroca' : null })[campo];
  const palavraDeEntrada = palavras[raw.toUpperCase()] === intencao;
  const leitura = interpretarColetaComercial({ texto: palavraDeEntrada ? '' : raw, origem: origem || 'ABERTURA', campoEsperado: campoFicha, dadosAtuais: dadosFicha });
  const revisaoIdentidade = /\b(?:mude|mudar|troque|trocar|altere|alterar|vincule|vincular|acesse|acessar|mostre|mostrar|revele|revelar|envie|enviar|mande|mandar|use|usar)\b/.test(t)
    && /\b(?:outro|outra)\b.{0,35}\b(?:cliente|contato|empresa)\b|\bempresa de outro\b/.test(t);
  // Identidade/acesso de terceiros exige equipe, mesmo com classificação incorreta.
  if (revisaoIdentidade || falhaIa) Object.assign(leitura, { humano: true, aguardar: false, retomada: false, revisaoIdentidade, operacoes: [] });
  const ia = revisaoIdentidade || falhaIa ? null : validarInterpretacaoLead(interpretacaoIa, raw);
  const qualificacaoCompleta = anterior.qualificacaoVersao === 2 || Boolean(ia && Object.hasOwn(ia, 'resposta'));
  // Pedidos explícitos de humano e navegação determinística têm precedência.
  if (ia && !leitura.humano && !leitura.reinicio && !leitura.aguardar && !leitura.retomada) {
    if (ia.comportamento === 'HUMANO' || ia.comportamento === 'DESCONHECIDO' && !qualificacaoCompleta) leitura.humano = true;
    if (ia.comportamento === 'PAUSAR') leitura.aguardar = true;
    if (ia.comportamento === 'RETOMAR') leitura.retomada = true;
  }
  if (ia) {
    const camposTriagem = { responsavelNome: 'nome', atividadePretendida: 'atividade', municipioAtendimento: 'cidade', motivoTroca: 'necessidade' };
    // O extrator antigo não pode gravar uma resposta livre no campo perguntado
    // quando a interpretação com evidência identifica outro significado.
    leitura.operacoes = ia.comportamento !== 'DADOS' ? [] : leitura.operacoes.filter(o => {
      const campoIa = camposTriagem[o.campo];
      if (!campoIa) return true;
      return ia.dados.some(d => d.campo === campoIa && (o.acao === 'set'
        ? d.valor !== null && normalizar(d.valor) === normalizar(o.valor) : d.valor === null));
    });
  }
  const capturados = Object.fromEntries(leitura.operacoes.filter(o => o.acao === 'set').map(o => [o.campo, o.valor]));
  if (!revisaoIdentidade && !falhaIa && !origem && (!ia || ia.comportamento === 'DADOS')) {
    const cnpj = interpretarColetaComercial({ texto: raw, origem: 'TRANSFERENCIA' }).operacoes.find(o => o.campo === 'cnpj' && o.acao === 'set');
    if (cnpj) capturados.cnpj = cnpj.valor;
  }
  Object.assign(pre.dadosInformados, capturados);
  if (pre.evidenciasIa?.nome?.valor !== null) pre.nome ||= dadosFicha.responsavelNome || nomeConhecido || null;
  if (pre.evidenciasIa?.atividade?.valor !== null) pre.atividade ||= dadosFicha.atividadePretendida || null;
  if (pre.evidenciasIa?.cidade?.valor !== null) pre.cidade ||= dadosFicha.municipioAtendimento || null;
  if (pre.evidenciasIa?.necessidade?.valor !== null) pre.necessidade ||= dadosFicha.motivoTroca || null;
  if (capturados.responsavelNome) pre.nome = capturados.responsavelNome;
  if (capturados.atividadePretendida) pre.atividade = capturados.atividadePretendida;
  if (capturados.municipioAtendimento) pre.cidade = capturados.municipioAtendimento;
  if (capturados.motivoTroca) pre.necessidade = capturados.motivoTroca;
  const social = leitura.aguardar || leitura.retomada || leitura.humano || leitura.reinicio;
  const duvida = leitura.resposta || responderDuvidaComercial(raw, { origem });
  const desconhecido = Boolean(leitura.desconhecido) || /^(?:(?:eu |ainda )?nao (?:sei|lembro|tenho certeza|tenho ideia)|a definir)(?: dizer| informar| agora| ainda)?[.!]*$/.test(t);
  // Usar o extrator de atividade também para empresa existente, sem reclassificar a ficha.
  if (!social && !ia) {
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
  if (ia) {
    // Valores da IA pertencem à triagem, nunca confirmam dados fiscais/contratuais.
    const evidencias = { ...(pre.evidenciasIa || {}) };
    for (const d of ia.dados) {
      if (['nome', 'atividade', 'cidade'].includes(d.campo) && /^(?:(?:eu |ainda )?nao (?:sei|lembro|tenho certeza|tenho ideia)|a definir)\b/.test(normalizar(d.valor))) continue;
      // Uma intenção genérica ainda precisa da pergunta curta sobre o problema.
      if (d.campo === 'necessidade' && /^(?:(?:eu )?(?:quero|preciso|gostaria de|pretendo) )?(?:regularizar (?:a |minha |uma )?empresa|trocar (?:de )?contador)[.!]*$/.test(normalizar(d.valor))) continue;
      pre[d.campo] = d.valor;
      evidencias[d.campo] = { valor: d.valor, trecho: d.evidencia, mensagemId };
      if (pre.evidenciasDeclaradas) delete pre.evidenciasDeclaradas[d.campo];
    }
    pre.evidenciasIa = evidencias;
  }
  // Preservar o relato inteiro solicitado na triagem, sem atribuir à IA um trecho
  // que ela omitiu e sem transformar esse relato em dado fiscal confirmado.
  const queixaLiteral = /\b(?:demora|atrasos?|atrasado|sem (?:resposta|retorno)|nao.{0,15}respond|nao.{0,15}explica)\b/.test(t);
  const decisaoEmAberto = intencao === 'INATIVA' && /\b(?:nao sei|melhor|compensa)\b/.test(t) && /\b(?:fechar|encerrar|baixar|voltar|reativar)\b/.test(t);
  const retomadaEmpresa = intencao === 'INATIVA' && ia?.comportamento === 'DADOS'
    && /\b(?:retomar|voltar|reativar)\b/.test(t) && /\b(?:vendas|vender|operar|atividades|empresa|negocio)\b/.test(t);
  if (ia && !revisaoIdentidade && campo === 'necessidade' && ['TRANSFERENCIA', 'INATIVA'].includes(intencao) && raw.length <= 700
    && (ia.dados.some(d => d.campo === 'necessidade' && d.valor !== null)
      || ia.comportamento === 'HUMANO' && queixaLiteral && !raw.includes('?') || decisaoEmAberto || retomadaEmpresa)) {
    pre.necessidade = raw;
    pre.evidenciasDeclaradas = { ...(pre.evidenciasDeclaradas || {}), necessidade: { valor: raw, trecho: raw, mensagemId } };
    if (pre.evidenciasIa) delete pre.evidenciasIa.necessidade;
  }
  // Uma declaração determinística nova também vence a evidência antiga.
  for (const [chave, evidencia] of Object.entries(pre.evidenciasIa || {})) {
    if (pre[chave] !== evidencia.valor) delete pre.evidenciasIa[chave];
  }
  for (const [chave, evidencia] of Object.entries(pre.evidenciasDeclaradas || {})) {
    if (pre[chave] !== evidencia.valor) delete pre.evidenciasDeclaradas[chave];
  }
  if (palavras[palavra] && identificarIntencaoComercial(raw)) pre.palavraEntrada ||= palavra;
  // Guardar o relato sem transformar perguntas ou o perfil observado em dados fiscais confirmados.
  if (raw && (!social || leitura.humano)) pre.ultimoRelato = raw.slice(0, 1000);
  pre.mensagensIds = [...new Set([...(pre.mensagensIds || []), mensagemId].filter(Boolean))].slice(-8);
  const perguntas = {
    nome: 'Como você se chama?',
    atividade: intencao === 'ABERTURA' ? 'Qual atividade você pretende exercer?' : 'Qual é a atividade da sua empresa?',
    cidade: 'Em qual cidade a empresa vai funcionar? Se ainda não definiu, tudo bem.',
    necessidade: intencao === 'TRANSFERENCIA' ? 'O que você gostaria de melhorar em relação ao contador atual?' : 'O que aconteceu com a empresa e o que você gostaria de resolver?',
  };
  const ordem = qualificacaoCompleta ? ORDEM_QUALIFICACAO[intencao] || ['necessidade', 'atividade'] : intencao === 'ABERTURA' ? ['nome', 'atividade', 'cidade']
    : ['TRANSFERENCIA', 'INATIVA'].includes(intencao) ? ['necessidade', 'nome'] : ['atividade', 'nome'];
  if (qualificacaoCompleta) {
    pre.qualificacaoVersao = 2;
    pre.dispensados = [...new Set([...(anterior.dispensados || []), ...(campo && (desconhecido || /prefiro n[aã]o|n[aã]o (?:quero|posso) informar|ainda n[aã]o (?:sei|defini|tenho)/i.test(raw)) ? [campo] : [])])];
    // Correções novas tornam o dado conhecido novamente, sem apagar sua evidência.
    pre.dispensados = pre.dispensados.filter(k => !pre[k]);
    pre.falhasCompreensao = ia?.comportamento === 'DESCONHECIDO' && !desconhecido && !pre.dispensados.includes(campo)
      ? (anterior.falhasCompreensao || 0) + 1 : 0;
  }
  const conhecido = ordem.every(k => pre[k] || pre.dispensados?.includes(k));
  const campoSeguinte = ordem.find(k => !pre[k] && !pre.dispensados?.includes(k)) || null;
  // Três perguntas no máximo, sem penalizar pausas. Dúvida complexa ou desconhecimento segue ao humano.
  const encaminhar = Boolean(leitura.humano || leitura.reinicio || desconhecido && !qualificacaoCompleta || pre.preferenciaContato || conhecido
    || ia?.comportamento === 'DUVIDA' && !duvida
    || anterior.perguntasFeitas >= (qualificacaoCompleta ? 8 : 3) || pre.falhasCompreensao >= 2
    || !qualificacaoCompleta && pre.necessidade && (intencao === 'TRANSFERENCIA' || intencao === 'INATIVA'));
  pre.campoEsperado = encaminhar ? null : campoSeguinte;
  pre.perguntasFeitas = (anterior.perguntasFeitas || 0) + (!encaminhar && !social && campoSeguinte ? 1 : 0);
  const operacoes = origem ? leitura.operacoes : [];
  const respostaNatural = qualificacaoCompleta && !encaminhar && !social && !duvida ? respostaNaturalPermitida(ia?.resposta, campoSeguinte) : null;
  return { pre, operacoes, leitura, encaminhar, respostaNatural, pergunta: (qualificacaoCompleta ? perguntasQualificacao(pre) : perguntas)[campoSeguinte] || null,
    resposta: duvida && !/CNPJ parece/.test(duvida) ? duvida : duvida ? 'Deixei o número informado no histórico para o contador conferir; isso não impede o atendimento.' : null };
}
