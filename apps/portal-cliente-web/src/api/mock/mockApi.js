// Mock do portal do cliente — para desenvolver sem banco/API.
//
// ⚠ O mock GUARDA ESTADO. Trocar de empresa, paginar e filtrar competência têm
// de ser exercíveis offline; um retorno fixo faria a tela parecer certa e o
// filtro parecer quebrado (ou o contrário) sem ninguém perceber.
//
// ⚠ Os contratos de resposta são IDÊNTICOS aos do `realApi`. Cada bloco abaixo
// cita a origem do formato no backend. Divergir aqui é como o mock passa a
// mentir — e quem paga é a tela que foi validada só offline.
//
// Fontes copiadas campo a campo:
//   serializeInvoice   -> apps/api/src/routes/portalInvoices.js
//   toGuideResponse    -> apps/api/src/application/guides/GuideService.js
//   GET /companies     -> apps/api/src/routes/client/index.js
//   GET /aliquotas     -> idem (inclusive a fórmula de pct e o reverse final)
//   GET /fluxo         -> idem

import { ApiError } from "../ApiError";
import { exigirContaDeCliente } from "../accountGate";
import { lerSessao, limparSessao } from "../sessionStore";

const LATENCIA_MS = 140; // o suficiente para os estados de carregamento existirem de verdade

// ⚠ ESPELHO DE `LOTE_MAXIMO` (`apps/api/src/application/nfse/danfse/loteDanfseDoPortal.js`).
// Está aqui em cópia porque não há código compartilhado entre a API e este app (ver a tabela
// "mudou lá, muda aqui" no CLAUDE.md deste portal). ⚠ **Mudou lá, muda aqui**: um mock com teto
// diferente do servidor treinaria a tela a recusar onde a produção aceita, ou pior, o contrário.
const LOTE_MAXIMO_MOCK = 200;

