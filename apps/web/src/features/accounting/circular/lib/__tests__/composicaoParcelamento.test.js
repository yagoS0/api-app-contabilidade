import { aparenciaDaGuia, totaisEmAberto } from '../estadoGuia';
import { pagamentosDisponiveis, projetarPendenciasContabeis, sinalizarPendenciaFechamento } from '../../../../../../../../packages/shared/src/fiscal/pendenciasContabeis.js';
const origem = statusContrato => ({ id:'pis',tipo:'PROVISAO',subtipo:'PIS',competencia:'2026-01',statusPagamento:'ABERTO',saldo:100,parcelamentoOrigem:{id:'origem',parcelamentoId:'acordo',statusContrato,principalIncluido:100} });
test.each([['ATIVO','Parcelado','PARCELADO'],['QUITADO','Quitado no acordo','PAGO'],['RESCINDIDO','A conciliar','A_CONCILIAR'],['EXCLUIDO','A conciliar','A_CONCILIAR']])('estado %s permanece coerente entre Circular, pagamento e situação fiscal', (status,label,estado) => {
 const e=sinalizarPendenciaFechamento(origem(status),{'2026-02':{fechadoEm:'2026-03-01'}});
 expect(e.pendenciaFechamento).toBe(false);
 expect(aparenciaDaGuia(e).rotulo).toBe(label);
 expect(pagamentosDisponiveis([e],'2026-10')).toEqual([]);
 expect(totaisEmAberto([e])).toEqual({aVencer:0,vencido:0,parcial:0,semData:0});
 const p=projetarPendenciasContabeis([e])[0];
 expect(p).toMatchObject({estado,fonte:'CONTABILIDADE',saldo:null});
 if(estado==='A_CONCILIAR')expect(p.total).toBeNull();
});
