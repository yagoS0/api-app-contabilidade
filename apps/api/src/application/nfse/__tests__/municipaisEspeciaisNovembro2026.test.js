import { prepararDpsNovembro2026Offline } from '../laboratorio/dpsNovembro2026.js';
import { xmlBase } from './fixtures/dpsNovembro2026.js';
const par={prestador:'39254243000191',ambiente:'homologacao',municipio:'3304557',codigoServicoNacional:'170601',codigoServicoMunicipal:'001',conferido:true,referencia:'consulta-sintetica-conferida',vigenciaInicio:'2026-01-01',vigenciaFim:null,convenioAtivo:true,admiteValor:true,admitePercentual:true,admiteDocumentos:true,aliquotaIss:'5.00'};
const contexto=parametros=>({municipioIncidencia:'3304557',parametros:{...par,...parametros}});
const ajuste=a=>xmlBase.replace('</vServPrest>','</vServPrest><vAjusteBC>'+a+'</vAjusteBC>');
const valor='<vAjusteBCISSQN>0.20</vAjusteBCISSQN>';
const doc=(tipo='104',v='0.20')=>`<docAjusteBC><tpAjusteBC>${tipo}</tpAjusteBC><vTotDoc>1.00</vTotDoc><vAjusteAplic>${v}</vAjusteAplic><dFeNacional><tipoChaveDFe>1</tipoChaveDFe><chaveDFe>${'1'.repeat(50)}</chaveDFe></dFeNacional></docAjusteBC>`;
const docs=(...d)=>'<documentos>'+d.join('')+'</documentos>';
const run=(xml=ajuste(valor),parametros={},extra={})=>prepararDpsNovembro2026Offline({xmlBase:xml,contrato:'NT009_V1_01_NOVEMBRO_2026',contextoMunicipal:contexto(parametros),...extra});
const recusa=(f,code)=>expect(f).toThrow(expect.objectContaining({code}));
test('parâmetros vinculados e vigentes conferem a base sem liberar emissão',()=>{
 const r=run();expect(r.municipal).toMatchObject({estado:'CONFERIDO_LOCALMENTE',ajusteISS:'0.20',ajusteIBSCBS:'0.00',baseISSAntesBeneficio:'0.80'});expect(r.liberadoParaEmissao).toBe(false);
});
test('data da consulta não substitui vigência e ausência fica pendente',()=>{
 expect(run(undefined,{}, {contextoMunicipal:undefined}).municipal.estado).toBe('PENDENTE');
 recusa(()=>run(undefined,{vigenciaInicio:undefined,consultadoEm:'2026-11-03'}),'PARAMETROS_VIGENCIA_NAO_CONFIRMADA');
});
test.each([
 ['prestador','11222333000181'],['ambiente','producao'],['municipio','3550308'],['codigoServicoNacional','171901'],['codigoServicoMunicipal','002'],
])('recusa parâmetros de outro escopo: %s',(k,v)=>recusa(()=>run(undefined,{[k]:v}),'PARAMETROS_ESCOPO_DIVERGENTE'));
test.each([{vigenciaInicio:'2026-11-04'},{vigenciaFim:'2026-11-02'},{vigenciaInicio:'2026-02-30'},{conferido:false},{referencia:''}])('recusa referência/vigência inconsistente %#',p=>recusa(()=>run(undefined,p),'PARAMETROS_VIGENCIA_NAO_CONFIRMADA'));
test('ausência de permissão não equivale a autorização',()=>expect(run(undefined,{admiteValor:undefined}).municipal).toMatchObject({estado:'PENDENTE',pendencias:['ADMISSAO_VALOR_AUSENTE']}));
test.each([[valor,{admiteValor:false},'E0446'],['<pAjusteBCISSQN>20</pAjusteBCISSQN>',{admitePercentual:false},'E0454']])('respeita vedação municipal %#',(a,p,c)=>recusa(()=>run(ajuste(a),p),c));
test('percentual aplica sobre serviço menos desconto, com centavos exatos',()=>{
 const xml=ajuste('<pAjusteBCISSQN>50.00</pAjusteBCISSQN>').replace('<vAjusteBC>','<vDescCondIncond><vDescIncond>0.33</vDescIncond></vDescCondIncond><vAjusteBC>');
 expect(run(xml).municipal).toMatchObject({ajusteISS:'0.34',baseISSAntesBeneficio:'0.33'});
});
test.each([
 ['<opSimpNac>3','<opSimpNac>2','E0436'],['<regEspTrib>0','<regEspTrib>1','E0445'],['<tribISSQN>1','<tribISSQN>2','E0435']
])('veda ajuste incompatível com enquadramento %#',(a,b,c)=>recusa(()=>run(ajuste(valor).replace(a,b)),c));
test('documento excepcional não libera ajuste direto misturado em imunidade',()=>{
 const xml=ajuste(valor+docs(doc())).replace('<tribISSQN>1','<tribISSQN>2');recusa(()=>run(xml),'E0435');
});
test('documentos excepcionais têm repercussão diferente para ISS e IBS',()=>{
 const xml=ajuste(docs(doc('104'),doc('105')));
 expect(run(xml,{admiteDocumentos:false}).municipal).toMatchObject({ajusteISS:'0.00',ajusteIBSCBS:'0.40',baseISSAntesBeneficio:'1.00'});
 expect(run(xml).municipal).toMatchObject({ajusteISS:'0.20',ajusteIBSCBS:'0.40',baseISSAntesBeneficio:'0.80'});
});
test('documento comum exige admissão municipal e somatórios não podem tornar base negativa',()=>{
 recusa(()=>run(ajuste(docs(doc('2'))),{admiteDocumentos:false}),'AJUSTE_DOCUMENTAL_MUNICIPAL_VEDADO');
 recusa(()=>run(ajuste(docs(doc('104','0.60'),doc('103','0.60')))),'E0427');
 recusa(()=>run(ajuste(docs(doc('104','0.60'),doc('103','0.60'))),{admiteDocumentos:false}),'BASE_IBSCBS_NEGATIVA');
});
test('não usa parâmetro de operação 17.05 no município divergente',()=>{
 const xml=ajuste(valor).replace('170601','170501');
 expect(run(xml,{codigoServicoNacional:'170501'}).municipal.municipio).toBe('3304557');
 recusa(()=>run(xml,{codigoServicoNacional:'170501',municipio:'3550308'}),'PARAMETROS_ESCOPO_DIVERGENTE');
});
test('Simples fora da lista não ganha autorização apenas com parâmetro permissivo',()=>recusa(()=>run(ajuste(valor).replace('170601','171901'),{codigoServicoNacional:'171901'}),'E0455'));
test('não optante depende de convênio e respeita limite de carga de dois por cento',()=>{
 const xml=v=>ajuste(`<vAjusteBCISSQN>${v}</vAjusteBCISSQN>`).replace('<opSimpNac>3','<opSimpNac>1').replace('170601','171901');
 recusa(()=>run(xml('0.20'),{codigoServicoNacional:'171901',convenioAtivo:false}),'E0449');
 recusa(()=>run(xml('0.61'),{codigoServicoNacional:'171901'}),'E0447');
 expect(run(xml('0.60'),{codigoServicoNacional:'171901'}).municipal.baseISSAntesBeneficio).toBe('0.40');
});
const exterior='<comExt><mdPrestacao>1</mdPrestacao><vincPrest>0</vincPrest><tpMoeda>220</tpMoeda><vServMoeda>1.00</vServMoeda><mecAFComexP>01</mecAFComexP><mecAFComexT>01</mecAFComexT><movTempBens>1</movTempBens><mdic>0</mdic></comExt>';
const comExt=x=>xmlBase.replace('</cServ>','</cServ>'+x);
test('comércio exterior preserva dados, admite modo 5 e pede confirmação da parcela',()=>{
 const r=run(comExt(exterior.replace('<mdPrestacao>1','<mdPrestacao>5')));expect(r.comercioExterior.pendencias).toContain('PARCELA_CONSUMIDA_NO_PAIS_OU_EXPORTADA');expect(r.comercioExterior.pendencias).toContain('MOEDA_BCB_POR_COMPETENCIA');expect(r.xml).toContain('<vServ>1.00</vServ>');
});
test.each([
 ['<mdPrestacao>1','<mdPrestacao>0','E0333'],['<mecAFComexP>01','<mecAFComexP>00','E0341'],['<mecAFComexT>01','<mecAFComexT>00','E0343'],['<movTempBens>1','<movTempBens>0','E0345'],['<movTempBens>1','<movTempBens>2','E0352'],['<movTempBens>1','<movTempBens>3','E0356'],['<tpMoeda>220','<tpMoeda>ABC','MOEDA_FORMATO_INVALIDO'],['</movTempBens>','</movTempBens><nDUIMP>123456789012345</nDUIMP>','E0354']
])('recusa comércio exterior inconsistente %#',(a,b,c)=>recusa(()=>run(comExt(exterior.replace(a,b))),c));
test('não renomeia documento antigo para DUIMP',()=>recusa(()=>run(comExt(exterior.replace('</mdic>','</mdic><nDI>123</nDI>'))),'CENARIO_NAO_PREPARADO'));
test('DUIMP declarada e ajuste negativo são preservados',()=>{
 const xml=comExt(exterior.replace('<movTempBens>1</movTempBens>','<movTempBens>2</movTempBens><nDUIMP>123456789012345</nDUIMP>')).replace('</vServPrest>','</vServPrest><vAjusteBC><vAjusteBCIBSCBSComExt>-0.05</vAjusteBCIBSCBSComExt></vAjusteBC>');
 expect(run(xml).xml).toContain('<vAjusteBCIBSCBSComExt>-0.05</vAjusteBCIBSCBSComExt>');
});
test('moeda exige vigência única da referência BCB',()=>{
 const referenciaMoedas={fonte:'BCB',referencia:'tabela-sintetica',moedas:[{codigo:'220',inicio:'2026-01-01',fim:null}]};
 expect(run(comExt(exterior),{}, {referenciaMoedas}).comercioExterior.pendencias).not.toContain('MOEDA_BCB_POR_COMPETENCIA');
 recusa(()=>run(comExt(exterior),{}, {referenciaMoedas:{...referenciaMoedas,moedas:[{codigo:'220',inicio:'2026-11-04'}]}}),'MOEDA_VIGENCIA_INVALIDA');
 recusa(()=>run(comExt(exterior),{}, {referenciaMoedas:{...referenciaMoedas,moedas:[...referenciaMoedas.moedas,...referenciaMoedas.moedas]}}),'MOEDA_VIGENCIA_INVALIDA');
});
test('exportação sem comExt é recusada; ajuste exterior isolado também',()=>{
 recusa(()=>run(xmlBase.replace('<tribISSQN>1','<tribISSQN>3')),'E0330');
 recusa(()=>run(ajuste('<vAjusteBCIBSCBSComExt>0.05</vAjusteBCIBSCBSComExt>')),'AJUSTE_EXTERIOR_SEM_COMEXT');
});
const imobiliario=(codigo,grupos)=>xmlBase.replace('170601',codigo).replace('<indDest>0</indDest>','<indDest>0</indDest>'+grupos);
const condominio='<imovel><cMun>3304557</cMun></imovel><condominios><dVencOrig>2026-11-10</dVencOrig><gCobranca><tpCobranca>01</tpCobranca><vCobranca>1.00</vCobranca></gCobranca></condominios>';
const locacao='<imovel><cMun>3304557</cMun><gLocacao><pCopropriedade>50.00</pCopropriedade><vTotOper>2.00</vTotOper></gLocacao></imovel>';
const locXml=imobiliario('990301',locacao).replace('114061100','110021000');
test('locação conserva proporção e valores sem calcular tributo definitivo',()=>{
 const r=run(locXml);expect(r.imoveis).toMatchObject({estado:'CONFERIDO_LOCALMENTE',tipo:'LOCACAO'});expect(r.xml).toContain('<vServ>1.00</vServ>');expect(r.liberadoParaEmissao).toBe(false);
});
test.each([
 ['50.00</pCopropriedade>','100.01</pCopropriedade>','E0940'],
 ['2.00</vTotOper>','3.00</vTotOper>','VALOR_COPROPRIEDADE_DIVERGENTE'],
 ['110021000','114061100','NBS_LOCACAO_INVALIDA'],
 ['<imovel><cMun>3304557','<imovel><cMun>9999999','E0929'],
])('recusa locação inconsistente %#',(a,b,c)=>recusa(()=>run(locXml.replace(a,b)),c));
test('desconto da copropriedade precisa corresponder ao total',()=>{
 const xml=locXml.replace('</vTotOper>','</vTotOper><vDescIncondTot>0.40</vDescIncondTot>').replace('</vServPrest>','</vServPrest><vDescCondIncond><vDescIncond>0.20</vDescIncond></vDescCondIncond>');
 expect(run(xml).imoveis.tipo).toBe('LOCACAO');recusa(()=>run(xml.replace('0.20</vDescIncond>','0.21</vDescIncond>')),'DESCONTO_COPROPRIEDADE_DIVERGENTE');
});
test('redutor social é exclusivo de NBS residencial',()=>{
 const unidade='<gUnidImob><cCIB>12345678</cCIB><gAjusteBCLocImoveis><tpAjusteBCLocImoveis>04</tpAjusteBCLocImoveis><vAjusteBCLocImoveis>0.30</vAjusteBCLocImoveis></gAjusteBCLocImoveis></gUnidImob>';
 const xml=locXml.replace('</imovel>',unidade+'</imovel>');expect(run(xml).imoveis.pendencias).toContain('CIB_DV_E_CADASTRO');recusa(()=>run(xml.replace('110021000','110022000')),'E0944');
});
test('condomínio confere soma das cobranças e ordena grupo conforme leiaute',()=>{
 const r=run(imobiliario('990501',condominio));expect(r.imoveis.tipo).toBe('CONDOMINIO');expect(r.xml.indexOf('<condominios>')).toBeGreaterThan(r.xml.indexOf('<imovel>'));expect(r.liberadoParaEmissao).toBe(false);
});
test.each([
 ['1.00</vCobranca>','0.90</vCobranca>','SOMA_COBRANCAS_DIVERGENTE'],
 ['1.00</vCobranca>','1.01</vCobranca>','COBRANCA_EXCEDE_SERVICO'],
 ['2026-11-10</dVencOrig>','2026-02-30</dVencOrig>','VENCIMENTO_INVALIDO'],
 ['<tpCobranca>01','<tpCobranca>99','DESCRICAO_TIPO_INVALIDA'],
 ['<tpCobranca>01','<tpCobranca>07','TIPO_COBRANCA_INVALIDO'],
 ['<imovel><cMun>3304557</cMun></imovel>','','IMOVEL_OBRIGATORIO'],
])('recusa condomínio inconsistente %#',(a,b,c)=>recusa(()=>run(imobiliario('990501',condominio.replace(a,b))),c));
test('não repete cobranças conhecidas; Outro pode repetir com descrição',()=>{
 const cobranças='<gCobranca><tpCobranca>01</tpCobranca><vCobranca>0.50</vCobranca></gCobranca>'.repeat(2);
 const grupo='<imovel><cMun>3304557</cMun></imovel><condominios><dVencOrig>2026-11-10</dVencOrig>'+cobranças+'</condominios>';
 recusa(()=>run(imobiliario('990501',grupo)),'COBRANCA_DUPLICADA');
 expect(run(imobiliario('990501',grupo.replaceAll('<tpCobranca>01</tpCobranca>','<tpCobranca>99</tpCobranca><xTpCobranca>Outra taxa</xTpCobranca>'))).imoveis.tipo).toBe('CONDOMINIO');
});
test('detalhes precisam fechar cobrança e correlação permanece pendente',()=>{
 const detalhes='<gDetCobranca><tpDetCobranca>001</tpDetCobranca><vDetCobranca>0.40</vDetCobranca></gDetCobranca><gDetCobranca><tpDetCobranca>002</tpDetCobranca><vDetCobranca>0.60</vDetCobranca></gDetCobranca>';
 const xml=imobiliario('990501',condominio.replace('</vCobranca>','</vCobranca>'+detalhes));
 expect(run(xml).imoveis.pendencias).toContain('CORRELACAO_COBRANCA_DETALHE');recusa(()=>run(xml.replace('0.60</vDetCobranca>','0.59</vDetCobranca>')),'SOMA_DETALHES_DIVERGENTE');
});
test('descontos de condomínio são conferidos por tipo',()=>{
 const grupo=condominio.replace('</condominios>','<gDesconto><tpDesconto>1</tpDesconto><vDesconto>0.20</vDesconto><xTpDesconto>Desconto</xTpDesconto></gDesconto></condominios>');
 const xml=imobiliario('990501',grupo).replace('</vServPrest>','</vServPrest><vDescCondIncond><vDescIncond>0.20</vDescIncond></vDescCondIncond>');
 expect(run(xml).imoveis.tipo).toBe('CONDOMINIO');recusa(()=>run(xml.replace('<tpDesconto>1','<tpDesconto>2')),'SOMA_DESCONTOS_DIVERGENTE');
});
test('grupos especiais não liberam 2027, produção ou XML assinado',()=>{
 for(const [a,b,code] of [['2026-11-03</dCompet>','2027-01-01</dCompet>','COMPETENCIA_INVALIDA'],['<tpAmb>2','<tpAmb>1','PRODUCAO_PROIBIDA'],['</DPS>','<Signature/></DPS>','XML_ASSINADO']])recusa(()=>run(imobiliario('990501',condominio).replace(a,b)),code);
});

test('complemento municipal 000 é recusado mesmo sem ajuste',()=>recusa(()=>run(xmlBase.replace('<cTribMun>001','<cTribMun>000')),'E0315'));

test('admissão documental excepcional não presume dedução de ISS em município não conveniado',()=>expect(run(ajuste(docs(doc('104'))),{convenioAtivo:false}).municipal).toMatchObject({estado:'PENDENTE',pendencias:['REPERCUSSAO_ISS_MUNICIPIO_NAO_CONVENIADO']}));