function dormir(ms = LATENCIA_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// PRNG determinístico (mulberry32): o mesmo seed dá sempre os mesmos dados, para
// que "a nota 41 sumiu" seja um defeito e não o acaso do recarregamento.
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function competenciasAte(mesesAtras, quantidade) {
  // Da mais antiga para a mais recente, terminando `mesesAtras` meses atrás.
  const out = [];
  const now = new Date();
  const fim = new Date(now.getFullYear(), now.getMonth() - mesesAtras, 1);
  for (let i = quantidade - 1; i >= 0; i -= 1) {
    const d = new Date(fim.getFullYear(), fim.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function diaDoMes(competencia, dia) {
  const [y, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dia));
}

const NOMES_TOMADOR = [
  ["Comercial Aurora Ltda", "11222333000181"],
  ["Studio Vertice Arquitetura ME", "22333444000172"],
  ["Delta Logistica S.A.", "33444555000163"],
  ["Prefeitura Municipal de Sao Bento", "44555666000154"],
  ["Marcos Antunes Pereira", "12345678909"],
  ["Nova Ponte Engenharia Ltda", "55666777000145"],
  ["Cafe do Largo Comercio ME", "66777888000136"],
  ["Instituto Farol de Ensino", "77888999000127"],
];

// -----------------------------------------------------------------------------
// Estado
// -----------------------------------------------------------------------------

function criarEstado() {
  // ⚠ AS QUATRO EMPRESAS SÃO OS QUATRO ESTADOS DO PORTÃO DE EMISSÃO, e existem separadas por isso.
  // Um estado de autorização que não se consegue alcançar offline é um estado cujo desenho de tela
  // ninguém confere antes de produção — e aqui produção emite nota fiscal de verdade.
  //
  //   pc-001  liberada + OWNER          → o formulário aparece
  //   pc-002  liberada + FINANCEIRO     → papel insuficiente
  //   pc-003  NÃO liberada              → o contador precisa liberar
  //   pc-004  campo AUSENTE             → ⚠ "não recebemos o estado" — que NÃO é "não liberada"
  //
  // ⚠ A pc-005 vem depois e NÃO é um quinto estado do portão: ela abre o eixo do REGIME
  // (Lucro Presumido), sem o qual o ramo do ISS que MANTÉM os campos é inalcançável offline.
  //
  // ⚠ A pc-006 é o MESMO regime da pc-005 com o OUTRO desfecho da carga tributária aproximada
  // (dono, 19/08/2026). Desde que os três percentuais viajam em `GET /client/companies`, a tela do
  // Presumido tem dois textos possíveis — "a nota sai, e a carga é esta" e "falta configurar tal
  // parcela" — e com uma empresa só, um dos dois seria inalcançável offline. A pc-006 tem apenas o
  // MUNICIPAL configurado de propósito: é a forma exata do defeito que o commit `11187501`
  // consertou (um percentual liberava a emissão, e o XML afirmava 0,00 nos outros dois).
  //
  // ⚠ A pc-004 **omite** `emissaoNfseLiberada` de propósito. É o que acontece quando o portal fala
  // com uma API anterior a 18/08/2026 (o campo é dessa data). Se o mock sempre mandasse o campo,
  // o ramo tri-estado da tela seria código morto no desenvolvimento e só apareceria em campo.
  const empresas = [
    {
      companyId: "pc-001",
      portalId: "pc-001",
      myRole: "OWNER",
      razao: "Vertice Servicos Digitais Ltda",
      cnpj: "12345678000190",
      inscricaoMunicipal: "884512",
      uf: "SP",
      municipio: "Sao Paulo",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: "financeiro@vertice.com.br",
      email: "contato@vertice.com.br",
      telefone: "11 4002-8922",
      emissaoNfseLiberada: true,
      portalCreatedAt: "2024-03-11T13:04:00.000Z",
      portalUpdatedAt: "2026-08-01T10:22:00.000Z",
      // ⚠ Só os campos que a rota real devolve e que a tela LÊ. `codigoServicoNacional` é o
      // singular do cadastro — é ele que vai no `cTribNac` da nota quando ninguém escolhe outro
      // (`application/nfse/codigoServicoDaNota.js`), e a tela precisa dizer qual é.
      legacyCompany: {
        id: "legacy-001",
        razaoSocial: "VERTICE SERVICOS DIGITAIS LTDA",
        inscricaoMunicipal: "884512",
        codigoServicoNacional: "010101",
        // ⚠ UM CÓDIGO SÓ — **o ramo que de fato renderiza hoje**: 0 de 33 empresas em produção têm
        // lista plural. A tela não pergunta nada; ela diz qual vai. Lista vazia (não `undefined`)
        // é o estado real das 33.
        codigosServicoNacional: [],
        codigoServicoMunicipal: "0101",
        rpsSerie: "1",
        rpsNumero: "37",
        regimeTributario: "SIMPLES_NACIONAL",
        optanteSimples: true,
        // ⚠ A ATIVIDADE — é dela que sai a DESCRIÇÃO SUGERIDA da nota
        // (`features/emitir/lib/descricaoSugerida.js`). Sem ela no mock, o formulário offline
        // mostraria "esta empresa não tem atividade cadastrada" e o caminho normal da sugestão
        // nunca seria exercido sem backend. O formato é o MEDIDO em produção:
        // `código + " - " + descrição`, e a descrição é texto real de CNAE.
        atividades: ["73.19-0-03 - Marketing direto"],
        cnaePrincipal: "7319003",
      },
    },
    {
      // Segunda empresa: mesma pessoa, papel menor, e SEM guia liberada — o
      // estado vazio precisa ser alcançável sem editar código.
      // ⚠ Emissão LIBERADA pelo contador e mesmo assim sem formulário: é o caso em que a guarda
      // que barra é o PAPEL, e ele tem frase e conserto próprios (trocar o papel, não pedir
      // liberação).
      companyId: "pc-002",
      portalId: "pc-002",
      myRole: "FINANCEIRO",
      razao: "Ponte Nova Comercio de Alimentos ME",
      cnpj: "98765432000155",
      inscricaoMunicipal: null,
      uf: "MG",
      municipio: "Juiz de Fora",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: null,
      email: null,
      telefone: null,
      emissaoNfseLiberada: true,
      portalCreatedAt: "2025-01-20T09:00:00.000Z",
      portalUpdatedAt: "2026-07-30T18:41:00.000Z",
      legacyCompany: null,
    },
    {
      companyId: "pc-003",
      portalId: "pc-003",
      myRole: "CLIENT_ADMIN",
      razao: "Farol Consultoria Empresarial Ltda",
      cnpj: "45678912000133",
      inscricaoMunicipal: "992301",
      uf: "PR",
      municipio: "Curitiba",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: null,
      email: null,
      telefone: null,
      emissaoNfseLiberada: false,
      portalCreatedAt: "2025-06-02T11:15:00.000Z",
      portalUpdatedAt: "2026-08-05T08:30:00.000Z",
      legacyCompany: null,
    },
    {
      companyId: "pc-004",
      portalId: "pc-004",
      myRole: "CLIENT_ADMIN",
      razao: "Alvorada Manutencao Predial ME",
      cnpj: "32165498000177",
      inscricaoMunicipal: null,
      uf: "RS",
      municipio: "Porto Alegre",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: null,
      email: null,
      telefone: null,
      // ⚠ `emissaoNfseLiberada` NÃO ESTÁ AQUI. Não escreva `undefined`, não escreva `null`: a
      // ausência da chave é o fato que este cenário existe para produzir.
      portalCreatedAt: "2025-09-14T16:45:00.000Z",
      portalUpdatedAt: "2026-08-11T12:05:00.000Z",
      legacyCompany: null,
    },
    {
      // ⚠ A QUINTA EMPRESA NÃO É UM QUINTO ESTADO DO PORTÃO — ela abre um EIXO NOVO: o REGIME.
      //
      // Desde 18/08/2026 o formulário esconde a alíquota de ISS (e a retenção) quando a empresa é
      // do Simples, porque ali o ISS está dentro do DAS. Com as quatro empresas de cima, o ramo
      // que MANTÉM os campos era inalcançável offline: só a pc-001 passa pelo portão, e ela é do
      // Simples. Um ramo que ninguém consegue abrir é um ramo cujo desenho só aparece em produção.
      //
      // ⚠⚠ E ELA MOSTRA O CAMINHO FELIZ DO NÃO OPTANTE, que até 19/08/2026 era inalcançável. O
      // formulário continua NÃO oferecendo `pTotTribFed/Est/Mun` — e não deve oferecer: eles são
      // configuração do CONTADOR. O que mudou é que o cadastro os manda para a tela VER, e
      // `NfseService` cai neles quando o payload não os traz. Com os três gravados aqui, a emissão
      // do Presumido passa; a pc-006 exercita o outro desfecho. Ver `emitirNfse`.
      companyId: "pc-005",
      portalId: "pc-005",
      myRole: "OWNER",
      razao: "Meridiano Engenharia e Projetos Ltda",
      cnpj: "10203040000150",
      inscricaoMunicipal: "551200",
      uf: "RJ",
      municipio: "Rio de Janeiro",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: null,
      email: null,
      telefone: null,
      emissaoNfseLiberada: true,
      portalCreatedAt: "2025-02-10T10:00:00.000Z",
      portalUpdatedAt: "2026-08-14T09:12:00.000Z",
      legacyCompany: {
        id: "legacy-005",
        razaoSocial: "MERIDIANO ENGENHARIA E PROJETOS LTDA",
        inscricaoMunicipal: "551200",
        codigoServicoNacional: "070201",
        // ⚠⚠ VÁRIOS CÓDIGOS — o ramo do SELETOR, inalcançável em produção hoje. Este projeto já foi
        // mordido três vezes esta semana por ramo que só existia offline no papel: o "não é
        // Simples", o `emitirNfse` que recusava todo Presumido, e a recusa do DANFSe sem QR Code.
        // ⚠ O terceiro elemento está FORA DA FORMA de propósito (é o item da LC 116, não o
        // cTribNac de 6 dígitos): a coluna não tem CHECK no banco, então isso acontece de verdade —
        // e a tela tem de MOSTRÁ-LO como inválido, não sumir com ele.
        codigosServicoNacional: ["070201", "140201", "31.01"],
        codigoServicoMunicipal: "0702",
        rpsSerie: "1",
        rpsNumero: "12",
        // ⚠ É ESTE CAMPO que a tela lê para decidir sobre o ISS — e ele é a SEGUNDA leitura do
        // servidor (a primeira é `CadastroFiscal.regime`, que `GET /client/companies` não manda).
        regimeTributario: "LUCRO_PRESUMIDO",
        optanteSimples: false,
        // ⚠ A CARGA TRIBUTÁRIA APROXIMADA COMPLETA (Lei 12.741/2012). ⚠ Os valores são os da NFS-e
        // real versionada em `docs/leiaute-nfse/nfse-nacional-substituicao.xml` — não foram
        // inventados aqui, e é ela que prova que `0.00` DECLARADO é legítimo (serviço não tem ICMS).
        // ⚠ STRING, como o backend entrega: `Decimal(5,2)` do Prisma serializa em JSON como texto.
        // Um mock que mandasse número esconderia justamente a conversão que a tela precisa fazer.
        pTotTribFed: "11.33",
        pTotTribEst: "0.00",
        pTotTribMun: "0.00",
        // ⚠⚠ O CASO QUE PROVA A REGRA 1: códigos NUS, sem texto nenhum. Não existe tabela
        // CNAE→descrição neste repositório (o `CnaeAnexo` mapeia para ANEXO DO SIMPLES, outra
        // coisa), então aqui a tela NÃO sugere nada, o campo fica VAZIO e ela diz por quê. Sem
        // este caso no mock, só o caminho feliz seria alcançável offline.
        atividades: ["71.12-0-00", "4120400", "4399101"],
        cnaePrincipal: "7112000",
      },
    },
    {
      // ⚠ O OUTRO DESFECHO DO PRESUMIDO: cadastro de carga tributária INCOMPLETO.
      //
      // ⚠⚠ E A FORMA DA INCOMPLETUDE É A DO DEFEITO REAL (commit `11187501`): só o MUNICIPAL está
      // configurado. Era exatamente essa a empresa que o portão antigo (`.some()`) deixava emitir,
      // com o XML escrevendo `0,00` no federal e no estadual — carga zero AFIRMADA ao tomador, por
      // omissão. Hoje o servidor exige os três e NOMEIA os que faltam; esta empresa existe para que
      // o texto que a tela mostra nesse caso possa ser lido offline, em vez de só em produção.
      companyId: "pc-006",
      portalId: "pc-006",
      myRole: "CLIENT_ADMIN",
      razao: "Baluarte Servicos de Engenharia Ltda",
      cnpj: "50607080000191",
      inscricaoMunicipal: "770145",
      uf: "MG",
      municipio: "Belo Horizonte",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: null,
      email: null,
      telefone: null,
      emissaoNfseLiberada: true,
      portalCreatedAt: "2025-04-22T13:30:00.000Z",
      portalUpdatedAt: "2026-08-16T15:40:00.000Z",
      legacyCompany: {
        id: "legacy-006",
        razaoSocial: "BALUARTE SERVICOS DE ENGENHARIA LTDA",
        inscricaoMunicipal: "770145",
        codigoServicoNacional: "070201",
        // Sem lista: a autoridade é o singular, como nas 33 de produção.
        codigosServicoNacional: [],
        codigoServicoMunicipal: "0702",
        rpsSerie: "1",
        rpsNumero: "4",
        regimeTributario: "LUCRO_PRESUMIDO",
        optanteSimples: false,
        // ⚠ `null`, NÃO chave ausente — e a diferença é o desenho inteiro. `null` é "o contador não
        // configurou" (a tela nomeia o que falta); chave AUSENTE seria "esta tela não recebeu o
        // cadastro" (a tela não afirma nada), que é o estado da API anterior a 19/08/2026. Escrever
        // um dos dois no lugar do outro apagaria a distinção que `lerCargaTributaria` existe para
        // manter.
        pTotTribFed: null,
        pTotTribEst: null,
        pTotTribMun: "2.50",
        atividades: ["71.12-0-00"],
        cnaePrincipal: "7112000",
      },
    },
  ];

  const usuarios = [
    {
      id: "u-cliente-1",
      email: "cliente@exemplo.com",
      senha: "123456",
      role: "cliente",
      accountType: "CLIENT",
      name: "Ana Ribeiro",
      defaultClientId: "pc-001",
      empresas: ["pc-001", "pc-002", "pc-003", "pc-004", "pc-005", "pc-006"],
    },
    {
      id: "u-cliente-2",
      email: "financeiro@exemplo.com",
      senha: "123456",
      role: "user",
      accountType: "CLIENT",
      name: "Carlos Menezes",
      defaultClientId: "pc-002",
      empresas: ["pc-002"],
    },
    {
      // ⚠ Existe DE PROPÓSITO: é com ela que se exercita a trava de tipo de
      // conta (not_a_client) sem precisar de backend.
      id: "u-contador-1",
      email: "contador@exemplo.com",
      senha: "123456",
      role: "contador",
      accountType: "FIRM",
      name: "Escritorio Modelo",
      defaultClientId: null,
      empresas: [],
    },
  ];

  // --- Notas -----------------------------------------------------------------
  const competencias = competenciasAte(0, 10); // 10 meses, terminando no mês corrente
  const notas = [];
  let seqNota = 1000;

  const SEED_POR_EMPRESA = { "pc-001": 20260818, "pc-002": 771203, "pc-003": 480915, "pc-004": 133742 };
  for (const empresa of empresas) {
    const rand = prng(SEED_POR_EMPRESA[empresa.companyId] || 1);
    for (const comp of competencias) {
      // O penúltimo mês da pc-002 fica sem nota: mês sem faturamento existe, e a
      // tela precisa mostrar ausência em vez de fabricar zero.
      const vazio = empresa.companyId === "pc-002" && comp === competencias[competencias.length - 2];
      const qtd = vazio ? 0 : Math.floor(rand() * 9) + 3;
      for (let i = 0; i < qtd; i += 1) {
        const [nomeTomador, docTomador] = NOMES_TOMADOR[Math.floor(rand() * NOMES_TOMADOR.length)];
        const dia = Math.min(28, Math.floor(rand() * 27) + 1);
        const sorte = rand();
        const status = sorte > 0.94 ? "CANCELADA" : sorte > 0.9 ? "SUBSTITUIDA" : "EMITIDA";
        seqNota += 1;
        notas.push({
          clientId: empresa.companyId,
          invoiceId: `inv-${seqNota}`,
          type: rand() > 0.85 ? "NFE" : "NFSE",
          numero: String(seqNota),
          competencia: comp,
          issueDate: diaDoMes(comp, dia).toISOString(),
          status,
          total: Number((rand() * 8400 + 260).toFixed(2)),
          emitente: { nome: empresa.razao, cnpj: empresa.cnpj },
          tomador: { nome: nomeTomador, cnpjCpf: docTomador },
          updatedAt: diaDoMes(comp, Math.min(28, dia + 1)).toISOString(),
          hasXml: rand() > 0.1,
          hasPdf: rand() > 0.35,
          // ⚠ A DESCRIÇÃO CHEGA NO CONTRATO desde 19/08/2026 — `PortalInvoice.xDescServ`, coluna.
          // Uma em cada seis fica SEM descrição de propósito: é o caso da nota anterior ao backfill
          // (ou cujo XML não trouxe o campo), e é ele que mantém alcançável o aviso
          // "a descrição não veio da nota de origem". Sem esse caso, o ramo some do alcance offline.
          descricao: seqNota % 6 === 0 ? null : `${nomeTomador.split(" ")[0]} — servico prestado`,
          // A nota gerada VEIO do ADN — é a projeção, o caso normal. Ver os dois casos
          // plantados logo abaixo para o estado oposto.
          confirmadaPeloAdn: true,
          // ⚠ campo interno do mock, NÃO sai no contrato: reproduz o filtro do
          // backend, que esconde canceladas por padrão (statusEfetivo).
          _statusEfetivo: status === "CANCELADA" ? "cancelada" : "autorizada",
        });
      }
    }
  }

  // ── OS DOIS ESTADOS QUE PRECISAM SER ALCANÇÁVEIS OFFLINE ──────────────────────────────────
  //
  // ⚠ SEM ISTO O CAMINHO NOVO É INALCANÇÁVEL SEM EMITIR. O mock só produzia nota confirmada e
  // com XML; a nota "emitida por nós, ainda não confirmada" só apareceria depois de uma emissão
  // no mock, e a recusa 503 do DANFSe não apareceria nunca. Precedente desta casa: o mock do
  // cliente recusava todo Lucro Presumido e ninguém via, porque a tela travava antes.
  const empresaPrincipal = empresas.find((e) => e.companyId === "pc-001");
  if (empresaPrincipal) {
    const compAtual = competencias[competencias.length - 1];
    const agoraMock = diaDoMes(compAtual, 20);

    // (1) EMITIDA POR NÓS, AINDA NÃO CONFIRMADA PELO ADN — a linha "mais clarinha".
    // ⚠ O `invoiceId` imita um `ServiceInvoice.id` de propósito: no backend ele É de outra
    // tabela, e é por isso que `/invoices/:id/xml` e o DANFSe não a encontram.
    notas.push({
      clientId: empresaPrincipal.companyId,
      invoiceId: "si-emitida-aguardando-adn",
      type: "NFSE",
      numero: null,
      competencia: compAtual,
      issueDate: agoraMock.toISOString(),
      status: "EMITIDA",
      total: 1450,
      emitente: { nome: empresaPrincipal.razao, cnpj: empresaPrincipal.cnpj },
      tomador: { nome: "TOMADOR AGUARDANDO ADN LTDA", cnpjCpf: "11222333000181" },
      updatedAt: agoraMock.toISOString(),
      hasXml: false,
      hasPdf: false,
      // ⚠ A nossa emissão não tem `xDescServ`: o extrator lê o XML que o sistema nacional devolve,
      // e ele ainda não devolveu. É o que o backend responde (`serializeEmitidaNaoConfirmada`).
      descricao: null,
      confirmadaPeloAdn: false,
      _statusEfetivo: "autorizada",
    });

    // (2) CONFIRMADA, COM XML, E SEM CHAVE DE ACESSO: é a nota em que o DANFSe é RECUSADO
    // (503 `danfse_sem_qrcode`). ⚠ O contrato do cliente não devolve `chaveAcesso`, então o
    // mock marca o caso com um campo interno — quem responde é o servidor, não a tela.
    const ontemMock = diaDoMes(compAtual, 19);
    notas.push({
      clientId: empresaPrincipal.companyId,
      invoiceId: "inv-sem-qrcode",
      type: "NFSE",
      numero: "13995",
      competencia: compAtual,
      issueDate: ontemMock.toISOString(),
      status: "EMITIDA",
      total: 640,
      emitente: { nome: empresaPrincipal.razao, cnpj: empresaPrincipal.cnpj },
      tomador: { nome: "TOMADOR MOCK 905 LTDA", cnpjCpf: "11222333090591" },
      updatedAt: ontemMock.toISOString(),
      hasXml: true,
      hasPdf: false,
      descricao: "SUPORTE TECNICO AVULSO",
      confirmadaPeloAdn: true,
      _statusEfetivo: "autorizada",
      _semQrCode: true,
    });

    // (3) ⚠⚠ UMA COMPETÊNCIA ACIMA DO TETO DO LOTE — senão a recusa `lote_muito_grande` seria
    // INALCANÇÁVEL offline, e ela é a única resposta do download em lote que a tela precisa
    // EXPLICAR (o teto existe porque cada DANFSe é gerado na hora; ver
    // `apps/api/src/application/nfse/danfse/loteDanfseDoPortal.js`). Sem este mês, o mock geraria
    // no máximo ~11 notas por competência e ninguém veria o ramo antes da produção — o precedente
    // desta casa é o mock que recusava todo Lucro Presumido sem ninguém ver.
    //
    // ⚠ VAI NO MÊS MAIS ANTIGO de propósito: a tela abre no mês CORRENTE, então nada do fluxo
    // normal fica mais lento por causa deste caso.
    const compAntiga = competencias[0];
    for (let i = 0; i < LOTE_MAXIMO_MOCK + 5; i += 1) {
      seqNota += 1;
      const dia = (i % 28) + 1;
      notas.push({
        clientId: empresaPrincipal.companyId,
        invoiceId: `inv-lote-${seqNota}`,
        type: "NFSE",
        numero: String(seqNota),
        competencia: compAntiga,
        issueDate: diaDoMes(compAntiga, dia).toISOString(),
        status: "EMITIDA",
        total: 100 + i,
        emitente: { nome: empresaPrincipal.razao, cnpj: empresaPrincipal.cnpj },
        tomador: { nome: `TOMADOR VOLUME ${i + 1} LTDA`, cnpjCpf: "11222333000181" },
        updatedAt: diaDoMes(compAntiga, dia).toISOString(),
        hasXml: true,
        hasPdf: false,
        descricao: "SERVICO RECORRENTE",
        confirmadaPeloAdn: true,
        _statusEfetivo: "autorizada",
      });
    }
  }

  // --- Guias -----------------------------------------------------------------
  // ⚠ LINHA DIGITÁVEL NO MOCK — as QUATRO situações, em rodízio, para que nenhuma delas dependa de
  // sorte para ser vista offline.
  //
  // ⚠⚠ A LINHA É UMA SÓ, REAL E FIXA — e o mock NÃO GERA linha digitável. Montar uma para cada
  // valor sorteado exigiria um gerador de código de barras dentro do projeto, que é precisamente o
  // que a regra proíbe: quem sabe montar aqui sabe montar em produção. Esta é uma linha de DAS real,
  // lida de um documento, cujos cinco dígitos verificadores fecham; ela codifica R$ 3.422,00.
  //
  // ⚠ Por isso a guia que EXIBE a linha tem o `valor` fixado em 3.422,00: a linha e o valor da guia
  // precisam concordar, senão o mock estaria desenhando como "disponível" exatamente a divergência
  // que a tela recusa a mostrar.
  const LINHA_DIGITAVEL_REAL = "858800000342220003282624010720261829070844066762";
  const VALOR_DA_LINHA = 3422.0;

  function linhaDigitavelDoMock(seq, valorSorteado) {
    const lidaEm = new Date().toISOString();
    switch (seq % 4) {
      case 0: // TEMOS A LINHA
        return {
          valor: VALOR_DA_LINHA,
          linhaDigitavel: LINHA_DIGITAVEL_REAL,
          linhaDigitavelSituacao: "DISPONIVEL",
          linhaDigitavelMotivo: null,
          linhaDigitavelValorLidoCentavos: null,
          linhaDigitavelLidaEm: lidaEm,
        };
      case 1: // DIVERGÊNCIA — a linha traz R$ 3.422,00 e a guia está com outro valor
        return {
          linhaDigitavel: null,
          linhaDigitavelSituacao: "DIVERGENTE",
          linhaDigitavelMotivo: "valor_divergente_do_documento",
          linhaDigitavelValorLidoCentavos: Math.round(VALOR_DA_LINHA * 100),
          linhaDigitavelLidaEm: lidaEm,
        };
      case 2: // TENTAMOS E NÃO DEU
        return {
          linhaDigitavel: null,
          linhaDigitavelSituacao: "NAO_ENCONTRADA",
          linhaDigitavelMotivo: "linha_digitavel_nao_encontrada_no_texto",
          linhaDigitavelValorLidoCentavos: null,
          linhaDigitavelLidaEm: lidaEm,
        };
      default: // NÃO TENTAMOS — o estado de toda guia anterior a esta leitura
        return {
          valor: valorSorteado,
          linhaDigitavel: null,
          linhaDigitavelSituacao: "NAO_TENTADA",
          linhaDigitavelMotivo: null,
          linhaDigitavelValorLidoCentavos: null,
          linhaDigitavelLidaEm: null,
        };
    }
  }

  // Só a pc-001 tem guias LIBERADAS. A rota /client já filtra `liberadaCliente`,
  // então a pc-002 responde lista vazia — que é o estado real de quem ainda não
  // teve nada liberado pelo contador.
  const guias = [];
  const circular = new Map(); // competencia -> dasTotal do extrato PGDAS-D
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let seqGuia = 500;

  {
    const empresa = empresas[0];
    const rand = prng(31415);
    for (const comp of competencias.slice(0, competencias.length - 1)) {
      const faturamento = notas
        .filter((n) => n.clientId === empresa.companyId && n.competencia === comp && n._statusEfetivo === "autorizada")
        .reduce((s, n) => s + n.total, 0);
      const das = Number((faturamento * (0.06 + rand() * 0.03)).toFixed(2));
      circular.set(comp, das);

      const [y, m] = comp.split("-").map(Number);
      // Vencimento do mês seguinte ao da competência (dia 20 = DAS, dia 20 = INSS
      // no mock; o valor real vem do PDF capturado, aqui só precisa ser coerente).
      const venc = new Date(Date.UTC(y, m, 20));
      const pago = venc < hoje && rand() > 0.25;
      const vencida = !pago && venc < hoje;

      for (const [tipo, valor] of [
        ["SIMPLES", das],
        ["INSS", Number((das * 0.42).toFixed(2))],
      ]) {
        seqGuia += 1;
        guias.push({
          _clientId: empresa.companyId,
          guideId: `gui-${seqGuia}`,
          companyId: empresa.companyId,
          competencia: comp,
          tipo,
          valor,
          valorRecalculado: null,
          vencimento: venc.toISOString(),
          status: "PROCESSED",
          emailStatus: "SENT",
          emailLastError: null,
          paymentStatus: pago ? "PAID" : vencida ? "OVERDUE" : "OPEN",
          paymentStatusSource: pago ? "SERPRO" : null,
          paymentConfirmedAt: pago ? new Date(venc.getTime() - 86400000).toISOString() : null,
          serproLastCheckedAt: null,
          serproLastCheckResult: null,
          serproService: null,
          canConfirmPayment: false,
          canRecalculate: false,
          parcelamentoId: null,
          numeroParcela: null,
          quantidadeParcelas: null,
          anoMesParcela: null,
          baixada: Boolean(pago),
          parcelaEstado: null,
          parcelamentoLabel: null,
          parcelamentoTipo: null,
          parcelamentoNumero: null,
          extracted: null,
          // ⚠ AS QUATRO SITUAÇÕES DA LINHA DIGITÁVEL, todas alcançáveis offline. O mock existe para
          // exercitar a tela, e uma tela que só é vista num dos estados é uma tela não conferida —
          // as três AUSÊNCIAS são o que mais importa aqui, e são as mais fáceis de deixar de fora.
          ...linhaDigitavelDoMock(seqGuia, valor),
          liberadaCliente: true,
          liberadaEm: venc.toISOString(),
          vazioEm: null,
          vazioPor: null,
          vazioMotivo: null,
          createdAt: venc.toISOString(),
          updatedAt: venc.toISOString(),
        });
      }
    }
    // Ordem da rota: updatedAt desc.
    guias.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  // ⚠ TOKENS DE REDEFINIÇÃO DE SENHA — os TRÊS ESTADOS, fixos e alcançáveis por URL.
  //
  // Existem com nome fixo (e não sorteados) para que a tela de redefinição possa ser aberta
  // offline em cada um dos desfechos, sem banco e sem e-mail:
  //
  //   /redefinir-senha?token=token-valido    → troca a senha
  //   /redefinir-senha?token=token-expirado  → recusa (vencido)
  //   /redefinir-senha?token=token-usado     → recusa (já consumido)
  //
  // Os dois últimos precisam existir SEPARADOS mesmo produzindo a mesma mensagem: é justamente a
  // igualdade entre eles que é a regra de segurança, e regra que não se consegue exercer não se
  // consegue conferir.
  const tokensRedefinicao = new Map([
    ["token-valido", { userId: "u-cliente-1", expiraEm: Date.now() + 60 * 60 * 1000, usado: false }],
    ["token-expirado", { userId: "u-cliente-1", expiraEm: Date.now() - 60 * 1000, usado: false }],
    ["token-usado", { userId: "u-cliente-1", expiraEm: Date.now() + 60 * 60 * 1000, usado: true }],
  ]);

  // ── NUMERAÇÃO DA NFS-e, POR EMPRESA ────────────────────────────────────────────────────────
  //
  // ⚠ EXISTE PORQUE **NÃO HÁ INUTILIZAÇÃO NA NFS-e**: número pulado é buraco permanente. O
  // servidor reserva o próximo número numa transação e, quando a tentativa falha de forma
  // corrigível, REAPROVEITA a mesma linha (`retryInvoiceId`) em vez de queimar outro. Um mock que
  // devolvesse um número novo a cada chamada faria a tela parecer certa exatamente na regra que
  // ela existe para respeitar.
  const numeracaoNfse = new Map([["pc-001", { rpsSerie: "1", proximo: 38 }]]);
  /** invoiceId → a linha da tentativa (número reservado, e se ele está retido). */
  const tentativasNfse = new Map();

  // ── A BASE DE CNPJ SIMULADA (consulta do tomador) ──────────────────────────────────────────
  //
  // ⚠ NADA AQUI SAI PARA A REDE. O par real (`api/real/brasilApi.js`) fala com a BrasilAPI; este
  // lado responde de uma tabela que mora no ESTADO do mock, pelos mesmos CNPJs que já aparecem nas
  // notas (`NOMES_TOMADOR`) — assim a consulta e a lista de notas contam a mesma história.
  //
  // ⚠ AS QUATRO RESPOSTAS BOAS SÃO QUATRO DESFECHOS DIFERENTES, e existem separadas por isso: a
  // regra do endereço é TUDO OU NADA e a do código IBGE é aceitação POR PROVA. Uma base só com
  // respostas perfeitas deixaria os dois ramos mais importantes sem desenho conferido offline.
  //
  //   11222333000181  completa e ATIVA          → nome + endereço inteiro entram
  //   22333444000172  ATIVA, endereço SEM NÚMERO→ ⚠ nada de endereço é escrito, e a tela diz o quê
  //   33444555000163  ATIVA, código IBGE que NÃO bate com o município/UF da MESMA resposta
  //                                             → o código é recusado, e o endereço cai junto
  //   44555666000154  situação BAIXADA          → aviso; a emissão segue normalmente
  //   00000000000191  → 404 (não encontrado)
  //   99999999000199  → falha de rede
  //   qualquer outro  → 404 (não encontrado)
  const baseCnpj = new Map([
    [
      "11222333000181",
      {
        razao_social: "COMERCIAL AURORA LTDA",
        descricao_situacao_cadastral: "ATIVA",
        cep: "01310930",
        descricao_tipo_de_logradouro: "AVENIDA",
        logradouro: "PAULISTA",
        numero: "1578",
        complemento: "CONJ 42",
        bairro: "BELA VISTA",
        municipio: "São Paulo",
        uf: "SP",
        codigo_municipio_ibge: "3550308",
      },
    ],
    [
      "22333444000172",
      {
        razao_social: "STUDIO VERTICE ARQUITETURA ME",
        descricao_situacao_cadastral: "ATIVA",
        cep: "36010000",
        descricao_tipo_de_logradouro: "RUA",
        logradouro: "HALFELD",
        numero: "", // ⚠ o furo do cenário
        bairro: "CENTRO",
        municipio: "Juiz de Fora",
        uf: "MG",
        codigo_municipio_ibge: "3136702",
      },
    ],
    [
      "33444555000163",
      {
        razao_social: "DELTA LOGISTICA S.A.",
        descricao_situacao_cadastral: "ATIVA",
        cep: "80010000",
        descricao_tipo_de_logradouro: "RUA",
        logradouro: "XV DE NOVEMBRO",
        numero: "300",
        bairro: "CENTRO",
        municipio: "Curitiba",
        uf: "PR",
        // ⚠ 3550308 é São Paulo/SP. A resposta diz Curitiba/PR. As três provas do
        // `codigoMunicipioVerificado` existem exatamente para este caso.
        codigo_municipio_ibge: "3550308",
      },
    ],
    [
      "44555666000154",
      {
        razao_social: "PREFEITURA MUNICIPAL DE SAO BENTO",
        descricao_situacao_cadastral: "BAIXADA",
        motivo_situacao_cadastral: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA",
        data_situacao_cadastral: "2024-11-30",
        cep: "58500000",
        descricao_tipo_de_logradouro: "PRACA",
        logradouro: "DA BANDEIRA",
        numero: "1",
        bairro: "CENTRO",
        municipio: "São Bento",
        uf: "PB",
        // ⚠ 2513901 conferido contra a lista versionada. O primeiro palpite deste cenário foi
        // 2513851, que é **Santo André/PB** — o erro que as três provas existem para pegar.
        codigo_municipio_ibge: "2513901",
      },
    ],
  ]);

  return {
    empresas,
    usuarios,
    notas,
    guias,
    circular,
    sessoes: new Map(),
    tokensRedefinicao,
    numeracaoNfse,
    tentativasNfse,
    baseCnpj,
  };
}

const estado = criarEstado();

// -----------------------------------------------------------------------------
// Sessão simulada
// -----------------------------------------------------------------------------

let seqToken = 0;

function emitirTokens(usuario) {
  seqToken += 1;
  const accessToken = `mock-access-${usuario.id}-${seqToken}`;
  const refreshToken = `mock-refresh-${usuario.id}-${seqToken}`;
  estado.sessoes.set(accessToken, usuario.id);
  return { accessToken, refreshToken };
}

/** Reproduz o gate do servidor: sem token válido, a sessão morreu. */
function usuarioAutenticado() {
  const { accessToken } = lerSessao();
  const userId = accessToken ? estado.sessoes.get(accessToken) : null;
  if (!userId) {
    limparSessao({ expirou: true });
    throw new ApiError(401, "session_expired");
  }
  return estado.usuarios.find((u) => u.id === userId) || null;
}

/** Reproduz `requireClientCompanyAccess`: empresa fora do vínculo é 403. */
function exigirAcessoEmpresa(companyId) {
  const usuario = usuarioAutenticado();
  const id = String(companyId || "");
  if (!id) throw new ApiError(400, "company_id_required");
  if (!usuario?.empresas.includes(id)) throw new ApiError(403, "forbidden");
  return id;
}

// -----------------------------------------------------------------------------
// API
// -----------------------------------------------------------------------------

export function createMockApi() {
  return {
    // --- Auth ---------------------------------------------------------------
    async login(email, password) {
      await dormir();
      const alvo = String(email || "").trim().toLowerCase();
      if (!alvo || !password) throw new ApiError(400, "username_password_required");
      const usuario = estado.usuarios.find((u) => u.email === alvo);
      if (!usuario || usuario.senha !== password) {
        throw new ApiError(401, "invalid_credentials");
      }
      const { accessToken, refreshToken } = emitirTokens(usuario);
      const resposta = {
        accessToken,
        refreshToken,
        user: {
          id: usuario.id,
          role: usuario.role,
          accountType: usuario.accountType,
          defaultClientId: usuario.defaultClientId,
          name: usuario.name,
        },
      };
      // Mesma trava do real — a chamada mora nos dois para não divergirem.
      return exigirContaDeCliente(resposta);
    },

    async logout() {
      await dormir(40);
      const { accessToken } = lerSessao();
      if (accessToken) estado.sessoes.delete(accessToken);
    },

    // --- Recuperação de senha -----------------------------------------------
    //
    // ⚠ A RESPOSTA É A MESMA para e-mail cadastrado e não cadastrado, igual ao servidor. O mock
    // NÃO consulta `estado.usuarios` aqui de propósito: se ele ramificasse, a tela poderia ser
    // desenvolvida offline contra um comportamento que vaza existência e só divergiria do real em
    // produção — que é exatamente como o mock passa a mentir.
    async solicitarRedefinicao(email) {
      await dormir();
      const alvo = String(email || "").trim();
      if (!alvo) throw new ApiError(400, "email_required");
      return {
        ok: true,
        message:
          "Se houver uma conta com esse e-mail, enviamos as instruções para redefinir a senha.",
      };
    },

    // ⚠⚠ O MOCK NÃO ACEITA QUALQUER TOKEN — e essa é a razão de ele existir nesta tela.
    //
    // A regra mais importante da recuperação de senha é que token VÁLIDO, EXPIRADO e JÁ USADO se
    // comportam de formas diferentes por dentro e produzem a MESMA recusa por fora. Um mock que
    // dissesse "ok" para qualquer string deixaria essa regra sem prova offline: a tela de erro
    // nunca seria exercida, e o desenvolvedor só descobriria o desenho dela em produção, com um
    // cliente trancado do lado de fora.
    //
    // Os três estados são alcançáveis por URL, sem banco e sem e-mail:
    //   /redefinir-senha?token=token-valido    → troca a senha (e vira "usado" na hora)
    //   /redefinir-senha?token=token-expirado  → recusa
    //   /redefinir-senha?token=token-usado     → recusa
    //   qualquer outro                         → recusa
    //
    // ⚠ As três recusas são o MESMO `ApiError(400, "invalid_reset_token")`, sem motivo anexo — copiado do
    // servidor, onde a indistinguibilidade é a regra de segurança e não um detalhe de mensagem.
    async redefinirSenha(token, password) {
      await dormir();
      const t = String(token || "");
      if (!t || !password) throw new ApiError(400, "token_password_required");

      // Mesma política do backend (`application/validators/passwordPolicy.js`), e conferida ANTES
      // do token — pelo mesmo motivo de lá: `weak_password` com token válido e `invalid_token` com
      // token chutado revelariam qual dos dois foi o problema.
      const faltas = [];
      if (password.length < 8) faltas.push("pelo menos 8 caracteres");
      if (!/[a-z]/.test(password)) faltas.push("uma letra minúscula");
      if (!/[A-Z]/.test(password)) faltas.push("uma letra maiúscula");
      if (!/[0-9]/.test(password)) faltas.push("um número");
      if (!/[^A-Za-z0-9]/.test(password)) faltas.push("um caractere especial");
      if (faltas.length) {
        throw new ApiError(400, "weak_password", `A senha precisa ter: ${faltas.join(", ")}.`);
      }

      const registro = estado.tokensRedefinicao.get(t);
      if (!registro) throw new ApiError(400, "invalid_reset_token");
      if (registro.usado) throw new ApiError(400, "invalid_reset_token");
      if (registro.expiraEm <= Date.now()) throw new ApiError(400, "invalid_reset_token");

      registro.usado = true;
      // Redefinir revoga as sessões, como no servidor: quem estava logado cai.
      estado.sessoes.clear();
      const usuario = estado.usuarios.find((u) => u.id === registro.userId);
      if (usuario) usuario.senha = password;
      return { ok: true };
    },

    // --- Empresas -----------------------------------------------------------
    async getCompanies() {
      await dormir();
      const usuario = usuarioAutenticado();
      return estado.empresas.filter((e) => usuario.empresas.includes(e.companyId));
    },

    // --- Notas --------------------------------------------------------------
    async getInvoices(companyId, { competencia, page = 1, limit = 25 } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
      const pageNum = Math.max(Number(page) || 1, 1);

      const filtradas = estado.notas
        .filter((n) => n.clientId === id)
        // direcao=emitidas: no mock toda nota é emitida pela própria empresa.
        .filter((n) => (competencia ? n.competencia === competencia : true))
        // O backend esconde canceladas por padrão (e elas não somam).
        .filter((n) => n._statusEfetivo !== "cancelada")
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

      const total = filtradas.length;
      const inicio = (pageNum - 1) * take;
      const pagina = filtradas.slice(inicio, inicio + take);
      const totalAmount = filtradas.reduce((s, n) => s + n.total, 0);
      const pageAmount = pagina.reduce((s, n) => s + n.total, 0);

      return {
        data: pagina.map(({ clientId, _statusEfetivo, _semQrCode, ...rest }) => rest),
        page: pageNum,
        limit: take,
        total,
        summary: {
          totalInvoices: total,
          totalAmount: Number(totalAmount.toFixed(2)),
          pageAmount: Number(pageAmount.toFixed(2)),
        },
        sync: { lastSyncAt: new Date().toISOString(), state: "OK", stale: false, canSync: true },
      };
    },

    // O DANFSe, offline. ⚠ AS DUAS RESPOSTAS PRECISAM SER ALCANÇÁVEIS — o PDF **e** a recusa 503
    // `danfse_sem_qrcode`. Ela é a única resposta desta rota que a interface precisa EXPLICAR (um
    // DANFSe sem QR Code não é um DANFSe), e sem um caso no mock ela só apareceria em produção.
    // A nota que a produz é `_semQrCode`, plantada em `criarEstado`.
    async fetchDanfseBlob(companyId, notaId) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const nota = estado.notas.find((n) => n.clientId === id && n.invoiceId === String(notaId));
      // O backend lê `PortalInvoice`; a nota emitida-e-não-confirmada não está lá.
      if (!nota || nota.confirmadaPeloAdn === false) {
        throw new ApiError(404, "nota_nao_encontrada", "Nota não encontrada nesta empresa.");
      }
      if (!nota.hasXml) {
        throw new ApiError(
          404,
          "xml_indisponivel",
          "Esta nota não tem o XML guardado, e o DANFSe é gerado a partir dele — nada aqui é "
            + "inventado. Recapture a nota para que o XML entre na base."
        );
      }
      if (nota._semQrCode) {
        const err = new ApiError(
          503,
          "danfse_sem_qrcode",
          "O QR Code não pôde ser gerado: a chave de acesso não está no XML desta nota.",
          { motivo: "chave_ausente" }
        );
        err.motivo = "chave_ausente";
        throw err;
      }
      // ⚠ `pdfDeUmaLinha` devolve BASE64 (é o formato da rota de guia, que responde JSON). A rota
      // real do DANFSe responde o PDF **cru**, e a tela faz `res.blob()` — então o mock decodifica
      // aqui, para que o par mock/real entregue o mesmo tipo à tela.
      const base64 = pdfDeUmaLinha(`DANFSe MOCK - nota ${nota.numero}`);
      const binario = window.atob(base64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
      return new Blob([bytes], { type: "application/pdf" });
    },

    // O DANFSe EM LOTE, offline — o zip com os PDFs + `RELATORIO.txt`.
    //
    // ⚠⚠ AS QUATRO AUSÊNCIAS PRECISAM SER ALCANÇÁVEIS AQUI, e é a razão de este mock decidir em
    // vez de devolver um zip fixo. O que o servidor recusa nota a nota, ele recusa também:
    //
    //   • **NF-e** — o mock gera ~15% das notas como `type: "NFE"` (`criarEstado`);
    //   • **sem o XML guardado** — ~10% nascem com `hasXml: false`;
    //   • **sem QR Code** — a nota plantada `inv-sem-qrcode`;
    //   • **emitida e ainda não confirmada** — a nota plantada `si-emitida-aguardando-adn`.
    //
    // Sem elas, o zip do mock viria sempre completo e o `RELATORIO.txt` nunca teria uma linha —
    // ninguém veria offline o que a entrega inteira existe para dizer.
    //
    // ⚠ E o teto (`lote_muito_grande`) é alcançável pela competência mais antiga da `pc-001`.
    async baixarDanfseEmLote(companyId, { competencia } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const empresa = estado.empresas.find((e) => e.companyId === id);
      const cnpj = String(empresa?.cnpj || "").replace(/\D+/g, "");

      // ⚠ O MESMO recorte de `getInvoices` — o zip tem de conter o que a tabela mostra.
      const filtradas = estado.notas
        .filter((n) => n.clientId === id)
        .filter((n) => (competencia ? n.competencia === competencia : true))
        .filter((n) => n._statusEfetivo !== "cancelada")
        .sort((a, b) => String(a.numero || "").localeCompare(String(b.numero || "")));

      if (!filtradas.length) {
        throw new ApiError(404, "lote_vazio", "Nenhuma nota encontrada para este filtro.");
      }
      if (filtradas.length > LOTE_MAXIMO_MOCK) {
        throw new ApiError(
          400,
          "lote_muito_grande",
          `Este filtro encontrou ${filtradas.length} notas, e o download em lote gera no máximo `
            + `${LOTE_MAXIMO_MOCK} DANFSe por vez (cada um é um PDF gerado na hora, não um arquivo `
            + 'guardado). Escolha uma competência mais estreita, ou baixe as notas uma a uma pelo '
            + 'botão "Baixar DANFSe" de cada linha.',
          { encontradas: filtradas.length, maximo: LOTE_MAXIMO_MOCK }
        );
      }

      const arquivos = [];
      const falhas = [];
      const usados = new Set(["relatorio.txt"]);
      for (const nota of filtradas) {
        if (String(nota.type).toUpperCase() !== "NFSE") {
          falhas.push([nota, "é NF-e, e o documento auxiliar dela é o DANFE — este portal não o gera"]);
          continue;
        }
        if (nota.confirmadaPeloAdn === false) {
          falhas.push([nota, "esta nota foi emitida por aqui e o sistema nacional ainda não a devolveu — o DANFSe é gerado a partir do XML que vem de lá"]);
          continue;
        }
        if (!nota.hasXml) {
          falhas.push([nota, "o XML desta nota não está guardado, e o DANFSe é gerado a partir dele"]);
          continue;
        }
        if (nota._semQrCode) {
          falhas.push([nota, "o QR Code não pôde ser gerado, e um DANFSe sem QR Code não é um DANFSe (NT 008 §2.2 e §2.4.3)"]);
          continue;
        }
        // ⚠ O ESQUEMA DE NOMES É O DO SERVIDOR: CNPJ da empresa + o NÚMERO da nota (não um
        // contador sequencial — ver `nomeNoLote`, no backend). Sem número, cai no id.
        const doc = String(nota.emitente?.cnpj || cnpj || "").replace(/\D+/g, "") || "sem-cnpj";
        const sufixo = String(nota.numero || nota.invoiceId || "sem-numero").replace(/[^\w.-]+/g, "_");
        let nome = `${doc}_${sufixo}.pdf`;
        for (let i = 2; usados.has(nome.toLowerCase()); i += 1) nome = `${doc}_${sufixo}-${i}.pdf`;
        usados.add(nome.toLowerCase());
        arquivos.push([nome, bytesDeBase64(pdfDeUmaLinha(`DANFSe MOCK - nota ${nota.numero}`))]);
      }

      const linhas = [
        "DANFSe em lote — relatório do download",
        "=".repeat(60),
        `Empresa .......: ${empresa?.razao || "(sem razão social)"}`,
        `CNPJ ..........: ${cnpj || "(não informado)"}`,
        `Competência ...: ${competencia || "todas"}`,
        "",
        `PDFs neste zip ........: ${arquivos.length}`,
        `Notas no filtro .......: ${filtradas.length}`,
        `Notas SEM DANFSe ......: ${falhas.length}`,
        "",
      ];
      if (!falhas.length) {
        linhas.push("Todas as notas do filtro geraram DANFSe. Nenhuma ficou de fora.");
      } else {
        linhas.push("Estas notas NÃO geraram DANFSe:", "");
        for (const [nota, motivo] of falhas) {
          linhas.push(`  • ${nota.numero ? `nota ${nota.numero}` : `nota sem número (id ${nota.invoiceId})`} — ${motivo}`);
        }
      }
      arquivos.push(["RELATORIO.txt", bytesDeTexto(`${linhas.join("\r\n")}\r\n`)]);

      return zipArmazenado(arquivos);
    },

    // ⚠⚠ CANCELAR, offline. AS TRÊS CAMADAS PRECISAM SER ALCANÇÁVEIS — senão o desfecho de
    // TRANSPORTE (o único em que o botão DESABILITA, porque o desfecho é desconhecido) só
    // apareceria em produção, num ato irreversível. Os gatilhos vão na JUSTIFICATIVA, mesmo
    // arranjo que a emissão usa na descrição.
    //
    //   "#transporte" → 502, camada TRANSPORTE, `podeTentarDeNovo: false`
    //   "#receita"    → 422, camada RECEITA (o sistema nacional analisou e recusou)
    //   qualquer outra → cancela (no mock)
    async cancelarNota(companyId, notaId, { cMotivo, justificativa } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const empresa = estado.empresas.find((e) => e.companyId === id);
      if (!empresa?.emissaoNfseLiberada) {
        throw new ApiError(403, "EMISSAO_CLIENTE_NAO_LIBERADA", "A emissão não está liberada para esta empresa.");
      }

      const nota = estado.notas.find((n) => n.clientId === id && n.invoiceId === String(notaId));
      if (!nota) throw new ApiError(404, "nota_nao_encontrada", "Nota não encontrada nesta empresa.");
      if (nota.confirmadaPeloAdn === false) {
        throw new ApiError(422, "nota_sem_chave", "Esta nota ainda não voltou do sistema nacional.");
      }
      if (nota._statusEfetivo === "cancelada" || nota.status === "CANCELADA") {
        throw new ApiError(422, "nota_ja_cancelada", "Esta nota já consta cancelada.");
      }

      // ⚠ As MESMAS travas do servidor, com a MESMA lista fechada — ver
      // `features/notas/lib/cancelamentoNota.js` e `apps/api/.../motivosDeEvento.js`.
      const texto = String(justificativa ?? "").trim();
      if (!["1", "2", "9"].includes(String(cMotivo ?? ""))) {
        const err = new ApiError(400, "c_motivo_invalido", "O motivo do evento é de lista fechada.", {
          camada: "NOSSA",
          podeTentarDeNovo: true,
          motivosAceitos: [
            { codigo: "1", rotulo: "Erro na emissão" },
            { codigo: "2", rotulo: "Serviço não prestado" },
            { codigo: "9", rotulo: "Outros" },
          ],
        });
        throw err;
      }
      if (texto.length < 15) {
        throw new ApiError(
          400,
          "justificativa_curta",
          `A justificativa precisa ter pelo menos 15 caracteres (tem ${texto.length}).`,
          { camada: "NOSSA", podeTentarDeNovo: true }
        );
      }

      if (texto.includes("#transporte")) {
        throw new ApiError(
          502,
          "nfse_cancelamento_transporte",
          "A resposta do sistema nacional não voltou.",
          {
            camada: "TRANSPORTE",
            // ⚠⚠ É ESTE `false` que desabilita o botão na tela.
            podeTentarDeNovo: false,
            correcao:
              "NÃO envie o cancelamento de novo: consulte a situação da nota antes de decidir. "
              + "Se ela já estiver cancelada, um segundo pedido volta recusado e parece falha.",
          }
        );
      }
      if (texto.includes("#receita")) {
        throw new ApiError(
          422,
          "nfse_cancelamento_rejeitado",
          "E0046 - NFS-e cancelada não pode ser cancelada novamente.",
          { camada: "RECEITA", podeTentarDeNovo: true }
        );
      }

      nota.status = "CANCELADA";
      nota._statusEfetivo = "cancelada";
      return { ok: true, evento: "e101101", status: "cancelled", notaId: nota.invoiceId, numero: nota.numero };
    },

    // --- Guias --------------------------------------------------------------
    async getGuides(companyId, { competencia, page = 1, limit = 25 } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
      const pageNum = Math.max(Number(page) || 1, 1);

      const filtradas = estado.guias
        .filter((g) => g._clientId === id)
        .filter((g) => g.liberadaCliente) // o /client só devolve liberadas
        .filter((g) => (competencia ? g.competencia === competencia : true));

      const total = filtradas.length;
      const inicio = (pageNum - 1) * take;
      return {
        data: filtradas.slice(inicio, inicio + take).map(({ _clientId, ...rest }) => rest),
        page: pageNum,
        limit: take,
        total,
      };
    },

    async downloadGuide(companyId, guideId) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const guia = estado.guias.find((g) => g._clientId === id && g.guideId === String(guideId));
      if (!guia || !guia.liberadaCliente) throw new ApiError(404, "not_found");
      // PDF mínimo válido (uma página, um texto), gerado aqui para que o fluxo de
      // download seja exercível offline sem carregar binário no repositório.
      const pdf = pdfDeUmaLinha(`Guia ${guia.tipo} - competencia ${guia.competencia} (MOCK)`);
      return {
        url: null,
        contentBase64: pdf,
        fileName: `guia-${guia.competencia}-${guia.tipo}.pdf`,
        mimeType: "application/pdf",
        expiresIn: null,
      };
    },

    // --- Alíquota -----------------------------------------------------------
    async getAliquotas(companyId, { from, to } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const lista = faixaDeCompetencias(from, to);
      // ⚠ pct() replica o backend LETRA POR LETRA, zero fabricado incluído:
      // denominador 0 devolve 0, e não null. A tela é que precisa saber que esse
      // 0 significa "sem faturamento", não "alíquota zero".
      const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);

      const data = lista.map((comp) => {
        const faturamento = estado.notas
          .filter((n) => n.clientId === id && n.competencia === comp && n._statusEfetivo === "autorizada")
          .reduce((s, n) => s + n.total, 0);
        const impostosPagos = estado.guias
          .filter((g) => g._clientId === id && g.competencia === comp && g.paymentStatus === "PAID")
          .reduce((s, g) => s + (g.valor || 0), 0);
        const dasExtrato = id === "pc-001" ? estado.circular.get(comp) || 0 : 0;
        return {
          competencia: comp,
          faturamento: Number(faturamento.toFixed(2)),
          impostosPagos: Number(impostosPagos.toFixed(2)),
          dasExtrato: Number(dasExtrato.toFixed(2)),
          efetiva: pct(impostosPagos, faturamento),
          deReceita: pct(dasExtrato, faturamento),
        };
      });
      data.reverse(); // mais recente primeiro, igual à rota
      return data;
    },

    // --- Fluxo --------------------------------------------------------------
    async getFluxo(companyId) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const agora = new Date();
      agora.setHours(0, 0, 0, 0);
      const data = estado.guias
        .filter(
          (g) =>
            g._clientId === id &&
            g.liberadaCliente &&
            g.vencimento &&
            ["OPEN", "OVERDUE"].includes(g.paymentStatus)
        )
        .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)))
        .map((g) => ({
          id: g.guideId,
          tipo: g.tipo || "OUTRA",
          competencia: g.competencia || null,
          valor: Number(g.valor || 0),
          vencimento: g.vencimento ? g.vencimento.slice(0, 10) : null,
          paymentStatus: g.paymentStatus || "OPEN",
          vencida: g.vencimento ? new Date(g.vencimento) < agora : false,
          numeroParcela: g.numeroParcela ?? null,
        }));
      return { data, total: Number(data.reduce((s, i) => s + i.valor, 0).toFixed(2)) };
    },

    // --- Consulta do tomador na Receita (CNPJ) ------------------------------------------------
    //
    // ⚠ **NENHUMA CHAMADA DE REDE SAI DAQUI.** O par real é `api/real/brasilApi.js`, que fala com
    // a BrasilAPI de verdade; este lado responde da tabela guardada no estado do mock. Os CNPJs
    // sentinela e o que cada um produz estão documentados em `criarEstado`.
    //
    // ⚠ O CONTRATO É O MESMO DOS DOIS LADOS, inclusive na forma da recusa: `{ ok:false, motivo,
    // mensagem }` e **nunca** um erro lançado. Um `throw` aqui entraria no
    // `real_with_mock_fallback` e uma queda da BrasilAPI viraria dado de empresa inventado numa
    // tela que emite nota fiscal.
    //
    // ⚠ CPF NÃO CHEGA AQUI — quem não pergunta é a tela (`decidirConsulta`). Se chegasse mesmo
    // assim, cai no `cnpj_incompleto` abaixo, que é o mesmo do real.
    async consultarCnpj(cnpj) {
      await dormir(320); // consulta externa demora mais que uma leitura local
      const digitos = String(cnpj || "").replace(/\D+/g, "").slice(0, 14);
      if (digitos.length !== 14) {
        return { ok: false, motivo: "cnpj_incompleto", mensagem: "Informe os 14 dígitos do CNPJ." };
      }
      if (digitos === "99999999000199") {
        return {
          ok: false,
          motivo: "rede",
          // ⚠ MESMA FRASE DO REAL, letra por letra (`api/real/brasilApi.js`): a instrução ("preencha
          // à mão") mora na TELA, e repeti-la aqui recriaria a duplicação removida em 19/08/2026.
          mensagem: "Não conseguimos consultar a Receita agora.",
        };
      }
      const bruto = estado.baseCnpj.get(digitos);
      if (!bruto) {
        return {
          ok: false,
          motivo: "nao_encontrado",
          mensagem: "CNPJ não encontrado na base da Receita.",
        };
      }
      const texto = String(bruto.descricao_situacao_cadastral || "").trim().toUpperCase();
      return {
        ok: true,
        situacao: {
          texto: texto || null,
          ativa: texto === "ATIVA",
          motivo: String(bruto.motivo_situacao_cadastral || "").trim() || null,
          data: String(bruto.data_situacao_cadastral || "").trim() || null,
        },
        bruto,
      };
    },

    // --- O LOTE POR PLANILHA, offline -------------------------------------------------------
    //
    // ⚠⚠ **NADA AQUI EMITE.** Baixar o modelo e conferir a planilha são leitura, aqui como no
    // servidor.
    //
    // ⚠⚠ **O MOCK PRECISA ALCANÇAR TODOS OS ESTADOS DE LINHA, e é por isso que ele não devolve uma
    // resposta fixa.** Este projeto já foi mordido quatro vezes por ramo que só existia em
    // produção. As linhas plantadas em `LINHAS_DO_LOTE_MOCK` cobrem, de propósito:
    //   • `pronta` pela MEMÓRIA (o *"se já emitiu antes, só preencher"*);
    //   • `conferir` com `municipio_nao_conferido` e código **válido** — a tela resolve o município;
    //   • `conferir` com `municipio_nao_conferido` e código **inexistente** — ⚠ é a linha que prova
    //     a segunda metade da prova do IBGE: a TELA rebaixa para `pendente`, o backend não pode;
    //   • `conferir` por `zero_a_esquerda_recuperado` (o CPF que o Excel comeu);
    //   • `conferir` por `email_fora_de_forma`;
    //   • `consultar` (dois CNPJs — um deles resolve, o outro serve para a consulta que FALHA);
    //   • `pendente` por `cpf_sem_endereco`, `endereco_incompleto`, `valor_ambiguo` e
    //     `competencia_ausente`.
    //
    // ⚠ **A CLASSIFICAÇÃO DE VERDADE É DO BACKEND** (`application/nfse/lote/classificarLinhaLote.js`).
    // O que roda aqui é um DUBLÊ que usa os mesmos códigos, para a tela poder ser exercitada sem
    // servidor — inclusive o ajuste, que reclassifica. Ele não é autoridade sobre nada.
    async baixarModeloDoLote(companyId) {
      await dormir();
      exigirAcessoEmpresa(companyId);
      return planilhaModeloMock();
    },

    async lerPlanilhaDoLote(companyId, arquivo, { consultas = null, ajustes = null } = {}) {
      await dormir();
      exigirAcessoEmpresa(companyId);

      // ⚠ AS RECUSAS DA LEITURA PRECISAM SER ALCANÇÁVEIS OFFLINE — senão a tela que as mostra só
      // seria vista em produção, com uma planilha de verdade na mão. O gatilho vai no NOME do
      // arquivo, mesmo arranjo que a emissão usa na descrição e o cancelamento na justificativa.
      const nome = String(arquivo?.name || "").toLowerCase();
      if (nome.includes("#cabecalho")) {
        throw new ApiError(
          422,
          "planilha_sem_cabecalho",
          "Não reconhecemos o cabeçalho desta planilha — nenhuma das colunas esperadas foi "
            + "encontrada nas primeiras linhas. Use o modelo que geramos: baixe, preencha e envie "
            + "de volta sem renomear as colunas."
        );
      }
      if (nome.includes("#vazia")) {
        throw new ApiError(
          422,
          "planilha_sem_linhas",
          "A planilha foi reconhecida, mas não há nenhuma linha preenchida abaixo do cabeçalho."
        );
      }
      if (nome.includes("#colunas")) {
        const err = new ApiError(
          422,
          "planilha_colunas_faltando",
          "Faltam colunas obrigatórias nesta planilha: Valor do serviço (R$).",
          { faltando: ["valor"] }
        );
        throw err;
      }

      // ⚠ AS RECUSAS DO AJUSTE PRECISAM SER ALCANÇÁVEIS, e vêm ANTES de aplicar qualquer coisa:
      // campo desconhecido e linha inexistente recusam NOMEANDO, e **nada é aplicado** — como no
      // servidor. Aplicar o resto e calar sobre o que não se conhece faz a correção sumir sem aviso.
      const recusaAjuste = conferirAjustesNoMock(ajustes, LINHAS_DO_LOTE_MOCK);
      if (recusaAjuste) throw recusaAjuste;

      const ajustadas = [];
      const linhas = LINHAS_DO_LOTE_MOCK.map((linha) => {
        const ajuste = lerAjusteDaLinhaMock(ajustes, linha.numero);
        if (ajuste) ajustadas.push(linha.numero);
        const valores = { ...linha.valores, ...(ajuste || {}) };
        return {
          numero: linha.numero,
          valores,
          ajustada: Boolean(ajuste),
          ...classificarLinhaNoMock(valores, { consultas }),
        };
      });

      const contar = (estado) => linhas.filter((l) => l.estado === estado).length;
      return {
        aba: "Notas",
        linhaDoCabecalho: 1,
        colunasReconhecidas: COLUNAS_DO_LOTE_MOCK,
        colunasIgnoradas: [],
        exemploDescartado: [],
        memoriaIndisponivel: null,
        linhasAjustadas: ajustadas,
        linhas,
        resumo: {
          total: linhas.length,
          prontas: contar("pronta"),
          conferir: contar("conferir"),
          consultar: contar("consultar"),
          pendentes: contar("pendente"),
        },
        aConsultar: [
          ...new Set(linhas.filter((l) => l.estado === "consultar" && l.documento).map((l) => l.documento)),
        ],
      };
    },

    // --- Emissão de NFS-e ---------------------------------------------------------------------
    //
    // ⚠⚠ **NADA AQUI EMITE COISA ALGUMA.** Nenhuma chamada de rede sai deste arquivo: a "emissão"
    // é um objeto montado em memória. A rota real (`POST /client/companies/:id/nfse`) delega ao
    // `NfseService.issue`, que fala com o **sistema nacional de PRODUÇÃO**.
    //
    // ⚠ POR QUE O MOCK PRECISA SER ESTE TANTO DE CÓDIGO. A tela de emissão tem sete desfechos com
    // desenhos diferentes — portão fechado, papel insuficiente, recusa do validador, cadastro
    // incompleto e **as três camadas** (NOSSA / TRANSPORTE / RECEITA). Só a rota real deixaria
    // todos eles sem prova offline, e o mais importante dos sete (TRANSPORTE, em que a tela
    // **proíbe** o reenvio) é justamente o que ninguém consegue provocar de propósito contra um
    // backend de verdade.
    //
    // ─── COMO ALCANÇAR CADA DESFECHO, SEM EDITAR CÓDIGO ───────────────────────────────────────
    //
    // O gatilho é uma **sentinela na descrição do serviço** — o mesmo desenho dos tokens fixos de
    // redefinição de senha (`token-expirado`, `token-usado`), e pelo mesmo motivo: sorteio faria
    // "a tela quebrou" e "deu azar" virarem a mesma coisa.
    //
    //   descrição contendo `#nossa`       → 400  camada NOSSA       (corrija e envie de novo)
    //   descrição contendo `#transporte`  → 502  camada TRANSPORTE  (⚠ NÃO reenvie — consulte)
    //   descrição contendo `#receita`     → 422  camada RECEITA     (recusa fiscal, E0014)
    //   descrição contendo `#processando` → 202  status `pending`   (não é sucesso)
    //   descrição contendo `#cadastro`    → 400  `company_missing_fields` (é do contador)
    //   descrição contendo `#revogado`    → 403  o portão fecha ENTRE abrir a tela e enviar
    //   qualquer outra descrição          → 201  emitida
    //
    // Reemitir com o `retryInvoiceId` de uma tentativa que falhou por TRANSPORTE devolve
    // **409 `nfse_numero_em_estado_indeterminado`**, igual ao servidor. A tela nunca deveria
    // chegar lá (ela não oferece reenvio nesse ramo) — o mock recusa mesmo assim, porque uma
    // guarda que só existe na tela é uma guarda que a próxima tela esquece.
    async emitirNfse(companyId, payload, { retryInvoiceId = null } = {}) {
      // Emitir demora mais que listar: o estado "enviando" precisa existir de verdade na tela.
      await dormir(650);
      const id = exigirAcessoEmpresa(companyId);
      const empresa = estado.empresas.find((e) => e.companyId === id);

      // ── 1. O PORTÃO ────────────────────────────────────────────────────────────────────────
      //
      // ⚠ O MOCK APLICA O PORTÃO, não confia na tela. Se a autorização morasse só no componente,
      // o modo offline mentiria sobre a regra mais cara desta entrega — exatamente o que
      // `accountGate.js` já evita do lado do login. Réplica de `decidirEmissaoCliente`
      // (`apps/api/src/application/nfse/emissaoClienteAutorizacao.js`).
      // ⚠ `#revogado` NÃO é um atalho de teste: é o cenário em que o contador REVOGA a liberação
      // (ou o OWNER rebaixa o papel) **entre** a tela abrir e o botão ser apertado. A tela leu o
      // portão uma vez, na carga; o servidor o confere a cada envio. Sem uma forma de provocá-lo,
      // a única recusa que chega com a nota já preenchida ficaria sem desenho conferido.
      const revogadoNoEnvio = String(payload?.servico?.descricao || "").toLowerCase().includes("#revogado");
      const recusa = revogadoNoEnvio
        ? decidirEmissaoClienteMock({ ...empresa, emissaoNfseLiberada: false })
        : decidirEmissaoClienteMock(empresa);
      if (recusa) {
        throw new ApiError(
          403,
          String(recusa.codigo).toLowerCase(),
          recusa.message,
          { error: String(recusa.codigo).toLowerCase(), ...recusa }
        );
      }

      // ── 2. O VALIDADOR ─────────────────────────────────────────────────────────────────────
      // Réplica de `validateNfsePayload` (`apps/api/src/application/validators/nfsePayload.js`),
      // limitada às recusas que ESTA tela consegue produzir. Cada `error` é o do backend, letra
      // por letra — um código diferente aqui viraria uma mensagem que o real nunca manda.
      const erroValidacao = validarPayloadNfseMock(payload);
      if (erroValidacao) {
        throw new ApiError(400, erroValidacao, erroValidacao, { error: erroValidacao });
      }

      // ── 3. O CADASTRO DA EMPRESA ───────────────────────────────────────────────────────────
      //
      // ⚠ ESTE RAMO **NÃO** É DEDUZIDO DE `empresa.legacyCompany`, e a distinção é medida: quem
      // decide é `REQUIRED_COMPANY_FIELDS` sobre a linha `Company` INTEIRA
      // (`apps/api/src/application/nfse/NfseService.js`), enquanto `legacyCompany` é a **projeção**
      // que `GET /client/companies` devolve — e o `legacyCompanySelect` de lá **não inclui
      // `Company.cnpj`**. Um mock que julgasse pela projeção recusaria toda emissão por "falta
      // CNPJ", que é um fato do select, não do cadastro. Por isso o desfecho tem sentinela própria.
      if (String(payload?.servico?.descricao || "").toLowerCase().includes("#cadastro")) {
        throw new ApiError(400, "company_missing_fields", "company_missing_fields", {
          error: "company_missing_fields",
          missing: ["codigoServicoMunicipal"],
        });
      }

      // ── 3.5. O REGIME, E A RECUSA QUE ELE PRODUZ ───────────────────────────────────────────
      //
      // ⚠ **QUEM NÃO É DO SIMPLES PRECISA DECLARAR A CARGA TRIBUTÁRIA APROXIMADA, E QUEM RECUSA É O
      // SERVIDOR.** `buildDpsXml` (`apps/api/src/application/nfse/NfseService.js`) recusa com
      // `MISSING_TOT_TRIB_NAO_SIMPLES` quando `opSimpNac ≠ 3` e algum de
      // `pTotTribFed`/`pTotTribEst`/`pTotTribMun` não é encontrado. A recusa é DELIBERADA lá: o
      // caminho antigo emitia `<vTotTribFed>0.00</vTotTribFed>`, que **afirma carga tributária
      // zero** (Lei 12.741/2012).
      //
      // ⚠⚠ **RESOLUÇÃO POR CAMPO, PAYLOAD → CADASTRO — e este mock já mentiu sobre isso.** Ele
      // julgava SÓ o payload, e por isso recusava toda empresa do Presumido: era verdade enquanto os
      // três só pudessem vir no corpo, e virou falso quando o cadastro passou a ser a fonte deles
      // (`11187501`). Cada campo resolve SOZINHO — o payload vence quando informado, e a ausência
      // dele cai no cadastro, nunca em zero. Um mock que continuasse recusando faria a tela parecer
      // travada para um regime que hoje emite.
      //
      // ⚠ O FORMULÁRIO DO CLIENTE NÃO ENVIA NENHUM DOS TRÊS, e não deve enviar: eles são
      // configuração do contador, e o payload VENCERIA o cadastro. Na prática, aqui, o valor sempre
      // vem do `legacyCompany` — o ramo do payload existe porque a REGRA do servidor é essa, e um
      // mock que só implementasse o ramo que a tela usa esconderia a precedência.
      const regimeBruto = String(empresa?.legacyCompany?.regimeTributario || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      const ehSimplesNoMock = regimeBruto === "SIMPLES" || regimeBruto === "SIMPLES_NACIONAL";
      const informadoNoMock = (v) => v !== undefined && v !== null && v !== "";
      const totTribFaltando = ["pTotTribFed", "pTotTribEst", "pTotTribMun"].filter((campo) => {
        const doPayload = payload?.totTrib?.[campo];
        const doCadastro = empresa?.legacyCompany?.[campo];
        return !informadoNoMock(doPayload) && !informadoNoMock(doCadastro);
      });
      // ⚠ Só recusa quando o regime é CONHECIDO e não é Simples. Regime que não chegou até a tela
      // (`legacyCompany: null`, as pc-002/003/004) não vira "não optante" por omissão — do lado do
      // servidor essa empresa cairia em `NFSE_REGIME_INDEFINIDO`, que é outra recusa, de outra
      // fonte (`CadastroFiscal`), e fabricá-la aqui seria o mock inventando um fato do cadastro.
      if (regimeBruto && !ehSimplesNoMock && totTribFaltando.length) {
        throw new ApiError(400, "nfse_falha_local", "falha local", {
          error: "nfse_falha_local",
          camada: "NOSSA",
          codigo: "MISSING_TOT_TRIB_NAO_SIMPLES",
          // ⚠ A LISTA VIAJA NOMEADA, como no servidor: "falta a carga tributária" mandaria conferir
          // três números; o servidor diz QUAIS, e o mock não pode dizer menos.
          faltando: totTribFaltando,
          message:
            "Empresa não optante do Simples: a carga tributária aproximada (Lei 12.741/2012) não " +
            `está completa — falta ${totTribFaltando.join(", ")}. O código emitia 0,00 nos campos ` +
            "ausentes, que AFIRMA carga zero ao tomador.",
          correcao:
            "Os percentuais de tributos aproximados (Lei 12.741/2012) são configurados pelo seu " +
            "contador, no cadastro da empresa. Fale com ele antes de emitir.",
          numeroReutilizavel: true,
          // ⚠ SEM `rpsNumero`: a recusa acontece ANTES da reserva de numeração, e é isso que ela
          // significa — nenhum número foi consumido, nada saiu da máquina. Preencher um número
          // aqui contaria a história errada sobre o que aconteceu.
          nfse: {
            companyId: id,
            tomadorNome: String(payload?.tomador?.nome || ""),
            valorServicos: Number(payload?.servico?.valorServicos),
            status: "falha_envio",
            falhaCamada: "NOSSA",
          },
        });
      }

      // ── 4. A LINHA DA TENTATIVA (numeração) ────────────────────────────────────────────────
      const anterior = retryInvoiceId ? estado.tentativasNfse.get(String(retryInvoiceId)) : null;
      if (retryInvoiceId && !anterior) {
        throw new ApiError(404, "nfse_retry_invoice_not_found", "nfse_retry_invoice_not_found", {
          error: "nfse_retry_invoice_not_found",
        });
      }
      if (anterior?.numeroRetido) {
        // ⚠ A RECUSA QUE PROTEGE O NÚMERO. Desfecho desconhecido não se resolve tentando de novo.
        throw new ApiError(409, "nfse_numero_em_estado_indeterminado", "numero em estado indeterminado", {
          error: "nfse_numero_em_estado_indeterminado",
          message:
            "A tentativa anterior desta nota terminou sem resposta do sistema nacional. O número " +
            "continua retido até que alguém consulte o Id da DPS: reemitir agora pode gerar nota " +
            "em duplicidade, e a NFS-e não tem inutilização.",
        });
      }

      const numeracao = estado.numeracaoNfse.get(id) || { rpsSerie: "1", proximo: 1 };
      let linha = anterior;
      if (!linha) {
        // Reserva: o número só avança quando uma linha NOVA nasce. Reenvio reaproveita a de antes.
        linha = {
          id: `nfse-mock-${id}-${numeracao.proximo}`,
          companyId: id,
          rpsSerie: numeracao.rpsSerie,
          rpsNumero: String(numeracao.proximo),
          numeroRetido: false,
        };
        numeracao.proximo += 1;
        estado.numeracaoNfse.set(id, numeracao);
        estado.tentativasNfse.set(linha.id, linha);
      }

      const descricao = String(payload?.servico?.descricao || "").toLowerCase();
      const nfseBase = {
        id: linha.id,
        companyId: id,
        rpsSerie: linha.rpsSerie,
        rpsNumero: linha.rpsNumero,
        tomadorNome: String(payload?.tomador?.nome || ""),
        tomadorDoc: String(payload?.tomador?.cnpjCpf || "").replace(/\D+/g, ""),
        valorServicos: Number(payload?.servico?.valorServicos),
        competencia: payload?.competencia || null,
      };

      // ── 5. OS DESFECHOS ────────────────────────────────────────────────────────────────────
      if (descricao.includes("#nossa")) {
        // Camada NOSSA: recusamos ANTES de enviar. Nada saiu da máquina e o número segue intacto.
        throw new ApiError(400, "nfse_falha_local", "falha local", {
          error: "nfse_falha_local",
          camada: "NOSSA",
          codigo: "MISSING_P_TOT_TRIB_SN",
          message:
            "A alíquota efetiva do Simples Nacional (pTotTribSN) é exigida quando opSimpNac=3 e não foi informada.",
          correcao:
            "Informe o percentual total de tributos do Simples (pTotTribSN) no assistente de emissão. " +
            "Ele é a alíquota efetiva da empresa na competência — sai do extrato do PGDAS-D.",
          numeroReutilizavel: true,
          nfse: { ...nfseBase, status: "falha_envio", falhaCamada: "NOSSA" },
        });
      }

      if (descricao.includes("#transporte")) {
        // ⚠ A LINHA DO MEIO. O pedido saiu e ninguém sabe o desfecho: o número fica RETIDO.
        linha.numeroRetido = true;
        throw new ApiError(502, "nfse_falha_transporte", "falha de transporte", {
          error: "nfse_falha_transporte",
          camada: "TRANSPORTE",
          codigo: "ETIMEDOUT",
          message: "Falha de comunicação com o sistema nacional.",
          correcao:
            "Não se sabe se a DPS chegou a ser processada. NÃO reemita com número novo: como a " +
            "NFS-e não tem inutilização, um número pulado é buraco permanente. Consulte o Id da " +
            "DPS no sistema nacional antes de decidir.",
          numeroReutilizavel: false,
          nfse: { ...nfseBase, status: "falha_envio", falhaCamada: "TRANSPORTE" },
        });
      }

      if (descricao.includes("#receita")) {
        // Camada RECEITA: o sistema nacional analisou e recusou. Fato fiscal; o número volta a valer.
        throw new ApiError(422, "nfse_rejected", "recusada", {
          error: "nfse_rejected",
          camada: "RECEITA",
          codigo: "E0014",
          message:
            "Já existe uma DPS com a mesma série, número, município emissor e CNPJ do prestador.",
          numeroReutilizavel: true,
          nfse: { ...nfseBase, status: "rejected", falhaCamada: "RECEITA" },
        });
      }

      if (descricao.includes("#processando")) {
        // 202. ⚠ Não é sucesso: a linha existe e a nota ainda não.
        return {
          status: "pending",
          message: "Pedido aceito; a nota ainda não foi confirmada pelo sistema nacional.",
          nfse: { ...nfseBase, status: "pending" },
        };
      }

      // ── SUCESSO ────────────────────────────────────────────────────────────────────────────
      estado.tentativasNfse.delete(linha.id);
      const numeroNfse = `${linha.rpsSerie}${String(linha.rpsNumero).padStart(6, "0")}`;
      const agora = new Date();
      const competencia =
        String(payload?.competencia || "").slice(0, 7) ||
        `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

      // ⚠ O MOCK GUARDA A NOTA. Emitir e a lista de Notas não mudar é o defeito mais fácil de
      // deixar passar offline — e é o primeiro lugar onde o cliente vai conferir se deu certo.
      estado.notas.push({
        clientId: id,
        invoiceId: `inv-${linha.id}`,
        type: "NFSE",
        numero: numeroNfse,
        competencia,
        issueDate: agora.toISOString(),
        status: "EMITIDA",
        total: Number(payload?.servico?.valorServicos),
        emitente: { nome: empresa?.razao || "", cnpj: empresa?.cnpj || "" },
        tomador: { nome: nfseBase.tomadorNome, cnpjCpf: nfseBase.tomadorDoc },
        updatedAt: agora.toISOString(),
        // ⚠ A NOTA RECÉM-EMITIDA NÃO PASSOU PELO ADN, e é isso que o backend agora reflete: ela
        // entra na lista vinda de `ServiceInvoice`, sem XML nosso e sem rota de download por este
        // id. Marcá-la `hasXml: true` aqui faria o mock oferecer um botão que a produção recusa.
        hasXml: false,
        hasPdf: false,
        descricao: null,
        confirmadaPeloAdn: false,
        _statusEfetivo: "autorizada",
      });

      return {
        status: "issued",
        message: "NFS-e emitida com sucesso (padrão nacional).",
        nfse: {
          ...nfseBase,
          status: "issued",
          numeroNfse,
          chaveAcesso: `35${agora.getFullYear()}${String(empresa?.cnpj || "").slice(0, 8)}${numeroNfse}`.slice(0, 44),
          codigoVerificacao: `MOCK${linha.rpsNumero}`,
          idDps: `DPS35503081234567800019000${linha.rpsSerie}${linha.rpsNumero}`,
          pdfUrl: null,
        },
      };
    },
  };
}


// -----------------------------------------------------------------------------
// O LOTE POR PLANILHA, offline — dublê da leitura do backend
// -----------------------------------------------------------------------------
//
// ⚠⚠ **A AUTORIDADE É `apps/api/src/application/nfse/lote/`.** O que está aqui existe para que a
// TELA seja exercitável sem servidor, e usa os MESMOS códigos de estado e de pendência — nunca
// códigos próprios. Um mock que inventasse vocabulário treinaria a tela errada.
//
// ⚠ **NENHUMA DESTAS FUNÇÕES EMITE, CONSULTA OU GRAVA.**

/** As 12 colunas, na ordem do modelo (`colunasLote.js`). */
const COLUNAS_DO_LOTE_MOCK = [
  "documento",
  "nome",
  "descricao",
  "valor",
  "competencia",
  "email",
  "cMun",
  "cep",
  "xLgr",
  "nro",
  "xBairro",
  "xCpl",
];

const ROTULOS_DO_LOTE_MOCK = [
  "CNPJ/CPF do tomador",
  "Nome / razão social do tomador",
  "Descrição do serviço",
  "Valor do serviço (R$)",
  "Data da competência (dd/mm/aaaa)",
  "E-mail do tomador",
  "Código IBGE do município do tomador",
  "CEP do tomador",
  "Logradouro do tomador",
  "Número",
  "Bairro",
  "Complemento",
];

/** Os cinco que a emissão exige JUNTOS. `xCpl` é o único opcional — aqui como lá. */
const ENDERECO_EXIGIDO_MOCK = [
  ["cMun", "o código IBGE do município"],
  ["cep", "o CEP"],
  ["xLgr", "o logradouro"],
  ["nro", "o número"],
  ["xBairro", "o bairro"],
];

/**
 * A MEMÓRIA de tomadores deste mock (`tomadores_emitidos`, do backend).
 *
 * ⚠ Um documento só: é o que faz a linha 2 sair `pronta` com `origemEndereco: "memoria"` — o
 * *"se o CNPJ já teve antes, só preencher"* do dono. Sem ele, esse ramo inteiro não existiria
 * offline.
 */
const MEMORIA_DO_LOTE_MOCK = {
  "44555666000177": {
    cMun: "3304557",
    cep: "20031005",
    xLgr: "Avenida Rio Branco",
    nro: "100",
    xBairro: "Centro",
    xCpl: "Sala 1201",
  },
};

const ENDERECO_COMPLETO_MOCK = {
  cMun: "3304557",
  cep: "20040020",
  xLgr: "Rua da Assembleia",
  nro: "10",
  xBairro: "Centro",
  xCpl: "",
};

/**
 * As linhas plantadas. ⚠ O `numero` é o do EXCEL (o cabeçalho é a linha 1) — é por ele que a tela
 * diz "linha 7" e a pessoa acha a linha na planilha dela, e é ele que chaveia o ajuste.
 */
const LINHAS_DO_LOTE_MOCK = [
  // pronta — pela MEMÓRIA (o *"se já emitiu antes, só preencher"* do dono)
  {
    numero: 2,
    valores: {
      documento: "44.555.666/0001-77",
      nome: "TOMADOR RECORRENTE LTDA",
      descricao: "Consultoria contábil de julho",
      valor: "1500,00",
      competencia: "31/07/2026",
      email: "financeiro@recorrente.com.br",
    },
  },
  // conferir — o código do município tem a forma certa e EXISTE: a tela resolve e mostra de quem é
  {
    numero: 3,
    valores: {
      documento: "22.333.444/0001-72",
      nome: "STUDIO VERTICE ARQUITETURA ME",
      descricao: "Assessoria fiscal",
      valor: "2800,00",
      competencia: "31/07/2026",
      ...ENDERECO_COMPLETO_MOCK,
    },
  },
  // ⚠⚠ conferir no SERVIDOR, pendente na TELA — o código não existe na lista oficial do IBGE.
  // É a linha que prova a segunda metade da prova: o backend não tem a lista; esta tela tem.
  {
    numero: 4,
    valores: {
      documento: "55.666.777/0001-14",
      nome: "SERVICOS DO INTERIOR LTDA",
      descricao: "Consultoria de processos",
      valor: "990,00",
      competencia: "31/07/2026",
      ...ENDERECO_COMPLETO_MOCK,
      cMun: "9999999",
    },
  },
  // conferir — o zero à esquerda do CPF, recolocado por nós (o Excel o comeu)
  {
    numero: 5,
    valores: {
      documento: "1234567890",
      nome: "MARIA DE SOUZA",
      descricao: "Aula particular",
      valor: "300,00",
      competencia: "31/07/2026",
      ...ENDERECO_COMPLETO_MOCK,
    },
  },
  // conferir — e-mail malformado. ⚠ A nota sai SEM e-mail; isto não bloqueia nada.
  {
    numero: 6,
    valores: {
      documento: "44.555.666/0001-77",
      nome: "TOMADOR RECORRENTE LTDA",
      descricao: "Consultoria contábil de agosto",
      valor: "1500,00",
      competencia: "31/07/2026",
      email: "financeiro.recorrente.com.br",
    },
  },
  // consultar → PRONTA: a consulta traz o endereço inteiro e o `cMun` passa na prova tripla
  {
    numero: 7,
    valores: {
      documento: "11.222.333/0001-81",
      nome: "COMERCIAL AURORA LTDA",
      descricao: "Implantação de sistema",
      valor: "4200,00",
      competencia: "31/07/2026",
    },
  },
  // consultar → PENDENTE: a resposta vem, mas o `cMun` dela não se prova (diz Curitiba/PR com o
  // código de São Paulo/SP). ⚠ Endereço é tudo ou nada, então o bloco inteiro cai.
  {
    numero: 8,
    valores: {
      documento: "33.444.555/0001-63",
      nome: "DELTA LOGISTICA S.A.",
      descricao: "Frete de mudança",
      valor: "1800,00",
      competencia: "31/07/2026",
    },
  },
  // ⚠⚠ consultar → a consulta FALHA (rede). É a linha que prova que uma consulta que morre no meio
  // não derruba o lote: ela vira pendência DESTA linha, com o motivo, e as outras seguem.
  {
    numero: 9,
    valores: {
      documento: "99.999.999/0001-99",
      nome: "CLIENTE SEM CADASTRO LTDA",
      descricao: "Manutenção mensal",
      valor: "800,00",
      competencia: "31/07/2026",
    },
  },
  // pendente — CPF sem endereço, e ⚠ CPF NÃO SE CONSULTA
  {
    numero: 10,
    valores: {
      documento: "123.456.789-09",
      nome: "JOAO DA SILVA",
      descricao: "Serviço de pintura",
      valor: "650,00",
      competencia: "31/07/2026",
    },
  },
  // pendente — meio endereço. ⚠ Nunca "quase pronta": o servidor recusa a emissão faltando um dos cinco
  {
    numero: 11,
    valores: {
      documento: "33.444.555/0001-03",
      nome: "LOJA DA ESQUINA LTDA",
      descricao: "Consultoria de estoque",
      valor: "1200,00",
      competencia: "31/07/2026",
      cep: "20040020",
      xLgr: "Rua da Assembleia",
    },
  },
  // pendente — valor ambíguo: mil e quinhentos ou um e meio?
  {
    numero: 12,
    valores: {
      documento: "66.777.888/0001-25",
      nome: "INDUSTRIA DO VALE LTDA",
      descricao: "Treinamento de equipe",
      valor: "1.500",
      competencia: "31/07/2026",
      ...ENDERECO_COMPLETO_MOCK,
    },
  },
  // pendente — competência em branco (num lote, a data de hoje carimbaria todas as notas)
  {
    numero: 13,
    valores: {
      documento: "77.888.999/0001-36",
      nome: "ESCRITORIO PARCEIRO LTDA",
      descricao: "Serviço de digitação",
      valor: "450,00",
      competencia: "",
      ...ENDERECO_COMPLETO_MOCK,
    },
  },
];

function soDigitosMock(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

function textoMock(v) {
  const t = String(v ?? "").trim();
  return t || null;
}

/**
 * O dublê do classificador. ⚠ Usa os códigos de `classificarLinhaLote.js`, e só os que as linhas
 * plantadas produzem — não é uma segunda implementação da regra, é o suficiente para a tela.
 */
function classificarLinhaNoMock(valores, { consultas = null } = {}) {
  const pendencias = [];
  const conferencias = [];
  const pend = (codigo, texto) => pendencias.push({ codigo, texto });
  const conf = (codigo, texto) => conferencias.push({ codigo, texto });

  // ── documento
  const digitos = soDigitosMock(valores.documento);
  let documento = null;
  let tipoDocumento = null;
  if (!digitos) {
    pend("documento_ausente", "O CNPJ/CPF do tomador está em branco.");
  } else if (digitos.length === 14) {
    documento = digitos;
    tipoDocumento = "CNPJ";
  } else if (digitos.length === 11) {
    if (cpfTemDvValidoMock(digitos)) {
      documento = digitos;
      tipoDocumento = "CPF";
    } else {
      pend("cpf_dv_invalido", "O dígito verificador deste CPF não confere — o número foi digitado errado.");
    }
  } else if (digitos.length === 10 && cpfTemDvValidoMock(`0${digitos}`)) {
    documento = `0${digitos}`;
    tipoDocumento = "CPF";
    conf(
      "zero_a_esquerda_recuperado",
      `A planilha trouxe “${String(valores.documento).trim()}” e nós lemos como o CPF ${documento}: `
        + "o Excel apaga o zero da frente em coluna numérica, e o dígito verificador fecha com ele "
        + "recolocado. Confira o CPF antes de emitir — nós mudamos o número que veio."
    );
  } else {
    pend(
      "documento_fora_de_forma",
      "O CNPJ/CPF não tem 11 nem 14 dígitos. Confira o número — e confira também se a coluna da "
        + "planilha está formatada como TEXTO, porque o Excel apaga o zero da frente."
    );
  }

  // ── nome / descrição / valor / competência
  const nome = textoMock(valores.nome);
  if (!nome) pend("nome_ausente", "O nome / razão social do tomador está em branco.");
  const descricao = textoMock(valores.descricao);
  if (!descricao) {
    pend("descricao_ausente", "A descrição do serviço está em branco. Ela sai impressa no DANFSe que vai ao tomador.");
  }

  const valorBruto = String(valores.valor ?? "").trim();
  let valor = null;
  if (!valorBruto) {
    pend("valor_ausente", "O valor do serviço está em branco.");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(valorBruto) || /^\d{1,3}(,\d{3})+$/.test(valorBruto)) {
    pend(
      "valor_ambiguo",
      "Este valor tem duas leituras possíveis — mil e quinhentos ou um e meio, conforme o separador "
        + "seja de milhar ou de decimal. Não convertemos: escreva o valor com vírgula nos centavos (1500,00)."
    );
  } else {
    valor = Number(valorBruto.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) {
      pend("valor_nao_positivo", "O valor do serviço tem de ser maior que zero.");
      valor = null;
    }
  }

  const competenciaBruta = String(valores.competencia ?? "").trim();
  let competencia = null;
  if (!competenciaBruta) {
    pend(
      "competencia_ausente",
      "A data da competência está em branco. Ela é obrigatória aqui: em branco, a nota sairia com a "
        + "data de hoje sem ninguém ver — e num lote isso carimbaria todas as notas."
    );
  } else {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(competenciaBruta);
    if (m) competencia = `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    else pend("competencia_ilegivel", `Não conseguimos ler “${competenciaBruta}” como data. Use dd/mm/aaaa.`);
  }

  // ── e-mail: opcional de verdade; malformado vai para conferência, nunca derruba a linha
  const emailBruto = String(valores.email ?? "").trim();
  const emailOk = !emailBruto || emailBruto.includes("@");
  if (!emailOk) {
    conf(
      "email_fora_de_forma",
      `O e-mail “${emailBruto}” não tem “@”. A nota sai SEM e-mail — a emissão não o exige. `
        + "Corrija se quiser que ele fique guardado."
    );
  }

  // ── endereço: planilha → memória → consulta
  const daPlanilha = {
    cMun: textoMock(valores.cMun),
    cep: soDigitosMock(valores.cep) || null,
    xLgr: textoMock(valores.xLgr),
    nro: textoMock(valores.nro),
    xBairro: textoMock(valores.xBairro),
    xCpl: textoMock(valores.xCpl),
  };
  const trouxeAlgo = Object.values(daPlanilha).some(Boolean);

  let endereco = null;
  let origemEndereco = null;
  let precisaConsulta = false;

  if (trouxeAlgo) {
    const faltam = ENDERECO_EXIGIDO_MOCK.filter(([c]) => !daPlanilha[c]).map(([, r]) => r);
    if (faltam.length) {
      pend(
        "endereco_incompleto",
        `O endereço do tomador está pela metade: falta ${faltam.join(", ")}. A nota exige o endereço `
          + "COMPLETO (só o complemento é opcional) — meio endereço faz a emissão ser recusada. "
          + "Preencha o que falta ou apague o bloco inteiro para buscarmos o endereço."
      );
    } else if (soDigitosMock(daPlanilha.cMun).length !== 7) {
      pend(
        "municipio_fora_de_forma",
        `O código IBGE do município (“${daPlanilha.cMun}”) não tem 7 dígitos. ⚠ O NOME do município `
          + "não serve no lugar do código."
      );
    } else {
      // ⚠ O servidor NÃO tem a lista oficial do IBGE — a conferência do código acontece na TELA.
      // O mock reproduz isso de propósito: é o ramo que a tela precisa exercitar.
      conf(
        "municipio_nao_conferido",
        `O código IBGE ${daPlanilha.cMun} tem a forma certa, mas não foi conferido contra a lista `
          + "oficial aqui — a conferência acontece na tela de ajuste, que tem a lista. Confira o "
          + "município antes de emitir."
      );
      endereco = daPlanilha;
      origemEndereco = "planilha";
    }
  } else if (documento) {
    const daMemoria = MEMORIA_DO_LOTE_MOCK[documento] || null;
    if (daMemoria) {
      endereco = { ...daMemoria };
      origemEndereco = "memoria";
    } else if (tipoDocumento === "CPF") {
      // ⚠ CPF NÃO SE CONSULTA — decisão do dono. Nenhuma chamada é sequer sugerida.
      pend(
        "cpf_sem_endereco",
        "O tomador é pessoa física e nunca emitimos para este CPF, então não temos o endereço — e "
          + "CPF não se consulta (a base pública é de CNPJ). Preencha o endereço do tomador nesta linha."
      );
    } else {
      const consulta = consultas ? consultas[documento] : undefined;
      if (consulta === undefined || consulta === null) {
        precisaConsulta = true;
      } else if (!consulta.ok) {
        pend(
          "consulta_falhou",
          `Não conseguimos consultar este CNPJ: ${consulta.motivo || "a consulta não respondeu"}. `
            + "Preencha o endereço do tomador nesta linha — as outras linhas seguem normalmente."
        );
      } else if (!consulta.endereco) {
        pend(
          "consulta_sem_endereco",
          `A consulta respondeu, mas não trouxe ${(consulta.faltantes || []).join(", ") || "o endereço"}. `
            + "A nota exige o endereço completo — preencha nesta linha."
        );
      } else if (consulta.cMunVerificado !== true) {
        pend(
          "consulta_municipio_nao_provado",
          "A consulta trouxe um código de município que não foi conferido contra a lista oficial do "
            + "IBGE. Não usamos código de município sem prova: a nota sairia no município errado."
        );
      } else {
        const e = consulta.endereco;
        endereco = {
          cMun: e.cMun,
          cep: soDigitosMock(e.CEP ?? e.cep) || null,
          xLgr: e.xLgr,
          nro: e.nro,
          xBairro: e.xBairro,
          xCpl: e.xCpl || null,
        };
        origemEndereco = "consulta";
      }
    }
  }

  // ⚠ A ORDEM É A PRIORIDADE, e só o último ramo produz `pronta` — igual ao backend.
  let estado;
  if (pendencias.length) estado = "pendente";
  else if (precisaConsulta) estado = "consultar";
  else if (!endereco || !origemEndereco) {
    pend("sem_endereco", "Não foi possível determinar o endereço do tomador desta linha. Preencha o endereço.");
    estado = "pendente";
  } else if (conferencias.length) estado = "conferir";
  else estado = "pronta";

  return {
    estado,
    pendencias,
    conferencias,
    documento,
    tipoDocumento,
    origemEndereco,
    dados:
      estado === "pronta" || estado === "conferir"
        ? {
            tomador: {
              doc: documento,
              nome,
              email: emailOk && emailBruto ? emailBruto : null,
              endereco: {
                cMun: endereco.cMun,
                CEP: endereco.cep,
                xLgr: endereco.xLgr,
                nro: endereco.nro,
                xCpl: endereco.xCpl,
                xBairro: endereco.xBairro,
              },
            },
            servico: { descricao, valorServicos: valor },
            competencia,
          }
        : null,
  };
}

