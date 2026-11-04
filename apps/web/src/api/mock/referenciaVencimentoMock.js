import { validIdentity, validCivilDate, referenceKey } from '../../features/operacoes/referenciaVencimentoView';
// Explicit simulation store only. No shared production data, flags or scheduling.
export function criarReferenciaVencimentoMock({canWrite=()=>false,canRead=canWrite,userId='contador-ficticio',now=()=>new Date().toISOString()}={}) {
 const rows=new Map(), requests=new Map();
 const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
 const access=(id,write)=>{if(!(write?canWrite(id):canRead(id)))fail('ACCESS_CHANGED','Acesso não permitido.');};
 const identity=id=>{if(!validIdentity(id))fail('INVALID_REFERENCE','Período ou tributo inválido.');};
 const result=row=>({reference:row?JSON.parse(JSON.stringify(row)):null,revision:row?.revision||0,referenceConsumerReady:false,captureCapabilityGranted:false});
 return {
 async getDueDateReference(companyId,id){access(companyId,false);identity(id);return result(rows.get(referenceKey(companyId,id)));},
 async saveDueDateReference(companyId,command){
 access(companyId,true);identity(command.identidade);
 const allowed=['identidade','acao','expectedRevision','requestId','motivo',...(command.acao==='CONFIRMAR'?['dataCivil','origem','descricaoFonte','confirmacao']:[])];
 if(Object.keys(command).some(k=>!allowed.includes(k))||!['CONFIRMAR','REVOGAR'].includes(command.acao)||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||!command.motivo?.trim()||command.motivo.length>300||typeof command.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(command.requestId))fail('INVALID_REFERENCE','Comando inválido.');
 if(command.acao==='CONFIRMAR'&&(!validCivilDate(command.dataCivil)||command.origem!=='CONFIRMADA_CONTADOR'||command.confirmacao!==true||!command.descricaoFonte?.trim()||command.descricaoFonte.length>300))fail('INVALID_REFERENCE','Confira a referência.');
 const key=referenceKey(companyId,command.identidade), prior=rows.get(key), requestKey=JSON.stringify([companyId,command.requestId]), fingerprint=JSON.stringify(command), replay=requests.get(requestKey);
 if(replay){if(replay.fingerprint!==fingerprint)fail('REFERENCE_CHANGED','Pedido diferente.');if(prior?.revision!==replay.revision)fail('REFERENCE_CHANGED','Referência mudou após este pedido.');return result(prior);}
 if((prior?.revision||0)!==command.expectedRevision)fail('REFERENCE_CHANGED','Referência mudou.');
 if(command.acao==='REVOGAR'&&prior?.status!=='ATIVA')fail('REFERENCE_NOT_ACTIVE','Sem referência ativa.');
 const at=now(),row={...prior,...command.identidade,id:prior?.id||`ficticio-${rows.size+1}`,companyId,targetKey:'TRIBUTO',revision:command.expectedRevision+1,updatedBy:userId,updatedAt:at,...(command.acao==='CONFIRMAR'?{dataCivil:command.dataCivil,origem:command.origem,descricaoFonte:command.descricaoFonte.trim(),status:'ATIVA',confirmedBy:userId,confirmedAt:at}:{status:'REVOGADA'})};
 rows.set(key,row);requests.set(requestKey,{fingerprint,revision:row.revision});return result(row);
 }
 };
}
