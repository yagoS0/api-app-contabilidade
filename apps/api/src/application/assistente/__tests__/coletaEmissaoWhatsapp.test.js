import { iniciarColeta, interpretarResposta, atualizarColeta, ehPedidoDeEmissao } from '../coletaEmissaoWhatsapp.js';

const agora = new Date('2026-09-09T15:00:00Z');
const DOC = '11222333000181';
const DOC2 = '12345678000195';
const CPF = '52998224725';
const TOMADOR = { cnpjCpf: DOC, nome: 'Cliente Sintético', endereco: { CEP: '20040002', cMun: '3304557', xLgr: 'Rua Exemplo', nro: '10', xBairro: 'Centro' } };
const helper = (tomador = TOMADOR, origens = {}) => ({ ok: true, tomador, campos: [], camposParaPerguntar: [], origens });
const responder = (estado, texto, interacao) => interpretarResposta({ estado, texto, interacao, agora });
function conhecido(opcoes = {}) {
  const inicio = iniciarColeta({ agora, ...opcoes });
  const entrada = responder(inicio.estado, DOC);
  return atualizarColeta({ estado: entrada.estado, tomadorPreparado: helper() });
}
function revisao() {
  let r = conhecido();
  r = responder(r.estado, 'Descrição: Consultoria mensal; valor: 1.500,50; competência: atual');
  return { ...r.estado, status: 'REVISAO', etapa: 'REVISAO' };
}