function lerAjusteDaLinhaMock(ajustes, numero) {
  const bruto = ajustes ? ajustes[numero] ?? ajustes[String(numero)] : null;
  if (!bruto || typeof bruto !== "object") return null;
  const saida = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    saida[chave] = valor === null || valor === undefined ? "" : String(valor);
  }
  return Object.keys(saida).length ? saida : null;
}

/**
 * As duas recusas do ajuste, offline. ⚠ Elas existem porque **nada é aplicado em silêncio**: um
 * campo que o servidor não conhece some sem aviso se a recusa não aparecer.
 */
function conferirAjustesNoMock(ajustes, linhas) {
  if (!ajustes || typeof ajustes !== "object") return null;
  const numeros = new Set(linhas.map((l) => Number(l.numero)));
  const desconhecidas = [];
  const colunas = new Set();
  for (const [chaveLinha, celulas] of Object.entries(ajustes)) {
    if (!numeros.has(Number(chaveLinha))) desconhecidas.push(String(chaveLinha));
    for (const chave of Object.keys(celulas || {})) {
      if (!COLUNAS_DO_LOTE_MOCK.includes(chave)) colunas.add(chave);
    }
  }
  if (desconhecidas.length) {
    return new ApiError(
      422,
      "ajuste_linha_desconhecida",
      `Estas linhas não existem na planilha enviada: ${desconhecidas.join(", ")}. Nada foi aplicado.`,
      { linhasDesconhecidas: desconhecidas }
    );
  }
  if (colunas.size) {
    return new ApiError(
      422,
      "ajuste_coluna_desconhecida",
      `Estes campos não existem na planilha: ${[...colunas].join(", ")}. Nada foi aplicado.`,
      { colunasDesconhecidas: [...colunas] }
    );
  }
  return null;
}

