// Local demonstration state only; no transport, worker adoption or legacy selection.
const taxes=['SIMPLES','IRPJ','CSLL','PIS','COFINS','ISS','INSS','FGTS','PARCELAMENTO'];
const copy=value=>JSON.parse(JSON.stringify(value)), companies=new Map(), requests=new Map();
let global={version:0,defaults:{},tributos:{}};
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const get=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
const fields={captura:['enabled','businessDaysBefore','hour'],'lembretes.before':['enabled','businessDays','hour'],'lembretes.onDue':['enabled','hour'],'lembretes.after':['enabled','businessDays','hour']};
function leaves(object,prefix='') {return Object.entries(object).flatMap(([key,value])=>value!==null&&typeof value==='object'&&!Array.isArray(value)?leaves(value,prefix+key+'.'):[[prefix+key,value]]);}
function merge(base,patch) {const out=copy(base);for(const [key,value] of Object.entries(patch)){if(value===null)delete out[key];else if(typeof value==='object')out[key]=merge(out[key]||{},value);else out[key]=value;}return out;}
export function mockValidarAgendaEventosPatch(patch) {
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||!leaves(patch).length)throw fail('Parâmetros vazios ou inválidos.',422);
  const actionShape={captura:{enabled:1,businessDaysBefore:1,hour:1},lembretes:{before:{enabled:1,businessDays:1,hour:1},onDue:{enabled:1,hour:1},after:{enabled:1,businessDays:1,hour:1}}};
  const shape={defaults:actionShape,tributos:Object.fromEntries(taxes.map(tax=>[tax,actionShape]))};
  function validateNodes(value,definition){
    if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)throw fail('Grupo de parâmetros inválido.',422);
    for(const [key,child] of Object.entries(value)){
      if(!Object.prototype.hasOwnProperty.call(definition,key))throw fail('Campo de configuração inválido.',422);
      if(definition[key]!==1)validateNodes(child,definition[key]);
      else if(child!==null&&typeof child==='object')throw fail('Valor de parâmetro inválido.',422);
    }
  }
  validateNodes(patch,shape);
  for(const [path,value] of leaves(patch)) {
    const parts=path.split('.'),scope=parts.shift();if(scope==='tributos'&&!taxes.includes(parts.shift())||!['tributos','defaults'].includes(scope))throw fail('Imposto inválido.',422);
    const field=parts.pop(),action=parts.join('.');if(!fields[action]?.includes(field))throw fail('Campo de configuração inválido.',422);
    if(value!==null&&(field==='enabled'?typeof value!=='boolean':!Number.isInteger(value)||value<(field==='hour'?0:1)||value>(field==='hour'?23:31)))throw fail('Valor de parâmetro inválido.',422);
  }
  return copy(patch);
}
export function mockLerAgendaEventos(companyId) {
  const config=companyId?(companies.get(companyId)||{version:0,defaults:{},tributos:{}}):global;
  const revision=JSON.stringify([global.version,companyId||null,config.version,config.defaults,config.tributos]);
  const common={schemaVersion:1,version:config.version,configured:config.version>0,revision,timezone:'America/Sao_Paulo',executionMode:'LEGADO',relativeConsumerReady:true,capabilities:{contractVersion:1,reminders:true,paymentD2:true,capture:false},prepared:true};
  if(!companyId)return {...common,defaults:copy(config.defaults),tributos:copy(config.tributos)};
  const effective={},origins={},inherited={},inheritedOrigins={};
  for(const tax of taxes){effective[tax]={};for(const [action,keys] of Object.entries(fields))for(const field of keys){const path=action+'.'+field;let value;let origin;
    let inheritedValue,inheritedOrigin;
    for(const [source,label] of [[global.defaults,'GLOBAL_DEFAULT'],[global.tributos[tax],'GLOBAL_TRIBUTO'],[config.defaults,'EMPRESA_DEFAULT'],[config.tributos[tax],'EMPRESA_TRIBUTO']])if(get(source,path)!==undefined){value=get(source,path);origin=label;if(label!=='EMPRESA_TRIBUTO'){inheritedValue=value;inheritedOrigin=label;}}
    if(inheritedValue!==undefined){const branch={};let node=branch;const parts=path.split('.');for(const key of parts.slice(0,-1))node=node[key]={};node[parts.at(-1)]=inheritedValue;inherited[tax]=merge(inherited[tax]||{},branch);(inheritedOrigins[tax]??={})[path]=inheritedOrigin;}
    if(value!==undefined){const branch={};let node=branch;const parts=path.split('.');for(const key of parts.slice(0,-1))node=node[key]={};node[parts.at(-1)]=value;effective[tax]=merge(effective[tax],branch);(origins[tax]??={})[path]=origin;}
  }}
  return {...common,globalRevision:mockLerAgendaEventos().revision,overrides:{schemaVersion:1,defaults:copy(config.defaults),tributos:copy(config.tributos)},effective,origins,inherited,inheritedOrigins};
}
export function mockSalvarAgendaEventos(companyId,{expectedRevision,requestId,patch}) {
  const validated=mockValidarAgendaEventosPatch(patch),identity=JSON.stringify([companyId,expectedRevision,validated]);
  const replay=requests.get(requestId);if(replay){if(replay.identity!==identity||mockLerAgendaEventos(companyId).revision!==replay.result.revision)throw fail('Solicitação ou configuração alterada.');return copy(replay.result);}
  if(typeof requestId!=='string'||!requestId||mockLerAgendaEventos(companyId).revision!==expectedRevision)throw fail('Recarregue a configuração antes de salvar.');
  const current=companyId?(companies.get(companyId)||{version:0,defaults:{},tributos:{}}):global;
  const next={...merge(current,validated),version:current.version+1};if(companyId)companies.set(companyId,next);else global=next;
  const result=mockLerAgendaEventos(companyId);requests.set(requestId,{identity,result});return copy(result);
}
