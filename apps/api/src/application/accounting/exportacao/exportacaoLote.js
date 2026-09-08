import { entriesToCsv, preflightExportacao } from './exportacaoIndividual.js';
import { createHash } from 'node:crypto';

function hashDaPrevia(pedido, empresa) {
  const ordenar = itens => itens.map(i => JSON.stringify(i)).sort();
  // Não é autorização: é o recibo daquilo que o contador efetivamente conferiu.
  return createHash('sha256').update(JSON.stringify({
    id:empresa.id,cnpj:empresa.cnpj,razao:empresa.razao,
    de:pedido.competenciaInicio,ate:pedido.competenciaFim,
    quantidade:empresa.quantidade,erros:ordenar(empresa.erros),alertas:ordenar(empresa.alertas),
  })).digest('hex');
}

export function validarPedidoLote(input = {}) {
  const companyIds = [...new Set((Array.isArray(input.companyIds) ? input.companyIds : []).map(String))];
  const de = String(input.competenciaInicio || ''), ate = String(input.competenciaFim || '');
  const valid = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  const ordinal = (v) => Number(v.slice(0,4))*12 + Number(v.slice(5))-1;
  if (!companyIds.length || companyIds.length > 100 || !valid(de) || !valid(ate) || ordinal(ate)<ordinal(de) || ordinal(ate)-ordinal(de)>11) {
    throw Object.assign(new Error('Selecione de 1 a 100 empresas e um período de até 12 meses.'), { status: 400 });
  }
  const competencias=[];
  for(let n=ordinal(de);n<=ordinal(ate);n++) competencias.push(`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`);
  return {companyIds, competenciaInicio:de, competenciaFim:ate, competencias};
}

export async function prepararLote({ prisma, input, podeAcessar, gerarArquivos=false }) {
  const pedido=validarPedidoLote(input), empresas=[], arquivos=[];
  for(const id of pedido.companyIds) {
    if (!await podeAcessar(id)) { empresas.push({id,estado:'SEM_ACESSO',motivo:'Sem acesso a esta empresa.'}); continue; }
    try {
      const empresa=await prisma.portalClient.findUnique({where:{id},select:{id:true,cnpj:true,razao:true}});
      if(!empresa) {empresas.push({id,estado:'INDISPONIVEL',motivo:'Empresa não encontrada.'});continue;}
      const checks=[];
      for(const competencia of pedido.competencias) checks.push(await preflightExportacao(prisma,id,competencia,gerarArquivos));
      const erros=checks.flatMap(c=>c.erros.map(e=>({...e,competencia:c.competencia})));
      const alertas=checks.flatMap(c=>c.alertas.map(e=>({...e,competencia:c.competencia})));
      const quantidade=checks.reduce((s,c)=>s+c.totais.entries,0);
      const resultado={id,cnpj:empresa.cnpj,razao:empresa.razao,quantidade,erros,alertas,estado:erros.length?'BLOQUEADA':quantidade?'PRONTA':'SEM_MOVIMENTO'};
      resultado.preflightHash=hashDaPrevia(pedido,resultado);
      if(gerarArquivos && resultado.estado==='PRONTA') {
        if(input.preflightHashes?.[id]!==resultado.preflightHash) {
          resultado.estado='PREVIA_ALTERADA';
          resultado.motivo='A empresa, o período ou os alertas mudaram desde a prévia. Confira novamente esta empresa antes de exportar.';
        }
        else if(alertas.length && input.confirmarAlertas!==true) {resultado.estado='AGUARDA_CONFIRMACAO';}
        else if(quantidade>50000) {resultado.estado='BLOQUEADA';resultado.motivo='Mais de 50 mil lançamentos: reduza o período.';}
        else {
          // Exporta exatamente os objetos que passaram pela conferência, sem segunda leitura.
          const entries=checks.flatMap(c=>c.entries);
          const nome=`${String(empresa.cnpj||id).replace(/[^\w-]/g,'')}-${pedido.competenciaInicio}_${pedido.competenciaFim}.csv`;
          arquivos.push({nome,conteudo:'\uFEFF'+entriesToCsv(entries)});
          resultado.estado='EXPORTADA';resultado.arquivo=nome;
        }
      }
      empresas.push(resultado);
    } catch {empresas.push({id,estado:'FALHA',motivo:'Não foi possível preparar esta empresa. Tente novamente.'});}
  }
  return {ok:true,competenciaInicio:pedido.competenciaInicio,competenciaFim:pedido.competenciaFim,empresas,arquivos};
}
