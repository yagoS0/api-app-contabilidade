jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../LeadService.js', () => ({ ...jest.requireActual('../LeadService.js'), iniciarAtendimento: jest.fn() }));
import { iniciarAtendimento } from '../LeadService.js';
import { coletarComercialWhatsapp } from '../ColetaComercialWhatsappService.js';
function banco({ dados = {}, portalClientId = "empresa-atual" } = {}) {
  const conversa = { id: "c", portalClientId, telefoneE164: "5521999990000", chaveEscopo: "empresa:atual", canalId: "principal" };
  const ficha = { id: "o", origem: "ABERTURA", status: "RASCUNHO", versao: 0, dados, cnpj: null };
  const caso = { id: "a", conversaId: "c", onboardingId: "o", onboarding: ficha, triagem: {}, versao: 1 };
  const recibos = new Map(), mensagens = new Map();
  const db = {
    conversaWhatsapp: { findUnique: jest.fn(async () => ({ ...conversa })), update: jest.fn(async ({ data }) => Object.assign(conversa, data)), updateMany: jest.fn(async () => ({ count: 1 })) },
    atendimentoLead: { findFirst: jest.fn(async () => caso), findUnique: jest.fn(async () => caso), update: jest.fn(async ({ data }) => { Object.assign(caso, data, { versao: caso.versao + (data.versao?.increment || 0) }); return caso; }), updateMany: jest.fn(async () => ({ count: 1 })) },
    onboarding: { findUnique: jest.fn(async () => ({ ...ficha })), updateMany: jest.fn(async ({ where, data }) => { if (where.versao !== ficha.versao) return { count: 0 }; Object.assign(ficha, data, { versao: ficha.versao + (data.versao?.increment || 0) }); return { count: 1 }; }) },
    onboardingEvento: { create: jest.fn(async () => ({})) },
    onboardingAnalise: { create: jest.fn(async () => ({})) },
    mensagemWhatsapp: { findFirst: jest.fn(async ({ where }) => mensagens.get(where.id)) },
    coletaComercialWhatsapp: { findUnique: jest.fn(async ({ where }) => recibos.get(where.mensagemId)), create: jest.fn(async ({ data }) => { recibos.set(data.mensagemId, structuredClone(data)); return structuredClone(data); }), update: jest.fn(async ({ where, data }) => { const r = { ...recibos.get(where.mensagemId), ...data }; recibos.set(where.mensagemId, r); return r; }) },
  };
  db.$transaction = fn => fn(db);
  iniciarAtendimento.mockImplementation(async () => caso);
  let n = 0;
  const chamar = async (texto, { id, enviar = jest.fn(), flag = true, interacao, tipo = "text", ocorridaEmProvedor, consultaPublica, ia = { flag: false } } = {}) => {
    const mensagem = { id: id || `m${++n}`, conversaId: "c", direcao: "in", corpo: texto, tipo, ocorridaEmProvedor, registradaEm: new Date(1760000000000 + n * 1000), conversa };
    mensagens.set(mensagem.id, mensagem);
    return coletarComercialWhatsapp({ registro: { conversa, mensagem }, item: { corpo: texto, interacao, tipo }, deps: { client: db, flag, piloto: [conversa.telefoneE164], enviar, consultaPublica, ia, agora: new Date(1760000010000 + n * 1000) } });
  };
  return { db, conversa, ficha, caso, recibos, chamar };
}
function iaTeste(interpretacao, executar) {
  return { flag: true, piloto: ['5521999990000'], canais: ['principal'], tetoTotalCentavos: 300, chave: 'teste',
    autorizar: jest.fn(async () => ({ ok: true, contexto: { chamadaId: 'call' } })), concluir: jest.fn(async () => {}),
    assistente: { interpretar: jest.fn(async () => { await executar?.(); return { interpretacao, usage: { input_tokens: 10, output_tokens: 5 } }; }) } };
}
const interpretacaoTeste = dados => ({intencao:null,evidenciaIntencao:null,comportamento:'DADOS',dados});
const iaCompleta = () => iaTeste({...interpretacaoTeste([]),resposta:null});
const cadastroTeste = () => ({ok:true,fonte:'BRASILAPI',bruto:{cnpj:'11222333000181',razao_social:'Empresa Teste',municipio:'Niterói',uf:'RJ',cnae_fiscal_descricao:'Serviços médicos',descricao_situacao_cadastral:'ATIVA'}});

