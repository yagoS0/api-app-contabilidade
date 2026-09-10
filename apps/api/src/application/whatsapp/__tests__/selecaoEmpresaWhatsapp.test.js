import { empresasAutorizadas, decidirSelecaoEmpresa, opcoesSelecaoEmpresa, textoSelecaoEmpresa } from '../selecaoEmpresaWhatsapp.js';
import { resolverVinculoTelefone } from '../vinculoTelefone.js';
import { vincularOpcoesAoContexto } from '../contextoMenuWhatsapp.js';

const agora = new Date('2026-09-10T15:00:00Z');
const dados = [
  { portalClientId: 'empresa-lente', razao: 'Lente Serviços Ltda', cnpj: '11111111000191', aliases: ['Lente'] },
  { portalClientId: 'empresa-klaus', razao: 'Klaus Nigro Ltda', cnpj: '22222222000191', aliases: ['Klaus'] },
  { portalClientId: 'empresa-alessandro', razao: 'Alessandro Serviços Ltda', cnpj: '33333333000191', aliases: ['Alessandro'] },
];
const empresas = dados.map((empresa, i) => ({ ...empresa, contatos: [{ contatoId: `contato-${i}`, userId: 'liz-sintetica', statusRbac: 'ACTIVE', papelRbac: 'CLIENT_ADMIN' }] }));
const contexto = (extra = {}) => ({ id: 'atendimento-1', versao: 7, portalClientId: 'empresa-klaus', aguardandoSelecao: false, expiraEm: new Date('2026-09-10T15:30:00Z'), pedidoPendente: null, ...extra });
const aguardando = (extra = {}) => contexto({ portalClientId: null, aguardandoSelecao: true, empresaIdsOferecidos: empresas.map((e) => e.portalClientId), pedidoPendente: 'preciso emitir uma nota; valor: 1500,00; serviço: consulta médica', ...extra });
const decidir = (extra = {}) => decidirSelecaoEmpresa({ empresas, contexto: contexto(), agora, ...extra });
const vinculo = (extra = {}) => ({ situacao: 'AMBIGUO', leitura: 'ESTRITA', ambiguidades: ['EMPRESA'], empresas, ...extra });

