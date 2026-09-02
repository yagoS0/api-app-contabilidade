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
import { competenciaPadrao } from "../../lib/format";
import { isAdminOrAbove } from "../../lib/roles";
// ⚠ Só o DRE ainda é ficção. O fluxo de caixa virou REAL em 27/08/2026, e o mock dele reproduz o
// CONTRATO do servidor — por isso mora em `api/mock/`, não em `dadosDeDemonstracao`.
import { dreDeDemonstracao } from "../../features/painel/lib/dadosDeDemonstracao";
import { dreDoMock, dreVazioDoMock } from "./dreDoMock";
import { fluxoDeCaixaDoMock } from "./fluxoDeCaixaDoMock";
import { LOTE_MAXIMO } from "../../features/notas/lib/loteDanfse";

function mockDeLancamentos(id, faturamento) {
  // ⚠⚠ A pc-001 É DO SIMPLES, E DESDE 30/08/2026 ELA TAMBÉM LÊ ESTE BLOCO — o dono mandou a
  // alíquota vir SEMPRE do que foi lançado. Sem esta linha o caminho principal da tela ficaria
  // **inalcançável offline** e o card do Simples cairia em *"não foi possível calcular pela
  // contabilidade"* no modo demonstração: a QUINTA vez que o mock esconderia um ramo nesta base.
  //
  // ⚠ A FORMA COPIA A EMPRESA REAL, medida em produção (ERISANGELA, 04–07/2026): **uma** conta de
  // imposto — `(-) DAS- SIMPLES NACIONAL` — e nada de IRPJ/CSLL, que no Simples estão dentro do
  // DAS. Um mock com quatro tributos treinaria a tela para um desenho que o Simples nunca tem.
  // ⚠ Os 6,24% são a alíquota REAL medida, não um número redondo: mock com valor cravado esconde
  // ramo, e este projeto já pagou por isso.
  if (id === "pc-001") {
    const base = Number(faturamento.toFixed(2));
    if (!(base > 0)) {
      // ⚠ Competência sem nota é o caso `SEM_LANCAMENTO`, e ele PRECISA ser alcançável: é o que a
      // tela desenha nos meses que o contador ainda não lançou.
      return {
        situacao: "SEM_LANCAMENTO", aliquota: null, base: 0, receitaBruta: 0, devolucoesEDescontos: 0,
        impostos: 0, impostoSobreReceita: 0, impostoSobreResultado: 0, impostosPorConta: [], naoClassificadas: 0,
      };
    }
    const impostoSobreReceita = Number((base * 0.0624).toFixed(2));
    // ⚠⚠ O INSS PATRONAL PRECISA EXISTIR OFFLINE (30/08/2026): é ele que separa `aliquota` de
    // `aliquotaComFolha`, e sem ele a tela mostraria os dois números IGUAIS no mock — e a frase
    // *"(INSS de X incluído)"* nunca apareceria. R$ 178,31 é o valor REAL da ERISANGELA.
    const impostoSobreFolha = 178.31;
    const impostosComFolha = Number((impostoSobreReceita + impostoSobreFolha).toFixed(2));
    return {
      situacao: "CALCULADA",
      aliquota: Number(((impostoSobreReceita / base) * 100).toFixed(4)),
      aliquotaComFolha: Number(((impostosComFolha / base) * 100).toFixed(4)),
      base,
      receitaBruta: base,
      devolucoesEDescontos: 0,
      impostos: impostoSobreReceita,
      impostosComFolha,
      impostoSobreReceita,
      impostoSobreResultado: 0,
      impostoSobreFolha,
      impostosPorConta: [
        { codigo: "557", nome: "(-) DAS- SIMPLES NACIONAL", total: impostoSobreReceita },
        { codigo: "240", nome: "INSS A PAGAR", total: impostoSobreFolha },
      ],
      naoClassificadas: 0,
    };
  }
  if (id === "pc-002") {
    const base = Number(faturamento.toFixed(2)) || 120000;
    const impostoSobreReceita = Number((base * 0.0365).toFixed(2));
    const impostoSobreResultado = Number((base * 0.0384).toFixed(2));
    const impostos = Number((impostoSobreReceita + impostoSobreResultado).toFixed(2));
    // ⚠ O CONTRAPONTO: esta empresa NÃO tem INSS lançado, então `aliquotaComFolha === aliquota` e a
    // frase do INSS NÃO aparece. Sem este caso, "com folha" e "sem folha" seriam indistinguíveis
    // offline e a guarda `impostoSobreFolha > 0` nunca seria exercida.
    return {
      situacao: "CALCULADA",
      aliquota: Number(((impostos / base) * 100).toFixed(4)),
      aliquotaComFolha: Number(((impostos / base) * 100).toFixed(4)),
      base,
      receitaBruta: base,
      devolucoesEDescontos: 0,
      impostos,
      impostosComFolha: impostos,
      impostoSobreReceita,
      impostoSobreResultado,
      impostoSobreFolha: 0,
      impostosPorConta: [
        { codigo: "420", nome: "(-) COFINS", total: Number((base * 0.03).toFixed(2)) },
        { codigo: "594", nome: "(-) IRPJ", total: Number((base * 0.024).toFixed(2)) },
        { codigo: "595", nome: "(-) CSLL", total: Number((base * 0.0144).toFixed(2)) },
        { codigo: "419", nome: "(-) PIS", total: Number((base * 0.0065).toFixed(2)) },
      ],
      naoClassificadas: 1,
    };
  }
  if (id === "pc-003") {
    return {
      situacao: "SEM_RECEITA_LANCADA",
      aliquota: null,
      base: 0,
      receitaBruta: 0,
      devolucoesEDescontos: 0,
      impostos: 1593,
      impostoSobreReceita: 1593,
      impostoSobreResultado: 0,
      impostosPorConta: [{ codigo: "419", nome: "(-) PIS", total: 1593 }],
      naoClassificadas: 0,
    };
  }
  return null;
}

const LATENCIA_MS = 140; // o suficiente para os estados de carregamento existirem de verdade

