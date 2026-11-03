jest.mock('../../fiscal/serpro/CompanyAutomationService.js', () => ({ lerAutomacaoEmpresa: jest.fn(async () => ({ automationPolicy: { paused: false }, globalAutomationPolicy: { paused: false } })) }));
jest.mock('../../operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn(async () => ({ applicabilitySource: 'month', changedBy: 'contador-ficticio', changedAt: '2026-11-08T10:00:00Z', applicable: true, status: 'DOCUMENT_AVAILABLE' })) }));
jest.mock('../../whatsapp/ContatoWhatsappService.js', () => ({ destinatariosDeEnvio: jest.fn() }));
jest.mock('../../whatsapp/EnvioGuiaWhatsappService.js', () => ({ carregarCanal: jest.fn(), enviarGuiaPorWhatsapp: jest.fn() }));
jest.mock('../GuideCompanyEmailService.js', () => ({ enviarGuiasExatasDoCiclo: jest.fn() }));
import { createCicloEnvioGuiasService } from '../CicloEnvioGuiasService.js';
// O CICLO DE VIDA da guia, que é o que o chip da listagem desenha.
//
//                       ┌─→ gerada ─→ enviada        (terminais bons)
//   missing ────────────┤     └────→ FALHOU          (tentou e não saiu; NÃO é terminal)
//                       └─→ vazio                    (terminal: ausência confirmada)
//
// `conflito` = MÊS declarado sem faturamento, mas há receita. Marcação manual de guia continua válida.
// `na` = não exigido pelo regime → o chip nem renderiza.
//
// ⚠ ESTE ARQUIVO MANTINHA UMA RÉPLICA DE `resolveNode`, com o aviso "se as duas divergirem, este
// teste deixa de proteger — mantenha-as juntas". Elas JÁ tinham divergido: a réplica derivava
// "enviada" de `emailStatus === "SENT"`, leitura que o código real abandonou quando o envio ganhou
// canal (`foiEnviadaComLegado`) — e o teste continuou verde o tempo todo, protegendo uma regra que
// não era mais a do sistema. Hoje a função é EXPORTADA e importada aqui; a classe de problema
// acabou junto com a cópia.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  guide: { findMany: jest.fn(async () => []) },
  companyMonthlyCircular: { findMany: jest.fn(async () => []) },
  envioGuia: { findMany: jest.fn(async () => []) },
} }));
jest.mock('../../accounting/parcelamento/ParcelamentoAcompanhamentoService.js', () => ({
  listarPendenciasParcelamento: jest.fn(async () => ({ itens: [] })),
}));
jest.mock('../../notas/apuracao/v2/FechamentoService.js', () => ({
  faturamentoEmitPorEmpresa: jest.fn(async () => new Map()),
}));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { computeGuideComplianceMap, resolveNode } from "../guideCompliance.js";

describe('INSS por folha ou pró-labore na projeção real', () => {
  beforeEach(() => {
    prisma.guide.findMany.mockResolvedValue([]);
    prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);
    prisma.envioGuia.findMany.mockResolvedValue([]);
  });
  test.each([[true, false], [false, true], [true, true]])('folha=%s pró-labore=%s exige INSS sem inventar documento', async (temFolha, hasProlabore) => {
    const result = (await computeGuideComplianceMap([{ portalId: 'sintetica', temFolha, hasProlabore, legacy: { regimeTributario: 'SIMPLES' } }], '2026-10')).get('sintetica');
    expect(result.inss).toMatchObject({ required: true, ok: false, state: 'missing' });
    expect(result.inss.guideId).toBeUndefined();
    expect(result.das).toMatchObject({ required: true, state: 'missing' });
  });
  test('dispensa mensal comprovada de INSS permanece distinta da folha cadastral', async () => {
    prisma.guide.findMany.mockImplementation(async ({ where }) => where.parcelamentoId === null
      ? [{ id: 'vazio-outubro', portalClientId: 'sintetica', tipo: 'INSS', status: 'VAZIO', competencia: '2026-10', vazioPor: 'contador' }] : []);
    const result = (await computeGuideComplianceMap([{ portalId: 'sintetica', temFolha: true, hasProlabore: false, legacy: { regimeTributario: 'SIMPLES' } }], '2026-10')).get('sintetica');
    expect(result.inss).toMatchObject({ required: true, state: 'vazio', ok: true });
    expect(result.das.state).toBe('missing');
    expect(prisma.guide.findMany.mock.calls.every(([query]) => query.where.competencia === '2026-10')).toBe(true);
  });
});

