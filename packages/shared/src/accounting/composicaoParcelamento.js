/** Resumo textual; IDs e valores permanecem na composição estruturada. */
export function resumoOrigensParcelamento(origens) {
 const grupos=new Map();
 for(const o of origens || []) {
  const comp=String(o.competencia || ''), tributo=String(o.tributo || 'Tributo');
  // Período trimestral explícito permanece trimestral. Não inferir mensalização.
  if(!/^\d{4}-(0[1-9]|1[0-2]|T[1-4])$/.test(comp)) {
   const chave=tributo+'|';
   if(!grupos.has(chave))grupos.set(chave,new Set());
   grupos.get(chave).add(comp || 'competência não informada');
   continue;
  }
  const chave=tributo+'|'+comp.slice(0,4);
  if(!grupos.has(chave)) grupos.set(chave,new Set());grupos.get(chave).add(comp.slice(5));
 }
 return [...grupos].sort(([a],[b])=>a.localeCompare(b)).map(([chave,meses])=>{const [tributo,ano]=chave.split('|');return tributo+' — '+[...meses].sort().join(',')+(ano?'/'+ano:'');}).join('; ');
}
export function tratamentoOrigemParcelamento(origem) {
 if(!origem) return null;
 const status=origem.statusContrato;
 return status==='ATIVO' ? 'PARCELADO' : status==='QUITADO' ? 'QUITADO_NO_ACORDO' : 'A_CONCILIAR';
}

export function historicoOrigensParcelamento(origens, numero) {
 const completo='PARCELAMENTO Nº '+String(numero || '')+' — '+resumoOrigensParcelamento(origens);
 return completo.length<=220?completo:completo.slice(0,195)+'… (ver composição)';
}