test('CNPJ ambíguo não reutiliza empresa antiga e confirmação consulta a nova',async()=>{
 const t=banco();t.ficha.origem='INATIVA';
 const consultaPublica=jest.fn(async cnpj=>({ok:true,fonte:'BRASILAPI',bruto:{cnpj,razao_social:cnpj==='11222333000181'?'Empresa A':'Empresa B',municipio:cnpj==='11222333000181'?'Niterói':'Recife',descricao_situacao_cadastral:'ATIVA'}}));
 await t.chamar('CNPJ 11222333000181',{ia:iaCompleta(),consultaPublica});
 const r=await t.chamar('Pode ser 11222333000181 ou 04252011000110',{ia:iaCompleta(),consultaPublica});
 expect(consultaPublica).toHaveBeenCalledTimes(1);expect(t.caso.triagem.preatendimento.cnpj).toBeNull();expect(t.caso.triagem.preatendimento.consultaPublica).toBeUndefined();expect(r.resultado.texto).toMatch(/CNPJ correto/);
 await t.chamar('Vou conferir e te mando',{ia:iaTeste({...interpretacaoTeste([]),comportamento:'PAUSAR',resposta:null}),consultaPublica});
 expect(consultaPublica).toHaveBeenCalledTimes(1);
 await t.chamar('Voltei. O correto é 04252011000110',{ia:iaTeste({...interpretacaoTeste([]),comportamento:'RETOMAR',resposta:null}),consultaPublica});
 expect(consultaPublica).toHaveBeenCalledTimes(2);expect(consultaPublica).toHaveBeenLastCalledWith('04252011000110');expect(t.ficha.cnpj).toBe('04252011000110');expect(t.caso.triagem.preatendimento.cidade).toBe('Recife');
});
test('pausa com CNPJ grava documento e consulta somente na retomada',async()=>{
 const t=banco();t.ficha.origem='INATIVA';const consultaPublica=jest.fn(async()=>cadastroTeste());
 await t.chamar('Quero ativar minha empresa',{ia:iaCompleta(),consultaPublica});
 const antes=t.caso.triagem.preatendimento.perguntasFeitas;
 await t.chamar('CNPJ 11222333000181, espera um pouco',{ia:iaTeste({...interpretacaoTeste([]),comportamento:'PAUSAR',resposta:null}),consultaPublica});
 expect(t.ficha.cnpj).toBe('11222333000181');expect(t.caso.triagem.preatendimento.perguntasFeitas).toBe(antes);expect(consultaPublica).not.toHaveBeenCalled();
 await t.chamar('Pode continuar',{ia:iaTeste({...interpretacaoTeste([]),comportamento:'RETOMAR',resposta:null}),consultaPublica});
 expect(consultaPublica).toHaveBeenCalledTimes(1);expect(t.caso.triagem.preatendimento.cidade).toBe('Niterói');
});
test('número recusado suspende reaproveitamento do cadastro antigo',async()=>{
 const t=banco();t.ficha.origem='INATIVA';const consultaPublica=jest.fn(async()=>cadastroTeste());
 await t.chamar('CNPJ 11222333000181',{ia:iaCompleta(),consultaPublica});
 await t.chamar('Não é 11222333000181',{ia:iaCompleta(),consultaPublica});
 await t.chamar('Ela está parada',{ia:iaCompleta(),consultaPublica});
 expect(consultaPublica).toHaveBeenCalledTimes(1);expect(t.caso.triagem.preatendimento).toMatchObject({cnpj:null,aguardandoConfirmacaoCnpj:true,campoEsperado:'cnpj'});
});

test.each([
 ['11222333000100','Não sei o CNPJ'],
 ['Pode ser 11222333000181 ou 04252011000110','Prefiro não informar'],
])('dispensa após documento pendente permite continuar sem reutilizar cadastro: %s',async(documento,dispensa)=>{
 const t=banco();t.ficha.origem='INATIVA';const consultaPublica=jest.fn(async()=>cadastroTeste());
 await t.chamar('CNPJ 11222333000181',{ia:iaCompleta(),consultaPublica});
 await t.chamar(documento,{ia:iaCompleta(),consultaPublica});
 expect(t.caso.triagem.preatendimento.campoEsperado).toBe('cnpj');
 const r=await t.chamar(dispensa,{ia:iaTeste({...interpretacaoTeste([]),comportamento:'DESCONHECIDO',resposta:null}),consultaPublica});
 expect(t.caso.triagem.preatendimento).toMatchObject({cnpj:null,aguardandoConfirmacaoCnpj:true,campoEsperado:'necessidade',dispensados:['cnpj']});
 expect(t.caso.triagem.preatendimento.consultaPublica).toBeUndefined();expect(consultaPublica).toHaveBeenCalledTimes(1);expect(r.resultado.texto).not.toMatch(/CNPJ correto|enviar os 14/);
 await t.chamar('A empresa está parada',{ia:iaTeste({...interpretacaoTeste([{campo:'necessidade',valor:'A empresa está parada',evidencia:'A empresa está parada'}]),resposta:null}),consultaPublica});
 expect(t.caso.triagem.preatendimento.cnpj).toBeNull();expect(t.caso.triagem.preatendimento.campoEsperado).not.toBe('cnpj');expect(consultaPublica).toHaveBeenCalledTimes(1);
});
