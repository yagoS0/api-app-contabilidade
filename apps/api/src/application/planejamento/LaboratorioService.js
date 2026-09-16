import { calcularCenario, validarPremissas, VERSAO_GESTAO } from '../../../../../packages/shared/src/analise/gestao.js';

export function prepararCenario(body) {
  if (!body || typeof body.nome!=='string' || !body.nome.trim() || body.nome.length>120 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.periodo)) throw new Error('Informe nome e mês de referência válidos.');
  const a=validarPremissas(body.a), b=validarPremissas(body.b);
  return { nome:body.nome.trim(), periodo:body.periodo, versao:VERSAO_GESTAO, entradasJson:{a,b}, resultadoJson:{a:calcularCenario(a),b:calcularCenario(b)}, origemJson:{tipo:body.companyId?'EMPRESA_COM_PREMISSAS':'FICTICIA', declaracaoAutor:typeof body.procedencia==='string'?body.procedencia.slice(0,1000):'Premissas manuais.', nota:'Premissas conferidas pelo autor; resultado calculado pelo servidor. Não é apuração tributária.'} };
}

export async function podeUsarEmpresa(client,user,companyId) {
  if (!companyId) return true;
  if (String(user.role).toLowerCase()==='admin') return !!await client.portalClient.findUnique({where:{id:companyId},select:{id:true}});
  const acesso=await client.companyFirmAccess.findUnique({where:{companyId_userId:{companyId,userId:user.id}},select:{status:true,role:true}});
  return acesso?.status==='ACTIVE'&&['ACCOUNTANT','FIRM_ADMIN'].includes(acesso.role);
}

export async function salvarCenario({client,user,body}) {
  const dados=prepararCenario(body),companyId=body.companyId||null;
  if (!await podeUsarEmpresa(client,user,companyId)) { const e=new Error('Sem permissão para esta empresa.');e.status=403;throw e; }
  // Append-only: salvar uma edição cria outra foto. Nenhum cadastro ou lançamento é alterado.
  return client.laboratorioCenario.create({data:{...dados,companyId,autorId:user.id}});
}

export async function listarCenarios({client,user}) {
  const registros=await client.laboratorioCenario.findMany({where:{autorId:user.id},orderBy:{createdAt:'desc'},take:100});
  const ids=[...new Set(registros.map(r=>r.companyId).filter(Boolean))];
  const permitidos=new Set();
  if (String(user.role).toLowerCase()==='admin') ids.forEach(id=>permitidos.add(id));
  else if(ids.length) {
    const links=await client.companyFirmAccess.findMany({where:{userId:user.id,companyId:{in:ids},status:'ACTIVE',role:{in:['ACCOUNTANT','FIRM_ADMIN']}},select:{companyId:true}});
    links.forEach(l=>permitidos.add(l.companyId));
  }
  return registros.filter(r=>!r.companyId||permitidos.has(r.companyId));
}
