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
        codigoServicoMunicipal: "0101",
        rpsSerie: "1",
        rpsNumero: "37",
        regimeTributario: "SIMPLES_NACIONAL",
        optanteSimples: true,
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
      // ⚠ E ela também torna visível uma limitação REAL, não uma invenção do mock: o formulário
      // não oferece `pTotTribFed/Est/Mun`, e `buildDpsXml` **recusa** a emissão de quem não é do
      // Simples sem eles (`MISSING_TOT_TRIB_NAO_SIMPLES`) em vez de declarar carga zero. Ver o
      // desfecho replicado em `emitirNfse`.
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
        codigoServicoMunicipal: "0702",
        rpsSerie: "1",
        rpsNumero: "12",
        // ⚠ É ESTE CAMPO que a tela lê para decidir sobre o ISS — e ele é a SEGUNDA leitura do
        // servidor (a primeira é `CadastroFiscal.regime`, que `GET /client/companies` não manda).
        regimeTributario: "LUCRO_PRESUMIDO",
        optanteSimples: false,
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
      empresas: ["pc-001", "pc-002", "pc-003", "pc-004", "pc-005"],
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
          // ⚠ campo interno do mock, NÃO sai no contrato: reproduz o filtro do
          // backend, que esconde canceladas por padrão (statusEfetivo).
          _statusEfetivo: status === "CANCELADA" ? "cancelada" : "autorizada",
        });
      }
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
        data: pagina.map(({ clientId, _statusEfetivo, ...rest }) => rest),
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
          mensagem: "Não conseguimos consultar a Receita agora — confira e preencha à mão.",
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
      // ⚠ **QUEM NÃO É DO SIMPLES NÃO CONSEGUE EMITIR POR ESTA TELA HOJE, E ISSO É DO SERVIDOR.**
      // `buildDpsXml` (`apps/api/src/application/nfse/NfseService.js`) recusa com
      // `MISSING_TOT_TRIB_NAO_SIMPLES` quando `opSimpNac ≠ 3` e nenhum de
      // `pTotTribFed`/`pTotTribEst`/`pTotTribMun` vem no corpo — e o formulário do cliente não
      // oferece nenhum dos três. A recusa é DELIBERADA lá: o caminho antigo emitia
      // `<vTotTribFed>0.00</vTotTribFed>`, que **afirma carga tributária zero** (Lei 12.741/2012),
      // e a estrutura correta do grupo não pôde ser confirmada sem o XSD.
      //
      // ⚠ O mock replica a recusa em vez de deixar a empresa do Presumido emitir. Um mock que
      // aceitasse faria a tela parecer pronta para um regime em que ela não está — e o defeito só
      // apareceria com o cliente na frente do formulário preenchido.
      const regimeBruto = String(empresa?.legacyCompany?.regimeTributario || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      const ehSimplesNoMock = regimeBruto === "SIMPLES" || regimeBruto === "SIMPLES_NACIONAL";
      const temTotTribNaoSimples = [
        payload?.totTrib?.pTotTribFed,
        payload?.totTrib?.pTotTribEst,
        payload?.totTrib?.pTotTribMun,
      ].some((v) => v !== undefined && v !== null && v !== "");
      // ⚠ Só recusa quando o regime é CONHECIDO e não é Simples. Regime que não chegou até a tela
      // (`legacyCompany: null`, as pc-002/003/004) não vira "não optante" por omissão — do lado do
      // servidor essa empresa cairia em `NFSE_REGIME_INDEFINIDO`, que é outra recusa, de outra
      // fonte (`CadastroFiscal`), e fabricá-la aqui seria o mock inventando um fato do cadastro.
      if (regimeBruto && !ehSimplesNoMock && !temTotTribNaoSimples) {
        throw new ApiError(400, "nfse_falha_local", "falha local", {
          error: "nfse_falha_local",
          camada: "NOSSA",
          codigo: "MISSING_TOT_TRIB_NAO_SIMPLES",
          message:
            "Empresa não optante do Simples: a carga tributária aproximada (pTotTribFed/Est/Mun) não " +
            "foi informada, e o código emitia 0,00 — que afirma carga zero.",
          correcao:
            "Informe os percentuais de tributos aproximados (Lei 12.741/2012). ⚠ O formulário do " +
            "cliente não oferece esses campos hoje: a emissão de empresa não optante ainda não " +
            "passa por esta tela. Fale com o seu contador.",
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
        hasXml: true,
        hasPdf: true,
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