const exigido = { required: true, ok: false, state: "missing" };
const naoExigido = { required: false, ok: true, state: "na" };

describe("ciclo de vida do nó de guia", () => {
  test("não exigido pelo regime → `na` (o chip não renderiza)", () => {
    expect(resolveNode(naoExigido).state).toBe("na");
  });

  test("exigido e sem nada → missing (vermelho: trabalho pendente)", () => {
    const r = resolveNode(exigido, undefined, undefined);
    expect(r.state).toBe("missing");
    expect(r.ok).toBe(false);
  });

  test("guia existe e NÃO foi enviada → gerada, com o guideId para o botão de enviar", () => {
    const r = resolveNode(exigido, { guideId: "g1", enviada: false, emailStatus: "PENDING" }, undefined);
    expect(r.state).toBe("gerada");
    expect(r.guideId).toBe("g1");
    expect(r.ok).toBe(true);
  });

  test("guia enviada → enviada", () => {
    expect(resolveNode(exigido, { guideId: "g1", enviada: true, emailStatus: "SENT" }, undefined).state).toBe("enviada");
  });

  test("guia real VENCE marcador vazio — o documento existe, a ausência não", () => {
    const r = resolveNode(exigido, { guideId: "g1", enviada: true, emailStatus: "SENT" }, { guideId: "v1" });
    expect(r.state).toBe("enviada");
  });

  test("marcador vazio sem faturamento → vazio (cinza, terminal)", () => {
    const r = resolveNode(exigido, undefined, { guideId: "v1", vazioPor: "u1" });
    expect(r.state).toBe("vazio");
    expect(r.ok).toBe(true);
    expect(r.origem).toBe("guia_vazia");
  });

  test("mês sem faturamento também resolve o DAS como vazio — e NÃO some da tela", () => {
    // Revoga a decisão antiga de "sumir com a tag": chip ausente significava duas coisas
    // diferentes e o contador não tinha como saber qual estava vendo.
    const r = resolveNode(exigido, undefined, undefined, { semFaturamento: true });
    expect(r.state).toBe("vazio");
    expect(r.origem).toBe("sem_faturamento");
  });

  test("marcação manual da guia permanece sem movimento mesmo com faturamento", () => {
    const r = resolveNode(exigido, undefined, { guideId: "v1", vazioPor: "contador", vazioMotivo: "Retenção integral" }, { faturamento: 17640 });
    expect(r.state).toBe("vazio");
    expect(r.ok).toBe(true);
    expect(r.origem).toBe("guia_vazia");
    expect(r.vazioPor).toBe("contador");
    expect(r.vazioMotivo).toBe("Retenção integral");
  });

  test("conflito vale também para o mês sem faturamento", () => {
    const r = resolveNode(exigido, undefined, undefined, { semFaturamento: true, faturamento: 500 });
    expect(r.state).toBe("conflito");
    expect(r.origem).toBe("sem_faturamento");
  });

  test("faturamento NÃO derruba guia que existe de verdade", () => {
    // Ter receita e ter guia é o caso NORMAL — o conflito é sobre a ausência afirmada, não sobre
    // a presença. Sem esta guarda, toda empresa com faturamento ficaria vermelha.
    const r = resolveNode(exigido, { guideId: "g1", enviada: true, emailStatus: "SENT" }, undefined, { faturamento: 99999 });
    expect(r.state).toBe("enviada");
  });
});

