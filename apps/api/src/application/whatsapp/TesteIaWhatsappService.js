import { randomUUID } from 'node:crypto';
import { criarRepositorioTesteIa } from './TesteIaWhatsappRepository.js';
import { enviarSaidaTesteIa } from './SaidaTesteIaWhatsappService.js';
import { IA_MODELO } from '../../config.js';
import { PRECOS_POR_MILHAO_CENTAVOS } from '../assistente/precosIa.js';

const erro = (message,status=400)=>Object.assign(new Error(message),{status,code:'TESTE_IA_RECUSADO'});
export function exigirAdministradorTeste(user) {
  if (!user?.id || user.role !== 'admin') throw erro('Ativação restrita ao administrador do sistema.',403);
}
const ativa = (s,agora)=>s.estado==='ativa' && Date.parse(s.expiraEm)>agora.getTime();
const LEASE_MS=120000;
// Reserva conservadora por chamada; custo incerto permanece reservado.
const preco=PRECOS_POR_MILHAO_CENTAVOS[IA_MODELO];
// Até 140k tokens de entrada (teto conservador em bytes para dois requests),
// 1024 de saída e maior preço de entrada/cache. Modelo desconhecido falha fechado.
export const RESERVA_CUSTO_CENTAVOS=preco?Math.ceil((140000*Math.max(preco.entrada,preco.cacheEscrita)+1024*preco.saida)/1000000):Infinity;
export function criarTesteIaWhatsapp({repo=criarRepositorioTesteIa(),agora=()=>new Date(),habilitado=()=>process.env.WHATSAPP_TESTE_IA_ENABLED==='1',
  envioHabilitado=()=>process.env.WHATSAPP_TESTE_IA_SEND_ENABLED==='1',responder=null,enviar=enviarSaidaTesteIa,
  resolverCanal=async id=>(await import('./CanalWhatsappService.js')).configuracaoDoCanal(id)}={}) {
  const permitido=s=>habilitado()&&ativa(s,agora())&&s.modelo===IA_MODELO;
  const servico={
    async ativar({user,telefone,canalId,duracaoMinutos=15,limiteTurnos=10,limiteCustoCentavos=500,confirmacao,envioReal=false}) {
      exigirAdministradorTeste(user);
      if(!habilitado())throw erro('Teste de IA desabilitado no servidor.',409);
      if(!await repo.autorAtivo(user.id))throw erro('Administrador inativo ou revogado.',403);
      if(!preco)throw erro('Modelo configurado sem tabela de custo: teste bloqueado.',409);
      if(typeof envioReal!=='boolean')throw erro('Envio real deve ser booleano.');
      if(confirmacao!==(envioReal?'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO':'TESTE_ISOLADO_SEM_ENVIO'))throw erro('Confirme explicitamente o modo de teste.');
      if(envioReal&&!envioHabilitado())throw erro('Transporte de teste desabilitado.',409);
      if(!/^\d{10,15}$/.test(telefone||'')||typeof canalId!=='string'||!canalId.trim())throw erro('Informe número interno e canal cadastrado.');
      if(!Number.isInteger(duracaoMinutos)||duracaoMinutos<1||duracaoMinutos>60)throw erro('Duração deve ser de 1 a 60 minutos.');
      if(!Number.isInteger(limiteTurnos)||limiteTurnos<1||limiteTurnos>20||!Number.isInteger(limiteCustoCentavos)||limiteCustoCentavos<RESERVA_CUSTO_CENTAVOS||limiteCustoCentavos>2000)throw erro('Limites de teste inválidos.');
      const canal=await resolverCanal(canalId);
      if(!canal?.phoneNumberId||!canal?.wabaId)throw erro('Canal sem identidade configurada.');
      const inicio=agora();
      const s={id:randomUUID(),autorId:user.id,telefone,canalId,canalProvedorId:canal.phoneNumberId,wabaProvedorId:canal.wabaId,
        criadaEm:inicio.toISOString(),expiraEm:new Date(+inicio+duracaoMinutos*60000).toISOString(),estado:'ativa',eventos:[],historico:[],contexto:{},
        envioReal,modelo:IA_MODELO,limiteTurnos,limiteCustoCentavos,custoReservadoCentavos:0};
      await repo.criar(s);
      return {id:s.id,expiraEm:s.expiraEm,marcador:`/teste-ia ${s.id}`,envioReal,modelo:s.modelo,limiteTurnos,limiteCustoCentavos,reservaPorTurnoCentavos:RESERVA_CUSTO_CENTAVOS};
    },
    async consultar({user,id}) {
      exigirAdministradorTeste(user);
      const s=await repo.ler(id);
      if(!s||s.autorId!==user.id)throw erro('Sessão não encontrada.',404);
      return {...s,quarentenas:await repo.listarQuarentenas(id),estado:ativa(s,agora())?'ativa':s.estado==='ativa'?'expirada':s.estado};
    },
    async encerrar({user,id}) {
      exigirAdministradorTeste(user);
      return repo.alterar(id,s=>{
        if(s.autorId!==user.id)throw erro('Sessão não encontrada.',404);
        s.estado='encerrada';s.encerradaEm=agora().toISOString();return {ok:true};
      });
    },
    async interceptar(item) {
      const anterior=await repo.classificacao(item);
      if(anterior&&!anterior.id)return {isolado:true,estado:'recusado'};
      let citada=null;
      if(item.respostaAProviderMessageId){
        citada=await repo.sessaoDaSaida(item.respostaAProviderMessageId)||await repo.sessaoComSaidaIncerta(item,true);
        if(!citada&&!await repo.citacaoOperacional(item))citada=await repo.sessaoComSaidaIncerta(item);
      }
      const corpo=String(item.corpo||'');
      if(!anterior&&!citada&&!/^\s*\/teste-ia\b/i.test(corpo))return {isolado:false};
      const match=corpo.match(/^\s*\/teste-ia ([a-f0-9-]{36})\s+([\s\S]+)$/);
      const id=anterior?.id||citada||match?.[1]||null;
      await repo.classificar(item,id);
      // Responder citando saída de teste continua isolado, inclusive sem marcador.
      // Exigimos nova entrada explícita para processar; nunca inferir consentimento.
      if(citada&&!match){await repo.quarentenar(item,id);return {isolado:true,estado:'resposta_citada_isolada'};}
      if(!id||!match||!habilitado())return {isolado:true,estado:'recusado'};
      if(!await repo.ler(id))return {isolado:true,estado:'recusado'};
      const desfecho=await repo.alterar(id,s=>{
        if(s.eventos.find(e=>e.id===item.providerMessageId))return {isolado:true,estado:'duplicado'};
        const instante=Date.parse(item.ocorridaEmProvedor);
        let estado='pendente';
        if(s.telefone!==item.telefone||s.canalProvedorId!==item.canalProvedorId||s.wabaProvedorId!==item.wabaProvedorId||!item.providerMessageId||item.tipo!=='text'||match[2].length>4000)estado='origem_invalida';
        else if(!permitido(s)||!Number.isFinite(instante)||instante<Date.parse(s.criadaEm)||instante>=Date.parse(s.expiraEm)||instante>+agora()+30000)estado='expirado';
        else if(s.eventos.filter(e=>!['origem_invalida','expirado','limite'].includes(e.estado)).length>=s.limiteTurnos)estado='limite';
        if(estado==='pendente')s.eventos.push({id:item.providerMessageId,estado,texto:match[2],recebidaEm:agora().toISOString()});
        return {isolado:true,estado};
      });
      await repo.desfechoEntrada(item,desfecho.estado);
      return desfecho;
    },
    async processarUmaVez() {
      if(!habilitado())return;
      for(const candidato of await repo.listar(agora()))await servico.processarSessao(candidato.id);
    },
    async processarSessao(id) {
      const atual=await repo.ler(id);
      if(!atual)return;
      if(!await repo.autorAtivo(atual.autorId)){
        await repo.alterar(id,s=>{s.estado='encerrada';s.motivoEncerramento='autor_revogado';});
        return;
      }
      const token=randomUUID();
      const r=await repo.alterar(id,s=>{
        // Crash/timeout não autoriza repetir custo ou envio de resultado desconhecido.
        for(const e of s.eventos)if(['processando','enviando'].includes(e.estado)&&Date.parse(e.leaseAte)<=+agora())e.estado='incerto';
        if(!permitido(s)||s.eventos.some(e=>['processando','enviando'].includes(e.estado)))return null;
        const pronto=s.eventos.find(e=>e.estado==='pronto');
        if(pronto)return {somenteSaida:true,eventId:pronto.id};
        const e=s.eventos.find(e=>e.estado==='pendente');
        if(!e)return null;
        if(s.contexto.humano){e.estado='pausa_local';return null;}
        if(s.custoReservadoCentavos+RESERVA_CUSTO_CENTAVOS>s.limiteCustoCentavos){e.estado='limite_custo';return null;}
        s.custoReservadoCentavos+=RESERVA_CUSTO_CENTAVOS;
        Object.assign(e,{estado:'processando',token,leaseAte:new Date(+agora()+LEASE_MS).toISOString()});
        return {texto:e.texto,eventId:e.id,historico:s.historico,contexto:s.contexto};
      });
      if(!r)return;
      if(!r.somenteSaida){
        let resultado;
        try {
          const executar=responder||(await import('../assistente/AssistenteTesteWhatsappService.js')).responderTesteWhatsapp;
          resultado=await executar({historico:r.historico,texto:r.texto,contexto:r.contexto,mensagemId:r.eventId});
        }catch{resultado={estado:'incerto'};}
        const autorValido=await repo.autorAtivo(atual.autorId);
        await repo.alterar(id,s=>{
          const e=s.eventos.find(e=>e.id===r.eventId);
          if(e?.token!==token||e.estado!=='processando')return;
          e.usage=resultado.usage||null;
          if(!autorValido||!permitido(s)||Date.parse(e.leaseAte)<=+agora()){e.estado='descartado';return;}
          if(!resultado.texto){e.estado=resultado.estado||'incerto';return;}
          e.estado='pronto';e.textoSaida=`[TESTE ALTAN — SEM EFEITO REAL]\n${String(resultado.texto).slice(0,3200)}\n\nContinue com /teste-ia ${s.id} antes de cada mensagem.`;
          e.origem=resultado.origem||'ia';s.contexto=resultado.contexto||s.contexto;
          s.historico.push({role:'user',content:r.texto},{role:'assistant',content:String(resultado.texto).slice(0,3200)});
          while(JSON.stringify(s.historico).length>12000)s.historico.splice(0,2);
        });
      }
      await servico.entregar(id,r.eventId);
    },
    async entregar(id,eventId) {
      const token=randomUUID();
      const reserva=await repo.alterar(id,s=>{
        const e=s.eventos.find(e=>e.id===eventId);
        if(e?.estado!=='pronto')return null;
        if(!permitido(s)){e.estado='descartado';return null;}
        if(!s.envioReal){e.estado='consultavel';return null;}
        if(!envioHabilitado()){e.estado='transporte_desabilitado';return null;}
        Object.assign(e,{estado:'enviando',tokenSaida:token,leaseAte:new Date(+agora()+LEASE_MS).toISOString()});
        return {sessao:s,texto:e.textoSaida};
      });
      if(!reserva)return;
      const revalidar=async()=>{
        const s=await repo.ler(id),e=s?.eventos.find(e=>e.id===eventId);
        if(!s||!permitido(s)||!s.envioReal||!envioHabilitado()||e?.tokenSaida!==token||e.estado!=='enviando'||Date.parse(e.leaseAte)<=+agora())throw erro('Saída de teste revogada.',409);
        if(!await repo.autorAtivo(s.autorId))throw erro('Administrador revogado.',403);
        return s;
      };
      let resultado;
      try {resultado=await enviar({sessao:reserva.sessao,texto:reserva.texto,correlacao:`altan-teste:${id}:${token}`,revalidar,resolverCanal});}
      catch {resultado={incerto:true};}
      if(resultado?.wamid)await repo.indexarSaida(resultado.wamid,id);
      await repo.alterar(id,s=>{
        const e=s.eventos.find(e=>e.id===eventId);
        if(e?.tokenSaida!==token)return;
        if(e.wamid&&['enviado','falhou'].includes(e.estado))return;
        e.estado=resultado?.wamid?'enviado':'incerto';e.wamid=resultado?.wamid||null;
      });
    },
    async interceptarStatus(item) {
      const reservado=String(item.correlacaoTeste||'').startsWith('altan-teste:');
      const match=String(item.correlacaoTeste||'').match(/^altan-teste:([a-f0-9-]{36}):([a-f0-9-]{36})$/);
      const id=match?.[1]||await repo.sessaoDaSaida(item.providerMessageId);
      const s=id?await repo.ler(id):null;
      if(s){
        const e=s.eventos.find(e=>e.wamid===item.providerMessageId||`altan-teste:${s.id}:${e.tokenSaida}`===item.correlacaoTeste);
        if(!e)return {isolado:true};
        const confirmado=await repo.alterar(s.id,atual=>{
          if(atual.canalProvedorId!==item.canalProvedorId||atual.wabaProvedorId!==item.wabaProvedorId||item.destinatario&&atual.telefone!==item.destinatario)return false;
          const evento=atual.eventos.find(x=>x.id===e.id);
          evento.recibos=[...(evento.recibos||[]),{status:item.status,em:agora().toISOString()}].slice(-20);
          if(item.providerMessageId&&['sent','delivered','read','failed'].includes(item.status)){
            evento.wamid=item.providerMessageId;
            if(['sent','delivered','read'].includes(item.status))evento.estado='enviado';
            else if(!evento.recibos.some(r=>['sent','delivered','read'].includes(r.status)))evento.estado='falhou';
            return true;
          }
          return false;
        });
        if(confirmado)await repo.indexarSaida(item.providerMessageId,s.id);
        return {isolado:true};
      }
      return {isolado:reservado};
    },
  };
  return servico;
}