// ⚠⚠ O TETO DEIXOU DE SER COPIADO AQUI (28/08/2026) e é IMPORTADO de `features/notas/lib/loteDanfse`.
// A tela passou a precisar do mesmo número (para desabilitar a oferta de baixar toda a competência
// com o motivo), e duas cópias dentro do MESMO app é como o mock e a tela começam a discordar — o
// defeito que a tabela "mudou lá, muda aqui" registra para a fronteira API × portal.
const LOTE_MAXIMO_MOCK = LOTE_MAXIMO;

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
    {
      // ⚠⚠ A SÉTIMA EMPRESA É O **REGIME INDEFINIDO COM O FORMULÁRIO ABERTO** — e sem ela metade
      // das guardas de regime é INALCANÇÁVEL offline.
      //
      // As pc-002/003/004 já têm `legacyCompany: null`, mas nenhuma delas passa pelo portão (papel
      // baixo, não liberada, e a do estado ausente): o formulário nunca chega a montar, então o
      // ramo "não sei o regime desta empresa" só existia no papel. Este projeto foi mordido QUATRO
      // vezes por ramo que só existia em produção — e o defeito de 20/08/2026 (o `pTotTribSN` sem
      // guarda nenhuma) é exatamente dessa família.
      //
      // ⚠ O CADASTRO CHEGA INTEIRO, **menos o regime**: é o estado real de uma empresa cujo
      // `Company.regimeTributario` está em branco (a primeira leitura, `CadastroFiscal.regime`,
      // nem viaja até aqui). Não escreva `regimeTributario: null` nem `"INDEFINIDO"` — a AUSÊNCIA
      // da chave é o fato que este cenário existe para produzir.
      //
      // O que ela torna alcançável, offline: o bloco de ISS **fica** (com o aviso próprio do
      // desconhecido), a "Alíquota efetiva do Simples" **não aparece** e a carga tributária do
      // Presumido **também não** — três decisões diferentes sobre o mesmo estado.
      companyId: "pc-007",
      portalId: "pc-007",
      myRole: "OWNER",
      razao: "Aurora Studio de Design Ltda",
      cnpj: "60708090000132",
      inscricaoMunicipal: "330987",
      uf: "SC",
      municipio: "Florianopolis",
      ownerEmail: "cliente@exemplo.com",
      guideNotificationEmail: null,
      email: null,
      telefone: null,
      emissaoNfseLiberada: true,
      portalCreatedAt: "2025-11-03T09:00:00.000Z",
      portalUpdatedAt: "2026-08-18T11:20:00.000Z",
      legacyCompany: {
        id: "legacy-007",
        razaoSocial: "AURORA STUDIO DE DESIGN LTDA",
        inscricaoMunicipal: "330987",
        codigoServicoNacional: "010101",
        codigosServicoNacional: [],
        codigoServicoMunicipal: "0101",
        rpsSerie: "1",
        rpsNumero: "9",
        // ⚠ `regimeTributario` AUSENTE — ver acima. `optanteSimples` também não entra: ele existe
        // na resposta real e a tela NÃO o lê de propósito (o backend não o consulta para o
        // `opSimpNac`), então plantá-lo aqui só convidaria alguém a "consertar" a leitura.
        atividades: ["74.10-2-02 - Design de interiores"],
        cnaePrincipal: "7410202",
      },
    },
  ];

  // ── A MEMÓRIA DE TOMADORES, POR EMPRESA ────────────────────────────────────────────────────
  //
  // ⚠⚠ **NÃO É UM CADASTRO — é o registro do que a emissão TEVE.** O par real é
  // `apps/api/src/application/nfse/tomadorEmitido.js`: cada emissão autorizada escreve aqui, e não
  // existe tela de gestão, edição nem exclusão em lugar nenhum. O mock respeita isso: só
  // `emitirNfse` escreve neste mapa.
  //
  // ⚠ AS TRÊS SITUAÇÕES QUE A TELA PRECISA SABER DESENHAR estão plantadas de propósito:
  //   • **pc-001** tem três — inclusive um **sem e-mail** e um **CPF sem endereço nenhum**. É a
  //     invariante 1 do módulo real ("só o que a emissão de fato teve"): nota que saiu sem e-mail
  //     virou registro sem e-mail, e a tela não pode completar o que falta nem apagar o que a
  //     pessoa digitou por causa disso.
  //   • **pc-005** (Lucro Presumido) tem um — senão o seletor só seria exercitável no Simples, e a
  //     memória não tem nada a ver com regime.
  //   • **pc-006 e pc-007 NÃO TÊM NENHUM**, e é o caso mais fácil de esquecer: sem tomadores o
  //     seletor **não aparece**, e nada é dito. (Critério literal do dono: *"sem sugestão não
  //     precisa ser falado, pois já está sem"*.)
  //
  // ⚠ Os documentos são os MESMOS que já aparecem nas notas e na `baseCnpj` — assim a memória, a
  // lista de notas e a consulta à Receita contam a mesma história offline.
  const tomadoresEmitidos = new Map([
    [
      "pc-001",
      [
        {
          documento: "11222333000181",
          nome: "COMERCIAL AURORA LTDA",
          email: "financeiro@aurora.com.br",
          cMun: "3550308",
          cep: "01310930",
          xLgr: "AVENIDA PAULISTA",
          nro: "1578",
          xCpl: "CONJ 42",
          xBairro: "BELA VISTA",
          ultimaEmissaoEm: "2026-08-12T14:20:00.000Z",
        },
        {
          // ⚠ SEM E-MAIL: a emissão anterior não teve, e o registro guarda `null`, não `""`.
          documento: "44555666000154",
          nome: "TRANSPORTADORA SAO BENTO LTDA",
          email: null,
          cMun: "2513901",
          cep: "58730000",
          xLgr: "RUA DA MATRIZ",
          nro: "45",
          xCpl: null,
          xBairro: "CENTRO",
          ultimaEmissaoEm: "2026-07-28T09:05:00.000Z",
        },
        {
          // ⚠⚠ CPF **SEM ENDEREÇO NENHUM** — e isto acontece de verdade: o validador entrega
          // `endereco: undefined` quando qualquer um dos cinco exigidos falta, então ou os cinco
          // chegam juntos ou nenhum chega. Escolher este tomador preenche documento e nome, e o
          // endereço continua vazio — a tela não pode fingir que preencheu.
          documento: "12219079724",
          nome: "Yago Almeida Santos",
          email: "yago@example.com",
          cMun: null,
          cep: null,
          xLgr: null,
          nro: null,
          xCpl: null,
          xBairro: null,
          ultimaEmissaoEm: "2026-06-15T16:40:00.000Z",
        },
      ],
    ],
    [
      "pc-005",
      [
        {
          documento: "22333444000172",
          nome: "STUDIO VERTICE ARQUITETURA ME",
          email: null,
          cMun: "3136702",
          cep: "36010000",
          xLgr: "RUA HALFELD",
          nro: "700",
          xCpl: null,
          xBairro: "CENTRO",
          ultimaEmissaoEm: "2026-08-05T11:00:00.000Z",
        },
      ],
    ],
  ]);

  const usuarios = [
    {
      id: "u-cliente-1",
      email: "cliente@exemplo.com",
      senha: "123456",
      role: "cliente",
      accountType: "CLIENT",
      name: "Ana Ribeiro",
      defaultClientId: "pc-001",
      empresas: ["pc-001", "pc-002", "pc-003", "pc-004", "pc-005", "pc-006", "pc-007"],
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
    {
      /**
       * ⚠⚠ O VISITANTE DO ESCRITÓRIO — a conta MARCADA (30/08/2026).
       *
       * > Dono: *"não estou conseguindo acessar o portal do cliente com meu acesso de contador (…)
       * > o meu acesso admin deve ser o único a conseguir isso."*
       *
       * ⚠ Ela existe ao LADO da `contador@exemplo.com`, e é o par que dá sentido às duas: a de cima
       * continua sendo recusada (`not_a_client`) e esta entra. Só uma delas não prova regra nenhuma
       * — provaria que "conta FIRM entra", que é exatamente o desenho recusado.
       * ⚠ `podeAbrirPortalDoCliente` é a MARCA POR USUÁRIO, nunca o `role`: `admin` é bypass total
       * nos três middlewares da api, e promover a conta para abrir uma porta daria privilégio sobre
       * o sistema inteiro.
       * ⚠ `empresas` traz a carteira: no servidor a lista vem de `companyFirmAccess`, e um mock com
       * lista vazia mostraria a tela logada e VAZIA — o estado que o conserto existe para evitar.
       */
      id: "u-contador-visita",
      email: "visita@exemplo.com",
      senha: "123456",
      role: "contador",
      accountType: "FIRM",
      podeAbrirPortalDoCliente: true,
      name: "Yago (escritório)",
      defaultClientId: null,
      empresas: ["pc-001", "pc-002", "pc-005"],
    },
    {
      /**
       * ⚠⚠ O MESTRE (02/09/2026) — e ele existe aqui porque o ramo dele era INALCANÇÁVEL offline.
       *
       * > Dono: *"esse meu usuario, no portal do cliente deve ter todos os poderes, inclusive de
       * > emitir notas"* · *"nao esta feito pois ao logar nao consigo emitir"*.
       *
       * ⚠ Ele existe ao LADO da `visita@exemplo.com`, e é o par que dá sentido aos dois: a de cima
       * entra e NÃO emite; esta entra e EMITE. Só uma delas provaria a regra errada — "conta FIRM
       * marcada emite", que é o oposto do *"apenas o meu"*.
       * ⚠⚠ A diferença é o **`role: "admin"`**, nunca a marca da porta. No servidor é o `admin` que
       * `requireClientCompanyAccess` promove a OWNER, e é ele que `isAdminLike` deixa passar no
       * portão de emissão.
       * ⚠ Sexta vez que o mock esconde um ramo neste projeto: a tela desabilitava os dois botões
       * do mestre e **nenhum teste e nenhuma sessão offline podiam ver isso**, porque não havia
       * usuário `admin` aqui.
       */
      id: "u-contador-mestre",
      email: "mestre@exemplo.com",
      senha: "123456",
      role: "admin",
      accountType: "FIRM",
      podeAbrirPortalDoCliente: true,
      name: "Yago (mestre)",
      defaultClientId: null,
      empresas: ["pc-001", "pc-002", "pc-003", "pc-005"],
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
          // ⚠ `papel` passou a viajar no contrato em 20/08/2026 — sem ele a tela não distingue a
          // nota que a empresa EMITIU da que ela RECEBEU. Ver a nota `inv-recebida`, plantada abaixo.
          papel: "EMIT",
          // A nota gerada VEIO do ADN — é a projeção, o caso normal. Ver os dois casos
          // plantados logo abaixo para o estado oposto.
          confirmadaPeloAdn: true,
          // ⚠⚠ O CICLO — passou a viajar no contrato do cliente em 24/08/2026
          // (`serializeInvoice`, `apps/api/src/routes/portalInvoices.js`). Aqui ele CONCORDA com o
          // `status`, que é o caso em que o ADN mandou o evento; o caso em que ele DISCORDA — o
          // defeito inteiro — está plantado abaixo, em `inv-substituida-sem-evento`.
          // ⚠ `derivarCiclo` chama de `autorizada` tudo que não está cancelado, e a réplica aqui
          // segue a mesma regra, senão o mock ensinaria uma precedência que o servidor não tem.
          ciclo: {
            situacao: status === "CANCELADA" ? "cancelada"
              : status === "SUBSTITUIDA" ? "substituida" : "autorizada",
            ehSubstituta: false,
          },
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
      papel: "EMIT",
      confirmadaPeloAdn: false,
      _statusEfetivo: "autorizada",
    });

    // (3) ⚠⚠ NOTA RECEBIDA (`papel: "DEST"`) — a empresa é a TOMADORA, não a emitente.
    //
    // Ela existe para que o ramo "não dá para cancelar nem reaproveitar" seja ALCANÇÁVEL OFFLINE.
    // Este projeto já foi mordido três vezes na mesma semana por ramo que só existia no papel: o
    // "não é Simples", o `emitirNfse` que recusava todo Presumido, e a recusa do DANFSe sem QR.
    //
    // ⚠ E ela é alcançável de verdade em produção, não só aqui: o filtro `direcao=emitidas` da
    // listagem **só é aplicado quando o `PortalClient` tem CNPJ** (`buildWhereFilters`) — empresa
    // sem CNPJ no cadastro vê as recebidas junto com as suas.
    notas.push({
      clientId: empresaPrincipal.companyId,
      invoiceId: "inv-recebida",
      type: "NFSE",
      numero: "88001",
      competencia: compAtual,
      issueDate: diaDoMes(compAtual, 15).toISOString(),
      status: "EMITIDA",
      total: 980,
      // ⚠ INVERTIDO de propósito: quem emitiu foi OUTRO; a nossa empresa é a tomadora.
      emitente: { nome: "PRESTADOR TERCEIRO LTDA", cnpj: "44555666000177" },
      tomador: { nome: empresaPrincipal.razao, cnpjCpf: empresaPrincipal.cnpj },
      updatedAt: diaDoMes(compAtual, 15).toISOString(),
      hasXml: true,
      hasPdf: false,
      descricao: "SERVICO CONTRATADO DE TERCEIRO",
      papel: "DEST",
      confirmadaPeloAdn: true,
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
      papel: "EMIT",
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

    // (4) ⚠⚠ E UMA COMPETÊNCIA COM VOLUME **ABAIXO** DO TETO — senão o ramo em que a oferta de
    // baixar toda a competência FUNCIONA seria inalcançável offline, e só o ramo em que ela é
    // RECUSADA teria mock. São dois desenhos diferentes (botão habilitado × desabilitado com o
    // motivo), e este projeto já foi mordido quatro vezes por ramo que só existia em produção.
    //
    // ⚠ 60 notas: mais de uma página de 25 (é isso que faz a oferta aparecer) e bem abaixo dos
    // ${LOTE_MAXIMO_MOCK} (é isso que a mantém habilitada). O número não precisa ser realista —
    // precisa alcançar o ramo.
    const compMedia = competencias[1];
    for (let i = 0; i < 60; i += 1) {
      seqNota += 1;
      const dia = (i % 28) + 1;
      notas.push({
        clientId: empresaPrincipal.companyId,
        invoiceId: `inv-meio-${seqNota}`,
        type: "NFSE",
        numero: String(seqNota),
        competencia: compMedia,
        issueDate: diaDoMes(compMedia, dia).toISOString(),
        status: "EMITIDA",
        total: 900 + i,
        emitente: { nome: empresaPrincipal.razao, cnpj: empresaPrincipal.cnpj },
        tomador: { nome: `TOMADOR MENSAL ${i + 1} LTDA`, cnpjCpf: "11222333000181" },
        updatedAt: diaDoMes(compMedia, dia).toISOString(),
        // ⚠ UMA EM CADA DEZ SEM O XML: ela é contada no total (e portanto no rótulo "60 notas") e
        // NÃO gera DANFSe. É exatamente o caso que obriga o rótulo do escopo largo a falar em
        // NOTAS, e sem ele o mock faria os dois números coincidirem sempre.
        hasXml: i % 10 !== 0,
        hasPdf: false,
        descricao: "MENSALIDADE",
        papel: "EMIT",
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

  // ⚠⚠ ESTE BLOCO DIZIA "a rota /client já filtra `liberadaCliente`" E FICOU FALSO EM 30/08/2026:
  // a lista do cliente parou de filtrar (dono: *"INSS e parcelamento não aparecem"*). Só as AÇÕES
  // — baixar, recalcular, confirmar pagamento — continuam exigindo a liberação.
  //
  // ⚠⚠ POR ISSO O MOCK PRECISA DE GUIA **NÃO LIBERADA**, e ela está plantada abaixo: sem ela o
  // desenho da linha travada (botão desabilitado + a frase *"seu contador ainda não liberou"*)
  // só existiria em produção. Medido lá: **232 não liberadas contra 24 liberadas** na carteira —
  // o estado comum é justamente o que faltava offline. Sexta vez que o mock esconderia um ramo.
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
        // ⚠⚠ O INSS DA COMPETÊNCIA MAIS ANTIGA NÃO FOI LIBERADO — é o caso do dono, literalmente:
        // *"INSS e parcelamento não aparecem"*. Uma só, e da espécie que ele nomeou, para a linha
        // travada aparecer sem afogar a lista.
        const liberada = !(tipo === "INSS" && comp === competencias[0]);
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
          // ⚠ Guia não paga PODE ser confirmada pelo cliente. Cravado em `false`, o botão nasceria
          // inalcançável offline — e ele é o ponto inteiro da Fase D.
          canConfirmPayment: !pago,
          // ⚠⚠ O PEDIDO DE GUIA ATUALIZADA — e ele SÓ existe na guia VENCIDA e não paga (decisão do
          // dono). Sem estes três campos o botão nasceria inalcançável offline, e ele é o primeiro
          // do portal do cliente que GASTA dinheiro do escritório: é o que mais precisa ser visto
          // antes de ir ao ar.
          //
          // ⚠ `tipo === "SIMPLES"` porque só o DAS é recalculável aqui — a guia de INSS não é, e um
          // mock que oferecesse as duas esconderia a distinção.
          canRecalculate: vencida && tipo === "SIMPLES",
          vencida,
          vencimentoEstimado: false,
          // ⚠ O TEXTO É O DO CLIENTE: sem teto, sem custo por chamada, sem o nome do fornecedor —
          // isso é orçamento interno do escritório. É a mesma frase que `PUBLICO.CLIENTE` produz.
          avisoDeRecalculo: vencida && tipo === "SIMPLES"
            ? {
              vencida: true,
              especie: "DAS_SIMPLES",
              titulo: "Esta guia está vencida",
              texto: `Ela venceu em ${venc.toISOString().slice(0, 10).split("-").reverse().join("/")}. `
                + "Recalcular NÃO atualiza esta guia: a Receita gera uma guia NOVA, com juros e multa, "
                + "e o valor a pagar será maior. O pedido é feito ao sistema da Receita e pode "
                + "demorar alguns segundos.",
              tom: "atencao",
            }
            : null,
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
          liberadaCliente: liberada,
          // ⚠ Sem liberação não há data de liberação. Carimbar uma aqui afirmaria um ato que não
          // aconteceu — e é por campos assim que "liberada" e "não liberada" ficam indistinguíveis.
          liberadaEm: liberada ? venc.toISOString() : null,
          vazioEm: null,
          vazioPor: null,
          vazioMotivo: null,
          createdAt: venc.toISOString(),
          updatedAt: venc.toISOString(),
        });
      }
    }
    // ⚠⚠ OS TRÊS RAMOS QUE O MOCK ESCONDIA — sétima vez nesta base (31/08/2026).
    //
    // Até aqui TODA guia do mock nascia com `extracted: null`, `parcelamentoId: null` e um dos dois
    // tipos (`SIMPLES`/`INSS`). Consequência: o rótulo da **DARF consolidada do Lucro Presumido** —
    // consertado no MESMO dia, e que é o que faz a guia se chamar "PIS · COFINS" em vez de "OUTRA"
    // — era **inalcançável offline**, e o mesmo valia para a precedência da PARCELA.
    //
    // ⚠ A COMPOSIÇÃO NÃO FOI INVENTADA: as denominações são as MEDIDAS em produção em 31/08/2026
    // (`scripts/diag-denominacao-composicao.mjs`), incluindo o campo `tributo` já preenchido, que é
    // a forma de 24 dos 29 itens da base. Os VALORES são fictícios, como todo dinheiro deste mock.
    //
    // ⚠ E o `valor` que se escreve aqui pode NÃO ser o que a tela mostra: `linhaDigitavelDoMock`
    // devolve `valor` nos ramos em que a linha digitável foi lida, e o spread vem depois — de
    // propósito, para o número impresso na linha e o da guia baterem. Quem for conferir um valor
    // específico nestas linhas tem de olhar o ramo do `seq % 4`, não só o literal.
    {
      const doPresumido = empresas.find((e) => e.companyId === "pc-005");
      const compAtual = competencias[competencias.length - 2];
      const [ya, ma] = compAtual.split("-").map(Number);
      const vencDarf = new Date(Date.UTC(ya, ma, 25));
      const base = {
        _clientId: doPresumido?.companyId,
        companyId: doPresumido?.companyId,
        competencia: compAtual,
        valorRecalculado: null,
        status: "PROCESSED",
        emailStatus: "SENT",
        emailLastError: null,
        paymentStatus: "OPEN",
        paymentStatusSource: null,
        paymentConfirmedAt: null,
        serproLastCheckedAt: null,
        serproLastCheckResult: null,
        serproService: null,
        canConfirmPayment: true,
        canRecalculate: false,
        vencida: false,
        vencimentoEstimado: false,
        avisoDeRecalculo: null,
        numeroParcela: null,
        quantidadeParcelas: null,
        anoMesParcela: null,
        baixada: false,
        parcelaEstado: null,
        parcelamentoLabel: null,
        parcelamentoTipo: null,
        parcelamentoNumero: null,
        parcelamentoId: null,
        liberadaCliente: true,
        vazioEm: null,
        vazioPor: null,
        vazioMotivo: null,
        vencimento: vencDarf.toISOString(),
        createdAt: vencDarf.toISOString(),
        updatedAt: vencDarf.toISOString(),
      };
      if (doPresumido) {
        seqGuia += 1;
        guias.push({
          ...base,
          guideId: `gui-${seqGuia}`,
          // ⚠⚠ É ASSIM QUE ELA É GRAVADA: um documento só, `tipo: "OUTRA"`, com os tributos DENTRO.
          // Sem esta linha, a tela que escreve "PIS · COFINS" nunca é exercida offline.
          tipo: "OUTRA",
          valor: 1435.49,
          extracted: {
            composicao: [
              { tributo: "PIS", denominacao: "PIS - FATURAMENTO - PJ EM GERAL", total: 431.25 },
              { tributo: "COFINS", denominacao: "COFINS - FATURAMENTO/PJ EM GERAL", total: 1004.24 },
            ],
          },
          ...linhaDigitavelDoMock(seqGuia, 1435.49),
          liberadaEm: vencDarf.toISOString(),
        });
        // ⚠⚠ O CONTRAPONTO, e ele importa tanto quanto: `OUTRA` **sem composição** continua se
        // chamando "OUTRA", porque é o que está GRAVADO. Medido: 7 das 20 guias `OUTRA` da base
        // estão assim. Sem esta linha, "OUTRA" pareceria um estado que não existe mais.
        seqGuia += 1;
        guias.push({
          ...base,
          guideId: `gui-${seqGuia}`,
          tipo: "OUTRA",
          valor: 320.18,
          extracted: null,
          ...linhaDigitavelDoMock(seqGuia, 320.18),
          liberadaEm: vencDarf.toISOString(),
        });
      }
      // ⚠⚠ A PARCELA DE PARCELAMENTO — na empresa do SIMPLES, que é onde ela existe (PARCSN).
      // Ela é gravada com `tipo: "SIMPLES"`, IDÊNTICA ao DAS do mês: o que as separa é o
      // `parcelamentoId`, e o rótulo tem de decidir por ele ANTES do tipo. Sem esta linha, a
      // precedência que impede a parcela de se passar pelo DAS não é exercida offline.
      seqGuia += 1;
      guias.push({
        ...base,
        _clientId: empresas[0].companyId,
        companyId: empresas[0].companyId,
        guideId: `gui-${seqGuia}`,
        tipo: "SIMPLES",
        valor: 512.7,
        extracted: null,
        parcelamentoId: "parc-mock-1",
        numeroParcela: 7,
        quantidadeParcelas: 60,
        parcelamentoLabel: "Parcela 7 de parcelamento",
        parcelamentoTipo: "PARCSN",
        parcelamentoNumero: "0211.00012.0011122233.26-69",
        ...linhaDigitavelDoMock(seqGuia, 512.7),
        liberadaEm: vencDarf.toISOString(),
      });
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
    /**
     * ⚠ A ciência sobre guias em atraso, por empresa — `Map<companyId, string[]>`.
     *
     * ⚠⚠ Ela é POR EMPRESA, e não global: ciência numa empresa não pode silenciar o aviso de outra,
     * e este é um portal multi-empresa. É o mesmo escopo que o `where` do servidor aplica.
     * ⚠ Em memória, como as sessões: recarregar a página devolve o pop-up. É artefato do modo
     * offline, não defeito do produto — em produção quem guarda é `ciencias_de_guias`.
     */
    cienciasDeGuias: new Map(),
    /**
     * ⚠⚠ AS SAÍDAS QUE O CLIENTE ACRESCENTOU, por empresa — `Map<companyId, Array>`.
     *
     * Guarda as DUAS formas que a rota aceita, cada uma com o seu estado:
     *  • a AVULSA, que tem DATA e vira uma linha própria no dia dela;
     *  • a RECORRENTE, que tem CICLO e não tem data — ela cai em "no mês".
     *
     * ⚠⚠ **NENHUMA DAS DUAS É LANÇAMENTO CONTÁBIL**, e o mock não pode sugerir que seja: elas
     * nascem `PENDENTE` e ficam esperando o contador. É o que o servidor faz, e um mock que as
     * mostrasse como confirmadas treinaria a tela a pintar de preto o que ninguém decidiu.
     * ⚠ Em memória, como as sessões e a ciência: recarregar devolve o fluxo sem elas. Artefato do
     * modo offline — em produção quem guarda é `saidas_avulsas_cliente` e `series_recorrentes`.
     */
    saidasDoCliente: new Map(),
    // ⚠⚠ O que o cliente MEXEU nas séries do fluxo (31/08/2026): `empresa -> { serieId: dia }` e
    // `empresa -> [serieId]`. Sem eles, mudar o dia e excluir não mudariam nada na tela offline.
    diasDasSeries: new Map(),
    seriesExcluidas: new Map(),
    tokensRedefinicao,
    numeracaoNfse,
    tentativasNfse,
    tomadoresEmitidos,
    baseCnpj,
  };
}

// ── A SITUAÇÃO FISCAL DE DEMONSTRAÇÃO ────────────────────────────────────────────────────────
//
// ⚠⚠ ELE ALCANÇA TODOS OS ESTADOS DA TELA, e é a razão de o mock DECIDIR em vez de devolver uma
// resposta fixa: este projeto foi mordido quatro vezes por ramo que só existia em produção. As
// quatro empresas cobrem `nao_consultada` (sem linha), `regular` (nada consta nos dois órgãos),
// `com_pendencia` (com a tabela, o total, a anotação de lançamento, o bloco QUE NÃO VIROU TABELA e
// a linha que não fechou em colunas) e `em_parcelamento` (o bloco do SIEFPAR, que o interpretador
// lê por PARES rótulo→valor).
//
// ⚠ Os CNPJs e números aqui são fabricados, como nas fixtures do backend — formato e comprimento
// idênticos aos reais, dígitos inventados. Fixture entra no histórico do git para sempre.
const SITUACAO_FISCAL = {
  // COM PENDÊNCIA — o caso mais rico, e o único onde o total do bloco FECHA.
  "pc-001": {
    situacao: "COM_PENDENCIA",
    checkedAt: "2026-08-19T13:42:10.000Z",
    ultimoRelatorioEm: "2026-08-19T13:42:10.000Z",
    relatorio: {
      emitidoEm: "19/08/2026 13:42:10",
      contribuinte: { cnpj: "12.345.678/0001-90", nome: "VERTICE SERVICOS DIGITAIS LTDA" },
      temTexto: true,
      naoInterpretado: [],
      diagnosticos: [
        {
          orgao: "Receita Federal",
          chave: "RFB",
          semPendencia: false,
          blocos: [
            {
              titulo: "Pendência - Débito (SIEF)",
              descricao: [],
              anotacoes: ["12345678202601001"],
              colunas: ["Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Multa", "Juros", "Sdo. Dev. Cons.", "Situação"],
              registros: [
                { "Receita": "4406-01 - MAED - PGDAS-D", "PA/Exerc.": "03/2026", "Dt. Vcto": "20/04/2026", "Vl. Original": "1.200,00", "Multa": "240,00", "Juros": "78,40", "Sdo. Dev. Cons.": "1.518,40", "Situação": "DEVEDOR" },
                { "Receita": "1099-01 - CP-SEGUR.", "PA/Exerc.": "2º TRIM/2026", "Dt. Vcto": "20/07/2026", "Vl. Original": "830,00", "Multa": "83,00", "Juros": "12,30", "Sdo. Dev. Cons.": "925,30", "Situação": "DEVEDOR" },
              ],
              naoInterpretado: [],
            },
            {
              // ⚠ O BLOCO QUE NÃO VIROU TABELA: nenhuma linha dele é cabeçalho conhecido, então o
              // bloco inteiro sai em `descricao` e `naoInterpretado` fica vazio. Sem este caso, o
              // ramo que AVISA isso na tela só existiria em produção.
              titulo: "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)",
              descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"],
              anotacoes: [],
              colunas: [],
              registros: [],
              naoInterpretado: [],
            },
          ],
        },
        {
          orgao: "Procuradoria-Geral da Fazenda Nacional",
          chave: "PGFN",
          semPendencia: false,
          blocos: [
            {
              // ⚠ O bloco em que o interpretador ACHOU colunas e as linhas NÃO FECHARAM — o caso
              // com risco de dado faltando, e por isso ele é vermelho, não âmbar.
              titulo: "Pendência - Inscrição em Dívida Ativa",
              descricao: [],
              anotacoes: [],
              colunas: ["Inscrição", "Devedor", "Valor", "Situação"],
              registros: [],
              naoInterpretado: ["70.4.24.100200-96", "VERTICE SERVICOS DIGITAIS LTDA", "3.410,55"],
            },
          ],
        },
      ],
    },
  },

  // EM PARCELAMENTO — o bloco do SIEFPAR, lido por PARES rótulo→valor.
  "pc-003": {
    situacao: "EM_PARCELAMENTO",
    checkedAt: "2026-08-11T09:05:00.000Z",
    ultimoRelatorioEm: "2026-08-11T09:05:00.000Z",
    relatorio: {
      emitidoEm: "11/08/2026 09:05:00",
      contribuinte: { cnpj: "45.678.912/0001-33", nome: "FAROL CONSULTORIA EMPRESARIAL LTDA" },
      temTexto: true,
      naoInterpretado: [],
      diagnosticos: [
        {
          orgao: "Receita Federal",
          chave: "RFB",
          semPendencia: false,
          blocos: [
            {
              titulo: "Parcelamento (SIEFPAR)",
              descricao: [],
              anotacoes: [],
              colunas: ["Parcelamento", "Parcelas em atraso", "Valor em Atraso", "Valor Suspenso"],
              registros: [
                { "Parcelamento": "0211.00012.0011122233.26-69", "Parcelas em atraso": "2", "Valor em Atraso": "1.140,00", "Valor Suspenso": "9.860,00" },
              ],
              // ⚠ A modalidade que o relatório imprime SOLTA: rótulo sem valor não vira par, e
              // volta cru em vez de ser casado com o vizinho por proximidade.
              naoInterpretado: ["Parcelamento Simplificado"],
            },
          ],
        },
        { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: true, blocos: [] },
      ],
    },
  },

  // REGULAR — nada consta nos DOIS órgãos.
  "pc-004": {
    situacao: "REGULAR",
    checkedAt: "2026-08-20T16:20:00.000Z",
    ultimoRelatorioEm: "2026-08-20T16:20:00.000Z",
    relatorio: {
      emitidoEm: "20/08/2026 16:20:00",
      contribuinte: { cnpj: "32.165.498/0001-77", nome: "ALVORADA MANUTENCAO PREDIAL ME" },
      temTexto: true,
      naoInterpretado: [],
      diagnosticos: [
        { orgao: "Receita Federal", chave: "RFB", semPendencia: true, blocos: [] },
        { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: true, blocos: [] },
      ],
    },
  },

  // ⚠ ESTADO CONHECIDO SEM RELATÓRIO GUARDADO — consulta antiga, de antes de o texto ser salvo. A
  // tela não pode cair numa tabela vazia sem explicação.
  "pc-005": {
    situacao: "REGULAR",
    checkedAt: "2026-05-04T10:00:00.000Z",
    ultimoRelatorioEm: "2026-05-04T10:00:00.000Z",
    relatorio: null,
  },
};

/** ⚠ Empresa sem linha responde `situacao: null` — NUNCA CONSULTADA NÃO É "EM DIA". */
function situacaoFiscalDaEmpresa(companyId) {
  const guardada = SITUACAO_FISCAL[companyId];
  if (!guardada) {
    return { ok: true, situacao: null, checkedAt: null, ultimoRelatorioEm: null, relatorio: null };
  }
  return { ok: true, ...guardada };
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

/**
 * O PDF do DANFSe, como BLOB.
 *
 * ⚠ `pdfDeUmaLinha` devolve BASE64 (é o formato da rota de guia, que responde JSON). A rota real do
 * DANFSe responde o PDF **cru**, e a tela faz `res.blob()` — então o mock decodifica aqui, para que
 * o par mock/real entregue o mesmo TIPO à tela.
 * ⚠ Extraída em 31/08/2026 porque passaram a existir DOIS caminhos que devolvem DANFSe (a nota
 * capturada e a recém-emitida) — e duas cópias divergiriam no primeiro conserto.
 */
function pdfDoDanfse(texto) {
  const base64 = pdfDeUmaLinha(texto);
  const binario = window.atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

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
          // ⚠ O campo tem de viajar aqui como viaja no real (`sanitizeUser`): é ele que
          // `exigirContaDeCliente` lê, e sem ele o mock recusaria a conta que o servidor aceita.
          // ⚠ `=== true`, nunca truthy — ausência não é permissão, dos dois lados.
          podeAbrirPortalDoCliente: usuario.podeAbrirPortalDoCliente === true,
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
      const minhas = estado.empresas.filter((e) => usuario.empresas.includes(e.companyId));
      /**
       * ⚠⚠ O MESTRE VÊ `myRole: OWNER` E A EMISSÃO LIBERADA EM TODAS — é o que o servidor manda.
       *
       * Medido em produção (02/09/2026, `yago@altan.company`): `GET /client/companies` devolve
       * **34 de 34** com `myRole: "OWNER"` e `emissaoNfseLiberada: true`. A rota faz isso em
       * `routes/client/index.js` (`ehMestre ? "OWNER" : "FINANCEIRO"` e
       * `(ehVisitaDoEscritorio && ehMestre) || emissaoClienteLiberada === true`) porque
       * `ensureEmissaoNfseAutorizada` aceita o `admin` por `isAdminLike`, SEM consultar a flag da
       * empresa — esconder o botão aqui seria a tela recusando o que o servidor aceita.
       *
       * ⚠ Sem esta linha o mock mostraria `pc-003` (`emissaoNfseLiberada: false`) como NÃO LIBERADA
       * para o mestre, e o ramo offline discordaria da produção — a divergência mock × real que
       * este projeto já pagou várias vezes.
       * ⚠ Vale SÓ para o `admin`. A visita comum continua lendo a flag de cada empresa.
       */
      if (String(usuario.role || "").toLowerCase() === "admin") {
        return minhas.map((e) => ({ ...e, myRole: "OWNER", emissaoNfseLiberada: true }));
      }
      return minhas;
    },

    // --- Notas --------------------------------------------------------------
    async getInvoices(companyId, { competencia, direcao = "emitidas", page = 1, limit = 25 } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
      const pageNum = Math.max(Number(page) || 1, 1);

      const filtradas = estado.notas
        .filter((n) => n.clientId === id)
        // ⚠⚠ O FILTRO DE DIREÇÃO PASSOU A EXISTIR AQUI (20/08/2026). O comentário que estava nesta
        // linha dizia *"no mock toda nota é emitida pela própria empresa"* — e isso deixou de ser
        // verdade no instante em que o mock ganhou uma nota RECEBIDA (`inv-recebida`), plantada
        // para que o ramo "não dá para cancelar nota recebida" exista offline.
        //
        // ⚠ SEM ESTE FILTRO O MOCK MENTIA SOBRE O BACKEND: lá, `buildWhereFilters` recorta por
        // `emitenteDoc`/`tomadorDoc` conforme a direção, e o padrão é `emitidas`. A ausência do
        // recorte aqui fazia a recebida aparecer no recorte em que ela não aparece de verdade — e
        // isso quebrou, com razão, o teste do DANFSe em lote, que conta com o recorte padrão.
        //
        // ⚠ ELA CONTINUA ALCANÇÁVEL, por `direcao: "todas"` — e continua alcançável em PRODUÇÃO
        // pelo caminho que o backend deixa aberto: `buildWhereFilters` só aplica o recorte de
        // direção **quando o `PortalClient` tem CNPJ**. Empresa sem CNPJ no cadastro vê as
        // recebidas junto com as suas, e é por isso que a guarda do cancelamento não é decorativa.
        .filter((n) => {
          const papel = String(n.papel || "EMIT").toUpperCase();
          const alvo = String(direcao || "emitidas").toLowerCase();
          if (alvo === "todas") return true;
          if (alvo === "recebidas") return papel === "DEST";
          return papel !== "DEST";
        })
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
      /**
       * ⚠⚠ A NOTA RECÉM-EMITIDA GERA DANFSe — e este dublê dizia o contrário até 31/08/2026.
       *
       * O comentário antigo era *"o backend lê `PortalInvoice`; a nota emitida-e-não-confirmada não
       * está lá"*. Verdade em 19/08; **falso desde 24/08**, quando `danfseDaNotaDoPortal.js` passou
       * a ler também de `ServiceInvoice` a pedido do dono (*"preciso que a DANFE esteja
       * imediatamente disponível"*). O mock ficou para trás e passou a RECUSAR o que o servidor
       * serve — escondendo offline exatamente o ramo que o dono veio cobrar.
       *
       * ⚠ `hasXml` também não vale de guarda aqui: nas notas ainda não confirmadas ele é `false` de
       * propósito, e significa "a rota do XML não serve por este id" — não "não há XML".
       */
      if (!nota) {
        throw new ApiError(404, "nota_nao_encontrada", "Nota não encontrada nesta empresa.");
      }
      if (nota.confirmadaPeloAdn === false) {
        // ⚠ Sai PDF, como o servidor. O XML de onde ele nasce é o de `ServiceInvoice`, guardado na
        // emissão — por isso o ramo do `hasXml` (logo abaixo) NÃO se aplica a esta nota.
        return pdfDoDanfse(`DANFSe MOCK - nota ${nota.numero || nota.invoiceId}`);
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
      return pdfDoDanfse(`DANFSe MOCK - nota ${nota.numero}`);
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
    async baixarDanfseEmLote(companyId, { competencia, ids } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const empresa = estado.empresas.find((e) => e.companyId === id);
      const cnpj = String(empresa?.cnpj || "").replace(/\D+/g, "");

      // ⚠ O MESMO recorte de `getInvoices` — o zip tem de conter o que a tabela mostra.
      //
      // ⚠⚠ O RECORTE DE DIREÇÃO ENTROU AQUI EM 20/08/2026, e foi este comentário que o exigiu.
      // Quando o mock ganhou uma nota RECEBIDA (`inv-recebida`), `getInvoices` passou a recortar
      // por direção — como o backend sempre fez — e este bloco ficou para trás: o zip passaria a
      // conter uma nota que a tabela NÃO mostra, com o CNPJ de um terceiro no nome do arquivo.
      //
      // ⚠ O NOME COM O CNPJ DO EMITENTE NÃO É DEFEITO — é deliberado no backend
      // (`nomeNoLote`, em `application/nfse/danfse/loteDanfseDoPortal.js`: *"nos recortes
      // recebidas/todas o emitente é outro, e escrever o CNPJ da empresa num DANFSe alheio seria
      // mentira"*). O que estava errado era o recorte, não o nome.
      const filtradas = estado.notas
        .filter((n) => n.clientId === id)
        // Recorte padrão do portal do cliente: `direcao=emitidas`.
        .filter((n) => String(n.papel || "EMIT").toUpperCase() !== "DEST")
        .filter((n) => (competencia ? n.competencia === competencia : true))
        .filter((n) => n._statusEfetivo !== "cancelada")
        // ⚠⚠ OS IDS SÃO UM FILTRO A MAIS, COMO NO SERVIDOR — nunca um atalho que pule os de cima.
        // Um mock que aceitasse ids sem reaplicar o recorte de direção entregaria offline um zip que
        // o servidor recusaria, e treinaria a tela errada. ⚠ Lista vazia não vira "baixe tudo": ela
        // filtra tudo fora e cai em `lote_vazio`, que é a mesma resposta do real.
        .filter((n) => (Array.isArray(ids) && ids.length ? ids.includes(n.invoiceId) : true))
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
      // ⚠⚠ A MESMA RECUSA DO SERVIDOR: cancelar é ato do EMITENTE. Sem isto o mock deixaria
      // cancelar a nota recebida e o ramo pareceria funcionar offline — que é pior que não existir.
      if (String(nota.papel || "").toUpperCase() === "DEST") {
        throw new ApiError(
          422,
          "nota_recebida",
          "Esta nota foi emitida PARA a sua empresa — o cancelamento é ato de quem emitiu.",
          { camada: "NOSSA", podeTentarDeNovo: false }
        );
      }
      if (String(nota.type || "").toUpperCase() !== "NFSE") {
        throw new ApiError(422, "nota_nao_e_nfse", "Este portal cancela apenas NFS-e.", {
          camada: "NOSSA", podeTentarDeNovo: false,
        });
      }
      /**
       * ⚠⚠ A recusa `confirmadaPeloAdn === false` SAIU em 31/08/2026 — a rota real passou a ler
       * `ServiceInvoice` e cancela a nota recém-emitida (dono: *"quero poder cancelar logo após a
       * emissão, simples"*). O mock recusava o que o servidor aceita, escondendo o ramo offline.
       */
      if (nota._statusEfetivo === "cancelada" || nota.status === "CANCELADA"
        || nota.status === "CANCELAMENTO_ENVIADO") {
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

      /**
       * ⚠⚠ `CANCELAMENTO_ENVIADO`, não `CANCELADA` — como a produção (31/08/2026). O evento foi
       * ACEITO, mas quem afirma o estado final é o ADN, e a lista real só diz "Cancelada" quando a
       * captura trouxer o evento. Um mock que pulasse direto para CANCELADA esconderia o chip
       * intermediário — exatamente o ramo que o dono veio cobrar.
       * ⚠ `_statusEfetivo` fica como está: ele alimenta a marca d'água do DANFSe, e o ADN ainda
       * não afirmou nada.
       */
      nota.status = "CANCELAMENTO_ENVIADO";
      return { ok: true, evento: "e101101", status: "cancelled", refletidoNaLista: false, notaId: nota.invoiceId, numero: nota.numero };
    },

    // --- Guias --------------------------------------------------------------
    async getGuides(companyId, { competencia, page = 1, limit = 25 } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
      const pageNum = Math.max(Number(page) || 1, 1);

      const filtradas = estado.guias
        .filter((g) => g._clientId === id)
        // ⚠⚠ O FILTRO SAIU EM 30/08/2026, junto com o da rota real — e as duas têm de sair juntas:
        // mock que esconde o que o servidor mostra treina a tela para um estado que não existe.
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

    /**
     * ⚠⚠ O PEDIDO DE GUIA ATUALIZADA, no mock — e ele reproduz as RECUSAS, não só o sucesso.
     *
     * Um mock que só conhece o caminho feliz esconde exatamente o que esta tela precisa mostrar: o
     * teto do escritório estourado (o cliente não pode resolver sozinho) e a guia nova que voltou
     * SEM juros e multa (o cliente pagaria a menor). A escolha é pelo ÚLTIMO DÍGITO do id da guia,
     * para os três desfechos serem alcançáveis sem backend e sem esperar sorte.
     */
    async recalcularGuia(companyId, guideId) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const guia = estado.guias.find((g) => g._clientId === id && g.guideId === String(guideId));
      if (!guia || !guia.liberadaCliente) throw new ApiError(404, "not_found");
      if (!guia.vencida) {
        // ⚠ A assinatura é `(status, code, message, corpo)` — o corpo INTEIRO viaja no 4º, e é dele
        // que a tela lê `podeTentarDeNovo`.
        throw new ApiError(400, "guia_nao_vencida", "Esta guia ainda não venceu — use a que você já tem.", {
          message: "Esta guia ainda não venceu — use a que você já tem.",
          podeTentarDeNovo: false,
        });
      }
      const ultimo = Number(String(guideId).slice(-1)) || 0;
      if (ultimo % 5 === 0) {
        // ⚠ A recusa do teto: traduzida, sem número nenhum, e SEM oferecer "tentar de novo".
        throw new ApiError(
          429,
          "SERPRO_TETO_MENSAL_ESCRITORIO",
          "Não foi possível recalcular agora. Fale com o seu contador.",
          { message: "Não foi possível recalcular agora. Fale com o seu contador.", podeTentarDeNovo: false },
        );
      }
      const acrescimo = ultimo % 3 === 0
        // ⚠⚠ "ANTES DE PAGAR", nunca "antes de enviar ao cliente": esta é a tela DO cliente. A frase
        // do contador aqui faz quem lê achar que o aviso não é para ele — e é justamente o aviso que
        // impede alguém de pagar uma guia a menor. O backend produz as duas versões
        // (`leituraDosAcrescimos({ ehCliente })`); o mock reproduz a do cliente.
        ? { estado: "ausentes", multa: 0, juros: 0, texto: "A guia nova veio SEM juros e multa. Numa guia vencida isso pode significar que este serviço da Receita não gera a versão com acréscimos. Confira no documento antes de pagar.", tom: "atencao" }
        : { estado: "presentes", multa: 12.94, juros: 1.78, texto: "A guia nova veio com juros e multa.", tom: "neutro" };
      guia.valor = Number((Number(guia.valor) * 1.0726).toFixed(2));
      guia.paymentStatus = "OPEN";
      return { ok: true, guide: { ...guia }, acrescimos: acrescimo };
    },

    /**
     * ⚠⚠ O CLIENTE CONFIRMA QUE PAGOU — e o mock grava `paymentStatusSource: "CLIENTE"`, que é o
     * valor que faz a Circular do CONTADOR mostrar "⏳ cliente" e o razão NÃO ser marcado.
     * Gravar "MANUAL" aqui esconderia justamente a distinção que a entrega existe para criar.
     */
    async confirmarPagamentoDaGuia(companyId, guideId, { pagoEm } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const guia = estado.guias.find((g) => g._clientId === id && g.guideId === String(guideId));
      if (!guia || !guia.liberadaCliente) throw new ApiError(404, "not_found");
      if (guia.paymentStatus === "PAID") {
        throw new ApiError(409, "guia_ja_confirmada", "Esta guia já consta como paga.", {
          message: "Esta guia já consta como paga.",
        });
      }
      /**
       * ⚠⚠ O MOCK RECUSA A DATA COMO O SERVIDOR RECUSA (30/08/2026), e tem de ser assim: mock que
       * aceita o que o real rejeita treina a tela errada — regra escrita deste app.
       * ⚠ A ordem das recusas é a mesma da regra pura (`application/guides/lib/dataDoPagamento.js`),
       * e os códigos também: a tela traduz pelo código, não pela frase.
       */
      const bruto = String(pagoEm ?? "").trim();
      if (!bruto) {
        throw new ApiError(400, "DATA_DO_PAGAMENTO_AUSENTE", "Informe o dia em que você pagou esta guia.", {
          message: "Informe o dia em que você pagou esta guia.",
        });
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bruto);
      const dt = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      const valida = Boolean(m) && dt.getUTCFullYear() === Number(m[1])
        && dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]);
      if (!valida) {
        throw new ApiError(400, "DATA_DO_PAGAMENTO_INVALIDA", "Esta data não existe.", {
          message: "Esta data não existe. Informe o dia em que você pagou, no formato dia/mês/ano.",
        });
      }
      const agoraD = new Date();
      if (dt.getTime() > Date.UTC(agoraD.getUTCFullYear(), agoraD.getUTCMonth(), agoraD.getUTCDate())) {
        throw new ApiError(400, "DATA_DO_PAGAMENTO_NO_FUTURO", "Esta data ainda não chegou.", {
          message: "Esta data ainda não chegou. Informe o dia em que você já pagou.",
        });
      }

      const agora = new Date().toISOString();
      guia.paymentStatus = "PAID";
      guia.paymentStatusSource = "CLIENTE";
      // ⚠⚠ A DATA DO PAGAMENTO É A INFORMADA; o CLIQUE continua sendo `agora`. São dois fatos, e
      // colapsá-los foi o defeito.
      guia.paymentConfirmedAt = dt.toISOString();
      guia.clienteConfirmouEm = agora;
      guia.canConfirmPayment = false;
      guia.vencida = false;
      guia.canRecalculate = false;
      guia.avisoDeRecalculo = null;
      return {
        ok: true,
        guide: { ...guia },
        aviso: "Registramos que você pagou. Seu contador vai conferir o comprovante na Receita e "
          + "lançar a baixa na contabilidade.",
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
          // ⚠⚠ ESTE BLOCO É O CAMINHO ÚNICO DA TELA DESDE 30/08/2026 — dono: *"use sempre o que
          // foi lançado"*. Ele dizia aqui *"o bloco do PRESUMIDO"*, e ficou falso no dia em que o
          // Simples passou a lê-lo também. Este projeto já foi mordido QUATRO vezes por ramo que
          // só existia contra o servidor real.
          //
          // ⚠ AS TRÊS SITUAÇÕES SÃO EXERCIDAS, e são elas que a tela precisa saber desenhar:
          //   pc-001 → CALCULADA no SIMPLES, com UMA conta de imposto (o DAS), como a empresa
          //            real — e SEM_LANCAMENTO nos meses sem nota;
          //   pc-002 → CALCULADA, com uma linha sem conta contábil (o caso REAL: 11 de 37
          //            provisões do Presumido nascem com a conta vazia);
          //   pc-003 → SEM_RECEITA_LANCADA (provisão existe, receita não foi lançada — medido em
          //            KODA BEAR, SINCROSAT e EDUCACAO E DIREITO);
          //   demais → null, que é "o servidor não mandou o bloco", DIFERENTE de "sem lançamento".
          deLancamentos: mockDeLancamentos(id, faturamento),
        };
      });
      data.reverse(); // mais recente primeiro, igual à rota
      return data;
    },

    // --- Os tomadores para quem esta empresa JÁ emitiu ----------------------
    //
    // ⚠ **SÓ LEITURA, COMO NO PAR REAL.** Não existe `salvarTomador`, `editarTomador` nem
    // `removerTomador` aqui — e não pode existir: quem escreve nessa memória é uma emissão que o
    // sistema nacional autorizou (ver `emitirNfse`, no fim deste arquivo, e
    // `apps/api/src/application/nfse/tomadorEmitido.js`). Um mock com porta de escrita treinaria a
    // tela a oferecer um cadastro que o servidor não tem.
    //
    // ⚠ **ESCOPADO PELA EMPRESA**, sempre — pelo mesmo motivo do `where` do backend: uma lista
    // global devolveria o endereço que OUTRA empresa usou.
    //
    // ⚠ ORDEM: `ultimaEmissaoEm` DESC, a mesma da rota. Um mock com outra ordem faria a tela
    // parecer certa offline e trocar de comportamento no primeiro deploy.
    async getTomadoresEmitidos(companyId) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const lista = estado.tomadoresEmitidos.get(id) || [];
      return [...lista].sort((a, b) =>
        String(b.ultimaEmissaoEm || "").localeCompare(String(a.ultimaEmissaoEm || ""))
      );
    },

    // --- Fluxo --------------------------------------------------------------
    /**
     * ⚠⚠ FLUXO DE CAIXA E DRE SÃO DEMONSTRAÇÃO — nos DOIS lados da api, inclusive no real.
     *
     * Não há backend para nenhum dos dois, e não há origem para ENTRADAS (o import de OFX e a rota
     * de transações do cliente são stubs 501). A resposta carimba `demonstracao: true`, e é ela —
     * não `api.mode` — que faz a tela mostrar o selo: `api.mode` some no modo real, e um selo preso
     * a ele deixaria número fictício sem aviso em produção.
     *
     * ⚠ Elas existem aqui E no `realApi` porque `createApiClient` só envolve a chave quando as DUAS
     * são função (`api/index.js`): função que exista só no mock **nunca é alcançada** no modo
     * `real_with_mock_fallback` — ela some do objeto e vira `api.getFluxoCaixa is not a function`.
     */
    /**
     * ⚠⚠ O FLUXO DE CAIXA DEIXOU DE SER DEMONSTRAÇÃO EM 27/08/2026 — e o mock tem de dizer isso.
     *
     * ⚠⚠ ELE DEVOLVE `demonstracao: false`, como o servidor. Não é contradição com o modo offline:
     * o mock existe para reproduzir o CONTRATO, e é o contrato que apaga o selo. Devolver `true`
     * aqui deixaria a visão de fluxo com selo offline e sem selo em produção — e aí ninguém
     * conseguiria conferir na tela o desenho que vai ao cliente. ⚠ O DRE, logo abaixo, continua
     * `true`: aquele **é** ficção, porque não existe rota de DRE.
     *
     * ⚠⚠ E TODOS OS RAMOS PRECISAM SER ALCANÇÁVEIS AQUI. Este projeto foi mordido oito vezes por
     * ramo que só existia em produção. `semImposto` e `recorrenciaIndisponivel` são mutuamente
     * exclusivos, no fluxo cheio, com o imposto previsto e com as séries — então a `pc-006` tem um
     * fluxo PRÓPRIO, magro, que é a única forma de vê-los offline.
     *
     * ⚠ Elas existem aqui E no `realApi` porque `createApiClient` só envolve a chave quando as DUAS
     * são função (`api/index.js`): função que exista só no mock **nunca é alcançada** no modo
     * `real_with_mock_fallback` — ela some do objeto e vira `api.getFluxoCaixa is not a function`.
     */
    async getFluxoCaixa(companyId, { competencia, janelaInicio } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const ciclo = competencia || competenciaPadrao();
      // ⚠⚠ `janelaInicio` é OUTRA pergunta que `competencia`: uma diz onde a tabela começa, a outra
      // diz que mês é "hoje". Passar a mesma nos dois faria a seta ‹ mover o mês pintado de ciano.
      return fluxoDeCaixaDoMock(id, ciclo, {
        janelaInicio,
        cientes: estado.cienciasDeGuias.get(id) || [],
        // ⚠⚠ SEM ISTO, criar uma saída não mudaria NADA na tela offline — e um mock que aceita a
        // escrita e não a mostra treina a tela a parecer quebrada. É a quinta vez que este mock
        // teria escondido um ramo.
        saidasDoCliente: estado.saidasDoCliente.get(id) || [],
        diasDasSeries: estado.diasDasSeries.get(id) || {},
        seriesExcluidas: estado.seriesExcluidas.get(id) || [],
      });
    },

    /**
     * ⚠⚠ "ESTOU CIENTE" — e ela NÃO marca guia como paga.
     *
     * A vizinha `confirmarPagamentoDaGuia` move `paymentStatus`; esta só registra que a pessoa viu
     * o aviso. A `CONSTITUICAO-do-produto.md` fecha a palavra na Lei 5: **Ciência nunca significa
     * pagamento**. Um mock que confundisse as duas treinaria a tela a chamar a rota errada.
     *
     * ⚠ Ela existe aqui E no `realApi` porque `createApiClient` só envolve a chave quando as DUAS
     * são função — função só do mock nunca é alcançada no modo `real_with_mock_fallback`.
     */
    async registrarCienciaDeGuias(companyId, { guiaIds } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const ids = [...new Set((guiaIds || []).map((g) => String(g || "").trim()).filter(Boolean))];
      // ⚠ Lista vazia RECUSA, como o servidor: gravar ciência sobre nada faria o histórico mentir
      // sobre ter havido um aviso.
      if (!ids.length) throw new ApiError(400, "CIENCIA_SEM_GUIAS", { error: "CIENCIA_SEM_GUIAS" });
      const jaVistas = estado.cienciasDeGuias.get(id) || [];
      estado.cienciasDeGuias.set(id, [...new Set([...jaVistas, ...ids])]);
      return { ok: true, ciencia: { id: `c-${jaVistas.length + 1}`, guiaIds: ids, origem: "CLIENT" } };
    },

    /**
     * ⚠⚠ A SAÍDA QUE O CLIENTE ACRESCENTA — as DUAS formas, num verbo só.
     *
     * Espelho do `realApi` e da rota `POST /client/companies/:id/fluxo/saidas`. O `tipo` é
     * vocabulário FECHADO, e valor fora dele RECUSA nomeando — nunca escolhe um por conta própria.
     *
     * ⚠⚠ **AS RECUSAS SÃO AS DO SERVIDOR, com os MESMOS códigos.** Um mock mais permissivo que o
     * servidor treina a tela a mandar o que vai ser rejeitado — foi o caso do `emitirNfse`, que
     * julgava só o payload e recusava todo Lucro Presumido.
     */
    async criarSaidaDoFluxo(companyId, corpo = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const tipo = String(corpo?.tipo || "").trim().toUpperCase();
      const descricao = String(corpo?.descricao || "").trim();
      const valor = Number(corpo?.valor);

      if (tipo !== "AVULSA" && tipo !== "RECORRENTE") {
        throw new ApiError(400, "tipo_invalido", { error: "tipo_invalido" });
      }
      if (!descricao) {
        throw new ApiError(400, "descricao_obrigatoria", { error: "descricao_obrigatoria" });
      }
      // ⚠ `> 0` por TIPO, nunca por verdade: `Number(null)` é 0 e 0 é finito. É a mesma armadilha
      // que a alíquota da nota já pagou.
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new ApiError(400, "valor_invalido", { error: "valor_invalido" });
      }

      const lista = estado.saidasDoCliente.get(id) || [];
      if (tipo === "AVULSA") {
        // ⚠ Data CIVIL, no formato do campo (`YYYY-MM-DD`). Nada de `new Date`: às 22h de Brasília
        // o ISO devolveria o dia seguinte, e esta data é o dia em que o cliente planeja pagar.
        const data = String(corpo?.data || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
          throw new ApiError(400, "data_invalida", { error: "data_invalida" });
        }
        const saida = {
          id: `sa-${lista.length + 1}`,
          data,
          valor,
          descricao,
          estado: "PENDENTE",
        };
        estado.saidasDoCliente.set(id, [...lista, { tipo, ...saida }]);
        return { ok: true, tipo, saida };
      }

      const periodicidade = String(corpo?.periodicidade || "").trim().toUpperCase();
      if (!["MENSAL", "TRIMESTRAL", "ANUAL"].includes(periodicidade)) {
        throw new ApiError(400, "periodicidade_invalida", { error: "periodicidade_invalida" });
      }
      const serie = {
        id: `sr-${lista.length + 1}`,
        rotulo: descricao,
        periodicidade,
        valorDeclarado: valor,
        estado: "PENDENTE",
        origem: "DECLARADA",
      };
      estado.saidasDoCliente.set(id, [...lista, { tipo, ...serie }]);
      return { ok: true, tipo, serie, jaDecidida: false };
    },

    /**
     * ⚠⚠ Remover só enquanto PENDENTE — depois da decisão do contador, o servidor recusa.
     *
     * ⚠ O mock exerce a recusa (`saida_ja_decidida`, 409) porque ela é o ramo que a tela precisa
     * saber desenhar: apagar depois da decisão seria desfazer o ato do contador pelo lado do
     * cliente. Sem o ramo no mock, ele só existiria em produção.
     */
    async removerSaidaDoFluxo(companyId, saidaId, { tipo } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const esperado = String(tipo || "AVULSA").trim().toUpperCase();
      if (esperado !== "AVULSA" && esperado !== "RECORRENTE") {
        throw new ApiError(400, "tipo_invalido", { error: "tipo_invalido" });
      }
      const lista = estado.saidasDoCliente.get(id) || [];
      // ⚠ O mock exige que o `tipo` BATA com o da saída, como o servidor: lá são duas tabelas, e
      // pedir a remoção na tabela errada devolve "não encontrada". Um mock que ignorasse o tipo
      // deixaria a tela mandar o parâmetro errado e só descobrir em produção.
      const alvo = lista.find((s) => s.id === String(saidaId) && s.tipo === esperado);
      /**
       * ⚠⚠ A SÉRIE DO FIXTURE NÃO MORA EM `saidasDoCliente` — ela é do fluxo, e o cliente passou a
       * poder tirá-la em 31/08/2026 (dono: *"pode ser excluído uma saída pelo usuário"*).
       *
       * ⚠ Antes, este ramo devolvia 404 sobre uma linha que está na frente da pessoa: o mock
       * recusava o que o servidor aceita, e a tela pareceria quebrada offline.
       * ⚠ No servidor ela não é APAGADA — é marcada, e continua na Conferência do contador. Aqui
       * ela some da tela do cliente, que é o que este mock existe para mostrar.
       */
      if (!alvo && esperado === "RECORRENTE") {
        /**
         * ⚠⚠ O ID TEM DE SER DE UMA SÉRIE QUE EXISTE NO FLUXO — achado por teste em 31/08/2026.
         *
         * A primeira versão deste ramo aceitava QUALQUER id e respondia `ok`, "excluindo" uma série
         * inexistente. O servidor real recusa (`buscarSerieDoCliente` → `serie_nao_encontrada`), e
         * um mock mais permissivo esconderia exatamente o caso em que a tela manda o `tipo` errado:
         * ela receberia sucesso offline e "não encontrada" em produção.
         */
        /**
         * ⚠⚠ A EXISTÊNCIA É MEDIDA **SEM** AS EXCLUSÕES — e a ordem errada aqui foi pega por teste.
         *
         * Com `seriesExcluidas` aplicado, a série já excluída não aparece no fixture e a SEGUNDA
         * tentativa respondia "não encontrada" em vez de "já excluída". São recusas diferentes e
         * pedem coisas diferentes de quem lê: uma é engano de id, a outra é "isso já está feito".
         * ⚠ É o que o servidor faz: `buscarSerieDoCliente` ACHA a linha de qualquer jeito (ela não
         * é apagada) e só então recusa por já excluída.
         */
        const existe = fluxoDeCaixaDoMock(id, competenciaPadrao(), {
          saidasDoCliente: estado.saidasDoCliente.get(id) || [],
          diasDasSeries: estado.diasDasSeries.get(id) || {},
          seriesExcluidas: [],
        }).meses.flatMap((m) => m.linhas || [])
          .some((l) => l?.referencia?.tipo === "serie" && l.referencia.id === String(saidaId));
        if (!existe) throw new ApiError(404, "saida_nao_encontrada", { error: "saida_nao_encontrada" });

        const jaExcluidas = estado.seriesExcluidas.get(id) || [];
        if (jaExcluidas.includes(String(saidaId))) {
          throw new ApiError(409, "serie_ja_excluida", { error: "serie_ja_excluida" });
        }
        estado.seriesExcluidas.set(id, [...jaExcluidas, String(saidaId)]);
        return { ok: true, tipo: esperado, apagada: false };
      }
      if (!alvo) throw new ApiError(404, "saida_nao_encontrada", { error: "saida_nao_encontrada" });
      if (alvo.estado !== "PENDENTE") {
        throw new ApiError(409, "saida_ja_decidida", { error: "saida_ja_decidida" });
      }
      estado.saidasDoCliente.set(id, lista.filter((s) => s.id !== alvo.id));
      return { ok: true };
    },

    /**
     * ⚠⚠ O CLIENTE DIZ EM QUE DIA A SAÍDA CAI — vale para a SÉRIE INTEIRA (31/08/2026).
     *
     * > Dono: *"série inteira: esse pagamento é sempre dia 10."*
     *
     * ⚠ As MESMAS recusas do servidor, com os mesmos códigos: um mock mais permissivo deixaria a
     * tela mandar um dia inválido e só descobrir em produção.
     * ⚠ `null` LIMPA e devolve a linha à estimativa — é o desfazer do próprio cliente.
     */
    async definirDiaDaSaida(companyId, saidaId, dia) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const atual = { ...(estado.diasDasSeries.get(id) || {}) };
      if (dia == null) {
        delete atual[String(saidaId)];
        estado.diasDasSeries.set(id, atual);
        return { ok: true, dia: null };
      }
      const n = Number(dia);
      // ⚠ Guard por TIPO: `Number(null) === 0` e 0 é finito — truthy deixaria passar.
      if (!Number.isInteger(n) || n < 1 || n > 31) {
        throw new ApiError(400, "dia_invalido", { error: "dia_invalido" });
      }
      atual[String(saidaId)] = n;
      estado.diasDasSeries.set(id, atual);
      return { ok: true, dia: n };
    },

    /**
     * ⚠⚠ O DRE DEIXOU DE SER FICÇÃO EM 29/08/2026 (Fase 7), e o mock só passou a dizer isso em
     * 30/08 — achado no navegador, ao validar a `main`.
     *
     * A rota real (`GET /client/companies/:id/dre`) monta o DRE pelo plano de contas e responde
     * `demonstracao: false`, **sem selo**. O mock continuava servindo `dreDeDemonstracao`, com
     * selo: a tela conferida offline não era a tela que o cliente vê. É a divergência mock × real
     * que este projeto já pagou várias vezes — e nesta direção ela é pior, porque o navegador
     * mostra o desenho ANTIGO e ninguém desconfia.
     *
     * ⚠ TRÊS EMPRESAS, TRÊS RAMOS, porque nenhum deles pode ser inalcançável offline:
     *   • `pc-006` → **demonstração**, com o selo. É o único caminho que ainda o acende, e o selo
     *     precisa continuar conferível: ele existe para número fictício nunca passar por real;
     *   • `pc-007` → **vazio nomeado** (`semLancamento: true`). ⚠ Ele NÃO é `R$ 0,00` em toda
     *     linha: zero afirma que a empresa não faturou nem gastou nada. Medido: 12 das 34 empresas
     *     de produção estão nesse estado;
     *   • as demais → o DRE **real**, com as contas no detalhe e a linha "fora do DRE" preenchida.
     */
    async getDre(companyId, { competencia } = {}) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      const ciclo = competencia || competenciaPadrao();
      if (id === "pc-006") return dreDeDemonstracao(id, ciclo);
      if (id === "pc-007") return dreVazioDoMock(id, ciclo);
      return dreDoMock(id, ciclo);
    },

    /**
     * A SITUAÇÃO FISCAL — leitura do que o ESCRITÓRIO gravou.
     *
     * ⚠⚠ NÃO EXISTE CONSULTA AQUI, nem no mock. A consulta ao SERPRO é paga e o limite é por
     * CONTRATANTE; um mock com botão de consultar ensinaria a tela errada.
     *
     * ⚠⚠ O PISO É `CLIENT_ADMIN`, e o mock o exerce — `pc-002` é FINANCEIRO e leva 403
     * `insufficient_role`, como o servidor faria. Mock que aceita o que o real recusa treina a tela
     * errada; foi o caso já pago do `emitirNfse`.
     */
    async getSituacaoFiscal(companyId) {
      await dormir();
      const id = exigirAcessoEmpresa(companyId);
      // `exigirAcessoEmpresa` já provou o vínculo; aqui só falta o PESO do papel.
      const empresa = estado.empresas.find((e) => e.companyId === id);
      if (!isAdminOrAbove(empresa?.myRole)) throw new ApiError(403, "insufficient_role");
      return situacaoFiscalDaEmpresa(id);
    },

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
    //   • `pronta` pela MEMÓRIA (o *"se já emitiu antes, só preencher"*) — ⚠ e desde 20/08/2026 é
    //     dela que vêm também o NOME e o e-mail, que deixaram de ser coluna da planilha;
    //   • `conferir` com `municipio_nao_conferido` e código **válido** — a tela resolve o município;
    //   • `conferir` com `municipio_nao_conferido` e código **inexistente** — ⚠ é a linha que prova
    //     a segunda metade da prova do IBGE: a TELA rebaixa para `pendente`, o backend não pode;
    //   • `conferir` por `zero_a_esquerda_recuperado` (o CPF que o Excel comeu);
    //   • `conferir` por `email_fora_de_forma`;
    //   • `consultar` (dois CNPJs — um deles resolve, o outro serve para a consulta que FALHA);
    //   • ⚠⚠ `pendente` por **`nome_ausente` + `cpf_sem_endereco` juntos**: o CPF que nunca recebeu
    //     nota. CPF NÃO SE CONSULTA, então não existe origem nem para o nome nem para o endereço, e
    //     ele SEMPRE cai na revisão. **Isso é a regra, não um defeito** — e o contraponto (um CPF
    //     que a memória conhece, que sai `pronta`) está plantado ao lado, senão "CPF cai na revisão"
    //     pareceria regra do documento em vez de regra do desconhecimento;
    //   • `pendente` por `endereco_incompleto`, `valor_ambiguo` e `competencia_ausente`.
    //
    // ⚠ **A CLASSIFICAÇÃO DE VERDADE É DO BACKEND** (`application/nfse/lote/classificarLinhaLote.js`).
    // O que roda aqui é um DUBLÊ que usa os mesmos códigos, para a tela poder ser exercitada sem
    // servidor — inclusive o ajuste, que reclassifica. Ele não é autoridade sobre nada.
    async baixarModeloDoLote(companyId) {
      await dormir();
      exigirAcessoEmpresa(companyId);
      return planilhaModeloMock();
    },
    async importarExtratoOfx(companyId, arquivo) {
      await dormir();
      exigirAcessoEmpresa(companyId);
      const nome = String(arquivo?.name || "").toLowerCase();

      // ⚠⚠ O MOCK RESPEITA O LIMITE DE TAMANHO DE VERDADE — e este conserto é de 26/08/2026,
      // achado por agente ADVERSARIAL que refutou a afirmação "11 MB nunca vira tela de sucesso".
      //
      // O ramifica-por-nome cobria só quem soubesse escrever `#grande` no arquivo. O cliente com um
      // extrato ANUAL de 11 MB não sabe — e no modo `mock` (que é o DEFAULT) ele lia
      // **"20 despesas novas na fila do seu contador"**, fechava o navegador, e nenhuma despesa
      // tinha entrado. Idem no `real_with_mock_fallback` com a API fora do ar: `ApiError(0)` cai
      // para o mock, e o mock respondia sucesso.
      //
      // ⚠ O comentário da rota dizia que o fallback estava desarmado "POR CONSTRUÇÃO". A construção
      // cobre o servidor RESPONDENDO; ela não cobre o servidor calado. Quem fecha esse lado é aqui.
      // ⚠ O número é o MESMO do multer (`limits.fileSize`) — dois limites divergiriam.
      const LIMITE_DE_BYTES = 10 * 1024 * 1024;
      if (Number(arquivo?.size) > LIMITE_DE_BYTES || nome.includes("#grande")) {
        throw new ApiError(
          413,
          "arquivo_grande_demais",
          "O extrato passa de 10 MB. Baixe o arquivo em períodos menores e envie um de cada vez.",
        );
      }

      const semConta = nome.includes("#semconta");
      const conta = semConta
        ? { acctId: null, bankId: "001" }
        : { acctId: "12345-6", bankId: "001" };
      // ⚠⚠ AS ANOMALIAS PRECISAM SER ALCANÇÁVEIS OFFLINE. O servidor devolve TRÊS
      // (`declarados/lib/dedupeOfx.js`), com frase pronta, e nenhum ramo do mock as produzia — então
      // o bloco que as mostra nasceria invisível no modo demonstração.
      // ⚠ `sem_fitid` é a mais importante: ela diz que "duas iguais no mesmo dia continuam entrando
      // as duas", ou seja, a EXCEÇÃO à promessa de que reenviar é seguro.
      // ⚠ As frases são cópia LITERAL de `FRASE_DA_ANOMALIA` — um segundo texto aqui faria a tela
      // offline dizer uma coisa e a de produção outra.
      const anomalias = semConta
        ? [
            {
              codigo: "sem_conta_bancaria",
              n: 23,
              frase: "O arquivo não diz de que conta bancária é o extrato. A conferência de repetidos passa a valer para a empresa inteira, sem separar contas.",
            },
            {
              codigo: "sem_fitid",
              n: 4,
              frase: "Estas transações não trazem o identificador do banco. A conferência de repetidos usa data, valor e descrição — e duas iguais no mesmo dia continuam entrando as duas.",
            },
          ]
        : [];

      if (nome.includes("#jaimportado")) {
        return {
          importId: "ofx-mock-2", conta, transacoesLidas: 23,
          criados: 0, jaImportadas: 23, foraDoEscopo: 7,
          descartadas: [], descartadasTotal: 0, descartadasTruncadas: false,
          recusadas: [], anomalias,
          // ⚠ o mesmo ARQUIVO já subiu antes — é a frase que só o hash permite
          arquivoJaImportado: { em: "2026-07-10T15:00:00.000Z", criadosNaquela: 23, jaImportadasNaquela: 0 },
        };
      }

      if (nome.includes("#socreditos")) {
        return {
          // ⚠⚠ `transacoesLidas` INCLUI os créditos — medido na fonte (`lib/ofx.js` marca
          // `sinal: CREDITO` e as põe em `transacoes`). A primeira versão deste ramo devolvia
          // `transacoesLidas: 0` com `foraDoEscopo: 12`, uma forma que o servidor NÃO CONSEGUE
          // produzir — e por isso o ramo da tela que ela servia era inalcançável em produção.
          importId: "ofx-mock-3", conta, transacoesLidas: 12,
          criados: 0, jaImportadas: 0, foraDoEscopo: 12,
          descartadas: [], descartadasTotal: 0, descartadasTruncadas: false,
          recusadas: [], anomalias, arquivoJaImportado: null,
        };
      }

      if (nome.includes("#muitoruim")) {
        // ⚠⚠ O CASO QUE MOTIVOU O `descartadasTotal`: a amostra para em 50 e o total é 145.634.
        // Sem o campo, a tela escreveria "50" — e este ramo existe para provar que ela não escreve.
        return {
          importId: "ofx-mock-4", conta, transacoesLidas: 2,
          criados: 2, jaImportadas: 0, foraDoEscopo: 0,
          // ⚠⚠ `frase` E `historico` vão JUNTO, como no real (`FRASE_DO_DESCARTE`, `lib/ofx.js`).
          // Omiti-los foi o que treinou a tela a mostrar o CÓDIGO (`sem_data`) ao cliente, numa
          // coluna chamada "Motivo" — código cru chegando ao olho de quem lê é o que `mensagens.js`
          // existe para impedir.
          descartadas: Array.from({ length: 50 }, (_, i) => ({
            motivo: "sem_data",
            frase: "A transação não traz data de lançamento (DTPOSTED).",
            fitId: `X${i}`, historico: `PAGTO FORNECEDOR ${i}`, dtPosted: null, trnAmt: "-10.00",
          })),
          descartadasTotal: 145634,
          descartadasTruncadas: true,
          recusadas: [], anomalias, arquivoJaImportado: null,
        };
      }

      return {
        importId: "ofx-mock-1", conta, transacoesLidas: 23,
        criados: 20, jaImportadas: 3, foraDoEscopo: 7,
        descartadas: [{
          motivo: "sem_data",
          frase: "A transação não traz data de lançamento (DTPOSTED).",
          fitId: "B7", historico: "TARIFA PACOTE SERVICOS", dtPosted: null, trnAmt: "-1500.00",
        }],
        descartadasTotal: 1,
        descartadasTruncadas: false,
        recusadas: [], anomalias, arquivoJaImportado: null,
      };
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

    // --- ⚠⚠ A EMISSÃO EM LOTE, NO MOCK -------------------------------------------------------
    //
    // ⚠⚠ **NADA AQUI EMITE COISA ALGUMA.** Nenhuma chamada de rede sai deste arquivo; o "lote" é
    // um objeto em memória. A rota real emite NOTA FISCAL EM SÉRIE no sistema nacional.
    //
    // ⚠⚠ POR QUE O MOCK PRECISA EXERCITAR O 502 QUE PARA O LOTE. É o caminho mais perigoso do
    // sistema — desfecho DESCONHECIDO, lote parado, linha que ninguém pode reprocessar — e é
    // impossível provocá-lo de propósito contra um backend de verdade. Sem ele aqui, a tela que
    // avisa sobre a linha indeterminada **só seria vista quando acontecesse com nota fiscal real**.
    //
    // ─── COMO ALCANÇAR CADA DESFECHO, SEM EDITAR CÓDIGO (sentinela no NOME do arquivo) ────────
    //
    //   `#desligado`     → 503 `emissao_lote_desligada` (a flag OFF, que é o estado de nascença)
    //   `#transporte`    → o lote PARA na 2ª linha, com a indeterminada nomeada
    //   `#recusa`        → uma linha recusada pela Receita (E0014) e o lote SEGUE
    //   `#tudorecusado`  → ⚠⚠ TODAS recusadas (E1235) e ZERO emitidas — o caso real de 21/08/2026
    //   `#jaemitido`     → 200 `reconhecido: true` — a mesma planilha subida duas vezes
    //   qualquer outro   → todas emitem
    //
    // ⚠ Sentinela fixa, nunca sorteio: sorteio faz "a tela quebrou" e "deu azar" virarem a mesma
    // coisa. Mesmo desenho dos tokens de redefinição de senha.

    async emitirLoteDeNotas(companyId, arquivo, { consultas = null, ajustes = null } = {}) {
      await dormir();
      // ⚠ O id RESOLVIDO, não o `companyId` cru: é por ele que `estado.notas` é chaveado (ver
      // `fetchDanfseBlob`). Registrar a nota com o outro faria o download responder "não
      // encontrada" — e foi exatamente o que aconteceu na primeira versão deste registro.
      const idDaEmpresa = exigirAcessoEmpresa(companyId);
      const nome = String(arquivo?.name || "").toLowerCase();

      // ⚠⚠ A FLAG DESLIGADA É O ESTADO DE NASCENÇA, e a recusa é do SERVIDOR — não da tela. Como
      // ela é NOMEADA, o fallback do mock não a engole (`api/index.js`).
      if (nome.includes("#desligado")) {
        throw new ApiError(
          503,
          "emissao_lote_desligada",
          "A emissão de NFS-e em lote está desligada neste ambiente (INTEGRACAO_NFSE_LOTE). "
            + "Nenhuma nota é emitida enquanto a integração não for habilitada."
        );
      }

      const leitura = await this.lerPlanilhaDoLote(companyId, arquivo, { consultas, ajustes });
      const prontas = leitura.linhas.filter((l) => l.estado === "pronta");
      if (!prontas.length) {
        throw new ApiError(
          422,
          "nenhuma_linha_pronta",
          "Nenhuma linha desta planilha está pronta para emitir. Só linhas conferidas e sem "
            + "pendência entram no lote — confira a tela e corrija o que estiver marcado.",
          { resumo: leitura.resumo }
        );
      }

      const loteId = `lote-mock-${Object.keys(LOTES_EMISSAO_MOCK).length + 1}`;
      const lote = montarLoteDoMock(loteId, prontas, nome);
      LOTES_EMISSAO_MOCK[loteId] = lote;

      /**
       * ⚠⚠ O LOTE PASSA A REGISTRAR AS NOTAS QUE EMITIU (31/08/2026) — e o mock mentia em DOIS
       * pontos por não fazer isso.
       *
       * 1. Emitir um lote offline não mudava a lista de Notas. O comentário da emissão AVULSA já
       *    diz por que isso importa: *"emitir e a lista de Notas não mudar é o defeito mais fácil
       *    de deixar passar offline — e é o primeiro lugar onde o cliente vai conferir se deu
       *    certo"*. Valia para uma nota e não valia para quarenta.
       * 2. Sem a nota registrada, `fetchDanfseBlob` respondia `nota_nao_encontrada` para o
       *    `serviceInvoiceId` do relatório — e o botão "Baixar" do lote, que é exatamente o que o
       *    dono veio cobrar em 31/08, **não podia ser exercido offline**.
       *
       * ⚠ `invoiceId` É O `serviceInvoiceId`, e não um id novo: é assim no servidor — a emissão
       * grava `ServiceInvoice`, e é esse id que o relatório carrega e que as rotas resolvem.
       * ⚠ `confirmadaPeloAdn: false` e `hasXml: false`, como `serializeEmitidaNaoConfirmada`: a
       * captura do ADN ainda não aconteceu. O DANFSe sai assim mesmo — é o conserto de 24/08.
       */
      const empresaDoLote = estado.empresas.find((e) => e.companyId === idDaEmpresa) || null;
      for (const l of lote.linhas || []) {
        if (l.desfecho !== "emitida" || !l.serviceInvoiceId) continue;
        const agora = new Date().toISOString();
        estado.notas.push({
          clientId: idDaEmpresa,
          invoiceId: l.serviceInvoiceId,
          type: "NFSE",
          numero: l.rpsNumero || null,
          competencia: competenciaPadrao(),
          issueDate: agora,
          status: "EMITIDA",
          total: Number(l.valorServicos) || 0,
          emitente: { nome: empresaDoLote?.razao || "", cnpj: empresaDoLote?.cnpj || "" },
          tomador: { nome: l.tomadorNome || "", cnpjCpf: l.tomadorDoc || "" },
          updatedAt: agora,
          hasXml: false,
          hasPdf: false,
          descricao: null,
          papel: "EMIT",
          confirmadaPeloAdn: false,
          _statusEfetivo: "autorizada",
        });
      }

      // ⚠⚠ RECONHECIDO NÃO É "JÁ FOI EMITIDA" — e o mock precisa provar isso, senão o ramo em que
      // a tela oferece a RETENTATIVA (lote reconhecido com 0 emitidas) só existiria em produção.
      // O plano vai junto, como na rota real.
      if (nome.includes("#jaemitido")) {
        return { reconhecido: true, lote, retentativa: planoDeRetentativaDoMock(lote) };
      }
      return { reconhecido: false, lote };
    },

    async consultarLoteEmissao(companyId, loteId) {
      await dormir();
      exigirAcessoEmpresa(companyId);
      const lote = LOTES_EMISSAO_MOCK[loteId];
      if (!lote) throw new ApiError(404, "lote_nao_encontrado", "Este lote não foi encontrado.");
      return { lote };
    },

    /**
     * ⚠⚠ A RETOMADA NÃO TOCA A LINHA INDETERMINADA — e o mock respeita isso, senão a tela seria
     * exercitada contra um comportamento que o servidor não tem.
     */
    async retomarLoteEmissao(companyId, loteId) {
      await dormir();
      exigirAcessoEmpresa(companyId);
      const lote = LOTES_EMISSAO_MOCK[loteId];
      if (!lote) throw new ApiError(404, "lote_nao_encontrado", "Este lote não foi encontrado.");

      const corte = Number.isInteger(lote.linhaIndeterminada) ? lote.linhaIndeterminada : -Infinity;
      lote.linhas = lote.linhas.map((l) =>
        // ⚠ ESTRITAMENTE MAIOR: a indeterminada continua indeterminada, para sempre, até o contador
        // decidir o que fazer com ela olhando o portal nacional.
        l.desfecho === "nao_tentada" && l.numeroLinha > corte
          ? { ...l, desfecho: "emitida", rpsSerie: "00001", rpsNumero: String(l.numeroLinha) }
          : l
      );
      recontarLoteDoMock(lote);
      lote.status = lote.naoTentadas > 0 ? "parado_indeterminado" : "concluido";
      return { lote };
    },

    /**
     * ⚠⚠ A RETENTATIVA — e o mock aplica a MESMA regra do servidor, por LINHA.
     *
     * Retentável é só o desfecho que PROVA que não existe nota (`nao_tentada`,
     * `recusada_receita`, `recusada_nossa`). ⚠⚠ `emitida` e `indeterminada` NUNCA — um mock que
     * reemitisse tudo treinaria a tela contra um comportamento que o servidor recusa, justamente
     * no ponto em que o erro é uma NOTA FISCAL DUPLICADA.
     */
    async retentarLoteEmissao(companyId, loteId) {
      await dormir();
      exigirAcessoEmpresa(companyId);
      const lote = LOTES_EMISSAO_MOCK[loteId];
      if (!lote) throw new ApiError(404, "lote_nao_encontrado", "Este lote não foi encontrado.");

      const plano = planoDeRetentativaDoMock(lote);
      if (!plano.quantas) {
        throw new ApiError(
          422,
          "nada_a_retentar",
          "Nenhuma linha deste lote pode ser emitida de novo. Só voltam a ser tentadas as linhas "
            + "cujo desfecho prova que nenhuma nota foi gerada — recusadas e não tentadas.",
          { retentativa: plano, lote }
        );
      }

      const aTentar = new Set(plano.retentaveis.map((l) => l.numeroLinha));
      lote.linhas = lote.linhas.map((l) =>
        aTentar.has(l.numeroLinha)
          ? {
              ...l,
              desfecho: "emitida",
              camada: null,
              codigo: null,
              mensagem: null,
              correcao: null,
              // ⚠ O número da tentativa anterior é REUSADO — não existe inutilização na NFS-e.
              rpsSerie: l.rpsSerie || "00001",
              rpsNumero: l.rpsNumero || String(l.numeroLinha),
              serviceInvoiceId: l.serviceInvoiceId || `si-mock-${l.numeroLinha}`,
              tentadaEm: new Date().toISOString(),
            }
          : l
      );
      recontarLoteDoMock(lote);
      lote.status = lote.naoTentadas > 0 ? "parado_indeterminado" : "concluido";
      return { lote, retentativa: plano };
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
        papel: "EMIT",
        confirmadaPeloAdn: false,
        _statusEfetivo: "autorizada",
      });

      // ⚠⚠ A MEMÓRIA DO TOMADOR SÓ SE ESCREVE **DEPOIS DO SUCESSO** — invariante 2 de
      // `apps/api/src/application/nfse/tomadorEmitido.js`. Este ponto é o equivalente do
      // `markIssued`: todos os desfechos de falha já saíram acima, com `throw`. Gravar antes
      // registraria como "já emitimos para este tomador" uma nota que a Receita ainda podia
      // recusar, e a memória passaria a oferecer dados que nunca saíram em documento nenhum.
      //
      // ⚠ SÓ O QUE A EMISSÃO TEVE (invariante 1): nada é completado por consulta nem deduzido.
      // Endereço incompleto no payload vira registro sem endereço — como no par real, onde o
      // validador entrega `endereco: undefined` a menos que os cinco exigidos cheguem juntos.
      const enderecoDaEmissao = payload?.tomador?.endereco || {};
      const completo = ["cMun", "CEP", "xLgr", "nro", "xBairro"].every((c) =>
        String(enderecoDaEmissao[c] || "").trim()
      );
      if (nfseBase.tomadorDoc && nfseBase.tomadorNome) {
        const memoria = estado.tomadoresEmitidos.get(id) || [];
        const registro = {
          documento: nfseBase.tomadorDoc,
          nome: nfseBase.tomadorNome,
          email: String(payload?.tomador?.email || "").trim() || null,
          cMun: completo ? String(enderecoDaEmissao.cMun) : null,
          cep: completo ? String(enderecoDaEmissao.CEP) : null,
          xLgr: completo ? String(enderecoDaEmissao.xLgr) : null,
          nro: completo ? String(enderecoDaEmissao.nro) : null,
          xCpl: completo ? String(enderecoDaEmissao.xCpl || "") || null : null,
          xBairro: completo ? String(enderecoDaEmissao.xBairro) : null,
          ultimaEmissaoEm: agora.toISOString(),
        };
        // ⚠ Um registro por (empresa, documento) — a chave única do model. Emitiu de novo para o
        // mesmo documento ⇒ é o MESMO registro, e ele se atualiza.
        const i = memoria.findIndex((t) => t.documento === registro.documento);
        if (i >= 0) memoria[i] = registro;
        else memoria.unshift(registro);
        estado.tomadoresEmitidos.set(id, memoria);
      }

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

