const mockFallback=jest.fn(),mockReal=jest.fn();
jest.mock('../real/realApi',()=>({createRealApi:()=>Object.fromEntries(['login','logout','solicitarCodigoAcesso','confirmarCodigoAcesso','solicitarRedefinicao','redefinirSenha'].map(k=>[k,(...args)=>mockReal(...args)]))}));
jest.mock('../mock/mockApi',()=>({createMockApi:()=>Object.fromEntries(['login','logout','solicitarCodigoAcesso','confirmarCodigoAcesso','solicitarRedefinicao','redefinirSenha'].map(k=>[k,(...args)=>mockFallback(...args)]))}));
const previous=process.env.VITE_API_MODE;
beforeEach(()=>{jest.resetModules();jest.clearAllMocks();process.env.VITE_API_MODE='real_with_mock_fallback';mockReal.mockRejectedValue({status:0});});
afterEach(()=>{if(previous==null)delete process.env.VITE_API_MODE;else process.env.VITE_API_MODE=previous;});
test.each(['login','logout','solicitarCodigoAcesso','confirmarCodigoAcesso','solicitarRedefinicao','redefinirSenha'])('%s nunca autentica ou simula envio após falha de rede',async(method)=>{
 const {createApiClient}=require('../index');await expect(createApiClient()[method]('value')).rejects.toEqual({status:0});expect(mockFallback).not.toHaveBeenCalled();
});