// A GUIA QUE FALHOU PRECISA APARECER — E COM O MOTIVO.
//
// ⚠ POR QUE ESTES TESTES EXISTEM
// `processOneGuide` grava `emailStatus:"ERROR"` + `emailLastError` + `emailNextRetryAt`. Só que
// **nada drena esse retry**: o laço automático foi removido na Q55 (`server.js`, "nada roda
// sozinho"). O campo é escrito e apodrece, e a guia fica em ERROR até alguém, por acaso, clicar de
// novo — sem ninguém ser avisado.
//
// O que tornava isso INVISÍVEL não era o banco: era esta função. Ela devolvia `state: "gerada"`
// para ERROR e para PENDING igualmente, e o chip do dashboard pintava as duas de âmbar
// "gerada, falta enviar". A tentativa que falhou ficava indistinguível da que nunca foi feita.
describe("envio que FALHOU não pode se passar por 'gerada'", () => {
  const falhou = Object.freeze({
    guideId: "g1", enviada: false, emailStatus: "ERROR",
    emailLastError: "550 5.1.1 mailbox unavailable", emailAttempts: 3,
  });

  test("guia com emailStatus ERROR → state `falhou`, NÃO `gerada`", () => {
    const r = resolveNode(exigido, falhou, undefined);
    expect(r.state).toBe("falhou");
    expect(r.state).not.toBe("gerada");
  });

  test("o MOTIVO viaja junto — sem ele o chip manda procurar em outro lugar", () => {
    const r = resolveNode(exigido, falhou, undefined);
    expect(r.emailLastError).toBe("550 5.1.1 mailbox unavailable");
    expect(r.emailAttempts).toBe(3);
  });

  test("o guideId vem junto: o caminho de ação é o MESMO botão de enviar", () => {
    // Envio manual alcança guia em ERROR (`whereGuiaPendenteDeEnvio()` sem janela de retry), então
    // "tentar de novo" é literalmente enviar de novo. Sem `guideId` o botão nasceria desabilitado.
    expect(resolveNode(exigido, falhou, undefined).guideId).toBe("g1");
  });

  test("⚠ `ok` NÃO muda — a guia existe; o que falhou foi o envio", () => {
    // Mexer em `ok` mudaria o filtro de pendências e o agregado do fechamento, que respondem outra
    // pergunta ("a obrigação está materializada?"). A visibilidade é assunto de `state`.
    expect(resolveNode(exigido, falhou, undefined).ok).toBe(true);
  });

  test("enviada VENCE falhou — erro anterior a um envio bem-sucedido é história", () => {
    // Enviada é terminal em QUALQUER canal. Um ERROR de e-mail numa guia que saiu pelo WhatsApp
    // (ou num reenvio posterior que deu certo) não é pendência.
    const r = resolveNode(exigido, { ...falhou, enviada: true }, undefined);
    expect(r.state).toBe("enviada");
  });

  test("guia real em ERROR ainda vence o marcador VAZIO", () => {
    // A precedência não muda: o documento existe, a ausência não. Trocar por "vazio" esconderia a
    // falha atrás de uma afirmação de que não havia nada a enviar.
    expect(resolveNode(exigido, falhou, { guideId: "v1" }).state).toBe("falhou");
  });

  test("PENDING e NULL seguem `gerada` — só ERROR é falha", () => {
    expect(resolveNode(exigido, { guideId: "g1", enviada: false, emailStatus: "PENDING" }).state).toBe("gerada");
    // NULL é o estado real da DARF consolidada do Lucro Presumido (nasce sem `emailStatus`).
    expect(resolveNode(exigido, { guideId: "g1", enviada: false, emailStatus: null }).state).toBe("gerada");
    expect(resolveNode(exigido, { guideId: "g1", enviada: false, emailStatus: "SENDING" }).state).toBe("gerada");
  });
});

