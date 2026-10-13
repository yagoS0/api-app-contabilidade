import {render,screen,fireEvent,act} from '@testing-library/react';
import {DesfechoEmissao} from '../DesfechoEmissao';
import {lerErroEmissao,TIPO,desfechoMantemOFormulario} from '../lib/desfechoEmissao';
import {ApiError} from '../../../api/ApiError';
const corpo={camada:'RECEITA',codigo:'E0014',message:'O conjunto Série, Número, Município e CNPJ da DPS já existe em uma NFS-e.',correcao:'Corrija os dados e emita de novo.',numeroReutilizavel:true,nfse:{id:'tentativa'}};
it.each(['RECEITA','TRANSPORTE'])('E0014 não oferece reenvio nem token reaproveitável (%s)',camada=>{
 const d=lerErroEmissao(new ApiError(422,'nfse_rejected','rejeitada',{...corpo,camada}));
 expect(d.tipo).toBe(TIPO.DUPLICIDADE);expect(d.podeReenviar).toBe(false);expect(d.retryInvoiceId).toBeNull();expect(desfechoMantemOFormulario(d)).toBe(false);expect(d.message).toBe(corpo.message);
});
it('tela orienta recuperar existente, mantém resposta oficial e só oferece consultar lista',()=>{
 const aoCorrigir=jest.fn(),aoNovaNota=jest.fn(),aoVoltarParaNotas=jest.fn();
 render(<DesfechoEmissao desfecho={lerErroEmissao(new ApiError(422,'nfse_rejected','rejeitada',corpo))} {...{aoCorrigir,aoNovaNota,aoVoltarParaNotas}}/>);
 expect(screen.getByText(corpo.message)).toBeInTheDocument();expect(screen.getByText(/Não reenvie nem altere a numeração/)).toBeInTheDocument();
 expect(screen.getByText(/ela pode pertencer a outra operação/)).toBeInTheDocument();
 expect(screen.getByText('A numeração da DPS já está ocupada.')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Corrigir|Preencher/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Ver minhas notas'}));expect(aoVoltarParaNotas).toHaveBeenCalledTimes(1);expect(aoCorrigir).not.toHaveBeenCalled();expect(aoNovaNota).not.toHaveBeenCalled();
});
it('recusa fiscal corrigível continua distinta da duplicidade',()=>{
 const d=lerErroEmissao(new ApiError(422,'nfse_rejected','rejeitada',{...corpo,codigo:'E0625',message:'Alíquota inválida'}));
 expect(d.tipo).toBe(TIPO.RECEITA);expect(d.podeReenviar).toBe(true);
});

it.each([
 {error:'nfse_retry_nao_permitido',codigo:'NFSE_RETRY_NAO_PERMITIDO',numeroReutilizavel:false},
 {error:'nfse_rejected',camada:'RECEITA',codigo:'OUTRO',numeroReutilizavel:false},
])('servidor impede reaproveitamento sem afirmar resultado fiscal (%j)',body=>{
 const d=lerErroEmissao(new ApiError(409,body.error,'bloqueado',{...body,message:'Esta tentativa já existe ou ainda precisa ser conciliada.',nfse:{id:'original'}}));
 expect(d.tipo).toBe(TIPO.CONFERENCIA);expect(d.podeReenviar).toBe(false);expect(d.retryInvoiceId).toBeNull();
 render(<DesfechoEmissao desfecho={d} aoCorrigir={jest.fn()} aoNovaNota={jest.fn()} aoVoltarParaNotas={jest.fn()}/>);
 expect(screen.getByText('Tentativa bloqueada para conferência.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:/Corrigir|Preencher/})).not.toBeInTheDocument();
 expect(screen.queryByText(/A nota não chegou a ser enviada|O sistema nacional recusou esta nota|Nota emitida/)).not.toBeInTheDocument();
});

it.each(['RECEITA','TRANSPORTE'])('consulta resultado da tentativa sem chamar nova emissão (%s)',async camada=>{
 const consultarResultado=jest.fn(async()=>({estado:'MESMA',nfse:{id:'tentativa',numeroNfse:'42'}}));const aoRecuperar=jest.fn();const aoNovaNota=jest.fn();
 const desfecho=lerErroEmissao(new ApiError(422,'nfse_rejected','rejeitada',{...corpo,camada,codigo:camada==='TRANSPORTE'?'TIMEOUT':'E0014',message:'Conferir tentativa'}));
 render(<DesfechoEmissao companyId="empresa" desfecho={desfecho} consultarResultado={consultarResultado} aoRecuperar={aoRecuperar} aoNovaNota={aoNovaNota}/>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Consultar resultado'})));
 expect(consultarResultado).toHaveBeenCalledWith('empresa','tentativa');expect(aoRecuperar).toHaveBeenCalledTimes(1);expect(aoNovaNota).not.toHaveBeenCalled();
});
