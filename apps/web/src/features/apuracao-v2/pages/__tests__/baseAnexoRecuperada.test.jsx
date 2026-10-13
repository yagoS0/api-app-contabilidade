import { render, screen, waitFor } from '@testing-library/react';
import { ApuracaoV2Tab } from '../renderApuracaoV2Tab';
const fatorR = [{idAtividade:11,anexoImplicito:'III',sujeitoFatorR:true}];
const semFatorR = [{idAtividade:14,anexoImplicito:'III',sujeitoFatorR:false}];
const recuperavel = (atividades=fatorR, folhaMensal12=[{pa:'2026-06',valor:6000},{pa:'2026-07',valor:6000},{pa:'2026-08',valor:6000}]) => ({calculoId:'validado',rbt12:60000,dasValor:777.61,formulario:{atividades,folhaMensal12,regimeApuracao:'COMPETENCIA'}});
function abrir(calculoRecuperavel, extra={}) {
 const api={
  getFechamento:jest.fn(async()=>({dados:{atividades:fatorR,rbt12:1000000,faturamento:{total:10000},calculoRecuperavel,...extra}})),
  getApuracaoSnapshot:jest.fn(async()=>({snapshot:{folha12m:null,dasSimuladoSerpro:777.61,estado:'calculada'}})),
  getRelatorioFaturamento:jest.fn(async()=>({relatorio:null})),
  calcularFechamento:jest.fn(),syncPgdasCircular:jest.fn(),
 };
 render(<ApuracaoV2Tab api={api} companyId="sintetica" competencia="2026-09" panel={{pendencias:[]}} feedback={{}}/>);
 return api;
}
it('card usa folha e RBT12 do cálculo validado, sem consulta nem recálculo',async()=>{
 const api=abrir(recuperavel());await screen.findByText(/Fator R desta competência/);
 expect(screen.queryByText(/folha de 12 meses não foi informada/)).not.toBeInTheDocument();
 expect(screen.getByText(/Fator R desta competência/).textContent).toMatch(/30,00%/);
 expect(api.calcularFechamento).not.toHaveBeenCalled();expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});
it('atividade validada sem Fator R substitui sugestão de Fator R e não exibe razão irrelevante',async()=>{
 abrir(recuperavel(semFatorR));await screen.findByText(/Anexo III/);
 expect(screen.queryByText(/folha de 12 meses não foi informada/)).not.toBeInTheDocument();
 expect(screen.queryByText(/Fator R desta competência/)).not.toBeInTheDocument();
});
it('cálculo desatualizado/legado readonly não fornece base corrente ao card',async()=>{
 abrir(null,{calculoSalvo:recuperavel(),calculoRecuperacaoMotivo:'Dados alterados'});
 await screen.findByText(/folha de 12 meses não foi informada/);
 expect(screen.queryByText(/Fator R desta competência/)).not.toBeInTheDocument();
});
it('zero explicitamente informado continua válido, sem NaN',async()=>{
 abrir(recuperavel(fatorR,[{pa:'2026-08',valor:0}]));await screen.findByText(/Fator R desta competência/);
 expect(screen.getByText(/Fator R desta competência/).textContent).toMatch(/0,00%/);
 expect(document.body.textContent).not.toContain('NaN');expect(screen.queryByText(/folha de 12 meses não foi informada/)).not.toBeInTheDocument();
});
it.each([{folha:[]},{folha:[{pa:'2026-08',valor:null}]},{folha:[{pa:'2026-08',valor:'inválido'}]}])('folha ausente ou inválida não vira zero (%j)',async ({folha})=>{
 abrir(recuperavel(fatorR,folha));await screen.findByText(/folha de 12 meses não foi informada/);
 await waitFor(()=>expect(screen.queryByText(/Fator R desta competência/)).not.toBeInTheDocument());
});