/**
 * Um .xlsx MÍNIMO e VÁLIDO com o cabeçalho do modelo.
 *
 * ⚠ Ele é de verdade (abre no Excel) porque reusa o `zipArmazenado` que o DANFSe em lote já usa —
 * um arquivo corrompido com extensão `.xlsx` faria o modo offline "funcionar" até a pessoa tentar
 * abrir o arquivo. ⚠ O que ele NÃO tem é a pré-formatação de TEXTO das colunas de dígitos, que é
 * metade da defesa do zero à esquerda do CPF (a outra metade, a leitura, existe nos dois lados).
 * Quem for conferir aquela defesa precisa do modelo do SERVIDOR.
 */
function planilhaModeloMock() {
  const celula = (col, linha, valor) =>
    `<c r="${col}${linha}" t="inlineStr"><is><t xml:space="preserve">${String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</t></is></c>`;
  const colunaExcel = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`);
  const cabecalho = ROTULOS_DO_LOTE_MOCK.map((r, i) => celula(colunaExcel(i), 1, r)).join("");

  const partes = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + "</Types>",
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + "</Relationships>",
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="Notas" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + "</Relationships>",
    ],
    [
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<sheetData><row r="1">${cabecalho}</row></sheetData></worksheet>`,
    ],
  ];

  // ⚠ O tipo importa: o navegador escolhe o programa por ele. Ele vai como PARÂMETRO do zip, e não
  // reembalando o Blob depois — `blob.arrayBuffer()` não existe no jsdom, e o teste do par
  // mock/real precisa conseguir abrir este arquivo.
  return zipArmazenado(partes.map(([nome, xml]) => [nome, bytesDeTexto(xml)]), {
    tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// -----------------------------------------------------------------------------
// Réplicas das regras do backend usadas pela emissão
// -----------------------------------------------------------------------------

/** Pesos de `PESO_PAPEL_CLIENTE` (apps/api/src/application/nfse/emissaoClienteAutorizacao.js). */
const PESO_PAPEL_CLIENTE_MOCK = { OWNER: 3, CLIENT_ADMIN: 2, FINANCEIRO: 1, CLIENT_USER: 1 };

/**
 * Réplica de `decidirEmissaoCliente` — o ramo do CLIENTE (o mock não tem usuário de escritório
 * com acesso a `/client`, e `requireAccountType("CLIENT")` já barraria um).
 *
 * @returns o corpo da recusa 403, ou `null` quando pode emitir.
 */
function decidirEmissaoClienteMock(empresa) {
  const liberada = empresa?.emissaoNfseLiberada === true;
  const papel = String(empresa?.myRole || "").toUpperCase() || null;
  const peso = PESO_PAPEL_CLIENTE_MOCK[papel] || 0;
  const papelSuficiente = peso >= PESO_PAPEL_CLIENTE_MOCK.CLIENT_ADMIN;
  if (liberada && papelSuficiente) return null;

  const motivos = [];
  if (!liberada) motivos.push("EMISSAO_CLIENTE_NAO_LIBERADA");
  if (!papelSuficiente) motivos.push("EMISSAO_CLIENTE_PAPEL_INSUFICIENTE");

  // ⚠ Faltando as DUAS, o código nomeia a da EMPRESA (é a guarda de fora, e a que o contador
  // resolve) e `motivos` traz as duas — idêntico ao backend.
  const codigo = !liberada ? "EMISSAO_CLIENTE_NAO_LIBERADA" : "EMISSAO_CLIENTE_PAPEL_INSUFICIENTE";
  return {
    codigo,
    motivos,
    papel,
    papelMinimo: "CLIENT_ADMIN",
    empresaLiberada: liberada,
    message: !liberada
      ? "A emissão de NFS-e por usuários do cliente não está liberada para esta empresa."
      : papel
        ? `O papel ${papel} não alcança a emissão de NFS-e desta empresa.`
        : "Seu usuário não tem papel cadastrado nesta empresa.",
    correcao: !liberada
      ? "Peça ao escritório de contabilidade que libere a emissão desta empresa no cadastro dela."
      : "A emissão exige o papel CLIENT_ADMIN ou superior. Peça ao responsável da empresa (OWNER) que ajuste seu papel, ou que a emissão seja feita por quem já o tem.",
  };
}

/**
 * O DÍGITO VERIFICADOR DO CPF — cópia de `apps/api/src/utils/cpf.js`.
 *
 * ⚠ Vive aqui porque o mock é o par da rota real, e esta é a validação que impede emitir nota
 * contra outra pessoa por um dígito trocado. Sem ela offline, a recusa
 * `tomador_cpf_digito_invalido` nunca seria exercida e o desenho da mensagem só apareceria em
 * produção — onde a nota já saiu. É aritmética fechada (módulo 11), sem rede e sem consulta:
 * **nada de CPF é consultado em lugar nenhum** (decisão do dono, 18/08/2026).
 */
function cpfTemDvValidoMock(valor) {
  const digitos = String(valor ?? "").replace(/\D+/g, "");
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false; // sequências repetidas passam no módulo 11
  const numeros = digitos.split("").map(Number);
  for (const [ate, posicao] of [
    [9, 9],
    [10, 10],
  ]) {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += numeros[i] * (ate + 1 - i);
    const resto = soma % 11;
    const esperado = resto < 2 ? 0 : 11 - resto;
    if (numeros[posicao] !== esperado) return false;
  }
  return true;
}

/**
 * Réplica de `validateNfsePayload` — só as recusas que esta tela produz.
 *
 * ⚠ `companyId` NÃO é conferido aqui: no `/client` ele vem do path, e a fachada o sobrescreve por
 * cima do corpo. Replicar a checagem do corpo daria a impressão de que mandá-lo importa.
 *
 * @returns o código do erro (o mesmo string do backend), ou `null`.
 */
function validarPayloadNfseMock(body) {
  if (!body || typeof body !== "object") return "payload_invalido";

  const tomador = body.tomador || {};
  const doc = String(tomador.cnpjCpf || "").replace(/\D+/g, "");
  if (!doc || (doc.length !== 11 && doc.length !== 14)) return "tomador_documento_invalido";
  // ⚠ Código PRÓPRIO e distinto: "documento com tamanho errado" é campo não preenchido;
  // "DV inválido" é número digitado errado, e quem lê precisa saber que o problema está NO NÚMERO.
  if (doc.length === 11 && !cpfTemDvValidoMock(doc)) return "tomador_cpf_digito_invalido";
  if (!String(tomador.nome || "").trim()) return "tomador_nome_obrigatorio";
  const email = String(tomador.email || "").trim();
  if (email && !email.includes("@")) return "tomador_email_invalido";

  const servico = body.servico || {};
  if (!String(servico.descricao || "").trim()) return "servico_descricao_obrigatoria";
  const valor = Number(String(servico.valorServicos ?? "").replace(",", "."));
  if (!Number.isFinite(valor) || !valor || valor <= 0) return "servico_valor_invalido";

  const locBruto = String(servico.cLocPrestacao || "").replace(/\D+/g, "");
  if (locBruto && locBruto.length !== 7) return "servico_local_prestacao_invalido";

  // ⚠ `??`, não `||`: `0` é um `pTotTribSN` legítimo, e `0 || undefined` o transformaria em
  // ausente — o mesmo defeito que o backend já corrigiu.
  const pTot = body.totTrib?.pTotTribSN ?? null;
  if (pTot !== null && pTot !== "") {
    const n = Number(String(pTot).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) return "p_tot_trib_sn_invalido";
  }

  return null;
}

// Réplica de `buildCompetenciaRange` (apps/api/src/routes/client/index.js):
// 12 meses terminando no mês ANTECEDENTE, ascendente.
function faixaDeCompetencias(from, to) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s || ""));
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
  };
  const now = new Date();
  const fimPadrao = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const fim = parse(to) || fimPadrao;
  const inicio = parse(from) || new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - 11, 1));
  const out = [];
  const cur = new Date(inicio);
  let guarda = 0;
  while (cur <= fim && guarda < 60) {
    out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
    guarda += 1;
  }
  return out;
}

