import { LeadsOpenAIClient, RESERVA_LEADS_CENTAVOS } from './LeadsOpenAIClient.js';
import { MODELO_LEADS } from './interpretacaoLeadIa.js';
import { custoEstimadoCentavos } from './precosIa.js';

const ORIENTACOES = {
  OPENAI_SEM_CHAVE: 'Configure OPENAI_API_KEY no ambiente da API ou no arquivo local de testes.',
  OPENAI_AUTENTICACAO: 'Confira se a chave do projeto está correta, ativa e sem espaços extras.',
  OPENAI_PERMISSAO: 'Confira as permissões da chave e o acesso do projeto ao modelo e à Responses API.',
  OPENAI_MODELO_INDISPONIVEL: 'O modelo não está disponível para esta configuração. Confira o acesso no projeto OpenAI.',
  OPENAI_SALDO_INSUFICIENTE: 'Confira faturamento, créditos e limites de gasto do projeto OpenAI.',
  OPENAI_LIMITE: 'A OpenAI limitou a requisição. Confira os limites de uso; este teste não tenta novamente.',
  OPENAI_TIMEOUT: 'A chamada excedeu o prazo. Pode haver consumo; não houve retentativa.',
  OPENAI_REDE: 'Confira a saída HTTPS do servidor para api.openai.com.',
  OPENAI_SERVIDOR: 'A OpenAI retornou uma falha temporária. Não houve retentativa automática.',
};

export function diagnosticarConfiguracaoOpenAI(env = {}) {
  const lista = String(env.IA_LEADS_TELEFONES_PILOTO || '').split(',').map(v => v.trim()).filter(Boolean);
  const canais = String(env.IA_LEADS_CANAIS_PILOTO || '').split(',').map(v => v.trim()).filter(Boolean);
  const teto = Number(env.IA_LEADS_TETO_TOTAL_CENTAVOS || 0);
  const tetoValido = Number.isSafeInteger(teto) && teto > 0;
  const numerosValidos = lista.filter(v => /^\+?\d{10,15}$/.test(v));
  const chaveConfigurada = Boolean(String(env.OPENAI_API_KEY || '').trim());
  const iaLigada = env.IA_LEADS_OPENAI === '1', coletaLigada = env.WHATSAPP_COLETA_COMERCIAL === '1';
  return { modelo: MODELO_LEADS, chaveConfigurada, iaLigada, coletaLigada,
    piloto: { quantidade: new Set(numerosValidos.map(v => v.replace(/\D/g, ''))).size, entradasInvalidas: lista.length - numerosValidos.length },
    canaisPiloto: new Set(canais).size, tetoTotalCentavos: tetoValido ? teto : null,
    configuracaoPilotoPronta: chaveConfigurada && iaLigada && coletaLigada && numerosValidos.length > 0 && numerosValidos.length === lista.length && canais.length > 0 && tetoValido,
    conexaoVerificada: false, chamadasExternas: 0,
  };
}

export async function verificarConexaoOpenAI({ env = {}, live = false, maxUsd, cliente } = {}) {
  const config = diagnosticarConfiguracaoOpenAI(env);
  if (!live) return { ...config, modo: 'offline', orientacao: 'Verificação local. A presença da chave não confirma validade, saldo ou acesso ao modelo.' };
  const teto = Number(maxUsd) * 100;
  if (!Number.isFinite(teto) || teto < RESERVA_LEADS_CENTAVOS || teto > 100) return { ...config, ok: false, codigo: 'TETO_DO_TESTE_INVALIDO', orientacao: `Informe teto explícito de US$ ${(RESERVA_LEADS_CENTAVOS / 100).toFixed(2)} a US$ 1 para uma chamada fictícia.` };
  if (!config.chaveConfigurada) return { ...config, ok: false, codigo: 'OPENAI_SEM_CHAVE', orientacao: ORIENTACOES.OPENAI_SEM_CHAVE };
  try {
    const r = await (cliente || new LeadsOpenAIClient({ chave: env.OPENAI_API_KEY.trim() })).interpretar({ texto: 'Quero abrir uma empresa.', intencao: null, campoEsperado: null });
    return { ...config, modo: 'live', ok: true, conexaoVerificada: true, chamadasExternas: 1,
      custoEstimadoCentavos: custoEstimadoCentavos(r.usage, MODELO_LEADS), moeda: 'USD',
      orientacao: 'A Responses API respondeu no contrato esperado. Isso não ativa o atendimento nem aprova a qualidade comercial.' };
  } catch (e) {
    const codigo = Object.hasOwn(ORIENTACOES, e?.codigo) ? e.codigo : 'OPENAI_VALIDACAO_FALHOU';
    return { ...config, modo: 'live', ok: false, chamadasExternas: 1, codigo,
      consumoConfirmado: Boolean(e?.usage), reservaEstimadaCentavos: RESERVA_LEADS_CENTAVOS,
      orientacao: ORIENTACOES[codigo] || 'A resposta não passou nas validações. Confira a integração antes de liberar o piloto.' };
  }
}
