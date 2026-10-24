import { AssistenteClient } from './AssistenteClient.js';
import { montarPromptComercial, respostaComercialUtilizavel } from './promptComercial.js';
import { identificarIntencaoComercial, prepararPreatendimento, mensagemDeValor } from '../onboarding/preatendimentoComercial.js';
import { camposDaColeta as camposDaOrigem } from '@contabilidade/shared/onboarding';
import { validarDadosOnboarding } from '@contabilidade/shared/onboarding-dados';
import { IA_MODELO } from '../../config.js';

// Reutiliza o cliente real do modelo, mas não o executor que dispõe de efeitos de negócio.
// Não há contexto de empresa nem leitura da conversa operacional.
export const MODELO_TESTE=IA_MODELO;
export async function responderTesteWhatsapp({historico,texto,contexto={},mensagemId,assistente = new AssistenteClient({modelo:MODELO_TESTE,maxTokens:512,maxIteracoes:2})}) {
  const novo={...contexto};
  const handoff=()=>({texto:'Neste teste, o atendimento foi encaminhado ao contador fictício. Nenhuma equipe real foi acionada.',estado:'encaminhamento_local',origem:'automatica',contexto:{...novo,humano:true}});
  if(/\b(falar com (?:o |a )?(?:contador|equipe)|atendimento humano|quero um humano)\b/i.test(texto))return handoff();
  if(/^(?:oi|ol[aá]|menu|in[ií]cio)[!.\s]*$/i.test(texto))return {texto:'Como podemos ajudar? Abertura de empresa, transferência de contabilidade, planejamento ou gestão?',estado:'concluido',origem:'automatica',contexto:novo};
  const intencao=identificarIntencaoComercial(texto)||novo.intencao;
  if(intencao){
    const pre=prepararPreatendimento({texto,intencao,anterior:novo.pre||{},mensagemId});
    novo.intencao=intencao;novo.pre=pre.pre;
    if(pre.encaminhar)return handoff();
    if(!contexto.intencao)return {texto:[mensagemDeValor(pre.pre),pre.pergunta||'Conte um pouco sobre sua necessidade.'].filter(Boolean).join('\n'),estado:'concluido',origem:'automatica',contexto:novo};
  }
  let registrado=false,chamarContador=false;
  const origem=['ABERTURA','TRANSFERENCIA','INATIVA'].includes(novo.intencao)?novo.intencao:'ABERTURA';
  const campos=camposDaOrigem(origem, novo.dados || {}).map(d=>({campo:d.campo,tipo:d.tipo,opcoes:d.opcoes}));
  const system=montarPromptComercial({ficha:{origem,dados:novo.dados||{}},campos,orientacoes:[]});
  system.push({type:'text',text:'AMBIENTE DE TESTE ISOLADO: somente declarações desta sessão são conhecidas. Não existem empresa, guia, contrato, assinatura, pagamento, documento ou equipe reais acessíveis. A ferramenta grava apenas o roteiro fictício. Não afirme executar operações reais. A passagem ao contador é apenas local. Não solicite senhas ou documentos reais.'});
  const messages=[...historico,{role:'user',content:texto}];
  // Uma byte por token é um limite superior conservador; 2 chamadas, até 512 tokens
  // de saída cada e ferramenta de no máximo 4k bytes. Modelo fixo, sem overrides HTTP.
  if(Buffer.byteLength(JSON.stringify({system,messages}),'utf8')>60000)return handoff();
  const resposta = await assistente.responder({
    system,
    messages,
    ferramentas:[{name:'registrar_atendimento',description:'Registra somente declarações no onboarding fictício desta sessão; nenhuma operação real.',input_schema:{type:'object',properties:{chamarContador:{type:'boolean'},campos:{type:'array',maxItems:20,items:{type:'object',properties:{campo:{type:'string'},acao:{type:'string',enum:['set','unset']},valor:{}},required:['campo','acao'],additionalProperties:false}}},additionalProperties:false}}],
    executar:async(nome,input)=>{
      if(nome!=='registrar_atendimento'||registrado)return {ok:false,motivo:'FERRAMENTA_BLOQUEADA_NO_TESTE'};
      if(!input||Object.keys(input).some(k=>!['campos','chamarContador'].includes(k))||input.campos!==undefined&&(!Array.isArray(input.campos)||input.campos.length>20))return {ok:false,motivo:'DADOS_INVALIDOS'};
      const dados={...(novo.dados||{})};
      for(const op of input.campos||[]){
        if(!campos.some(d=>d.campo===op.campo)||!['set','unset'].includes(op.acao))return {ok:false,motivo:'CAMPO_INVALIDO'};
        if(op.acao==='unset')delete dados[op.campo];else dados[op.campo]=op.valor;
      }
      const validacao=validarDadosOnboarding(origem,dados);
      if(!validacao.ok||Buffer.byteLength(JSON.stringify(validacao.dados))>12000)return {ok:false,motivo:'DADOS_INVALIDOS'};
      novo.dados=validacao.dados;
      registrado=true;chamarContador=input?.chamarContador===true;
      return {ok:true,teste:true,encaminhamentoLocal:chamarContador,proximaPergunta:'Peça somente a informação necessária para esclarecer a necessidade; não ofereça assinatura ou pagamento.'};
    },
  });
  if(chamarContador||!registrado||!respostaComercialUtilizavel(resposta?.texto)||resposta.recusou||resposta.stopReason!=='end_turn')return {...handoff(),usage:resposta?.usage||null};
  return {texto:resposta.texto,estado:'concluido',origem:'ia',contexto:novo,usage:resposta.usage||null};
}