describe('empresas do responsável, sem conceder permissão pelo telefone ou nome', () => {
  it('mantém três empresas da mesma pessoa, com papéis independentes', () => {
    const fonte = empresas.map((e, i) => ({ ...e, contatos: [{ ...e.contatos[0], papelRbac: ['OWNER', 'CLIENT_ADMIN', 'FINANCEIRO'][i] }] }));
    const antes = JSON.stringify(fonte);
    const resultado = empresasAutorizadas(vinculo({ empresas: fonte }));
    expect(resultado).toMatchObject({ bloqueado: false, motivo: null, userId: 'liz-sintetica' });
    expect(resultado.empresas.map((e) => e.papelRbac)).toEqual(['OWNER', 'CLIENT_ADMIN', 'FINANCEIRO']);
    expect(JSON.stringify(fonte)).toBe(antes);
    expect(resultado.empresas.every((e) => e.podeEmitir === undefined && e.permissoesGlobais === undefined)).toBe(true);
  });

  it.each(['DESCONHECIDO', 'TELEFONE_INVALIDO', undefined])('não usa empresas injetadas com situação %s', (situacao) => {
    expect(empresasAutorizadas(vinculo({ situacao }))).toMatchObject({ empresas: [], motivo: 'SEM_VINCULO' });
  });

  it('recusa uma leitura aproximada mesmo que o chamador forneça contatos', () => {
    expect(empresasAutorizadas(vinculo({ leitura: 'NONO_DIGITO' }))).toMatchObject({ empresas: [], bloqueado: true, motivo: 'LEITURA_NAO_ESTRITA' });
  });

  it.each([
    [{ userId: null }, 'SEM_PESSOA'],
    [{ statusRbac: 'INACTIVE' }, 'VINCULO_INATIVO'],
    [{ statusRbac: 'active' }, 'VINCULO_INATIVO'],
    [{ papelRbac: null }, 'PAPEL_NAO_AUTORIZADO'],
    [{ papelRbac: 'ADMIN' }, 'PAPEL_NAO_AUTORIZADO'],
    [{ papelRbac: '__proto__' }, 'PAPEL_NAO_AUTORIZADO'],
  ])('descarta somente a empresa com acesso inválido %o', (alteracao, motivo) => {
    const fonte = empresas.map((e, i) => i === 1 ? { ...e, contatos: [{ ...e.contatos[0], ...alteracao }] } : e);
    const r = empresasAutorizadas(vinculo({ empresas: fonte }));
    expect(r.empresas.map((e) => e.portalClientId)).toEqual(['empresa-lente', 'empresa-alessandro']);
    expect(r.descartadas).toEqual([{ portalClientId: 'empresa-klaus', motivo }]);
  });

  it('aceita CLIENT_USER legado para seleção; isso não dá piso de emissão', () => {
    const r = empresasAutorizadas(vinculo({ situacao: 'VINCULADO', empresas: [{ ...empresas[0], contatos: [{ ...empresas[0].contatos[0], papelRbac: 'CLIENT_USER' }] }] }));
    expect(r.empresas[0].papelRbac).toBe('CLIENT_USER');
  });

  it.each([
    { ambiguidades: ['EMPRESA', 'PESSOA'] },
    { empresas: [{ ...empresas[0], pessoaAmbigua: true }, empresas[1]] },
    { empresas: [{ ...empresas[0], contatos: [empresas[0].contatos[0], empresas[0].contatos[0]] }, empresas[1]] },
    { empresas: [empresas[0], empresas[0]] },
  ])('bloqueia pessoa duplicada em vez de escolher um dos contatos (%o)', (extra) => {
    expect(empresasAutorizadas(vinculo(extra))).toMatchObject({ empresas: [], bloqueado: true, motivo: 'PESSOA_AMBIGUA' });
  });

  it('mesmo nome Liz com userIds diferentes exige revisão cadastral', () => {
    const fonte = empresas.map((e, i) => ({ ...e, contatos: [{ ...e.contatos[0], nome: 'Liz', userId: i ? 'outra-pessoa' : 'liz-sintetica' }] }));
    expect(empresasAutorizadas(vinculo({ empresas: fonte }))).toMatchObject({ empresas: [], bloqueado: true, motivo: 'RESPONSAVEIS_DIFERENTES' });
  });

  it('não mascara pessoa diferente por ela ter acesso inativo', () => {
    const fonte = [empresas[0], { ...empresas[1], contatos: [{ ...empresas[1].contatos[0], userId: 'outro', statusRbac: 'INACTIVE' }] }];
    expect(empresasAutorizadas(vinculo({ empresas: fonte })).motivo).toBe('RESPONSAVEIS_DIFERENTES');
  });

  it('consome o resultado real do vínculo estrito, sem adicionar o nono dígito', () => {
    const candidatos = dados.map((e, i) => ({ id: `c-${i}`, portalClientId: e.portalClientId, portalClient: { razao: e.razao, cnpj: e.cnpj }, telefoneE164: '5521999990000', userId: 'liz-sintetica', ativo: true, vinculoRbac: { status: 'ACTIVE', role: 'CLIENT_ADMIN' } }));
    expect(empresasAutorizadas(resolverVinculoTelefone('5521999990000', candidatos)).empresas).toHaveLength(3);
    expect(empresasAutorizadas(resolverVinculoTelefone('552199990000', candidatos)).empresas).toEqual([]);
  });
});

