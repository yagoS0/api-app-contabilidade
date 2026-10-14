import { aplicarConsultaEmpresaPreservandoEdicoes } from '../renderCompanyForm';
test('retorno cadastral não sobrescreve edição feita durante a consulta nem apaga campo por ausência',()=>{
  const onChange=jest.fn();
  aplicarConsultaEmpresaPreservandoEdicoes({razao_social:'DA CONSULTA',logradouro:'RUA NOVA'},
    {razaoSocial:'',enderecoRua:'',enderecoNumero:'12'},
    {razaoSocial:'DIGITADO',enderecoRua:'',enderecoNumero:'12'},onChange);
  expect(onChange).not.toHaveBeenCalledWith('razaoSocial','DA CONSULTA');
  expect(onChange).not.toHaveBeenCalledWith('enderecoNumero','');
});
