import assert from 'node:assert/strict';
import { criarServicoComercial } from '../src/application/onboarding/ComercialService.js';
import { criarJornadaLead } from '../src/application/onboarding/JornadaLeadService.js';
import { criarPropostasComerciais } from '../src/application/onboarding/PropostasComerciaisService.js';
import { criarRecursosComerciais } from '../src/application/onboarding/RecursosComerciaisService.js';
import { registrarCampos, proximaPergunta } from '../src/application/onboarding/LeadService.js';
import { criar, atualizar, converter } from '../src/application/onboarding/OnboardingService.js';
import { diagnosticoSintetico } from '../src/application/onboarding/__tests__/fixtures/diagnosticoSintetico.js';
import { interpretarColetaComercial } from '../src/application/onboarding/interpretacaoComercialWhatsapp.js';

// Banco descartável e rede bloqueada pelo verificador chamador.
export async function verificarAlinhamento({ db, user, ok }) {
  const publico = criarServicoComercial({ db }), jornada = criarJornadaLead({ db });
  const propostas = criarPropostasComerciais({ db }), recursos = criarRecursosComerciais({ db });
  for (const [i, tipo] of ['ATIVO', 'PASSIVO', 'RECEITA', 'DESPESA', 'PATRIMONIO'].entries()) await db.chartOfAccount.create({ data: { codigo: `ALINHAMENTO-${i}`, nome: `Conta sintética ${tipo}`, tipo } });
  for (const modo of ['MANUAL', 'LINK']) {
    let ficha = await criar({ origem: 'TRANSFERENCIA', criadoPorId: user.id });
    const id = ficha.id, email = `onboarding-${modo.toLowerCase()}@example.invalid`;
    const cnpj = modo === 'MANUAL' ? '11222333000181' : '11444777000161';
    const dados = { cnpj, razaoSocial: `Empresa teste ${modo}`, tipoEmpresa: 'LTDA', responsavelNome: 'Ana Teste', responsavelEmail: email,
      responsavelTelefone: '11999998888', modalidadeServico: 'RECORRENTE', regimeAtual: 'SIMPLES', qtdFuncionarios: '2', notasRecebidasMes: '12',
      notasEmitidasMes: '40', faturamentoMensal: '20.000,50', temProLabore: true, temDebitos: 'NAO_SEI', contadorAnterior: 'Escritório anterior sintético',
      ultimaCompetenciaEntregue: '2026-09', inicioCompetenciaAltan: '2026-10' };
    if (modo === 'MANUAL') ficha = await atualizar(id, { versao: ficha.versao, dados, finalizar: true }, { atorId: user.id });
    else {
      const { token } = await publico.emitirLink(id, user);
      const inicial = await publico.publico(token);
      await assert.rejects(publico.publico(token, { versao: inicial.onboarding.versao, dados: { ...dados, qtdFuncionarios: -1 } }), e => e.code === 'dados_invalidos');
      await publico.publico(token, { versao: inicial.onboarding.versao, dados, ultimoPasso: 'revisao' });
      ficha = await db.onboarding.findUnique({ where: { id } });
      const leitura = interpretarColetaComercial({ texto: 'Emito 45 notas por mês e recebo 14 notas por mês', origem: 'TRANSFERENCIA', dadosAtuais: ficha.dados });
      assert.deepEqual(leitura.operacoes.filter(o => /notas/.test(o.campo)).map(o => [o.campo, o.valor]).sort(), [['notasEmitidasMes', 45], ['notasRecebidasMes', 14]]);
      await registrarCampos({ onboardingId: id, versao: ficha.versao, operacoes: leitura.operacoes, fonte: 'WHATSAPP', client: db });
      await assert.rejects(publico.publico(token, { versao: ficha.versao, dados, finalizar: true }), e => e.code === 'formulario_alterado');
      const retomada = await publico.publico(token);
      assert.equal(retomada.onboarding.dados.notasEmitidasMes, 45);
      assert.notEqual(proximaPergunta({ origem: 'TRANSFERENCIA', dados: retomada.onboarding.dados }).campo, 'notasEmitidasMes');
      await publico.publico(token, { versao: retomada.onboarding.versao, dados: retomada.onboarding.dados, finalizar: true });
      assert.deepEqual(await publico.publico(token), { enviado: true });
      assert.deepEqual(await publico.publico(token, { finalizar: true, dados: {} }), { enviado: true });
      ficha = await db.onboarding.findUnique({ where: { id } });
    }
    assert.equal(ficha.dados.qtdFuncionarios, 2); assert.equal(ficha.dados.faturamentoMensal, 20000.5);
    await jornada.conferirAnalise(id, user, { tipo: 'PUBLICA', versao: ficha.versao, manual: { fonte: 'Documento sintético', evidencia: 'CNPJ e razão social conferidos no documento local sintético.' } });
    ficha = await db.onboarding.findUnique({ where: { id } });
    const diagnostico = await jornada.diagnosticar(id, user, { versao: ficha.versao, ...diagnosticoSintetico('Cadastro sintético conferido para esta simulação.'),
      servicos: 'Contabilidade mensal da empresa de teste, sem regularização de períodos anteriores.', dispensaConsultaPrivada: 'Teste local sem consulta fiscal externa; regularidade fiscal não comprovada.' });
    assert.equal(diagnostico.dados.roteiro.dados.funcionariosClt, 2);
    assert.equal(diagnostico.dados.roteiro.dados.notasEmitidasMes, modo === 'LINK' ? 45 : 40);
    assert.equal(diagnostico.dados.roteiro.dados.faturamentoMensal, 20000.5);
    await jornada.registrarApresentacao(id, user, { versao: ficha.versao, diagnosticoId: diagnostico.id, meio: 'Reunião local', evidencia: 'Escopo sintético e pendências apresentados na simulação.' });
    const proposta = await propostas.gerar(id, user, { versao: ficha.versao });
    await propostas.aprovar(id, proposta.id, user);
    const linkProposta = await propostas.emitirLink(id, proposta.id, user);
    const recorrente = proposta.snapshot.opcoes.find(o => o.recorrente);
    assert.ok(recorrente);
    await propostas.publico(linkProposta.token, { versao: proposta.versao, opcao: recorrente.chave, confirmado: true });
    const modelo = await recursos.criar({ tipo: 'CONTRATO', chave: `onboarding-${modo.toLowerCase()}`, titulo: 'Contrato sintético mensal', texto: '{{nome}} — {{servico}} — {{honorarios}}', dados: { recorrente: true, origens: ['TRANSFERENCIA'] } }, user);
    await recursos.aprovar(modelo.id, user);
    const contrato = await propostas.contrato(id, proposta.id, user, { modeloId: modelo.id });
    await propostas.aprovarContrato(id, contrato.id, user);
    const documento = await propostas.salvarDocumento(id, user, { originalname: 'assinatura-sintetica.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nAssinatura sintética local\n%%EOF') });
    await propostas.conferirAssinatura(id, contrato.id, user, documento.id);
    await jornada.confirmarPagamento(id, user, { contratoId: contrato.id, evidencia: 'Pagamento fictício conferido para o teste local; nenhuma cobrança real.' });
    const resultado = await converter(id, { ownerEmail: email, ownerName: 'Ana Teste', ownerPassword: 'Teste-Local-2026!Segura', hasProlabore: true, temFolha: true,
      company: { cnpj, razaoSocial: dados.razaoSocial, regimeTributario: 'SIMPLES', cnaePrincipal: '6201501',
        endereco: { rua: 'Rua de Teste', numero: '100', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01001000' } },
      contato: { nome: 'Ana Teste', email, telefone: '11999998888', whatsappAutorizado: false } }, { atorId: user.id, portalIds: [] });
    assert.equal(resultado.onboarding.status, 'CONVERTIDO');
    assert.ok(await db.portalClient.findUnique({ where: { id: resultado.portalClientId } }));
    assert.ok(await db.companyDocument.count({ where: { portalClientId: resultado.portalClientId } }) >= 2);
    ok(`${modo}: formulário/IA → dados normalizados → diagnóstico → proposta aceita → contrato e assinatura conferidos → pagamento → empresa na carteira com documentos`);
  }
}
