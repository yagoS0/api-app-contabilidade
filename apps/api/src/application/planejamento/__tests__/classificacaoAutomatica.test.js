import { sugerirClassificacoes, ajustarReceita } from '../../../../../../packages/shared/src/analise/classificacao.js';
import { calcularGestao, calcularCenario } from '../../../../../../packages/shared/src/analise/gestao.js';
const das={codigo:'311020001',nome:'(-) DAS- SIMPLES NACIONAL',custo:720,chaveCategoria:'deducoes'};
test('DAS reconhecido por natureza e nome exato, sem inferir tributos genéricos ou parcelas',()=>{
 expect(sugerirClassificacoes([das]).efetivas[das.codigo]).toEqual({comportamento:'VARIAVEL',prolabore:false});
 for(const conta of [{...das,nome:'Parcelamento DAS'},{...das,nome:'Multa DAS'},{...das,chaveCategoria:'tributarias'},{...das,nome:'Impostos diversos'},{...das,custo:-10}])expect(sugerirClassificacoes([conta]).automaticas).toHaveLength(0);
});
test('confirmação da empresa prevalece e sugestão incerta não habilita sozinha',()=>{
 const confirmado={[das.codigo]:{comportamento:'FIXO',prolabore:false}};
 expect(sugerirClassificacoes([das],confirmado).efetivas).toEqual(confirmado);
 const aluguel={codigo:'411020010',nome:'Aluguel de imóveis',custo:1000,chaveCategoria:'gerais'};
 const r=sugerirClassificacoes([aluguel]);expect(r.efetivas).toEqual({});expect(r.sugestoes[aluguel.codigo].confianca).toBe('MEDIA');
});
test('DRE com DAS habilita contribuição e simulação escala sem duplicar imposto',()=>{
 const dre={linhas:[{chave:'receitaBruta',valor:12000},{chave:'deducoes',contas:[{...das,valor:-720}]}]};
 const g=calcularGestao(dre);expect(g).toMatchObject({bloqueado:false,variaveis:720,contribuicao:11280});
 const a={receita:12000,variaveis:g.variaveis,fixos:0,prolabore:0,aliquota:0,tributosNosCustos:true,clientes:1};
 const b=ajustarReceita(a,13200);expect(b.variaveis).toBe(792);expect(calcularCenario(b)).toMatchObject({resultado:12408,tributos:null});
 expect(ajustarReceita(a,0).variaveis).toBe(0);
 expect(ajustarReceita({...a,receita:''},13200).variaveis).toBe(720);
});
