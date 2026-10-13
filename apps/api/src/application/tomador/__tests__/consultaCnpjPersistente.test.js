import { criarConsultaCnpjPersistente } from '../consultaCnpjPersistente.js';
const CNPJ='11222333000181';
const sucesso={ok:true,cnpj:CNPJ,fonte:'BRASILAPI',bruto:{cnpj:CNPJ,razao_social:'TESTE',logradouro:'RUA',bairro:'CENTRO',municipio:'RIO',uf:'RJ',cep:'20040020',qsa:[{nome_socio:'SOCIO'}]}};
const ctx={escopo:'empresa:1',finalidade:'EMISSOR'};
function setup(extra={}) {
  const gratuito=jest.fn().mockResolvedValue(sucesso);
  const repositorio={precosPersistidos:true,adquirir:jest.fn().mockResolvedValue({chave:'x',lease:'y'}),salvar:jest.fn(),liberar:jest.fn().mockResolvedValue(),reservar:jest.fn().mockResolvedValue({autorizada:true,id:'r'}),concluir:jest.fn()};
  const serproBasica={consultar:jest.fn().mockResolvedValue({...sucesso,tomador:{nome:'TESTE'}})};
  return {gratuito,repositorio,serproBasica,consultar:criarConsultaCnpjPersistente({gratuito,repositorio,serproBasica,...extra})};
}
test('sucesso gratuito grava cache sem sócios para emissor e sem reserva paga',async()=>{
  const s=setup(); const r=await s.consultar(CNPJ,ctx);
  expect(r.bruto.qsa).toBeUndefined(); expect(s.repositorio.reservar).not.toHaveBeenCalled();
  expect(s.repositorio.salvar).toHaveBeenCalledWith({chave:'x',lease:'y'},expect.objectContaining({ok:true}),30*86400000);
});
test('cache é reutilizado sem fornecedores, mas tomador é validado com a lista IBGE atual',async()=>{
  const s=setup();s.repositorio.adquirir.mockResolvedValue({cache:true,resultado:{...sucesso,tomador:{endereco:{cMun:'inventado'}}}});
  const r=await s.consultar(CNPJ,ctx);expect(r.cache).toBe(true);expect(r.tomador.endereco).toBeNull();expect(s.gratuito).not.toHaveBeenCalled();
});
test('concorrência ocupada não dispara novas consultas',async()=>{
  const s=setup();s.repositorio.adquirir.mockResolvedValue({ocupado:true});
  expect((await s.consultar(CNPJ,ctx)).motivo).toBe('consulta_em_andamento');expect(s.gratuito).not.toHaveBeenCalled();
});
test('banco indisponível permite somente gratuito mesmo com pago configurado',async()=>{
  const s=setup({habilitarPago:true});s.repositorio.adquirir.mockRejectedValue(new Error('db'));
  expect((await s.consultar(CNPJ,ctx)).ok).toBe(true);expect(s.serproBasica.consultar).not.toHaveBeenCalled();expect(s.repositorio.reservar).not.toHaveBeenCalled();
});
test('pago desabilitado permanece assim quando gratuitas falham',async()=>{
  const s=setup();s.gratuito.mockResolvedValue({ok:false,motivo:'timeout'});
  await s.consultar(CNPJ,ctx);expect(s.serproBasica.consultar).not.toHaveBeenCalled();
  expect(s.repositorio.salvar.mock.calls[0][2]).toBe(60000);
});
test('composição habilitada só usa Básica após gratuita e reserva',async()=>{
  const s=setup({habilitarPago:true});s.gratuito.mockResolvedValue({ok:false,motivo:'timeout'});
  expect((await s.consultar(CNPJ,ctx)).fonte).toBe('SERPRO_BASICA');
  expect(s.gratuito.mock.invocationCallOrder[0]).toBeLessThan(s.repositorio.reservar.mock.invocationCallOrder[0]);
  expect(s.repositorio.reservar.mock.invocationCallOrder[0]).toBeLessThan(s.serproBasica.consultar.mock.invocationCallOrder[0]);
});
test('formulário público nunca autoriza pago e não recebe sócios',async()=>{
  const s=setup({habilitarPago:true});const r=await s.consultar(CNPJ,{...ctx,finalidade:'PUBLICO'});
  expect(r.bruto.qsa).toBeUndefined();expect(s.repositorio.reservar).not.toHaveBeenCalled();
});
test('cadastro usa Empresa depois do gratuito e mantém cache distinto',async()=>{
  const empresa={consultar:jest.fn().mockResolvedValue({...sucesso,tomador:{nome:'TESTE'},fonte:'SERPRO_EMPRESA'})};
  const s=setup({habilitarPago:true,serproEmpresa:empresa});
  const r=await s.consultar(CNPJ,{...ctx,finalidade:'CADASTRO'});
  expect(r.bruto.qsa).toEqual(sucesso.bruto.qsa);expect(r.fonte).toBe('SERPRO_EMPRESA');
  expect(s.repositorio.adquirir).toHaveBeenCalledWith(expect.objectContaining({modalidade:'EMPRESA'}));
  expect(s.repositorio.reservar).toHaveBeenCalledWith(expect.objectContaining({modalidade:'EMPRESA',finalidade:'CADASTRO'}));
  expect(s.gratuito.mock.invocationCallOrder[0]).toBeLessThan(empresa.consultar.mock.invocationCallOrder[0]);
});
test('falha ao cifrar/salvar preserva retorno sem repetir provedor',async()=>{
  const s=setup();s.repositorio.salvar.mockRejectedValue(new Error('cofre'));
  expect((await s.consultar(CNPJ,ctx)).ok).toBe(true);expect(s.gratuito).toHaveBeenCalledTimes(1);expect(s.repositorio.liberar).toHaveBeenCalledTimes(1);
});
test.each(['12345678000190','123','A11222333000181'])('documento inválido não usa banco/rede: %s',async doc=>{
  const s=setup();expect((await s.consultar(doc,ctx)).ok).toBe(false);expect(s.repositorio.adquirir).not.toHaveBeenCalled();expect(s.gratuito).not.toHaveBeenCalled();
});