// ── O SEGUNDO CANAL (02/09/2026): o WhatsApp que a Meta recusou também é `falhou` ─────────────────
describe("falhou por WhatsApp — a segunda fonte do mesmo estado", () => {
  test("⚠ WhatsApp `falhou` sem e-mail enviado → falhou (era âmbar 'gerada', igual a nunca tentada)", () => {
    const r = resolveNode(exigido, {
      guideId: "g1", enviada: false, emailStatus: "PENDING",
      canalEnvio: "WHATSAPP", envioStatus: "falhou", envioErro: "contato sem opt-in", envioErroCodigo: "META_131047", envioPodeTentarDeNovo: null,
    }, undefined);
    expect(r.state).toBe("falhou");
    expect(r.ok).toBe(true);
    expect(r.envioErro).toBe("contato sem opt-in");
    expect(r.envioErroCodigo).toBe("META_131047");
  });

  test("⚠ `envioPodeTentarDeNovo` viaja com as TRÊS respostas — null continua null, nunca vira false", () => {
    for (const v of [true, false, null]) {
      const r = resolveNode(exigido, { guideId: "g1", enviada: false, canalEnvio: "WHATSAPP", envioStatus: "falhou", envioPodeTentarDeNovo: v }, undefined);
      expect(r.envioPodeTentarDeNovo).toBe(v);
    }
    // Ausente no carimbo (contrato antigo) → null, não undefined nem false.
    expect(resolveNode(exigido, { guideId: "g1", enviada: false }, undefined).envioPodeTentarDeNovo).toBeNull();
  });

  test("enviada VENCE o WhatsApp falhado — se o e-mail saiu, ela chegou", () => {
    const r = resolveNode(exigido, { guideId: "g1", enviada: true, canalEnvio: "EMAIL", envioStatus: "enviado" }, undefined);
    expect(r.state).toBe("enviada");
  });
});

describe('ciclo e projeção real compartilham o regime da competência',()=>{
 async function lerComHistoria(history){
  const guide={id:'inss-temporal',portalClientId:'temporal',competencia:'2026-10',tipo:'INSS',status:'PROCESSED',valor:'100',hash:'sintetico',pdfBytes:Buffer.from('%PDF-sintetico'),vencimento:new Date('2026-11-20'),emailStatus:'PENDING',paymentStatus:'OPEN'};
  Object.assign(prisma,{
   portalClient:{findUnique:jest.fn(async()=>({id:'temporal',companyId:'legacy-temporal',status:'ATIVA',hasProlabore:true,temFolha:false}))},
   company:{findUnique:jest.fn(async()=>({regimeTributario:'LUCRO_PRESUMIDO'}))},
   regimeHistorico:{findMany:jest.fn(async()=>history)},feriado:{findMany:jest.fn(async()=>[])},
   appSetting:{findUnique:jest.fn(async({where})=>where.key==='envio_guias_config:temporal'?{value:{enabled:true,selectionToken:'fixture'}}:where.key==='serpro_runtime_settings'?{value:{rotinas:{simples_envio_guias:{enabled:true,frequency:'DAILY',hour:8}}}}:where.key==='operations_manual_inss:v1:temporal:2026-10'?{value:{fixture:true}}:null)},
  });
  prisma.guide.findMany.mockImplementation(async({where})=>where.OR||where.tipo?.in?[guide]:[]);
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);prisma.envioGuia.findMany.mockResolvedValue([]);
  const email=jest.fn();
  const service=createCicloEnvioGuiasService({db:prisma,now:()=>new Date('2026-11-08T10:00:00Z'),contatos:async()=>({emails:['fixture@example.test'],telefones:[]}),canal:async()=>({disponivel:false}),email});
  const dto=await service.ler({portalClientId:'temporal',competencia:'2026-10'});
  expect(email).not.toHaveBeenCalled();return dto;
 }
 test('cadastro atual Presumido não dispensa DAS de competência comprovadamente Simples',async()=>{
  const dto=await lerComHistoria([{regime:'SIMPLES',vigenciaInicio:new Date('2020-01-01'),vigenciaFim:new Date('2026-10-31')}]);
  expect(dto.expectation).toMatchObject({state:'KNOWN',requiredCount:2,availableCount:1});
  expect(dto.expectation.missing).toEqual(expect.arrayContaining([expect.objectContaining({obligationKey:'das',label:'DAS'})]));
  expect(dto.decision.kind).toBe('WAIT');expect(dto.items.map(g=>g.guideId)).toEqual(['inss-temporal']);
 });
 test('história fiscal sobreposta não ganha cobertura conhecida nem envio completo',async()=>{
  const dto=await lerComHistoria([{regime:'SIMPLES',vigenciaInicio:new Date('2020-01-01')},{regime:'LUCRO_PRESUMIDO',vigenciaInicio:new Date('2026-10-01')}]);
  expect(dto.expectation.state).toBe('REVIEW');expect(dto.decision.kind).toBe('REVIEW');expect(dto.items[0].reason).toContain('regime tributário');
 });
});