describe('seleção e retomada do pedido inicial', () => {
  it('guarda todo o pedido antes de perguntar a empresa', () => {
    const texto = 'preciso emitir uma nota; valor: 1500,00; serviço: consulta médica';
    expect(decidir({ contexto: contexto({ portalClientId: null }), texto })).toEqual({ acao: 'PERGUNTAR', motivo: 'SEM_EMPRESA_SELECIONADA', pedido: texto });
  });

  it.each(['2', 'opção 2', 'número 2', 'Klaus', 'KLAUS NIGRO LTDA', '22.222.222/0001-91', 'cnpj: 22222222000191'])('retoma o pedido completo ao escolher %s', (texto) => {
    expect(decidir({ contexto: aguardando(), texto })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-klaus', pedido: aguardando().pedidoPendente });
  });

  it('aceita apenas nome fantasia/alias explicitamente fornecido pelo cadastro', () => {
    expect(decidir({ contexto: aguardando(), texto: 'Klaus Nigro' }).acao).toBe('PERGUNTAR');
    expect(decidir({ contexto: aguardando(), texto: 'Klaus', empresas: empresas.map((e) => ({ ...e, aliases: [] })) }).acao).toBe('PERGUNTAR');
    expect(decidir({ contexto: aguardando(), texto: 'Clínica Azul', empresas: empresas.map((e) => e.portalClientId === 'empresa-klaus' ? { ...e, nomeFantasia: 'Clínica Azul' } : e) })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-klaus' });
  });

  it('botão usa contexto e versão completos e retoma o texto guardado', () => {
    expect(decidir({ contexto: aguardando(), interacao: { id: 'altan.company.atendimento-1.7.empresa-klaus' } })).toEqual({ acao: 'SELECIONAR', portalClientId: 'empresa-klaus', motivo: 'BOTAO', pedido: aguardando().pedidoPendente });
  });

  it.each([
    'altan.company.atendimento-1.6.empresa-klaus',
    'altan.company.outro-atendimento.7.empresa-klaus',
    'altan.company.atendimento-1.07.empresa-klaus',
    'altan.company.atendimento-1.7.empresa-klaus.extra',
    'altan.company.atendimento-1.7.empresa-secreta',
    'altan.company.atendimento-1.7.%65mpresa-klaus',
  ])('botão antigo, forjado ou não autorizado não escolhe (%s)', (id) => {
    expect(decidir({ contexto: aguardando(), interacao: { id } }).acao).toBe('PERGUNTAR');
  });

  it('ignora botão que já foi consumido mesmo sem mudança de versão', () => {
    expect(decidir({ interacao: 'altan.company.atendimento-1.7.empresa-lente' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'SELECAO_EXPIRADA' });
  });

  it('uma revogação não desloca o número da lista para outra empresa', () => {
    const restantes = empresas.filter((e) => e.portalClientId !== 'empresa-klaus');
    expect(decidir({ empresas: restantes, contexto: aguardando(), texto: '2' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'OPCAO_INVALIDA' });
    expect(decidir({ empresas: restantes, contexto: aguardando(), texto: '3' })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-alessandro' });
  });

  it('reordenar o cadastro não muda os números do seletor persistido', () => {
    expect(decidir({ empresas: [...empresas].reverse(), contexto: aguardando(), texto: '1' })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-lente' });
  });

  it.each(['0', '4', '-1', '2 ou 3', 'segunda', 'Klauss', 'a outra empresa'])('resposta ambígua não escolhe (%s)', (texto) => {
    expect(decidir({ contexto: aguardando(), texto }).acao).toBe('PERGUNTAR');
  });

  it('homônimos e alias duplicado apresentam CNPJ, sem escolher primeiro', () => {
    const ambiguas = empresas.map((e) => ({ ...e, aliases: ['Clínica'] }));
    expect(decidir({ empresas: ambiguas, contexto: aguardando(), texto: 'Clínica' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'EMPRESA_AMBIGUA' });
    const exibido = textoSelecaoEmpresa({ empresas: ambiguas, contexto: aguardando() });
    expect(exibido).toContain('11.111.111/0001-91');
    expect(exibido).toContain('22.222.222/0001-91');
    expect(exibido).toContain('33.333.333/0001-91');
  });

  it('botão de empresa recém-adicionada não constava da seleção apresentada', () => {
    expect(decidir({ contexto: aguardando({ empresaIdsOferecidos: ['empresa-lente'] }), interacao: 'altan.company.atendimento-1.7.empresa-klaus' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'EMPRESA_NAO_AUTORIZADA' });
  });
});

describe('emissor não é tomador', () => {
  it('emitir pela Klaus para a Lente seleciona Klaus e conserva o tomador', () => {
    expect(decidir({ texto: 'preciso emitir uma nota pela Klaus para a Lente; valor: 100,00', contexto: contexto({ portalClientId: null }) })).toEqual({
      acao: 'SELECIONAR', portalClientId: 'empresa-klaus', motivo: 'EMPRESA_EXPLICITA',
      acaoOperacao: 'EMISSAO',
      pedido: 'preciso emitir uma nota pela Klaus para a Lente; valor: 100,00',
      textoOperacao: 'preciso emitir uma nota para a Lente; valor: 100,00',
    });
  });

  it('não confunde CNPJ explícito da emissora e CNPJ do tomador', () => {
    const texto = 'emitir uma nota pela 22222222000191; tomador: 11111111000191; valor: 1500,00';
    expect(decidir({ texto })).toMatchObject({ portalClientId: 'empresa-klaus', textoOperacao: 'emitir uma nota; tomador: 11111111000191; valor: 1500,00' });
  });

  it('retira o emissor conservando campos com acentos, quebras de linha e CNPJ', () => {
    const texto = 'Preciso emitir uma nota pela Klaus Nigro Ltda, valor: 1.500,00\nserviço: consulta médica\ntomador: 11.111.111/0001-91';
    expect(decidir({ texto }).textoOperacao).toBe('Preciso emitir uma nota, valor: 1.500,00\nserviço: consulta médica\ntomador: 11.111.111/0001-91');
  });

  it.each(['11111111000191', '11.111.111/0001-91', '1', 'Lente', 'tomador: 11111111000191', 'para a Lente', 'serviço: emissão de guias da Lente', 'nota referente a atendimento pela Lente'])('resposta de coleta não troca emissor: %s', (texto) => {
    expect(decidir({ texto, coletaAtiva: true })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus', pedido: texto });
  });

  it('empresa citada só como tomador não seleciona emissora em novo pedido', () => {
    expect(decidir({ texto: 'quero emitir uma nota para a Lente', contexto: contexto({ portalClientId: null }) })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'SEM_EMPRESA_SELECIONADA' });
  });

  it.each(['trocar para a Lente', 'mudar de empresa para Lente', 'quero trocar a empresa para a Lente', 'empresa emissora: Lente', 'emissora: Lente'])('troca explicitamente durante coleta: %s', (texto) => {
    expect(decidir({ texto, coletaAtiva: true })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-lente', motivo: 'EMPRESA_EXPLICITA', textoOperacao: null, pedido: null });
  });

  it('troca isolada retoma o pedido pendente sem enviar a frase de troca ao coletor', () => {
    expect(decidir({ texto: 'trocar para a Lente', contexto: aguardando() })).toMatchObject({ textoOperacao: aguardando().pedidoPendente, pedido: aguardando().pedidoPendente });
  });

  it('troca seguida de pedido novo conserva somente a operação para o coletor', () => {
    expect(decidir({ texto: 'trocar para a Lente; emitir uma nota; valor: 1500,00' })).toMatchObject({ portalClientId: 'empresa-lente', textoOperacao: 'emitir uma nota; valor: 1500,00' });
  });

  it.each([
    'trocar', 'mudar', 'trocar de empresa', 'mudar de empresa', 'mudar a empresa',
    'da outra empresa', 'a outra', 'trocar empresa', 'troca de empresa', 'troque de empresa',
    'alterar empresa', 'selecionar outra empresa', 'escolher empresa',
    'quero trocar de empresa', 'preciso mudar de empresa', 'gostaria de trocar de empresa',
    'pode mudar a empresa?', 'poderia trocar de empresa, por favor?', 'trocar!',
    'outra empresa, por favor.', 'mudar para outra empresa', 'trocar pra outra empresa',
    'trocar para uma outra empresa', 'trocar a empresa por outra', 'trocar pfv',
    'Oi, quero mudar de empresa.', 'Bom dia! Gostaria de trocar de empresa, por gentileza.',
    'Por favor, pode trocar de empresa?', 'EU QUERO TROCAR DE EMPRESA!!!',
    'como faço para mudar de empresa?', 'posso trocar de empresa?', 'podemos mudar de empresa?',
  ])('pede qual empresa sem presumir a outra: %s', (texto) => {
    expect(decidir({ texto })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'TROCA_SOLICITADA', pedido: null });
    expect(decidir({ texto, coletaAtiva: true })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'TROCA_SOLICITADA' });
  });

  it.each(['não quero trocar de empresa', 'não mudar de empresa', 'trocar o valor', 'mudar a descrição',
    'quero mudar o endereço da empresa', 'descrição: trocar de empresa', 'serviço: mudar de empresa',
    'trocar o CNPJ do tomador', 'trocar de empresa quando terminar'])('não troca o contexto por uma descrição, correção ou menção incidental: %s', texto => {
    expect(decidir({ texto, coletaAtiva: true })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus' });
  });

  it.each(['manda a guia da Lente', 'preciso da guia da Lente de agosto', 'guia da empresa Lente', 'guia de 11.111.111/0001-91'])('consulta identificada pausa a operação anterior: %s', (texto) => {
    expect(decidir({ texto, coletaAtiva: true })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-lente', motivo: 'EMPRESA_EXPLICITA' });
  });

  it.each([
    ['manda a guia da Lente', 'manda a guia'],
    ['preciso da guia da Lente de agosto', 'preciso da guia de agosto'],
    ['guia da empresa Lente', 'guia'],
    ['guia de 11.111.111/0001-91', 'guia'],
  ])('retira só a indicação de empresa da consulta: %s', (texto, textoOperacao) => {
    expect(decidir({ texto })).toMatchObject({ portalClientId: 'empresa-lente', textoOperacao });
  });

  it.each(['emitir pela Klaus e Lente', 'emitir pela Empresa Secreta para Lente', 'manda a guia da Lent', 'emitir pela Klaus Souza', 'emitir pela 44444444000191'])('não usa empresa aproximada, externa ou múltipla: %s', (texto) => {
    expect(decidir({ texto, coletaAtiva: true }).acao).toBe('PERGUNTAR');
  });

  it('nome maior cadastrado não é substituído por alias que é prefixo', () => {
    const comHomonomo = [...empresas, { portalClientId: 'outra-klaus', razao: 'Klaus Souza', cnpj: '44444444000191' }];
    expect(decidir({ texto: 'emitir pela Klaus Souza para a Lente', empresas: comHomonomo })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'outra-klaus' });
  });

  it('não transforma a descrição do serviço em indicação da emissora', () => {
    expect(decidir({ texto: 'preciso emitir uma nota; descrição: serviço prestado pela Lente', contexto: contexto({ portalClientId: null }) }).acao).toBe('PERGUNTAR');
  });

  it('duas emissoras em pedidos separados não viram uma única emissão', () => {
    expect(decidir({ texto: 'emitir uma nota pela Klaus para a Lente; emitir outra pela Alessandro para a Lente' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'EMPRESA_AMBIGUA' });
  });
});

describe('contexto, expiração e referências verificadas', () => {
  it.each(['manda a guia', 'preciso emitir uma nota', 'quanto devo?', 'quais documentos existem?'])('mantém a empresa durante o atendimento vigente: %s', (texto) => {
    expect(decidir({ texto })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus', pedido: texto });
  });

  it('botão legado sem vínculo de contexto exige escolha explícita', () => {
    expect(decidir({ interacao: { id: 'altan.client.nfse.issue.v1' } })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'MENU_SEM_CONTEXTO' });
  });

  it.each(['obrigada', 'e agosto?', 'sim', '1'])('continua conversa livre sem tratar resposta como nova seleção: %s', (texto) => {
    expect(decidir({ texto })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus' });
  });

  it('empresa única é selecionada explicitamente no resultado', () => {
    expect(decidir({ empresas: [empresas[0]], contexto: {}, texto: 'emitir uma nota' })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-lente', motivo: 'EMPRESA_UNICA' });
  });

  it('empresa única inicial não fica presa esperando um seletor que nunca foi exibido', () => {
    expect(decidir({ empresas: [empresas[0]], contexto: aguardando({ expiraEm: null, pedidoPendente: null }), texto: 'emitir uma nota' })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-lente', motivo: 'EMPRESA_UNICA', pedido: 'emitir uma nota' });
  });

  it('empresa única ativa continua sem perguntar novamente a cada dado', () => {
    expect(decidir({ empresas: [empresas[1]], texto: 'manda a guia' })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus' });
  });

  it('acesso removido não conserva empresa atual pelo contexto antigo', () => {
    const restantes = empresas.filter((e) => e.portalClientId !== 'empresa-klaus');
    expect(decidir({ empresas: restantes, texto: '1500', coletaAtiva: true })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'CONTEXTO_EXPIRADO' });
  });

  it.each([new Date('2026-09-10T15:00:00Z'), new Date('2026-09-10T14:59:59Z'), null, 'inválida'])('contexto vencido/ausente não serve para continuar (%s)', (expiraEm) => {
    expect(decidir({ contexto: contexto({ expiraEm }), coletaAtiva: true, texto: '1500,00' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'CONTEXTO_EXPIRADO' });
  });

  it.each(['CONFIRMAR A7XY', 'CANCELAR A7XY', 'confirmar', 'cancelar'])('não armazena nem reproduz ato recebido sem contexto vigente: %s', (texto) => {
    expect(decidir({ texto, contexto: contexto({ expiraEm: agora, pedidoPendente: 'CONFIRMAR ANTIGO' }) })).toEqual({ acao: 'PERGUNTAR', motivo: 'CONFIRMACAO_EXIGE_CONTEXTO', pedido: null });
  });

  it('confirmação com contexto válido segue para a confirmação existente, sem executar aqui', () => {
    expect(decidir({ texto: 'CONFIRMAR A7XY', coletaAtiva: true })).toEqual({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus', pedido: null });
  });

  it('clique expirado e número expirado exigem nova seleção', () => {
    const c = aguardando({ expiraEm: agora });
    expect(decidir({ contexto: c, interacao: 'altan.company.atendimento-1.7.empresa-klaus' }).motivo).toBe('SELECAO_EXPIRADA');
    expect(decidir({ contexto: c, texto: '2' }).motivo).toBe('SELECAO_EXPIRADA');
    expect(decidir({ contexto: c, texto: 'Klaus' })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-klaus' });
  });

  it('código legado guardado nunca volta como pedido depois de escolher empresa', () => {
    expect(decidir({ contexto: aguardando({ pedidoPendente: 'CONFIRMAR ANTIGO' }), texto: 'Klaus' }).pedido).toBeNull();
  });

  it('referência verificada seleciona empresa autorizada para uma guia', () => {
    expect(decidir({ empresaCitadaId: 'empresa-lente', texto: 'pode mandar essa guia?', coletaAtiva: true })).toMatchObject({ acao: 'SELECIONAR', portalClientId: 'empresa-lente', motivo: 'MENSAGEM_CITADA' });
  });

  it.each(['11111111000191', '1500,00', 'Lente', 'descrição: entrega de guias'])('citar outra mensagem ao responder coleta não troca empresa: %s', (texto) => {
    expect(decidir({ empresaCitadaId: 'empresa-lente', texto, coletaAtiva: true })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus' });
  });

  it('referência a empresa revogada exige escolha; não usa o conteúdo de um encaminhamento', () => {
    expect(decidir({ empresaCitadaId: 'empresa-revogada', texto: 'manda essa guia' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'REFERENCIA_NAO_AUTORIZADA' });
  });

  it.each(['guias de todas', 'manda as guias de todas as empresas', 'quero as guias das todas'])('consulta de todas depende de frase explícita: %s', (texto) => {
    expect(decidir({ texto })).toEqual({ acao: 'TODAS', motivo: 'CONSULTA_EXPLICITA', pedido: texto });
  });

  it.each(['emitir notas de todas', 'guias de todas e emitir notas', 'emitir guias de todas', 'todas', 'preparar cancelamento de todas'])('não transforma emissão, cancelamento ou plural vago em consulta conjunta: %s', (texto) => {
    expect(decidir({ texto }).acao).not.toBe('TODAS');
  });

  it('replay é determinístico e não altera contexto nem candidatas', () => {
    const c = aguardando();
    const snapshot = JSON.stringify({ c, empresas });
    const entrada = { empresas, contexto: c, texto: '2', agora };
    expect(decidirSelecaoEmpresa(entrada)).toEqual(decidirSelecaoEmpresa(entrada));
    expect(JSON.stringify({ c, empresas })).toBe(snapshot);
  });

  it('sem empresas não trata o pedido nem inventa uma autorização', () => {
    expect(decidir({ empresas: [], texto: 'emitir pela Klaus' })).toEqual({ acao: 'NAO_TRATADO', motivo: 'SEM_EMPRESAS_AUTORIZADAS' });
  });

  it('relógio inválido falha antes de produzir uma seleção', () => {
    expect(() => decidir({ agora: 'inválido', texto: 'Klaus' })).toThrow('agora deve ser uma data válida');
  });
});

describe('opções apresentadas', () => {
  it('lista nome e CNPJ, com IDs versionados', () => {
    const opcoes = opcoesSelecaoEmpresa({ empresas, contexto: aguardando() });
    expect(opcoes).toHaveLength(3);
    expect(opcoes[1]).toMatchObject({ id: 'altan.company.atendimento-1.7.empresa-klaus', numero: 2, descricao: '22.222.222/0001-91', rotulo: '2. Klaus Nigro Ltda · 22.222.222/0001-91' });
  });

  it('mantém números originais ao remover candidata sem vazar seu nome', () => {
    const opcoes = opcoesSelecaoEmpresa({ empresas: [empresas[2], empresas[0]], contexto: aguardando() });
    expect(opcoes.map((o) => o.numero)).toEqual([1, 3]);
    expect(JSON.stringify(opcoes)).not.toContain('Klaus');
  });

  it('exibe empresa anterior para tornar explícita a reescolha', () => {
    expect(textoSelecaoEmpresa({ empresas, contexto: contexto() })).toContain('A seleção anterior era Klaus Nigro Ltda');
  });
});


describe('continuidade entre seleção e serviços', () => {
  it.each(['Guias do mês', 'guias de setembro', 'notas de agosto de 2026', 'guias de 09/2026'])('período não vira nome de empresa: %s', texto => {
    expect(decidir({ texto })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus' });
  });
  it('empresa desconhecida continua exigindo conferência', () => {
    expect(decidir({ texto: 'guias da Desconhecida Ltda' })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'EMPRESA_NAO_IDENTIFICADA' });
  });
  const menu = (extra = {}) => vincularOpcoesAoContexto([{ id: 'altan.client.guides.current.v1' }], { atendimentoId: 'atendimento-1', portalClientId: 'empresa-klaus', versao: 7, ...extra })[0];
  it('ID do menu vigente executa mesmo se título parecer nome de empresa', () => {
    expect(decidir({ texto: 'Guias do mês', interacao: menu() })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus', interacaoId: 'altan.client.guides.current.v1' });
  });
  it.each([{ versao: 6 }, { portalClientId: 'empresa-lente' }, { atendimentoId: 'outro-responsavel' }])('menu antigo não troca empresa nem reaproveita ação: %j', extra => {
    expect(decidir({ texto: 'Guias do mês', interacao: menu(extra) })).toMatchObject({ acao: 'CONTINUAR', portalClientId: 'empresa-klaus', menuDesatualizado: true, descartarInteracao: true });
  });
  it('menu com contexto expirado exige empresa e descarta o pedido antigo', () => {
    expect(decidir({ texto: 'Emitir NFS-e', interacao: menu(), contexto: contexto({ expiraEm: new Date('2026-09-10T14:00:00Z') }) })).toMatchObject({ acao: 'PERGUNTAR', motivo: 'MENU_DESATUALIZADO', pedido: null, descartarInteracao: true });
  });
});