/**
 * ⚠⚠ AS QUATRO COLUNAS DA PLANILHA (`colunasLote.js`) — eram doze até 20/08/2026.
 * Dono: *"não precisamos de nada do tomador, apenas o CNPJ ou CPF."*
 */
const COLUNAS_DO_LOTE_MOCK = ["documento", "descricao", "valor", "competencia"];

const ROTULOS_DO_LOTE_MOCK = [
  "CNPJ/CPF do tomador",
  "Descrição do serviço",
  "Valor do serviço (R$)",
  "Data da competência (dd/mm/aaaa)",
];

/**
 * ⚠⚠ OS CAMPOS QUE A REVISÃO PODE PREENCHER (`CAMPOS_DA_REVISAO`, no backend) — as quatro
 * colunas mais nome, e-mail e o bloco de endereço, que saíram da planilha.
 *
 * ⚠ É contra ESTA lista que o ajuste é validado. Usar a das colunas faria o mock recusar
 * exatamente os campos que a revisão existe para preencher — e a tela seria treinada errado.
 */
const CAMPOS_DA_REVISAO_MOCK = [
  ...COLUNAS_DO_LOTE_MOCK,
  "nome",
  "email",
  "cMun",
  "cep",
  "xLgr",
  "nro",
  "xBairro",
  "xCpl",
];

