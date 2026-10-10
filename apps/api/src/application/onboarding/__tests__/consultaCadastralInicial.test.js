import { consultarCadastroInicial, enriquecerResumoCadastral, normalizarConsultaCadastral } from '../ConsultaCadastralInicial.js';
const cnpj = '11222333000181', agora = new Date('2026-10-10T12:00:00Z');
const retorno = { ok: true, fonte: 'BRASILAPI', bruto: { cnpj, razao_social: 'Teste', municipio: 'Recife', cnae_fiscal_descricao: 'Comércio', opcao_pelo_mei: false, qsa: [{ nome_socio: 'Ana', cpf: 'não armazenar' }] } };
test('normaliza somente cadastro da empresa consultada, sem campos pessoais extras', () => {
  const r = normalizarConsultaCadastral(retorno, cnpj, agora);
  expect(r).toMatchObject({razaoSocial:'Teste',opcaoMei:false}); expect(r.socios[0]).not.toHaveProperty('cpf');
  expect(normalizarConsultaCadastral(retorno,'04252011000110',agora)).toBeNull();
});
test('valida documento antes da rede e reaproveita consulta anterior', async () => {
  const consultar = jest.fn(async()=>retorno);
  expect(await consultarCadastroInicial({cnpj:'11222333000100',consultar})).toBeNull(); expect(consultar).not.toHaveBeenCalled();
  const anterior=await consultarCadastroInicial({cnpj,consultar,agora});
  expect(await consultarCadastroInicial({cnpj,consultar,anterior,agora})).toBe(anterior); expect(consultar).toHaveBeenCalledTimes(1);
});
test('troca de CNPJ remove só valores da consulta antiga e preserva declaração do cliente', () => {
  const dados=normalizarConsultaCadastral(retorno,cnpj,agora);
  const pre=enriquecerResumoCadastral({cidade:'Olinda'},{cnpj,estado:'CONCLUIDA',dados});
  expect(pre).toMatchObject({cidade:'Olinda',atividade:'Comércio'});
  const proximo=enriquecerResumoCadastral(pre,{cnpj:'04252011000110',estado:'INDISPONIVEL'});
  expect(proximo.cidade).toBe('Olinda');expect(proximo.atividade).toBeUndefined();expect(proximo.fontesPublicas).toEqual({});
});