// PDF de uma linha, montado à mão (sem dependência) só para o mock ter um
// arquivo abrível. Não pretende ser uma guia — o texto diz MOCK.
function pdfDeUmaLinha(texto) {
  const seguro = String(texto).replace(/[\\()]/g, "");
  const conteudo = `BT /F1 12 Tf 60 760 Td (${seguro}) Tj ET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  // btoa só aceita latin-1; o conteúdo aqui é ASCII por construção.
  return window.btoa(pdf);
}

/**
 * Texto → bytes UTF-8.
 *
 * ⚠ NÃO USA `TextEncoder`, e isso é medido: o ambiente jsdom do jest deste projeto **não o expõe**
 * (`ReferenceError: TextEncoder is not defined`), enquanto o navegador expõe. Depender dele faria o
 * mock funcionar no `npm run dev` e explodir no `npm test` — ou pior, obrigaria a mexer no
 * `jest.config.js`, que é cópia deliberada do `apps/web`. São 10 linhas; a conversão é a definição
 * de UTF-8, não uma aproximação.
 */
function bytesDeTexto(texto) {
  const s = String(texto);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    let cp = s.codePointAt(i);
    if (cp > 0xffff) i += 1; // par substituto: o code point ocupa duas unidades
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return new Uint8Array(out);
}

/** base64 → bytes. Existe porque o mock produz PDF em base64 e o zip precisa de bytes. */
function bytesDeBase64(base64) {
  const binario = window.atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// UM ZIP DE VERDADE, OFFLINE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ POR QUE ISTO EXISTE, e por que é tão pequeno. O lote de DANFSe é um **zip**, e um mock que
// devolvesse qualquer Blob rotulado `application/zip` produziria um arquivo que **não abre** —
// a tela pareceria funcionar e o download seria lixo. Mesmo raciocínio de `pdfDeUmaLinha`, que
// monta um PDF mínimo mas VÁLIDO em vez de fingir um.
//
// ⚠ SEM COMPRESSÃO (método 0, "stored"), de propósito: `deflate` no navegador exigiria
// `CompressionStream` (que o jsdom dos testes não tem) ou uma biblioteca. O que se quer aqui é um
// arquivo que ABRA, não um arquivo pequeno.
//
// ⚠ NADA DISTO É USADO EM PRODUÇÃO — quem monta o zip de verdade é o `archiver` do backend.

const TABELA_CRC32 = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABELA_CRC32[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Monta um zip (entradas "stored") a partir de `[nome, bytes][]`.
 *
 * ⚠ Os nomes são ASCII por construção (dígitos de CNPJ, número da nota, `RELATORIO.txt`); o
 * CONTEÚDO vai em UTF-8 e não precisa de sinalização — só o nome precisaria.
 */
function zipArmazenado(arquivos, { tipo = "application/zip" } = {}) {
  // ⚠ `bytesDeTexto` e não `TextEncoder` — ver o comentário dele.
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const [nome, dados] of arquivos) {
    const nomeBytes = bytesDeTexto(nome);
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // assinatura do cabeçalho local
    local.setUint16(4, 20, true); // versão necessária
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // método: 0 = stored
    local.setUint16(10, 0, true); // hora
    local.setUint16(12, 0x21, true); // data (1980-01-01: o zip não guarda "agora" aqui)
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true); // tamanho comprimido = original (stored)
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nomeBytes.length, true);
    local.setUint16(28, 0, true); // extra
    locais.push(new Uint8Array(local.buffer), nomeBytes, dados);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // versão de origem
    central.setUint16(6, 20, true); // versão necessária
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0x21, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dados.length, true);
    central.setUint32(24, dados.length, true);
    central.setUint16(28, nomeBytes.length, true);
    central.setUint16(30, 0, true); // extra
    central.setUint16(32, 0, true); // comentário
    central.setUint16(34, 0, true); // disco
    central.setUint16(36, 0, true); // atributos internos
    central.setUint32(38, 0, true); // atributos externos
    central.setUint32(42, deslocamento, true); // onde está o cabeçalho local
    centrais.push(new Uint8Array(central.buffer), nomeBytes);

    deslocamento += 30 + nomeBytes.length + dados.length;
  }

  const tamanhoCentral = centrais.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(4, 0, true);
  fim.setUint16(6, 0, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);
  fim.setUint16(20, 0, true); // comentário
  // ⚠ O TIPO É PARÂMETRO porque um .xlsx TAMBÉM é um zip — e é o `type` do Blob que faz o
  // navegador oferecer o arquivo ao programa certo. Reembalar o Blob depois exigiria
  // `blob.arrayBuffer()`, que **não existe no jsdom** desta versão do Jest.
  return new Blob([...locais, ...centrais, new Uint8Array(fim.buffer)], { type: tipo });
}