/** Os cinco que a emissão exige JUNTOS. `xCpl` é o único opcional — aqui como lá. */
const ENDERECO_EXIGIDO_MOCK = [
  ["cMun", "o município"],
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
    // ⚠ NOME E E-MAIL VÊM DAQUI DESDE 20/08/2026 — eles não são mais coluna da planilha.
    nome: "TOMADOR RECORRENTE LTDA",
    email: "financeiro@recorrente.com.br",
    cMun: "3304557",
    cep: "20031005",
    xLgr: "Avenida Rio Branco",
    nro: "100",
    xBairro: "Centro",
    xCpl: "Sala 1201",
  },
  // ⚠ O CPF QUE JÁ RECEBEU NOTA — o contraponto do `cpf_sem_cadastro`: com memória, ele NÃO vai
  // à revisão. Sem os dois lados, "CPF sempre cai na revisão" pareceria regra do documento, e
  // não do desconhecimento.
  "12345678909": {
    nome: "MARIA DE SOUZA",
    cMun: "3304557",
    cep: "20040020",
    xLgr: "Rua da Assembleia",
    nro: "10",
    xBairro: "Centro",
    xCpl: "",
  },
  /** O CPF que o Excel comeu o zero — a memória é buscada pelo documento JÁ CORRIGIDO. */
  "01234567890": {
    nome: "ANA PEREIRA",
    cMun: "3304557",
    cep: "20040020",
    xLgr: "Rua da Assembleia",
    nro: "10",
    xBairro: "Centro",
    xCpl: "",
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
 *
 * ⚠⚠ **`valores` SÃO AS CÉLULAS DA LINHA, NÃO AS COLUNAS DO ARQUIVO.** A planilha tem QUATRO
 * colunas desde 20/08/2026; `nome`, `email` e o bloco de endereço só existem quando alguém os
 * preencheu na REVISÃO. As linhas que os trazem aqui representam linhas **já revisadas** — é o que
 * mantém alcançáveis, offline, os ramos que dependem de um endereço digitado (a conferência do
 * município e o tudo-ou-nada). As linhas que NÃO os trazem são o estado de nascença de uma planilha
 * recém-enviada, e é nelas que a memória e a consulta trabalham.
 */
// ⚠⚠ OS LOTES DE EMISSÃO DO MOCK — em memória, e NADA aqui emite coisa alguma.
const LOTES_EMISSAO_MOCK = {};

/**
 * Monta o lote já com o desfecho de cada linha, conforme a sentinela do nome do arquivo.
 *
 * ⚠⚠ O CASO `#transporte` É O QUE MAIS IMPORTA. Ele reproduz a regra do servidor: a linha do meio
 * fica **indeterminada** (desfecho DESCONHECIDO — a nota pode existir), o lote PARA ali, e as
 * seguintes ficam `nao_tentada`, que é a verdade: ninguém encostou nelas.
 *
 * ⚠ E o número reservado fica REGISTRADO na linha indeterminada: não existe inutilização na NFS-e,
 * então um número que não virou nota é buraco permanente — informação fiscal, não detalhe técnico.
 */
function montarLoteDoMock(id, prontas, nomeDoArquivo) {
  const paraTransporte = nomeDoArquivo.includes("#transporte");
  // ⚠⚠ ONDE O LOTE PARA, e por que NÃO é uma posição fixa.
  //
  // O que o caso do TRANSPORTE precisa demonstrar é que **as linhas seguintes ficam `nao_tentada`**
  // — ninguém encostou nelas. Uma posição fixa (`i === 1`) faz o lote parar na ÚLTIMA linha quando
  // o mock tem só duas prontas: o estado aparece, mas a propriedade que importa fica sem prova, e o
  // teste passaria por vacuidade.
  //
  // `length - 2` sempre deixa pelo menos uma linha depois, e com 3+ prontas também deixa uma
  // emitida antes.
  const indiceDaParada = Math.max(0, prontas.length - 2);
  const paraRecusa = nomeDoArquivo.includes("#recusa");
  // ⚠⚠ O CASO REAL DE 21/08/2026: **todas** recusadas por erro de esquema (`E1235`), zero emitidas.
  // É o único estado em que a retentativa alcança o lote INTEIRO, e é o que a tela precisava saber
  // dizer — ela afirmava "já havia sido emitida" exatamente aqui.
  const tudoRecusado = nomeDoArquivo.includes("#tudorecusado");
  let parou = false;
  let linhaIndeterminada = null;

  const linhas = prontas.map((l, i) => {
    const base = {
      numeroLinha: l.numero,
      tomadorDoc: l.valores?.documento ?? l.documento ?? "",
      // ⚠ O NOME SAI DE `dados`, como no servidor (`emissaoLote.js:176`) — ele é RESOLVIDO (cadastro
      // de tomador → Receita → revisão) e, desde 20/08/2026, quase nunca existe como célula. Ler a
      // célula deixaria o relatório da emissão com a coluna "Tomador" vazia na maioria das linhas.
      tomadorNome: l.dados?.tomador?.nome ?? l.valores?.nome ?? "",
      valorServicos: l.dados?.servico?.valorServicos ?? l.valores?.valor ?? null,
      rpsSerie: null,
      rpsNumero: null,
      serviceInvoiceId: null,
      camada: null,
      codigo: null,
      mensagem: null,
      correcao: null,
      // ⚠ O carimbo POR LINHA. Nulo em `nao_tentada` — ninguém encostou nela.
      tentadaEm: null,
    };
    if (parou) return { ...base, desfecho: "nao_tentada" };

    if (paraTransporte && i === indiceDaParada) {
      parou = true;
      linhaIndeterminada = l.numero;
      return {
        ...base,
        desfecho: "indeterminada",
        camada: "TRANSPORTE",
        codigo: "ETIMEDOUT",
        rpsSerie: "00001",
        rpsNumero: String(l.numero),
        tentadaEm: new Date().toISOString(),
        mensagem: "Falha de comunicação com o sistema nacional.",
        correcao:
          "Não se sabe se a DPS chegou a ser processada. NÃO reemita com número novo: como a NFS-e "
          + "não tem inutilização, um número pulado é buraco permanente. Consulte o Id da DPS no "
          + "sistema nacional antes de decidir.",
      };
    }
    if (tudoRecusado) {
      return {
        ...base,
        desfecho: "recusada_receita",
        camada: "RECEITA",
        codigo: "E1235",
        rpsSerie: "00001",
        rpsNumero: String(l.numero),
        serviceInvoiceId: `si-mock-${l.numero}`,
        tentadaEm: new Date().toISOString(),
        mensagem: "Erro de esquema no XML enviado.",
      };
    }
    if (paraRecusa && i === 0) {
      return {
        ...base,
        desfecho: "recusada_receita",
        camada: "RECEITA",
        codigo: "E0014",
        rpsSerie: "00001",
        rpsNumero: String(l.numero),
        tentadaEm: new Date().toISOString(),
        mensagem:
          "Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe.",
      };
    }
    return {
      ...base,
      desfecho: "emitida",
      rpsSerie: "00001",
      rpsNumero: String(l.numero),
      serviceInvoiceId: `si-mock-${l.numero}`,
      tentadaEm: new Date().toISOString(),
    };
  });

  const lote = {
    id,
    status: parou ? "parado_indeterminado" : "concluido",
    totalLinhas: linhas.length,
    linhaIndeterminada,
    paradoEm: parou ? new Date().toISOString() : null,
    paradoMotivo: parou
      ? "O pedido desta linha saiu, mas a resposta do sistema nacional não voltou — então NÃO se "
        + "sabe se a nota foi emitida. O lote parou aqui de propósito."
      : null,
    criadoEm: new Date().toISOString(),
    linhas,
  };
  recontarLoteDoMock(lote);
  return lote;
}

/**
 * ⚠⚠ A REGRA DE RETENTABILIDADE, no mock — escrita à mão de propósito.
 *
 * O mock não importa a lib da tela: se ele reusasse o mesmo módulo, o teste que confere a tela
 * contra o mock estaria conferindo o módulo contra ele mesmo, e um erro na regra passaria verde dos
 * dois lados. A autoridade continua sendo `apps/api/.../emissaoLote.js`.
 */
function planoDeRetentativaDoMock(lote) {
  const RETENTAVEIS = ["nao_tentada", "recusada_receita", "recusada_nossa"];
  const retentaveis = [];
  const bloqueadas = [];
  for (const l of lote.linhas || []) {
    const bloqueada =
      !RETENTAVEIS.includes(l.desfecho)
      || (Number.isInteger(lote.linhaIndeterminada) && l.numeroLinha === lote.linhaIndeterminada);
    if (bloqueada) bloqueadas.push({ numeroLinha: l.numeroLinha, desfecho: l.desfecho });
    else retentaveis.push({ numeroLinha: l.numeroLinha, desfecho: l.desfecho });
  }
  const conta = (d) => bloqueadas.filter((b) => b.desfecho === d).length;
  return {
    quantas: retentaveis.length,
    retentaveis,
    bloqueadas,
    emitidas: conta("emitida"),
    indeterminadas: conta("indeterminada"),
  };
}

/** Os totais saem das LINHAS, nunca de um contador incrementado — igual ao servidor. */
function recontarLoteDoMock(lote) {
  const conta = (d) => lote.linhas.filter((l) => l.desfecho === d).length;
  lote.emitidas = conta("emitida");
  lote.recusadas = conta("recusada_receita") + conta("recusada_nossa");
  lote.naoTentadas = conta("nao_tentada");
  return lote;
}

const LINHAS_DO_LOTE_MOCK = [
  // ── PRONTA pela MEMÓRIA — o *"se já teve antes, só preencher"* do dono. ⚠ A planilha traz só o
  //    documento; NOME e endereço vêm do cadastro de tomador.
  {
    numero: 2,
    valores: {
      documento: "44.555.666/0001-77",
      descricao: "Consultoria contábil de julho",
      valor: "1500,00",
      competencia: "31/07/2026",
    },
  },
  // ── CONFERIR — o código do município tem a forma certa e EXISTE: a tela resolve e mostra de quem é.
  {
    numero: 3,
    valores: {
      documento: "22.333.444/0001-72",
      descricao: "Assessoria fiscal",
      valor: "2800,00",
      competencia: "31/07/2026",
      nome: "STUDIO VERTICE ARQUITETURA ME",
      ...ENDERECO_COMPLETO_MOCK,
    },
  },
  // ── ⚠⚠ CONFERIR no SERVIDOR, PENDENTE na TELA — o código não existe na lista oficial do IBGE.
  //    É a linha que prova a segunda metade da prova: o backend sem a lista não pode rebaixá-la.
  {
    numero: 4,
    valores: {
      documento: "55.666.777/0001-14",
      descricao: "Consultoria de processos",
      valor: "990,00",
      competencia: "31/07/2026",
      nome: "SERVICOS DO INTERIOR LTDA",
      ...ENDERECO_COMPLETO_MOCK,
      cMun: "9999999",
    },
  },
  // ── CONFERIR — o zero à esquerda do CPF, recolocado por nós (o Excel o comeu). ⚠ A memória é
  //    buscada pelo documento JÁ CORRIGIDO, e é ela que dá nome e endereço.
  {
    numero: 5,
    valores: {
      documento: "1234567890",
      descricao: "Aula particular",
      valor: "300,00",
      competencia: "31/07/2026",
    },
  },
  // ── CONFERIR — e-mail malformado. ⚠ A nota sai SEM e-mail; isto não bloqueia nada, e o e-mail
  //    guardado na memória NÃO entra no lugar (a frase da conferência ficaria falsa).
  {
    numero: 6,
    valores: {
      documento: "44.555.666/0001-77",
      descricao: "Consultoria contábil de agosto",
      valor: "1500,00",
      competencia: "31/07/2026",
      email: "financeiro.recorrente.com.br",
    },
  },
  // ── CONSULTAR → PRONTA: a consulta traz a razão social E o endereço, e o `cMun` passa na prova tripla.
  {
    numero: 7,
    valores: {
      documento: "11.222.333/0001-81",
      descricao: "Implantação de sistema",
      valor: "4200,00",
      competencia: "31/07/2026",
    },
  },
  // ── CONSULTAR → PENDENTE: a resposta vem, mas o `cMun` dela não se prova (diz Curitiba/PR com o
  //    código de São Paulo/SP). ⚠ Endereço é tudo ou nada, então o bloco inteiro cai.
  {
    numero: 8,
    valores: {
      documento: "33.444.555/0001-63",
      descricao: "Frete de mudança",
      valor: "1800,00",
      competencia: "31/07/2026",
    },
  },
  // ── ⚠⚠ CONSULTAR → a consulta FALHA (rede). Prova que uma consulta que morre no meio não derruba
  //    o lote: vira pendência DESTA linha, com o motivo, e as outras seguem.
  {
    numero: 9,
    valores: {
      documento: "99.999.999/0001-99",
      descricao: "Manutenção mensal",
      valor: "800,00",
      competencia: "31/07/2026",
    },
  },
  // ── ⚠⚠ O CASO QUE O DONO NOMEOU: CPF QUE NUNCA RECEBEU NOTA. Não existe origem para o nome nem
  //    para o endereço — CPF NÃO SE CONSULTA —, então ele SEMPRE cai na revisão, com as DUAS faltas
  //    nomeadas. **Isso é a regra, não um defeito**, e sem esta linha o ramo não existiria offline.
  {
    numero: 10,
    valores: {
      documento: "529.982.247-25",
      descricao: "Serviço de pintura",
      valor: "650,00",
      competencia: "31/07/2026",
    },
  },
  // ── ⚠ O CONTRAPONTO: CPF que a empresa JÁ conhece sai PRONTA, sem revisão nenhuma. Sem os dois
  //    lados, "CPF cai na revisão" pareceria regra do documento, e não do desconhecimento.
  {
    numero: 11,
    valores: {
      documento: "123.456.789-09",
      descricao: "Aula de reforço",
      valor: "420,00",
      competencia: "31/07/2026",
    },
  },
  // ── PENDENTE — meio endereço. ⚠ Nunca "quase pronta": o servidor recusa a emissão faltando um dos cinco.
  {
    numero: 12,
    valores: {
      documento: "33.444.555/0001-03",
      descricao: "Consultoria de estoque",
      valor: "1200,00",
      competencia: "31/07/2026",
      nome: "LOJA DA ESQUINA LTDA",
      cep: "20040020",
      xLgr: "Rua da Assembleia",
    },
  },
  // ── PENDENTE — valor ambíguo: mil e quinhentos ou um e meio?
  {
    numero: 13,
    valores: {
      documento: "66.777.888/0001-25",
      descricao: "Treinamento de equipe",
      valor: "1.500",
      competencia: "31/07/2026",
      nome: "INDUSTRIA DO VALE LTDA",
      ...ENDERECO_COMPLETO_MOCK,
    },
  },
  // ── PENDENTE — competência em branco (num lote, a data de hoje carimbaria todas as notas).
  {
    numero: 14,
    valores: {
      documento: "77.888.999/0001-36",
      descricao: "Serviço de digitação",
      valor: "450,00",
      competencia: "",
      nome: "ESCRITORIO PARCEIRO LTDA",
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

  // ── descrição / valor / competência (o NOME é resolvido junto do tomador, mais abaixo)
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

  // ══════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ O TOMADOR — nome, e-mail e endereço, nas TRÊS origens: REVISÃO → MEMÓRIA → CONSULTA
  // ══════════════════════════════════════════════════════════════════════════════════════
  let nome = textoMock(valores.nome);
  let origemNome = nome ? "revisao" : null;
  let email = emailOk && emailBruto ? emailBruto : null;

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
      origemEndereco = "revisao";
    }
  }

  // ── (2) A MEMÓRIA — o *"se já teve antes, só preencher"* do dono; ela só COMPLETA.
  const daMemoria = documento ? MEMORIA_DO_LOTE_MOCK[documento] || null : null;
  if (daMemoria) {
    if (!nome && daMemoria.nome) {
      nome = daMemoria.nome;
      origemNome = "memoria";
    }
    if (!email && emailOk && daMemoria.email) email = daMemoria.email;
    if (!endereco && !trouxeAlgo) {
      endereco = { ...daMemoria };
      origemEndereco = "memoria";
    }
  }

  // ── (3) A CONSULTA — e SÓ para CNPJ.
  const faltaEndereco = !endereco && !trouxeAlgo;
  if (documento && (!nome || faltaEndereco)) {
    if (tipoDocumento === "CPF") {
      // ⚠⚠ CPF NÃO SE CONSULTA — decisão do dono. As faltas viram pendência nomeada abaixo.
    } else {
      const consulta = consultas ? consultas[documento] : undefined;
      if (consulta === undefined || consulta === null) {
        precisaConsulta = true;
      } else if (!consulta.ok) {
        pend(
          "consulta_falhou",
          `Não conseguimos consultar este CNPJ: ${consulta.motivo || "a consulta não respondeu"}. `
            + "Preencha o nome e o endereço do tomador nesta linha — as outras linhas seguem normalmente."
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
      // ⚠ A razão social da MESMA resposta preenche o nome — e resposta sem `nome` não
      // preenche nada: campo que a API não deu fica vazio, nunca inventado.
      if (!nome && consulta && consulta.ok && textoMock(consulta.nome)) {
        nome = textoMock(consulta.nome);
        origemNome = "consulta";
      }
    }
  }

  // ── (4) O QUE NENHUMA DAS TRÊS RESOLVEU. ⚠ Nada disto entra com consulta pendente: a linha
  // iria a PENDENTE em vez de CONSULTAR, e o segundo passe nunca aconteceria.
  if (!precisaConsulta) {
    if (!nome) {
      pend(
        "nome_ausente",
        tipoDocumento === "CPF"
          ? "Não sabemos o nome deste tomador: é pessoa física, nunca emitimos para este CPF e CPF "
            + "não se consulta (a base pública é de CNPJ). Escreva o nome do tomador nesta linha."
          : "Não sabemos o nome deste tomador — não emitimos para este documento antes e a consulta "
            + "não trouxe a razão social. Escreva o nome do tomador nesta linha."
      );
    }
    if (tipoDocumento === "CPF" && faltaEndereco) {
      pend(
        "cpf_sem_endereco",
        "O tomador é pessoa física e nunca emitimos para este CPF, então não temos o endereço — e "
          + "CPF não se consulta (a base pública é de CNPJ). Preencha o endereço do tomador nesta linha."
      );
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
    origemNome,
    dados:
      estado === "pronta" || estado === "conferir"
        ? {
            tomador: {
              doc: documento,
              nome,
              email,
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
      if (!CAMPOS_DA_REVISAO_MOCK.includes(chave)) colunas.add(chave);
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
      `Estes campos não existem nesta nota: ${[...colunas].join(", ")}. Nada foi aplicado.`,
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