describe('coleta guiada sem modelo nem efeitos externos', () => {
  test.each(['emitir nota', 'Quero emitir uma nota fiscal', 'Preciso emitir uma NFS-e, por favor'])('inicia por pedido claro: %s', (t) => expect(ehPedidoDeEmissao(t)).toBe(true));
  test.each(['não quero emitir nota', 'como emitir nota?', 'me manda a nota', 'cancelar nota', 'emitir nota amanhã talvez'])('não sequestra outra intenção: %s', (t) => expect(ehPedidoDeEmissao(t)).toBe(false));

  test('percorre documento, enriquecimento, descrição, valor e competência sem pedir nome/endereço conhecidos', () => {
    let r = iniciarColeta({ agora });
    expect(r.estado.etapa).toBe('TOMADOR');
    r = responder(r.estado, '11.222.333/0001-81');
    expect(r.acao).toBe('PREPARAR_TOMADOR');
    r = atualizarColeta({ estado: r.estado, tomadorPreparado: helper() });
    expect(r.estado.etapa).toBe('DESCRICAO');
    r = responder(r.estado, 'Consultoria de marketing de setembro');
    expect(r.estado.etapa).toBe('VALOR');
    r = responder(r.estado, 'fica em R$ 1.500,50');
    expect(r.estado.dados.valor).toBe(1500.5);
    expect(r.estado.etapa).toBe('COMPETENCIA');
    r = responder(r.estado, 'deste mês');
    expect(r.acao).toBe('PREPARAR_EMISSAO');
    expect(r.estado.dados.competencia).toBe('2026-09');
    expect(r.estado.status).toBe('PRONTO');
  });

  test('campos rotulados em uma mensagem são preservados antes da consulta', () => {
    const r = responder(iniciarColeta({ agora }).estado, 'CNPJ: 11.222.333/0001-81\nServiço: Consultoria mensal\nValor: 950,00\nCompetência: 08/2026');
    expect(r.acao).toBe('PREPARAR_TOMADOR');
    expect(r.estado.dados).toMatchObject({ tomadorDoc: DOC, descricao: 'Consultoria mensal', valor: 950, competencia: '2026-08' });
    expect(atualizarColeta({ estado: r.estado, tomadorPreparado: helper() }).acao).toBe('PREPARAR_EMISSAO');
  });

  test.each(['1.500', '1,500', '1 500', '1500 ou 1600', 'R$ 2 mil', '1500,005', '0', '-50'])('valor %s requer esclarecimento sem mudar o valor', (t) => {
    const antes = { ...conhecido().estado, etapa: 'VALOR', dados: { ...conhecido().estado.dados, descricao: 'Consultoria' } };
    const r = responder(antes, t);
    expect(r.acao).toBe('COLETAR');
    expect(r.estado.dados.valor).toBeUndefined();
    expect(r.mensagem).toMatch(/valor|reais|R\$/i);
  });
  test.each(['1500,00', '1.500,00', 'R$ 1500.00', '1500 reais'])('valor inequívoco %s é aceito', (t) => {
    const antes = conhecido().estado;
    const r = responder({ ...antes, etapa: 'VALOR', dados: { ...antes.dados, descricao: 'Consultoria' } }, t);
    expect(r.estado.dados.valor).toBe(1500);
  });

  test.each(['quanto devo colocar?', 'não sei', 'isso já inclui imposto?', 'me manda meu contrato', 'sim', 'ok', '1500'])('não usa %s como descrição', (t) => {
    const r = responder(conhecido().estado, t);
    expect(r.estado.dados.descricao).toBeUndefined();
    expect(r.acao).not.toBe('PREPARAR_EMISSAO');
  });

  test('CPF pede apenas nome/CEP/número faltantes; depois do CEP enriquece novamente', () => {
    let r = responder(iniciarColeta({ agora }).estado, CPF);
    r = atualizarColeta({ estado: r.estado, tomadorPreparado: { ok: false, tomador: { cnpjCpf: CPF, nome: '', endereco: {} }, campos: ['tomadorNome', 'endereco.CEP', 'endereco.cMun', 'endereco.nro'], camposParaPerguntar: ['tomadorNome', 'endereco.CEP', 'endereco.nro'] } });
    expect(r.estado.etapa).toBe('tomadorNome');
    r = responder(r.estado, 'Joana da Silva');
    expect(r.estado.etapa).toBe('endereco.CEP');
    r = responder(r.estado, '20040-002');
    expect(r.acao).toBe('PREPARAR_TOMADOR');
    expect(r.estado.dados.endereco.CEP).toBe('20040002');
    expect(r.estado.dados.tomadorNome).toBe('Joana da Silva');
  });
  test.each(['11111111111', '52998224724', '5299822472', 'abc11222333000181'])('não inventa/repara documento %s', (t) => {
    const r = responder(iniciarColeta({ agora }).estado, t);
    expect(r.acao).toBe('COLETAR');
    expect(r.estado.dados.tomadorDoc).toBeUndefined();
  });

  test('seleção de tomador exige uma opção fornecida, com numeração estável', () => {
    const estado = iniciarColeta({ agora, tomadores: [{ id: 'a', documento: DOC, nome: 'Horizonte Comunicação' }, { id: 'b', documento: DOC2, nome: 'Horizonte Consultoria' }] }).estado;
    expect(responder(estado, 'Horizonte').acao).toBe('COLETAR');
    expect(responder(estado, '2').estado.dados.tomadorDoc).toBe(DOC2);
    expect(responder(estado, '', 'emis:tomador:a').estado.dados.tomadorDoc).toBe(DOC);
    expect(responder(estado, '', 'emis:tomador:intruso').estado.dados.tomadorDoc).toBeUndefined();
  });
  test('perfil único é reutilizado; múltiplos exigem escolha explícita, sem aceitar ID estranho', () => {
    const perfis = [{ id: 'p1', nome: 'Consultoria' }, { id: 'p2', nome: 'Treinamento' }];
    const unico = conhecido({ perfis: [perfis[0]] });
    expect(unico.estado.dados.perfilId).toBe('p1');
    let r = responder(conhecido({ perfis }).estado, 'Descrição: aula; valor: 100; competência: atual');
    expect(r.estado.etapa).toBe('PERFIL');
    expect(r.estado.dados.perfilId).toBeUndefined();
    expect(responder(r.estado, '', 'emis:perfil:intruso').acao).toBe('COLETAR');
    r = responder(r.estado, 'Treinamento');
    expect(r.acao).toBe('PREPARAR_EMISSAO');
    expect(r.estado.dados.perfilId).toBe('p2');
  });

  test('corrigir valor invalida a revisão imediatamente e preserva outros dados', () => {
    const antes = revisao();
    let r = responder(antes, 'corrigir valor');
    expect(r.invalidarConfirmacao).toBe(true);
    expect(r.estado.etapa).toBe('VALOR');
    r = responder(r.estado, '1.050,50');
    expect(r.estado.dados.valor).toBe(1050.5);
    expect(r.estado.dados.tomadorDoc).toBe(DOC);
    expect(r.acao).toBe('PREPARAR_EMISSAO');
    expect(antes.dados.valor).toBe(1500.5);
  });
  test('correção ambígua não prepara de novo usando o valor antigo', () => {
    const r = responder(revisao(), 'corrigir valor para 1.500');
    expect(r.invalidarConfirmacao).toBe(true);
    expect(r.acao).toBe('COLETAR');
    expect(r.estado.etapa).toBe('VALOR');
  });
  test('troca de cliente limpa nome/endereço anteriores e consulta o novo documento', () => {
    const r = responder(revisao(), `trocar cliente para ${DOC2}`);
    expect(r.invalidarConfirmacao).toBe(true);
    expect(r.acao).toBe('PREPARAR_TOMADOR');
    expect(r.estado.dados.tomadorNome).toBeUndefined();
    expect(r.estado.dados.endereco).toEqual({});
    expect(r.estado.dados.descricao).toBe('Consultoria mensal');
  });
  test('novo CEP não mistura rua, número e complemento do endereço antigo', () => {
    const r = responder(revisao(), 'corrigir CEP: 01001-000');
    expect(r.acao).toBe('PREPARAR_TOMADOR');
    expect(r.estado.dados.endereco).toEqual({ CEP: '01001000' });
    expect(r.invalidarConfirmacao).toBe(true);
  });
  test('correção explícita do número mantém CEP/rua e não remove complemento informado', () => {
    const r = responder(revisao(), 'Número: 22; complemento: sala 2');
    expect(r.estado.dados.endereco).toMatchObject({ CEP: '20040002', xLgr: 'Rua Exemplo', nro: '22', xCpl: 'sala 2' });
    expect(r.invalidarConfirmacao).toBe(true);
  });

  test('dados retornados pelo helper conservam a origem quando só foram reenviados', () => {
    let r = responder(iniciarColeta({ agora }).estado, DOC);
    r = atualizarColeta({ estado: r.estado, tomadorPreparado: helper(TOMADOR, { tomadorNome: 'cnpj', 'endereco.CEP': 'cnpj', 'endereco.nro': 'memoria' }) });
    const novo = atualizarColeta({ estado: r.estado, tomadorPreparado: helper(TOMADOR, { tomadorNome: 'manual', 'endereco.CEP': 'manual', 'endereco.nro': 'manual' }) });
    expect(novo.estado.origens).toMatchObject({ tomadorDoc: 'manual', tomadorNome: 'cnpj', 'endereco.CEP': 'cnpj', 'endereco.nro': 'memoria' });
    expect(responder(novo.estado, 'Nome: Novo Nome').estado.origens.tomadorNome).toBe('manual');
  });
  test('complemento ausente não bloqueia; sem complemento é uma resposta válida quando solicitado', () => {
    const r = responder({ ...conhecido().estado, camposPendentes: ['endereco.xCpl'], etapa: 'endereco.xCpl' }, 'sem complemento');
    expect(r.estado.dados.endereco.xCpl).toBe('');
    expect(r.estado.camposPendentes).not.toContain('endereco.xCpl');
  });
  test('município não resolvido pelo CEP pede equipe, não código IBGE ao cliente', () => {
    const r = atualizarColeta({ estado: conhecido().estado, tomadorPreparado: { ...helper(), ok: false, encaminharEscritorio: true, campos: ['endereco.cMun'], camposParaPerguntar: [] } });
    expect(r.acao).toBe('EQUIPE');
    expect(r.mensagem).not.toMatch(/informe.*IBGE/i);
  });

  test('competência atual usa São Paulo na virada do mês', () => {
    const estado = { ...conhecido().estado, etapa: 'COMPETENCIA', dados: { ...conhecido().estado.dados, descricao: 'aula', valor: 100 } };
    const r = interpretarResposta({ estado, texto: 'atual', agora: new Date('2026-10-01T01:00:00Z') });
    expect(r.estado.dados.competencia).toBe('2026-09');
  });
  test.each(['13/2026', '2026-00', '31/02/2026', '09/10'])('competência %s não é adivinhada', (t) => {
    const r = responder(revisao(), `competência: ${t}`);
    expect(r.acao).toBe('COLETAR');
    expect(r.estado.etapa).toBe('COMPETENCIA');
  });
  test('data explícita mantém o dia informado', () => {
    const r = responder(revisao(), 'competência: 08/09/2026');
    expect(r.estado.dados.competencia).toBe('2026-09-08');
  });

  test.each(['CONFIRMAR A7K2', 'confirmar b8l3!'])('confirmação %s é devolvida ao protocolo externo sem avançar', (t) => {
    const estado = revisao();
    const r = responder(estado, t);
    expect(r).toMatchObject({ acao: 'CONFIRMACAO_EXTERNA', consumiu: false, invalidarConfirmacao: false, estado });
  });
  test('sim em revisão não prepara nem confirma', () => {
    const r = responder(revisao(), 'sim');
    expect(r.acao).toBe('COLETAR');
    expect(r.mensagem).toMatch(/CONFIRMAR/);
    expect(r.invalidarConfirmacao).toBe(false);
  });
  test.each([['desistir', 'CANCELAR', 'CANCELADO'], ['cancelar pedido', 'CANCELAR', 'CANCELADO'], ['falar com atendente', 'EQUIPE', 'EQUIPE'], ['pausar', 'PAUSAR', 'PAUSADO'], ['quero falar livremente', 'PAUSAR', 'PAUSADO']])('controle %s preserva dados e encerra captura', (t, acao, status) => {
    const estado = revisao();
    const r = responder(estado, t);
    expect(r.acao).toBe(acao);
    expect(r.estado.status).toBe(status);
    expect(r.estado.dados).toEqual(estado.dados);
  });
  test('pedido de outro documento pausa e permite roteamento normal sem virar descrição', () => {
    const r = responder(conhecido().estado, 'me manda o contrato social');
    expect(r).toMatchObject({ acao: 'PAUSAR', consumiu: false });
    expect(r.estado.dados.descricao).toBeUndefined();
  });
  test('dúvida simples explica competência; alteração tributária requer equipe', () => {
    const antes = conhecido().estado;
    expect(responder(antes, 'o que é competência?').mensagem).toMatch(/mês|mes|período|periodo/i);
    expect(responder(antes, 'alíquota: 5%').acao).toBe('EQUIPE');
  });
  test('estado serializável e imutável durante leitura/seleção', () => {
    const antes = revisao();
    const copia = JSON.stringify(antes);
    const r = responder(antes, 'corrigir serviço para Treinamento mensal');
    expect(JSON.stringify(antes)).toBe(copia);
    expect(r.estado.dados.descricao).toBe('Treinamento mensal');
    expect(JSON.parse(JSON.stringify(r.estado))).toEqual(r.estado);
  });

  test('primeiro pedido pode conter campos rotulados juntos, sem reiniciar ou perder os dados', () => {
    const texto = `Quero emitir uma nota. CNPJ: ${DOC}; valor: 1200,00; serviço: Consultoria mensal`;
    expect(ehPedidoDeEmissao(texto)).toBe(true);
    const r = responder(iniciarColeta({ agora }).estado, texto);
    expect(r.estado.dados).toMatchObject({ tomadorDoc: DOC, valor: 1200, descricao: 'Consultoria mensal' });
    expect(r.acao).toBe('PREPARAR_TOMADOR');
  });
  test('campos ditos naturalmente têm alvo explícito mesmo fora da pergunta atual', () => {
    const r = responder(conhecido().estado, 'o valor é 1200');
    expect(r.estado.dados.valor).toBe(1200);
    expect(r.estado.dados.descricao).toBeUndefined();
    expect(r.estado.etapa).toBe('DESCRICAO');
    const c = responder(revisao(), `o CPF é ${CPF}`);
    expect(c.estado.dados.tomadorDoc).toBe(CPF);
    expect(c.acao).toBe('PREPARAR_TOMADOR');
  });
  test('na verdade 1300 é valor na pergunta de valor; em revisão exige alvo explícito', () => {
    const estado = responder(conhecido().estado, 'Consultoria').estado;
    expect(responder(estado, 'na verdade 1300').estado.dados.valor).toBe(1300);
    const r = responder(revisao(), 'na verdade 1300');
    expect(r.estado.dados.valor).toBe(1500.5);
    expect(r.mensagem).toMatch(/valor: 1300/);
    expect(r.invalidarConfirmacao).toBe(false);
  });
  test('número do endereço ambíguo não é gravado', () => {
    const r = responder(revisao(), 'número: 10 ou 20');
    expect(r.acao).toBe('COLETAR');
    expect(r.estado.dados.endereco.nro).toBe('10');
  });
  test('tomador da lista com documento formatado é normalizado e revalidado', () => {
    const estado = iniciarColeta({ agora, tomadores: [{ documento: '11.222.333/0001-81', nome: 'Cliente Sintético' }] }).estado;
    expect(responder(estado, '1').estado.dados.tomadorDoc).toBe(DOC);
  });
  test.each(['qual alíquota devo usar?', 'regime: lucro presumido', 'pTotTribSN: 5'])('assunto fiscal %s exige equipe', (texto) => {
    expect(responder(conhecido().estado, texto).acao).toBe('EQUIPE');
  });
  test.each(['obrigado pela ajuda', 'me ajuda', 'pode continuar'])('fala social %s não vira serviço', (texto) => {
    expect(responder(conhecido().estado, texto).estado.dados.descricao).toBeUndefined();
  });
  test('pedido de cancelamento de nota existente sai da coleta e não cancela ato fiscal', () => {
    const r = responder(conhecido().estado, 'quero cancelar uma nota');
    expect(r).toMatchObject({ acao: 'PAUSAR', consumiu: false });
  });
  test('tomadores com o mesmo nome podem ser distinguidos pelo documento nas opções', () => {
    const r = iniciarColeta({ agora, tomadores: [{ documento: DOC, nome: 'Joana da Silva' }, { documento: DOC2, nome: 'Joana da Silva' }] });
    expect(r.opcoes[0].titulo).not.toBe(r.opcoes[1].titulo);
    expect(r.mensagem).toContain(DOC.slice(-6));
    expect(r.mensagem).toContain(DOC2.slice(-6));
  });
  test('rótulos de trinta tomadores permanecem dentro do limite de texto WhatsApp', () => {
    const tomadores = Array.from({ length: 30 }, (_, i) => ({ documento: `${DOC.slice(0, -2)}${i.toString().padStart(2, '0')}`, nome: `Cliente ${i} ${'muito longo '.repeat(60)}` }));
    const r = iniciarColeta({ agora, tomadores });
    expect(r.opcoes).toHaveLength(10);
    expect(r.opcoes.every((o) => o.titulo.length <= 64)).toBe(true);
    expect(r.mensagem.length).toBeLessThan(4096);
    expect(responder(r.estado, '30').estado.dados.tomadorDoc).toBe(tomadores[29].documento);
  });
  test('pedido explícito de desistência em linguagem comum não exige palavra exata', () => {
    const r = responder(revisao(), 'quero cancelar o pedido');
    expect(r.acao).toBe('CANCELAR');
    expect(r.invalidarConfirmacao).toBe(true);
  });
});
