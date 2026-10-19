// Métodos reais; somente persistência, certificado e HTTP são substituídos por sentinelas.
// Nenhum certificado ou provedor real é acessado.
jest.mock('../../../config.js',()=>({NFSE_ENV:'homolog',NFSE_BASE_URL:'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',NFSE_PATH:'/nfse',NFSE_CONSULT_PATH:'/nfse/consulta',NFSE_DPS_PATH:'/dps',NFSE_NFSE_PATH:'/nfse',log:{error:jest.fn(),warn:jest.fn(),info:jest.fn()}}));
jest.mock('axios',()=>({__esModule:true,default:{create:jest.fn()}}));
jest.mock('../nfseCertificado.js',()=>({resolverCertificadosDaEmpresa:jest.fn()}));
jest.mock('../nfseNumeracao.js',()=>({normalizarSerie:jest.fn(x=>x),reservarNumeracao:jest.fn()}));
jest.mock('../../../infrastructure/db/NfseRepository.js',()=>({NfseRepository:{claimRetry:jest.fn(),update:jest.fn(),updateMany:jest.fn(),create:jest.fn(),findById:jest.fn(),findByChaveAcesso:jest.fn()}}));
jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{company:{findUnique:jest.fn()},serviceInvoice:{findUnique:jest.fn(),create:jest.fn(),update:jest.fn(),updateMany:jest.fn()},$transaction:jest.fn()}}));
import axios from 'axios';
import {prisma} from '../../../infrastructure/db/prisma.js';
import {NfseRepository} from '../../../infrastructure/db/NfseRepository.js';
import {resolverCertificadosDaEmpresa} from '../nfseCertificado.js';
import {reservarNumeracao} from '../nfseNumeracao.js';
import {NfseService} from '../NfseService.js';
const config=require('../../../config.js');
const EMPRESA={id:'company-fixture',cnpj:'11222333000181',inscricaoMunicipal:'123',codigoServicoNacional:'171201',codigoServicoMunicipal:'001',rpsSerie:'1',rpsNumero:'1',codigoMunicipioIbge:'3304557',regimeTributario:'SIMPLES_NACIONAL'};
const emitir=retry=>NfseService.issue({data:{companyId:EMPRESA.id},log:config.log,...(retry?{retryInvoiceId:'tentativa'}:{})});
const cancelar=()=>NfseService.sendEvent({companyId:EMPRESA.id,chaveAcesso:'3'.repeat(50),tipoEvento:'e101101',cMotivo:'1',justificativa:'Cancelamento sintético para teste isolado.',log:config.log});
const consultar=()=>NfseService.syncFromProvider({companyId:EMPRESA.id,filters:{chaveAcesso:'3'.repeat(50)},log:config.log});
const conciliar=()=>NfseService.conciliarTentativa({companyId:EMPRESA.id,invoiceId:'tentativa'});
const metodos=[['emissão',()=>emitir(false)],['retry',()=>emitir(true)],['evento',cancelar],['consulta',consultar],['conciliação',conciliar]];
beforeEach(()=>{
 jest.clearAllMocks();Object.assign(config,{NFSE_ENV:'homolog',NFSE_BASE_URL:'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',NFSE_PATH:'/nfse'});
 prisma.company.findUnique.mockResolvedValue(EMPRESA);
 prisma.serviceInvoice.findUnique.mockResolvedValue({id:'tentativa',companyId:EMPRESA.id,status:'rejected',falhaCodigo:'E0014',idDps:'DPS-fixture',xmlDps:'<DPS/>'});
});
function semEfeitos(){
 for(const fn of [resolverCertificadosDaEmpresa,reservarNumeracao,NfseRepository.claimRetry,NfseRepository.create,NfseRepository.update,NfseRepository.updateMany,prisma.serviceInvoice.create,prisma.serviceInvoice.update,prisma.serviceInvoice.updateMany,prisma.$transaction,axios.create])expect(fn).not.toHaveBeenCalled();
}
describe.each(metodos)('%s recusa configuração antes de certificados e efeitos',(_nome,executar)=>{
 it.each([
  ['ambiente',{NFSE_ENV:'homologacao'},'NFSE_INVALID_ENV'],
  ['host produção',{NFSE_BASE_URL:'https://sefin.nfse.gov.br/SefinNacional'},'NFSE_ENV_HOST_MISMATCH'],
  ['URL insegura',{NFSE_BASE_URL:'http://sefin.producaorestrita.nfse.gov.br'},'NFSE_INVALID_BASE_URL'],
  ['path externo',{NFSE_PATH:'https://example.invalid/nfse'},'NFSE_INVALID_PATH'],
 ])('%s',async(_caso,configuracao,code)=>{
   Object.assign(config,configuracao);await expect(executar()).rejects.toMatchObject({code,antesDoPost:true});semEfeitos();
 });
});
it.each(metodos.filter(([nome])=>nome!=='conciliação'))('%s preserva erro de empresa inexistente antes da configuração',async(_nome,executar)=>{
 config.NFSE_ENV='invalido';prisma.company.findUnique.mockResolvedValue(null);
 await expect(executar()).rejects.toMatchObject({code:'COMPANY_NOT_FOUND'});semEfeitos();
});
it('conciliação recusa tentativa de outra empresa antes de configuração ou certificado',async()=>{
 config.NFSE_ENV='invalido';prisma.serviceInvoice.findUnique.mockResolvedValue({id:'tentativa',companyId:'outra'});
 await expect(conciliar()).rejects.toMatchObject({code:'NFSE_RETRY_INVOICE_NOT_FOUND'});expect(prisma.company.findUnique).not.toHaveBeenCalled();semEfeitos();
});

it('evento sem integração declara recusa anterior ao POST, sem certificado ou gravação',async()=>{
 config.NFSE_BASE_URL='';await expect(cancelar()).rejects.toMatchObject({code:'NFSE_NOT_CONFIGURED',antesDoPost:true});semEfeitos();
});
it('falha de certificado no evento é conhecida antes do POST',async()=>{
 resolverCertificadosDaEmpresa.mockRejectedValueOnce(Object.assign(new Error('A1 ausente'),{code:'NO_COMPANY_CERT'}));
 await expect(cancelar()).rejects.toMatchObject({code:'NO_COMPANY_CERT',antesDoPost:true});
 expect(axios.create).not.toHaveBeenCalled();expect(prisma.serviceInvoice.update).not.toHaveBeenCalled();
});
