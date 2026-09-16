import { validarBaseSocios,resumirSocios } from '../../../../../../packages/shared/src/analise/socios.js';
const base={id:2,competencia:'2026-08',prolaborePago:1000,distribuicaoPaga:2000,outrasRetiradas:300,fonte:'Conferência de comprovantes do mês',confirmado:true};
test('não registra ausência como zero nem aceita declaração sem confirmação e fonte',()=>{
 expect(()=>validarBaseSocios({...base,confirmado:false})).toThrow();
 expect(()=>validarBaseSocios({...base,fonte:''})).toThrow();
 expect(()=>validarBaseSocios({...base,prolaborePago:''})).toThrow();
 expect(validarBaseSocios({...base,prolaborePago:0}).prolaborePago).toBe(0);
});
test('pró-labore não é descontado novamente do resultado',()=>{
 expect(resumirSocios([base],['2026-08'],5000)).toMatchObject({completo:true,total:3300,resultadoMenosDistribuicao:3000});
});
test('lacuna mensal impede total e versão mais recente vence',()=>{
 expect(resumirSocios([base],['2026-07','2026-08'],5000)).toEqual({completo:false,faltas:['2026-07']});
 expect(resumirSocios([base,{...base,id:1,distribuicaoPaga:100}],['2026-08'],5000).distribuicao).toBe(2000);
});
