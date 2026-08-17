import { faker } from "@faker-js/faker";

faker.seed(20260127);

function delay(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Marcações de "sem movimento" feitas na sessão, chave `companyId|tipo`. Estado de VERDADE, não
// retorno fixo: o ciclo da guia só dá para conferir offline se marcar vazio realmente mudar o chip
// e o desfazer realmente voltar. Mock imutável passaria por esses caminhos sem testar nenhum.
const mockVazios = new Map(); // chave → { vazioEm, vazioPor, vazioMotivo }
// Guias cuja liberação já foi TENTADA nesta sessão do mock. A 1ª tentativa simula o lock global
// preso (`guides_email_lock`, TTL 5 min) e a 2ª envia — ver `liberarGuiaCliente`.
const mockLiberacoesTentadas = new Set();
const chaveVazio = (companyId, tipo) => `${companyId}|${String(tipo || "").toUpperCase()}`;

// Chave do compliance → tipo de Guide (mesmo de-para do backend; PIS representa o grupo PIS/COFINS).
const MOCK_TRIBUTO_TIPO = {
  das: "SIMPLES", inss: "INSS", irpj: "IRPJ", csll: "CSLL", pisCofins: "PIS", iss: "ISS",
};

/**
 * Compliance do mock com o CICLO DE VIDA completo — os cinco estados que o chip desenha.
 *
 * Cada empresa cai num cenário diferente de propósito (pelo índice): sem isso a tela só mostraria
 * um estado e os outros quatro nunca seriam vistos antes de produção.
 */
function mockGuideComplianceRow({ companyId, indice = 0, hasProlabore, regimeTributario, competencia = "2026-02", faturamento = 0 }) {
  const regime = String(regimeTributario || "SIMPLES").toUpperCase();
  const presumido = regime === "LUCRO_PRESUMIDO" || regime === "LUCRO_REAL";
  const requeridos = {
    das: regime === "SIMPLES",
    inss: Boolean(hasProlabore),
    irpj: presumido, csll: presumido, pisCofins: presumido, iss: presumido,
  };

  // Cenário por empresa: 0 falta tudo · 1 gerada (falta enviar) · 2 enviada · 3 vazio · 4 conflito.
  //
  // ⚠ `falhou` NÃO entra neste rodízio, e sim na empresa MISTURADA abaixo. Um sexto cenário
  // deslocaria o cenário de todas as outras empresas — e, pior, cairia numa empresa qualquer da
  // lista, inclusive numa ZERADA, onde o card nem desenha chip (`empresaSemObrigacoes`). A empresa
  // misturada é onde ele precisa aparecer de qualquer forma: o ponto de `falhou` é justamente não
  // se confundir com `gerada`, e só lado a lado isso se confere.
  const cenario = indice % 5;
  // ⚠ UMA EMPRESA COM ESTADOS MISTURADOS, sempre.
  //
  // Sem ela, todas as guias de uma empresa compartilham o mesmo estado — e dois comportamentos
  // ficam impossíveis de ver: a regra de "individualizar os chips quando os estados divergem" (que
  // existe justamente para o Lucro Presumido) e o popover de um chip "enviada" sozinho, com canal e
  // ✓✓. Os dois só aparecem quando a empresa tem uma guia enviada ao lado de outra pendente.
  const misturada = indice === 1;
  const no = (chave) => {
    const required = requeridos[chave];
    if (!required) return { required: false, ok: true, state: "na" };

    if (misturada) {
      // PIS/COFINS já foi (por WhatsApp, lida); IRPJ ainda espera envio; o resto falta gerar.
      if (chave === "pisCofins") {
        return {
          required, ok: true, state: "enviada", guideId: `mock-guia-${companyId}-${chave}`,
          canalEnvio: "WHATSAPP", envioStatus: "lido", envioEm: new Date().toISOString(),
          envioDestino: "+55 (21) 99999-8888",
        };
      }
      if (chave === "irpj") {
        return { required, ok: true, state: "gerada", guideId: `mock-guia-${companyId}-${chave}`, emailStatus: "PENDING" };
      }
      // ⚠ CSLL com o envio FALHADO, ao lado do IRPJ apenas "gerada". Era este par que a tela não
      // sabia distinguir: os dois caíam em âmbar "gerada, falta enviar", e a guia que NÃO chegou ao
      // cliente tinha a mesma cara da que só está esperando a vez. Como nada drena
      // `emailNextRetryAt` (o laço saiu na Q55), ela ficava assim até alguém clicar por acaso.
      // `ok: true` de propósito — a guia existe; o que falhou foi o envio.
      if (chave === "csll") {
        return {
          required, ok: true, state: "falhou", guideId: `mock-guia-${companyId}-${chave}`,
          emailStatus: "ERROR", emailAttempts: 3,
          emailLastError: "550 5.1.1 The email account that you tried to reach does not exist",
        };
      }
      return { required, ok: false, state: "missing" };
    }

    const marcado = mockVazios.get(chaveVazio(companyId, MOCK_TRIBUTO_TIPO[chave]));
    if (marcado) {
      // Marcação feita AGORA na tela. Com faturamento na competência vira conflito, igual ao real.
      return faturamento > 0
        ? { required, ok: false, state: "conflito", faturamento, origem: "guia_vazia", ...marcado }
        : { required, ok: true, state: "vazio", origem: "guia_vazia", ...marcado };
    }

    if (cenario === 1) return { required, ok: true, state: "gerada", guideId: `mock-guia-${companyId}-${chave}`, emailStatus: "PENDING" };
    // ⚠ Metade das enviadas sai por WhatsApp no mock, de propósito: o popover mostra canal e as
    // confirmações ✓✓ que só o WhatsApp dá, e um mock 100% e-mail nunca exercitaria esse caminho.
    if (cenario === 2) {
      const porWhats = indice % 2 === 0;
      return {
        required, ok: true, state: "enviada", guideId: `mock-guia-${companyId}-${chave}`,
        emailStatus: porWhats ? null : "SENT",
        emailSentAt: porWhats ? null : new Date().toISOString(),
        canalEnvio: porWhats ? "WHATSAPP" : "EMAIL",
        envioStatus: porWhats ? "lido" : "enviado",
        envioEm: new Date().toISOString(),
      };
    }
    if (cenario === 3) return { required, ok: true, state: "vazio", origem: "guia_vazia", vazioEm: new Date().toISOString(), vazioPor: "Usuario Mock", vazioMotivo: null };
    if (cenario === 4) return { required, ok: false, state: "conflito", faturamento: 17640, origem: "guia_vazia", vazioEm: new Date().toISOString(), vazioPor: "Usuario Mock" };
    return { required, ok: false, state: "missing" };
  };

  // ⚠ Uma empresa a cada três tem PARCELA no mês, e ela convive com o DAS em vez de substituí-lo.
  // O mock precisa exercitar isso: enquanto a parcela satisfazia o nó do DAS, a tela mostrava a
  // empresa em dia com um DAS que nunca existiu — e nenhum mock mostrava a diferença.
  const temParcela = requeridos.das && indice % 3 === 0;
  const parcDas = temParcela
    ? {
      required: true, ok: true, state: cenario === 2 ? "enviada" : "gerada",
      guideId: `mock-parcela-${companyId}`,
      emailStatus: cenario === 2 ? "SENT" : "PENDING",
      emailSentAt: cenario === 2 ? new Date().toISOString() : null,
      tipoParcelamento: "PARCSN", numeroParcelamento: "1234567",
      numeroParcela: 3, quantidadeParcelas: 60,
    }
    : { required: false, ok: true, state: "na" };

  const nos = {
    das: no("das"), inss: no("inss"), irpj: no("irpj"),
    csll: no("csll"), pisCofins: no("pisCofins"), iss: no("iss"), parcDas,
  };
  return {
    competencia,
    ...nos,
    expected: requeridos.inss ? "INSS" : requeridos.das ? "SIMPLES" : null,
    ok: Object.values(nos).every((n) => n.ok),
  };
}

function makeCompanies(count = 6) {
  return Array.from({ length: count }).map((_, i) => {
    const companyId = faker.string.uuid();
    const ownerEmail = faker.internet.email().toLowerCase();
    const hasProlabore = i === 0;
    // Folha e pró-labore variam em empresas DIFERENTES de propósito: é o que deixa conferir na
    // tela que os dois selos são independentes, em vez de sempre aparecerem juntos.
    const temFolha = i === 1 || i === 2;
    const regimeTributario = i === 1 ? "LUCRO_PRESUMIDO" : "SIMPLES";
    // Certificado A1: a MAIORIA em dia, uma sem e uma vencida. O selo só aparece na exceção, então
    // um mock onde nenhuma empresa tem cert faz a pílula aparecer em todas — e aí ela não distingue
    // ninguém, que é exatamente o defeito que ela existe para evitar.
    const semCert = i === 3;
    const certVencido = i === 4;
    const certExpiresAt = certVencido
      ? new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
      : new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString();
    // Empresa zerada (sem movimento): a coluna de guias precisa dizer isso em vez de listar chips.
    const empresaZerada = i === 5;
    // ⚠ O MUNICÍPIO EMISSOR EM DUAS SITUAÇÕES, porque são duas telas diferentes.
    // Em produção (medido) 32 das 33 empresas são do Rio e uma é de Mangaratiba/RJ, e NENHUMA tem
    // o código IBGE preenchido — a coluna nasceu vazia de propósito. O mock precisa dos dois casos:
    // sem código (a empresa NÃO emite, e é isso que o cadastro e o assistente têm de dizer ANTES da
    // tentativa) e com código (o caminho normal). Só a de Mangaratiba vem configurada.
    // `municipio`/`uf` são texto do `PortalClient` e existem no payload real; aqui eles alimentam a
    // CONFERÊNCIA ao lado do seletor — nunca a escolha.
    const ehMangaratiba = i === 2;
    return {
      companyId,
      razao: faker.company.name(),
      cnpj: faker.helpers.replaceSymbols("##.###.###/####-##"),
      municipio: ehMangaratiba ? "Mangaratiba" : "Rio de Janeiro",
      uf: "RJ",
      ownerEmail,
      guideNotificationEmail: ownerEmail,
      hasProlabore,
      temFolha,
      empresaZerada,
      email: null,
      legacyCompany: {
        regimeTributario,
        tipoTributario: regimeTributario,
        certStorageKey: semCert ? null : `mock-cert-${companyId}`,
        certExpiresAt: semCert ? null : certExpiresAt,
        // ⚠ SEM ISSO A JANELA DE NF-e NÃO EXISTE OFFLINE. `renderCompanyDetailPage` só monta o
        // toggle NFS-e⇄NF-e com `legacyCompany.inscricaoEstadual` preenchida, e NENHUMA empresa do
        // mock tinha uma — metade da aba Notas Fiscais (e a NF-e, que é o caso FEIO: sem XML, sem
        // tomador e sem nenhum item) era inalcançável sem backend. Só a 2ª empresa tem IE: a maioria
        // dos clientes é de serviço, e ter IE em todas apagaria o caminho "empresa só de NFS-e".
        inscricaoEstadual: i === 1 ? "11.222.333" : "",
        // Código do IBGE (7 dígitos) — o `cLocEmi` da DPS. Nulo = empresa que ainda não emite.
        codigoMunicipioIbge: ehMangaratiba ? "3302601" : null,
        // ⚠ A CONFIGURAÇÃO DE EMISSÃO EM DOIS ESTADOS, e pelo mesmo motivo do município: são duas
        // telas diferentes. Medido em produção, NENHUMA das 33 empresas tem estes campos — as
        // colunas existem desde sempre e não havia formulário que as escrevesse. O mock precisa do
        // caso "empresa não configurada" (a maioria, que o cadastro e o assistente têm de recusar
        // ANTES da tentativa) e do caso configurado, para o caminho normal existir offline.
        // Só a de Mangaratiba vem completa — a mesma que já tinha município.
        inscricaoMunicipal: ehMangaratiba ? "1.234.567-8" : "",
        // ⚠ NADA aqui é derivado do CNAE nem da atividade: a lista da LC 116 e a do município não
        // existem no projeto. Estes valores são os do exemplo real de `docs/nfse-preenchimento.md`.
        codigoServicoNacional: ehMangaratiba ? "171201" : null,
        // ⚠ A empresa configurada nasce com DOIS códigos, não um — o caso que o dono descreveu
        // ("a empresa pode usar mais de uma atividade") precisa existir offline, senão o seletor,
        // o marcador de "qual a nota leva" e a escolha na emissão nunca são exercidos. Os dois
        // saem da lista OFICIAL versionada (`docs/lista-servico-nacional/`): 171201 é o do exemplo
        // real de `docs/nfse-preenchimento.md`, 010101 é o primeiro da lista.
        codigosServicoNacional: ehMangaratiba ? ["171201", "010101"] : [],
        codigoServicoMunicipal: ehMangaratiba ? "001" : null,
        rpsSerie: ehMangaratiba ? "00001" : null,
      },
      // Recalculado a cada `listCompanies` (ver abaixo) — aqui é só o valor inicial da carga.
      guideCompliance: mockGuideComplianceRow({ companyId, indice: i, hasProlabore, regimeTributario }),
      // C6: paridade com o real — o card usa estes campos pro toggle guias⇄"Enviado",
      // pro aviso de pendência fiscal (SITFIS) e pro selo PARC.
      guidesEnvio: { competencia: null, total: 2, enviadas: i % 3 === 0 ? 2 : 1, todasEnviadas: i % 3 === 0 },
      fiscalSituacao: i === 0 ? "COM_PENDENCIA" : i === 1 ? "EM_PARCELAMENTO" : i === 2 ? "REGULAR" : null,
      // ⚠ Uma consulta VELHA e uma NUNCA feita são casos diferentes e precisam dos dois no mock:
      // a velha rebaixa o chip para "Consultar (Xd)", a nunca feita mostra só "Consultar".
      fiscalCheckedAt: i === 0 || i === 1 ? new Date().toISOString()
        : i === 2 ? new Date(Date.now() - 45 * 86400000).toISOString()
          : null,
      temParcelamento: i === 1,
      // ⚠ SEM ISTO O MOCK NUNCA PRODUZ "Falta fechar". O campo não existia aqui, então a coluna
      // Apuração só sabia mostrar "falta apurar" e o estado âmbar — com seu tooltip de check-list —
      // não tinha como ser exercitado em lugar nenhum antes de ir para produção.
      apuracao: { apurada: i === 2 || i === 4, estado: i === 2 || i === 4 ? "transmitida" : null },
    };
  });
}

// Competência default da aba Guias (mês anterior) — a fixture de parcelamento precisa cair nela,
// senão só aparece depois de marcar "Ver todas as competências" e ninguém a encontra.
function competenciaAnteriorMock() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * As DUAS caras de uma parcela de parcelamento, na empresa que tem `temParcelamento`.
 *
 * ⚠ As duas são `tipo:"SIMPLES"`, iguais ao DAS do mês — é esse o ponto. A segunda vem SEM
 * modalidade (parcelamento criado pelo caminho V1, que não grava `tipo` nem `numeroParcelamento`):
 * era ela que fazia a tela imprimir "Parc. SIMPLES", e sem ela no mock a correção não é conferível
 * offline.
 */
function makeParcelaGuides(company) {
  const competencia = competenciaAnteriorMock();
  const base = {
    portalClientId: company.companyId,
    tipo: "SIMPLES",
    competencia,
    status: "PROCESSED",
    emailStatus: "PENDING",
    paymentStatus: "OPEN",
    paymentStatusSource: "SERPRO",
    paymentConfirmedAt: null,
    serproLastCheckedAt: new Date().toISOString(),
    serproLastCheckResult: "FOUND",
    serproService: "GERARDAS161",
    canConfirmPayment: true,
    // ⚠ `true` de propósito, e não é descuido: é o que o backend real devolve.
    // `canGuideRecalculate` só olha `source`/`tipo`/pago, e a parcela é SERPRO + SIMPLES + OPEN —
    // por isso ela ganhava um "Recalcular" habilitado que emite o DAS do MÊS por cima dela. Com
    // `false` aqui, o mock desabilitava o botão por outro motivo e escondia o defeito offline.
    canRecalculate: true,
    vencimento: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  return [
    {
      ...base,
      id: `mock-parcela-completa-${company.companyId}`,
      valor: "812.44",
      parcelamentoId: `mock-parc-${company.companyId}`,
      parcelamentoTipo: "PARCSN",
      parcelamentoNumero: "1234567",
      parcelamentoLabel: "RE-PARCELAMENTO SIMPLES NACIONAL DE SET/OUT/2024",
      numeroParcela: 3,
      quantidadeParcelas: 10,
    },
    {
      ...base,
      id: `mock-parcela-sem-modalidade-${company.companyId}`,
      valor: "512.10",
      parcelamentoId: `mock-parc-v1-${company.companyId}`,
      parcelamentoTipo: null,
      parcelamentoNumero: null,
      parcelamentoLabel: "PARCELAMENTO INSS 2023 (lançado à mão)",
      numeroParcela: 4,
      quantidadeParcelas: 10,
    },
  ];
}

function makeGuidesByCompany(companies) {
  const guidesByCompany = new Map();
  for (const company of companies) {
    const guides = Array.from({ length: faker.number.int({ min: 3, max: 12 }) }).map(() => {
      const status = faker.helpers.arrayElement(["PROCESSED", "PROCESSED", "PROCESSED", "ERROR"]);
      const emailStatus = status === "ERROR" ? "ERROR" : faker.helpers.arrayElement(["PENDING", "SENT"]);
      const vencimento = faker.date.soon({ days: 20 }).toISOString();
      const paymentStatus = faker.helpers.arrayElement(["OPEN", "OPEN", "PAID", "OVERDUE"]);
      return {
        id: faker.string.uuid(),
        portalClientId: company.companyId,
        tipo: faker.helpers.arrayElement(["DAS", "FGTS", "INSS", "IRPJ", "SIMPLES"]),
        competencia: `${faker.number.int({ min: 2024, max: 2026 })}-${String(
          faker.number.int({ min: 1, max: 12 })
        ).padStart(2, "0")}`,
        valor: faker.finance.amount({ min: 120, max: 9500, dec: 2 }),
        vencimento,
        status,
        emailStatus,
        paymentStatus,
        paymentStatusSource: paymentStatus === "PAID" ? faker.helpers.arrayElement(["MANUAL", "SERPRO"]) : "SERPRO",
        paymentConfirmedAt: paymentStatus === "PAID" ? new Date().toISOString() : null,
        serproLastCheckedAt: new Date().toISOString(),
        serproLastCheckResult: paymentStatus === "PAID" ? "NOT_FOUND" : "FOUND",
        serproService: "GERARDAS12",
        canConfirmPayment: paymentStatus !== "PAID",
        canRecalculate: paymentStatus !== "PAID", // Q29: vencida ou em aberto (não só vencida)
      };
    });
    if (company.temParcelamento) guides.unshift(...makeParcelaGuides(company));
    guidesByCompany.set(company.companyId, guides);
  }
  return guidesByCompany;
}

const mockCompanies = makeCompanies();
const mockGuidesByCompany = makeGuidesByCompany(mockCompanies);
const mockUnidentifiedGuides = [];

// ── Obrigações ────────────────────────────────────────────────────────────────────────────────
// Gera a janela de 12 meses com as MESMAS regras do backend (clamp do dia 31, fim de semana,
// defasagem da competência). Repetir a regra aqui é chato, mas um mock que devolvesse datas
// bonitas esconderia justamente o que precisa ser visto na tela.
function mockCriarObrigacao(companyId, empresa, dados) {
  const periodicidade = String(dados.periodicidade || "MENSAL").toUpperCase();
  const diaPedido = Number(dados.diaVencimento) || 20;
  const ajuste = String(dados.ajusteDiaUtil || "ANTECIPAR").toUpperCase();
  const defasagem = dados.defasagemMeses == null ? 1 : Number(dados.defasagemMeses);
  const mesRef = dados.mesReferencia == null ? null : Number(dados.mesReferencia);

  const hoje = new Date();
  const ocorrencias = [];
  for (let i = 0; i < 12; i += 1) {
    const bruto = hoje.getUTCMonth() + i;
    const ano = hoje.getUTCFullYear() + Math.floor(bruto / 12);
    const mes = (bruto % 12) + 1;
    if (periodicidade === "ANUAL" && mes !== mesRef) continue;
    if (periodicidade === "TRIMESTRAL" && (((mes - mesRef) % 3) + 3) % 3 !== 0) continue;

    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const d = new Date(Date.UTC(ano, mes - 1, Math.min(diaPedido, ultimoDia)));
    if (ajuste !== "MANTER") {
      const passo = ajuste === "ANTECIPAR" ? -1 : 1;
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + passo);
    }
    const compBruta = ano * 12 + (mes - 1) - Math.max(0, defasagem);
    ocorrencias.push({
      ocorrenciaId: `mock-oc-${companyId}-${ano}${String(mes).padStart(2, "0")}-${Math.random().toString(36).slice(2, 7)}`,
      dataVencimento: d.toISOString().slice(0, 10),
      competenciaRef: `${Math.floor(compBruta / 12)}-${String((compBruta % 12) + 1).padStart(2, "0")}`,
      status: "PENDENTE",
      concluidaEm: null,
      fonteConclusao: null,
    });
  }

  return {
    obrigacaoId: `mock-obr-${Math.random().toString(36).slice(2, 9)}`,
    companyId,
    empresa,
    nome: String(dados.nome || "").trim() || "Obrigação sem nome",
    categoria: String(dados.categoria || "").trim() || null,
    periodicidade,
    diaVencimento: diaPedido,
    mesReferencia: periodicidade === "MENSAL" ? null : mesRef,
    defasagemMeses: defasagem,
    antecedenciaLembreteDias: dados.antecedenciaLembreteDias == null ? 5 : Number(dados.antecedenciaLembreteDias),
    ajusteDiaUtil: ajuste,
    cor: dados.cor || null,
    ativa: dados.ativa === undefined ? true : Boolean(dados.ativa),
    verificador: dados.verificador || null,
    regraId: dados.regraId || null,
    sobrescritaLocal: false,
    ocorrencias,
  };
}

// Semente escolhida para cobrir os três casos que a tela precisa distinguir: uma que se conclui
// sozinha, uma manual com vencimento já passado (para o VENCIDA derivado aparecer) e uma anual.
const mockObrigacoes = mockCompanies.length
  ? [
      mockCriarObrigacao(mockCompanies[0].companyId, mockCompanies[0].razao, {
        nome: "Transmitir apuração do Simples",
        categoria: "fiscal",
        periodicidade: "MENSAL",
        diaVencimento: 20,
        verificador: "APURACAO_TRANSMITIDA",
      }),
      mockCriarObrigacao(mockCompanies[0].companyId, mockCompanies[0].razao, {
        nome: "Enviar folha ao cliente",
        categoria: "trabalhista",
        periodicidade: "MENSAL",
        diaVencimento: 5,
        defasagemMeses: 0,
      }),
      mockCriarObrigacao(mockCompanies[1]?.companyId || mockCompanies[0].companyId, mockCompanies[1]?.razao || mockCompanies[0].razao, {
        nome: "Entregar ECD",
        categoria: "fiscal",
        periodicidade: "ANUAL",
        mesReferencia: 5,
        diaVencimento: 31,
        defasagemMeses: 5,
        // ⚠ Janela de 60 dias, não os 5 do default. Numa obrigação ANUAL o lembrete de 5 dias é
        // irreal — e, com ele, a fixture pularia de "aguardando" direto para "urgente" na véspera,
        // deixando o ciclo que esta entrega acrescenta invisível offline. O número é escolha de
        // FIXTURE, não regra fiscal: quem declara a janela de verdade é o escritório.
        antecedenciaLembreteDias: 60,
      }),
    ]
  : [];

// Feriados de 2026 — os mesmos que `scripts/semear-feriados.mjs` grava, para a tela poder ser
// conferida no mock. Carnaval e Corpus Christi entram por decisão do dono (são ponto facultativo
// federal, não feriado, mas banco não opera).
const MOCK_FERIADOS = {
  "2026-01-01": "Confraternização Universal",
  "2026-02-16": "Carnaval (segunda)",
  "2026-02-17": "Carnaval (terça)",
  "2026-04-03": "Sexta-feira Santa",
  "2026-04-21": "Tiradentes",
  "2026-05-01": "Dia do Trabalho",
  "2026-06-04": "Corpus Christi",
  "2026-07-09": "Revolução Constitucionalista (SP)",
  "2026-09-07": "Independência do Brasil",
  "2026-10-12": "Nossa Senhora Aparecida",
  "2026-11-02": "Finados",
  "2026-11-15": "Proclamação da República",
  "2026-11-20": "Consciência Negra",
  "2026-12-25": "Natal",
};

// ── Regras do escritório ──────────────────────────────────────────────────────────────────────
const mockRegras = [];

const MOCK_ROTULO_REGIME = {
  SIMPLES: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real",
};

function mockRegimeDaEmpresa(c) {
  return c.legacyCompany?.regimeTributario || null;
}

function mockEmpresasDoEscopo(escopo, filtros, excecoesIds = []) {
  const fora = new Set(excecoesIds);
  let alvo = mockCompanies.filter((c) => !fora.has(c.companyId));
  if (escopo === "SELECAO_MANUAL") {
    const ids = new Set(filtros?.empresasIds || []);
    alvo = alvo.filter((c) => ids.has(c.companyId));
  } else if (escopo === "POR_FILTRO") {
    const regimes = filtros?.regimes || [];
    if (filtros?.temFolha === true) alvo = alvo.filter((c) => c.temFolha);
    // Empresa sem regime declarado NÃO entra num filtro por regime — mesma regra do backend.
    if (regimes.length) alvo = alvo.filter((c) => regimes.includes(mockRegimeDaEmpresa(c)));
  }
  return alvo.map((c) => ({ companyId: c.companyId, razao: c.razao, cnpj: c.cnpj, temFolha: Boolean(c.temFolha) }));
}

function mockResumoEscopo(regra, total) {
  const sufixo = `${total} empresa${total === 1 ? "" : "s"}`;
  if (regra.escopo === "TODAS") return `Todas as empresas · ${sufixo}`;
  if (regra.escopo === "SELECAO_MANUAL") return `Empresas escolhidas à mão · ${sufixo}`;
  const partes = [];
  if (regra.filtros?.regimes?.length) partes.push(regra.filtros.regimes.map((r) => MOCK_ROTULO_REGIME[r] || r).join(", "));
  if (regra.filtros?.temFolha === true) partes.push("somente com folha");
  return `${partes.join(" · ") || "Todas"} · ${sufixo}`;
}

function mockPropagarRegra(regra) {
  const excecoesIds = (regra.excecoes || []).map((e) => e.companyId);
  const alvo = regra.ativa === false ? [] : mockEmpresasDoEscopo(regra.escopo, regra.filtros, excecoesIds);
  const alvoIds = new Set(alvo.map((e) => e.companyId));
  let criadas = 0, atualizadas = 0, puladas = 0;

  for (const empresa of alvo) {
    const atual = mockObrigacoes.find((o) => o.regraId === regra.regraId && o.companyId === empresa.companyId);
    // Sobrescrita local é pulada: a regra não apaga a escolha de quem editou na empresa.
    if (atual?.sobrescritaLocal) { puladas += 1; continue; }
    const nova = mockCriarObrigacao(empresa.companyId, empresa.razao, { ...regra });
    nova.regraId = regra.regraId;
    if (atual) {
      const concluidas = atual.ocorrencias.filter((oc) => oc.status === "CONCLUIDA");
      const jaTem = new Set(concluidas.map((oc) => oc.dataVencimento));
      nova.obrigacaoId = atual.obrigacaoId;
      nova.ocorrencias = [...concluidas, ...nova.ocorrencias.filter((oc) => !jaTem.has(oc.dataVencimento))]
        .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
      mockObrigacoes[mockObrigacoes.indexOf(atual)] = nova;
      atualizadas += 1;
    } else {
      mockObrigacoes.push(nova);
      criadas += 1;
    }
  }

  const removidas = mockObrigacoes.filter(
    (o) => o.regraId === regra.regraId && !alvoIds.has(o.companyId) && !o.sobrescritaLocal,
  );
  for (const o of removidas) mockObrigacoes.splice(mockObrigacoes.indexOf(o), 1);

  return { criadas, atualizadas, puladas, removidas: removidas.length, empresasNoEscopo: alvo.length };
}

const MOCK_TIPOS_DOC = ["CONTRATO_SOCIAL", "CARTAO_CNPJ", "INSCRICAO_ESTADUAL", "INSCRICAO_MUNICIPAL", "ALVARA", "PROCURACAO", "OUTRO"];
const MOCK_TIPO_DOC_LABELS = {
  CONTRATO_SOCIAL: "Contrato social", CARTAO_CNPJ: "Cartão CNPJ",
  INSCRICAO_ESTADUAL: "Inscrição estadual", INSCRICAO_MUNICIPAL: "Inscrição municipal",
  ALVARA: "Alvará", PROCURACAO: "Procuração", OUTRO: "Outro",
};
let mockDocumentos = [
  { id: "mock-doc-1", tipo: "CONTRATO_SOCIAL", nome: "Contrato social.pdf", mimeType: "application/pdf", bytes: 184320, validade: null, createdAt: "2026-03-10T12:00:00.000Z" },
  { id: "mock-doc-2", tipo: "CARTAO_CNPJ", nome: "Cartão CNPJ.pdf", mimeType: "application/pdf", bytes: 51200, validade: null, createdAt: "2026-05-02T12:00:00.000Z" },
  { id: "mock-doc-3", tipo: "ALVARA", nome: "Alvará de funcionamento.pdf", mimeType: "application/pdf", bytes: 92160, validade: "2026-12-31T00:00:00.000Z", createdAt: "2026-01-15T12:00:00.000Z" },
];
// A fixada é de propósito a MENOS importante e a MAIS antiga: é o caso que revela um orderBy
// ingênuo — nas duas ordenações ela tem que continuar em primeiro.
let mockAnotacoes = [
  { id: "mock-nota-1", texto: "Cliente prefere receber as guias até o dia 5.", importancia: "BAIXA", fixada: true, createdAt: "2026-02-01T12:00:00.000Z" },
  { id: "mock-nota-2", texto: "Sócio entrou em 04/2026 — conferir pró-labore.", importancia: "ALTA", fixada: false, createdAt: "2026-07-20T12:00:00.000Z" },
  { id: "mock-nota-3", texto: "Enviar balancete trimestral ao contador do grupo.", importancia: "MEDIA", fixada: false, createdAt: "2026-06-11T12:00:00.000Z" },
];
// ── Cofre de senhas (mock com estado em memória) ─────────────────────────────────────────────
//
// ⚠ NENHUMA SENHA AQUI PARECE REAL, E ISSO É REGRA, NÃO ESTILO. Fixture entra no histórico do git
// para sempre; uma senha plausível num mock é indistinguível de uma senha vazada, e alguém acaba
// tentando-a em algum portal. Os valores abaixo se ANUNCIAM como falsos.
//
// ⚠ O mock guarda a senha num campo SEPARADO (`_senhaFalsa`) que a listagem nunca copia — é o
// espelho da invariante do backend (`select` sem `senhaCifrada`). Um mock que devolvesse a senha
// junto da lista faria a tela funcionar sem nunca exercitar o botão "Ver senha", que é o único
// caminho auditado, e o defeito só apareceria em produção.
let mockCredenciais = [
  {
    id: "mock-cred-1", rotulo: "gov.br", login: "12.345.678/0001-90",
    observacao: "Titular: sócio administrador.",
    senhaAtualizadaEm: "2026-05-14T12:00:00.000Z", createdAt: "2026-01-10T12:00:00.000Z",
    vezesRevelada: 3, _senhaFalsa: "SENHA-FALSA-DO-MOCK-nao-use",
  },
  {
    id: "mock-cred-2", rotulo: "Prefeitura (NFS-e)", login: "usuario.exemplo",
    observacao: null,
    senhaAtualizadaEm: null, createdAt: "2026-03-02T12:00:00.000Z",
    vezesRevelada: 0, _senhaFalsa: "OUTRA-SENHA-FALSA-DO-MOCK",
  },
  // ⚠ Sem senha, de propósito: é o caso que separa "não posso ver" de "não há o que ver". Sem ele
  // o estado `SEM_SENHA` e a primeira recusa de `podeVerSenha` nunca aparecem na tela.
  {
    id: "mock-cred-3", rotulo: "Portal do banco", login: null,
    observacao: "Acesso só pelo app, com biometria do sócio — não há senha a guardar.",
    senhaAtualizadaEm: null, createdAt: "2026-04-18T12:00:00.000Z",
    vezesRevelada: 0, _senhaFalsa: null,
  },
];
let mockInformacoes = [
  { id: "mock-info-1", rotulo: "Contador anterior", valor: "Escritório Exemplo — (11) 0000-0000", createdAt: "2026-02-08T12:00:00.000Z" },
  { id: "mock-info-2", rotulo: "Protocolo alvará", valor: "2026/000123-4", createdAt: "2026-06-01T12:00:00.000Z" },
];
// ⚠ O mock devolve `kms: false` de propósito: é o cenário de MENOR proteção, e é o único em que o
// aviso âmbar da tela aparece. Um mock com `kms: true` deixaria o caminho que o dono precisa
// enxergar (a chave-mestra numa variável de ambiente) sem nenhuma exibição.
const mockCofre = {
  kms: false,
  algoritmo: "AES-256-GCM",
  rotulo: "Chave derivada de CERT_SECRET_KEY (variável de ambiente do servidor)",
};

// Consultas de notas em lote já disparadas nesta sessão — dá para sair da aba e voltar achando o
// resultado, que é o comportamento que evita o contador disparar (e pagar) de novo.
let mockCapturas = [];
const mockGuideSettings = {
  pdfReaderConfigured: true,
};
const mockSerproSettings = {
  enabled: false,
  environment: "homolog",
  authUrl: "https://autenticacao.sapi.serpro.gov.br/authenticate",
  baseUrl: "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1",
  consumerKey: "",
  consumerSecretConfigured: false,
  scope: "",
  timeoutMs: 30000,
  fetchCron: "0 7 5 * *",
  certificate: {
    hasCertificate: false,
    originalName: null,
    uploadedAt: null,
    expiresAt: null,
    passwordConfigured: false,
  },
  source: {
    usingEnvBaseUrl: false,
    usingEnvConsumerKey: false,
    usingEnvConsumerSecret: false,
  },
};
let mockSerproLastRun = {
  key: "serpro_pgdasd_log:mock",
  updatedAt: new Date().toISOString(),
  value: {
    worker: "serpro_pgdasd",
    createdAt: new Date().toISOString(),
    competencia: "2026-04",
    summary: {
      totalCompanies: 4,
      captured: 2,
      failed: 1,
      skippedByProcuration: 1,
      durationMs: 1842,
    },
  },
};
const mockSerproProcurationByCompany = new Map();

// Plano de contas mock (por empresa)
const mockChartOfAccounts = new Map();
// Sequencial das notas emitidas no mock — número e chave precisam ser distintos a cada emissão,
// senão duas notas seguidas pareceriam a mesma na tela de resultado.
let mockNfseSeq = 0;

// ── Notas fiscais (listagem + íntegra) ────────────────────────────────────────
//
// ⚠ ESTE MOCK É GRANDE DE PROPÓSITO. O anterior tinha DUAS notas, e por isso o caminho que quebrou
// em produção era **inalcançável offline**: a tabela pagina de 100 em 100, e com 2 notas ninguém
// nunca via a paginação, o rodapé "mostrando 1–100 de 247" nem o que acontece quando o mês tem
// mais nota do que a página. Medido na base real (10/08/2026): **2.717 notas** numa única
// competência (empresa × 2026-07 × EMIT × NFS-e), e **8 células empresa×competência acima de 500**
// — o teto duro da rota. 247 aqui é o menor número que exercita 3 páginas.
//
// Os casos FEIOS são os da base real, com as contagens que os motivaram:
//   • 62 notas sem `numero`, sem `emitenteNome` e sem `total`
//   • 1 nota sem `chaveAcesso`, sem `papel` e sem `statusEfetivo`
//   • 556 canceladas
//   • 29 NF-e — TODAS sem `xmlRaw`, sem `tomadorNome`/`tomadorDoc` e sem nenhum item
//   • 16.128 de 16.128 NFS-e COM `xmlRaw` gravado (4,4–11,4 KB)
// ⚠ Os CNPJs e as razões sociais são FABRICADOS (mesmo formato, dígitos inventados).

// ⚠ Acompanha o default da aba (mês ANTERIOR ao atual, igual `prevMonthCompetencia` do hook), em
// vez de um mês fixo: fixo, o mock envelhece e a aba abre vazia no default — e uma tela vazia por
// data velha se parece com uma tela vazia por defeito, que é exatamente o que não se pode confundir.
const MOCK_NOTAS_COMPETENCIA = (() => {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();
const MOCK_XML_NFSE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">',
  "  <infNFSe>",
  "    <nNFSe>__NUMERO__</nNFSe>",
  "    <dhProc>2026-06-__DIA__T09:14:22-03:00</dhProc>",
  "    <emit><CNPJ>00000000000191</CNPJ><xNome>EMPRESA EXEMPLO MOCK LTDA</xNome></emit>",
  "    <valores><vServ>__VALOR__</vServ></valores>",
  "    <serv><cTribNac>080201</cTribNac><xDescServ>__DESCRICAO__</xDescServ></serv>",
  "  </infNFSe>",
  "</NFSe>",
].join("\n");

function mockXmlDaNota(n) {
  return MOCK_XML_NFSE
    .replace("__NUMERO__", n.numero || "")
    .replace("__DIA__", String(new Date(n.issueDate).getUTCDate()).padStart(2, "0"))
    .replace("__VALOR__", n.total || "0.00")
    .replace("__DESCRICAO__", (n.__descricao || "").slice(0, 60));
}

function mockNota(over) {
  return {
    id: null, type: "NFSE", papel: "EMIT", statusEfetivo: "autorizada", status: "EMITIDA",
    chaveAcesso: null, numero: null, serie: null,
    competencia: `${MOCK_NOTAS_COMPETENCIA}-01T00:00:00.000Z`,
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-10T00:00:00.000Z`,
    total: null, emitenteNome: null, emitenteDoc: null, tomadorNome: null, tomadorDoc: null,
    competenciaPosFechamento: false,
    // O VÍNCULO e a HISTÓRIA. `chaveSubstituida` é coluna ("eu substituo aquela"); `ciclo` é a
    // leitura derivada que a rota compõe (cancelada × substituída × substituta × "não temos o
    // evento"). Nulo/ausente na esmagadora maioria — como em produção.
    chaveSubstituida: null, motivoSubstituicao: null,
    // ⚠ `eventoRegistrado: false` numa nota CANCELADA quer dizer "não sabemos", nunca "não houve".
    // O default aqui é o estado real da base: nenhum evento guardado.
    ciclo: {
      situacao: "autorizada", ehSubstituta: false, substitui: null, motivoSubstituicao: null,
      substituidaPor: null, evento: null, eventoRegistrado: false, avisos: [],
    },
    // Campos só da íntegra (a listagem não os devolve).
    idNfse: null, idDps: null, pdfUrl: null, xmlHash: null, lastSyncAt: null,
    createdAt: `${MOCK_NOTAS_COMPETENCIA}-10T12:00:00.000Z`,
    updatedAt: `${MOCK_NOTAS_COMPETENCIA}-10T12:00:00.000Z`,
    // ⚠ `eventos` é da ÍNTEGRA e é o que dá data e motivo ao cancelamento/substituição. Vazio é o
    // estado da esmagadora maioria (0 linhas em `PortalInvoiceEvent` para as 556 canceladas): a
    // lista de eventos vazia significa "não guardamos", nunca "não houve".
    __eventos: [],
    __temXml: true, __descricao: null, __codigoServico: null, __cfop: null, __ncm: null,
    ...over,
  };
}

const mockNotas = (() => {
  const out = [];
  const dia = (i) => String((i % 28) + 1).padStart(2, "0");
  const chave = (i) => `330455722553875800001030000000${String(13000 + i).padStart(5, "0")}26088969924${String(100 + (i % 900))}`;
  const servicos = [
    ["080201", "CURSO EAD - POS-GRADUACAO - PROCESSO CIVIL"],
    ["170101", "ASSINATURA MENSAL - PLATAFORMA DE ENSINO"],
    ["010701", "SUPORTE TECNICO E MANUTENCAO DE SISTEMA"],
    ["140201", "CONSULTORIA EM GESTAO EMPRESARIAL"],
  ];

  // 240 NFS-e emitidas "normais" — o volume que faz a paginação existir.
  for (let i = 0; i < 240; i++) {
    const [cod, desc] = servicos[i % servicos.length];
    out.push(mockNota({
      id: `mock-nfse-${i + 1}`,
      numero: String(13000 + i),
      chaveAcesso: chave(i),
      issueDate: `${MOCK_NOTAS_COMPETENCIA}-${dia(i)}T00:00:00.000Z`,
      total: (89.9 + i * 7.35).toFixed(2),
      emitenteNome: "EMPRESA EXEMPLO MOCK LTDA", emitenteDoc: "00000000000191",
      tomadorNome: `TOMADOR MOCK ${String(i + 1).padStart(3, "0")} LTDA`,
      tomadorDoc: `1122233300${String(i % 90).padStart(2, "0")}91`,
      __descricao: desc, __codigoServico: cod,
    }));
  }

  // FEIO 1 — a nota mutilada: sem número, sem emitente, sem valor (62 assim na base real).
  out.push(mockNota({
    id: "mock-nfse-mutilada",
    chaveAcesso: chave(900),
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-05T00:00:00.000Z`,
    tomadorNome: "TOMADOR MOCK 900 LTDA",
    __descricao: "SERVICO SEM DESCRICAO NO DOCUMENTO", __codigoServico: null,
  }));

  // FEIO 2 — sem chave, sem papel, sem statusEfetivo: só o `idNfse` identifica (1 assim na base).
  out.push(mockNota({
    id: "mock-nfse-sem-chave",
    numero: "13990", papel: null, statusEfetivo: null,
    idNfse: "3304557202606000000013990",
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-06T00:00:00.000Z`,
    total: "1250.00",
    emitenteNome: "EMPRESA EXEMPLO MOCK LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR MOCK 901 LTDA",
    __descricao: "CONSULTORIA AVULSA", __codigoServico: "140201",
  }));

  // FEIO 3 — cancelada (556 na base). Fica FORA do faturamento e só aparece com o toggle ligado.
  out.push(mockNota({
    id: "mock-nfse-cancelada",
    numero: "13991", statusEfetivo: "cancelada", status: "CANCELADA",
    chaveAcesso: chave(901),
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-12T00:00:00.000Z`,
    total: "800.00",
    emitenteNome: "EMPRESA EXEMPLO MOCK LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR MOCK 902 LTDA",
    // ⚠ ESTE É O ESTADO DE 556 NOTAS EM PRODUÇÃO: cancelada, e sem o evento guardado. A captura só
    // passou a gravar o evento em 10/08/2026 — do que veio antes não temos data nem motivo, e a
    // tela precisa dizer isso em vez de se calar (calar-se é afirmar "não houve evento").
    ciclo: {
      situacao: "cancelada", ehSubstituta: false, substitui: null, motivoSubstituicao: null,
      substituidaPor: null, evento: null, eventoRegistrado: false,
      avisos: [{
        codigo: "evento_nao_registrado",
        texto: "Esta nota está marcada como cancelada, mas nós não guardamos o evento de "
          + "cancelamento — não temos a data, o motivo, nem se foi cancelamento simples ou "
          + "substituição. Isso NÃO quer dizer que o evento não existiu.",
      }],
    },
    __descricao: "CURSO CANCELADO A PEDIDO DO ALUNO", __codigoServico: "080201",
  }));

  // FEIO 7 — O CICLO INTEIRO: cancelada → substituída → substituta.
  //
  // É o caso que o dono descreveu ("cancelamos essa nota, emitimos outra e depois a substituímos")
  // e o que a aba não sabia contar: 22 pares reais na base. As três notas abaixo cobrem as três
  // leituras que precisam ser DIFERENTES na tela — e a quarta, que é a pior:
  //   · 13993 — cancelada por substituição, COM o evento gravado (sabemos data e motivo)
  //   · 13994 — a substituta, que declara quem substituiu
  //   · 13991 (acima) — cancelada SEM evento: 556 assim em produção. "Não temos o evento" tem de
  //     aparecer diferente de "não houve evento".
  out.push(mockNota({
    id: "mock-nfse-substituida",
    numero: "13993", statusEfetivo: "cancelada", status: "CANCELADA",
    chaveAcesso: chave(903),
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-15T00:00:00.000Z`,
    total: "2300.00",
    emitenteNome: "EMPRESA EXEMPLO MOCK LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR MOCK 904 LTDA",
    ciclo: {
      situacao: "substituida", ehSubstituta: false, substitui: null, motivoSubstituicao: null,
      substituidaPor: { notaId: "mock-nfse-substituta", numero: "13994", chaveAcesso: chave(904), naBase: true },
      evento: {
        tipo: "canc_por_substituicao", tpEvento: "105102", nSeqEvento: 1,
        dataEvento: `${MOCK_NOTAS_COMPETENCIA}-16T10:30:00.000Z`, motivo: "valor da nota esta incorreto",
      },
      eventoRegistrado: true, avisos: [],
    },
    // O evento é o FATO: com ele a tela tem data, motivo e a chave da substituta. Sem ele (o caso
    // da 13991) sobra só "está cancelada", que é bem menos do que o contador precisa saber.
    __eventos: [{
      id: "mock-ev-1", tipo: "canc_por_substituicao", tpEvento: "105102", nSeqEvento: 1,
      dataEvento: `${MOCK_NOTAS_COMPETENCIA}-16T10:30:00.000Z`,
      motivo: "valor da nota esta incorreto", chaveSubstituta: chave(904),
      capturadoEm: `${MOCK_NOTAS_COMPETENCIA}-16T11:02:00.000Z`,
    }],
    __descricao: "CONSULTORIA COM VALOR CORRIGIDO DEPOIS", __codigoServico: "140201",
  }));
  out.push(mockNota({
    id: "mock-nfse-substituta",
    numero: "13994", chaveAcesso: chave(904),
    chaveSubstituida: chave(903), motivoSubstituicao: "valor da nota esta incorreto",
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-16T00:00:00.000Z`,
    total: "2100.00",
    emitenteNome: "EMPRESA EXEMPLO MOCK LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR MOCK 904 LTDA",
    ciclo: {
      situacao: "autorizada", ehSubstituta: true,
      substitui: { notaId: "mock-nfse-substituida", numero: "13993", chaveAcesso: chave(903), naBase: true },
      motivoSubstituicao: "valor da nota esta incorreto",
      substituidaPor: null, evento: null, eventoRegistrado: false, avisos: [],
    },
    __descricao: "CONSULTORIA COM VALOR CORRIGIDO DEPOIS", __codigoServico: "140201",
  }));

  // FEIO 4 — chegou em competência já FECHADA.
  out.push(mockNota({
    id: "mock-nfse-pos-fechamento",
    numero: "13992", chaveAcesso: chave(902),
    issueDate: `${MOCK_NOTAS_COMPETENCIA}-28T00:00:00.000Z`,
    total: "3400.00", competenciaPosFechamento: true,
    emitenteNome: "EMPRESA EXEMPLO MOCK LTDA", emitenteDoc: "00000000000191",
    tomadorNome: "TOMADOR MOCK 903 LTDA",
    __descricao: "SERVICO LANCADO APOS O FECHAMENTO", __codigoServico: "010701",
  }));

  // FEIO 5 — NFS-e RECEBIDA (papel DEST): a empresa é a tomadora, não a emitente.
  for (let i = 0; i < 12; i++) {
    out.push(mockNota({
      id: `mock-nfse-dest-${i + 1}`,
      papel: "DEST", numero: String(4400 + i), chaveAcesso: chave(700 + i),
      issueDate: `${MOCK_NOTAS_COMPETENCIA}-${dia(i + 3)}T00:00:00.000Z`,
      total: (310.5 + i * 44).toFixed(2),
      emitenteNome: `PRESTADOR MOCK ${i + 1} LTDA`, emitenteDoc: `4455566600${String(i).padStart(2, "0")}31`,
      tomadorNome: "EMPRESA EXEMPLO MOCK LTDA", tomadorDoc: "00000000000191",
      __descricao: "SERVICOS DE APOIO ADMINISTRATIVO", __codigoServico: "170101",
    }));
  }

  // FEIO 6 — NF-e: 29 na base real, TODAS `papel: DEST`, TODAS sem XML, sem tomador e SEM ITEM.
  // É o caso em que a íntegra tem de dizer "não temos" três vezes seguidas sem parecer defeito.
  for (let i = 0; i < 9; i++) {
    out.push(mockNota({
      id: `mock-nfe-${i + 1}`,
      type: "NFE", papel: "DEST",
      numero: String(14520 + i).padStart(9, "0"), serie: "001",
      chaveAcesso: `332608058760120026565500100001452${String(i).padStart(2, "0")}1580128212`,
      issueDate: `${MOCK_NOTAS_COMPETENCIA}-${dia(i + 2)}T00:00:00.000Z`,
      total: (5890.66 + i * 120).toFixed(2),
      emitenteNome: `FORNECEDOR MOCK ${i + 1} LTDA`, emitenteDoc: `7788899900${String(i).padStart(2, "0")}12`,
      tomadorNome: null, tomadorDoc: null,
      __temXml: false, __descricao: null, __codigoServico: null,
    }));
  }

  return out;
})();

// Aplica os MESMOS filtros da rota real — sem isso o mock "pagina" sobre um universo diferente do
// que o resumo conta, e as duas caixas discordariam offline como já discordaram em produção.
function mockFiltrarNotas(filters = {}) {
  const { papel, type, search, incluirCanceladas, competencia } = filters;
  const s = String(search || "").trim().toLowerCase();
  return mockNotas.filter((n) => {
    // ⚠ A competência FILTRA de verdade. Ignorá-la faria a mesma lista aparecer em todo mês, e o
    // seletor do header pareceria funcionar sem funcionar — o mock tem de errar onde o real erra.
    if (competencia && /^\d{4}-\d{2}$/.test(competencia) && !String(n.competencia).startsWith(competencia)) return false;
    if (papel && n.papel !== String(papel).toUpperCase()) return false;
    if (type && n.type !== String(type).toUpperCase()) return false;
    if (String(incluirCanceladas || "") !== "1" && n.statusEfetivo === "cancelada") return false;
    if (s) {
      const alvo = [n.chaveAcesso, n.numero, n.emitenteNome, n.emitenteDoc, n.tomadorNome]
        .filter(Boolean).join(" ").toLowerCase();
      if (!alvo.includes(s)) return false;
    }
    return true;
  });
}

// A listagem devolve só as colunas da rota real — os campos `__*` e os da íntegra ficam de fora.
function mockNotaDeLista(n) {
  return {
    id: n.id, type: n.type, papel: n.papel, statusEfetivo: n.statusEfetivo, status: n.status,
    chaveAcesso: n.chaveAcesso, numero: n.numero, serie: n.serie,
    competencia: n.competencia, issueDate: n.issueDate, total: n.total,
    emitenteNome: n.emitenteNome, emitenteDoc: n.emitenteDoc,
    tomadorNome: n.tomadorNome, tomadorDoc: n.tomadorDoc,
    competenciaPosFechamento: n.competenciaPosFechamento,
    // A rota real devolve os três na LISTA (não só na íntegra): sem eles a tabela não consegue
    // distinguir cancelada de substituída, e voltaria a pintar tudo com a mesma palavra.
    chaveSubstituida: n.chaveSubstituida, motivoSubstituicao: n.motivoSubstituicao, ciclo: n.ciclo,
  };
}

// ── Onboarding (funil pré-cadastro) ───────────────────────────────────────────
// `Map` no topo do módulo, com a chave espelhando a PK do Prisma — assim o rascunho sobrevive à
// navegação e ao F5 dentro da mesma sessão do app.
const mockOnboardings = new Map();
const mockOnboardingEtapas = new Map(); // onboardingId -> etapa[]
let mockOnboardingSeq = 0;

// ⚠ STAND-IN do catálogo do servidor (`application/onboarding/etapasTemplate.js`), que é a
// AUTORIDADE — a trilha real mora só lá, para que quem preenche o formulário não escolha o que o
// escritório tem de conferir. O que precisa ser fiel aqui é o COMPORTAMENTO (materializar no
// finalizar, sem duplicar ao repetir), não o texto: sem isso, o único caminho que exercita essa
// regra ficaria offline.
const MOCK_ETAPAS_POR_ORIGEM = {
  ABERTURA: [
    { chave: "contato_inicial", titulo: "Contato inicial registrado", acao: null },
    { chave: "definicao_societaria", titulo: "Definição societária e de atividade", acao: null },
    { chave: "viabilidade_registro", titulo: "Viabilidade e registro na Junta", acao: null },
    { chave: "cnpj_definitivo", titulo: "CNPJ definitivo em mãos", acao: null },
    { chave: "conversao", titulo: "Empresa criada no portal", acao: "CONVERSAO" },
    { chave: "certificado_a1", titulo: "Certificado A1 da empresa instalado", acao: "CERTIFICADO_A1" },
    { chave: "documentos", titulo: "Documentos societários arquivados", acao: "DOCUMENTOS" },
  ],
  TRANSFERENCIA: [
    { chave: "contato_inicial", titulo: "Contato inicial registrado", acao: null },
    { chave: "procuracao_ecac", titulo: "Procuração eletrônica no e-CAC", acao: null },
    { chave: "certificado_a1", titulo: "Certificado A1 da empresa instalado", acao: "CERTIFICADO_A1" },
    { chave: "documentos", titulo: "Documentos recebidos do contador anterior", acao: "DOCUMENTOS" },
    { chave: "sitfis", titulo: "Situação fiscal consultada (SITFIS)", acao: "SITFIS" },
    { chave: "conferencia_debitos", titulo: "Débitos declarados conferidos contra o SITFIS", acao: null },
    { chave: "conversao", titulo: "Empresa criada no portal", acao: "CONVERSAO" },
  ],
  INATIVA: [
    { chave: "contato_inicial", titulo: "Contato inicial registrado", acao: null },
    { chave: "procuracao_ecac", titulo: "Procuração eletrônica no e-CAC", acao: null },
    { chave: "sitfis", titulo: "Situação fiscal consultada (SITFIS)", acao: "SITFIS" },
    { chave: "levantamento_obrigacoes", titulo: "Obrigações em atraso levantadas", acao: null },
    { chave: "decisao_reativar_ou_baixar", titulo: "Decisão: reativar ou dar baixa", acao: null },
    { chave: "conversao", titulo: "Empresa criada no portal", acao: "CONVERSAO" },
    { chave: "certificado_a1", titulo: "Certificado A1 da empresa instalado", acao: "CERTIFICADO_A1" },
  ],
};

// As mesmas cinco colunas de `extrairColunas` no servidor. Aqui a razão é a mesma: a busca da lista
// e o card leem a coluna, não o JSON.
function mockColunasDoOnboarding(dados) {
  const d = dados || {};
  const texto = (v) => (String(v ?? "").trim() || null);
  const digitos = String(d.cnpj ?? "").replace(/\D+/g, "");
  return {
    cnpj: digitos.length === 14 ? digitos : null,
    razaoSocial: texto(d.razaoSocial),
    responsavelNome: texto(d.responsavelNome),
    responsavelEmail: texto(d.responsavelEmail)?.toLowerCase() || null,
    responsavelTelefone: texto(d.responsavelTelefone),
  };
}

function mockEtapasDe(id) {
  return (mockOnboardingEtapas.get(id) || []).slice().sort((a, b) => a.ordem - b.ordem);
}

function mockOnboardingComEtapas(id) {
  const registro = mockOnboardings.get(id);
  if (!registro) return null;
  return { ...registro, etapas: mockEtapasDe(id) };
}

function mockMaterializarEtapas(id, origem) {
  const atuais = mockOnboardingEtapas.get(id) || [];
  const jaTem = new Set(atuais.map((e) => e.chave));
  const template = MOCK_ETAPAS_POR_ORIGEM[origem] || [];
  // ⚠ `skipDuplicates` do servidor, implementado: repetir o "finalizar" NÃO pode duplicar a
  // checklist — a segunda cópia viria com tudo desmarcado, desfazendo visualmente o trabalho feito.
  template.forEach((etapa, indice) => {
    if (jaTem.has(etapa.chave)) return;
    atuais.push({
      id: `mock-et-${++mockOnboardingSeq}`,
      onboardingId: id,
      chave: etapa.chave,
      titulo: etapa.titulo,
      descricao: null,
      ordem: indice + 1,
      acao: etapa.acao,
      obrigatoria: true,
      concluidaEm: null,
      concluidaPorId: null,
      observacao: null,
    });
  });
  mockOnboardingEtapas.set(id, atuais);
}
// Entregas por arquivo (EFD-Contribuições, ECD, ECF) por `empresa|tipo|competência`.
const mockEntregasObrigacao = new Map();
// A declaração do PGDAS-D entregue FORA do portal (gov.br), por `empresa|competência`. É a
// AFIRMAÇÃO do contador — no backend mora no mesmo `EntregaObrigacaoArquivo`, tipo `PGDAS_D`.
// ⚠ Separada da prova (`pgdasNumeroDeclaracao`, que vem do extrato da RFB) aqui também: um mock
// que colapsasse as duas esconderia exatamente a distinção que a tela existe para mostrar.
const mockEntregaPgdasExterna = new Map();
const mockEntriesByCompany = new Map();
const mockMonthlyCirculars = new Map();

// Históricos mockados globais (não atrelados a empresa específica)
const mockHistoricos = [
  { id: "h1", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO AIRBNB", contaDebito: "426", contaCredito: "5", usageCount: 8, scope: "GLOBAL" },
  { id: "h2", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO ALUGUEL", contaDebito: "426", contaCredito: "1", usageCount: 5, scope: "GLOBAL" },
  { id: "h3", createdByUserId: "mock-user", companyPortalClientId: null, text: "RECEBIMENTO DE CLIENTES", contaDebito: "1", contaCredito: "3", usageCount: 12, scope: "GLOBAL" },
  { id: "h4", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO CONTA DE ENERGIA", contaDebito: "464", contaCredito: "5", usageCount: 3, scope: "GLOBAL" },
  { id: "h5", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO INTERNET", contaDebito: "465", contaCredito: "5", usageCount: 4, scope: "GLOBAL" },
];
// Históricos específicos por empresa são adicionados dinamicamente em mockHistoricosByCompany
const mockHistoricosByCompany = new Map();

/**
 * Casamento de descrição × histórico do import de Excel — a MESMA leitura de
 * `findHistoricoMatches` (`apps/api/src/application/accounting/excelImport.js`): normaliza,
 * tenta o EXATO e só então o substring, ficando com o de maior `usageCount`.
 *
 * ⚠ Duas leituras diferentes fariam o mock casar descrição que o servidor não casa (e vice-versa),
 * e a revisão do modal chegaria à produção preenchendo outras contas — que é o defeito mais caro
 * possível numa tela cujo produto é justamente qual conta vai em cada linha.
 */
function normalizarTextoMatch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\-_\/.,;:!?()[\]{}]+/g, " ")
    .trim();
}

function acharMatchDeHistorico(companyId, descricao) {
  const alvo = normalizarTextoMatch(descricao);
  if (!alvo) return null;
  // `orderBy: usageCount desc` do backend — é ele que decide entre dois históricos que casam.
  const disponiveis = [...mockHistoricos, ...(mockHistoricosByCompany.get(companyId) || [])]
    .map((h) => ({ ...h, _norm: normalizarTextoMatch(h.text) }))
    .filter((h) => h._norm)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

  const montar = (h, matchType) => ({
    historicoId: h.id,
    text: h.text,
    historicoSugerido: h.historicoSugerido || null,
    contaDebito: h.contaDebito,
    contaCredito: h.contaCredito,
    usageCount: h.usageCount,
    scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL",
    matchType,
  });

  const exato = disponiveis.find((h) => h._norm === alvo);
  if (exato) return montar(exato, "exact");
  let melhor = null;
  for (const h of disponiveis) {
    if (alvo.includes(h._norm) || h._norm.includes(alvo)) {
      if (!melhor || (h.usageCount || 0) > (melhor.usageCount || 0)) melhor = h;
    }
  }
  return melhor ? montar(melhor, "substring") : null;
}

// Histórico de execuções fiscais por empresa
const mockFiscalExecutions = new Map();

// Seed de plano de contas para a primeira empresa mock
const _seedAccounts = [
  { codigo: "1", nome: "Ativo", tipo: "ATIVO", natureza: "DEVEDORA", status: "CONFIRMADA" },
  // ⚠ `codigoCompleto` é a CONTA MÃE (o código completo do ERP) e `analitica` é DERIVADO dele:
  // sintética = existe outro código completo, mais longo, começando com o dela.
  // Aqui `400` (completo `41102`) é SINTÉTICA de propósito — ela tem `401`, `402` e `464` abaixo.
  // Um mock só com folhas nunca exerceria o que esta fase existe para mostrar: a conta de agregação
  // sumindo da sugestão do dropdown e o aviso aparecendo quando alguém a digita mesmo assim.
  // E `464` fica SEM conta mãe, de propósito também: é o terceiro estado (`analitica: null`) —
  // conta que ainda não foi reimportada, que não é sintética nem analítica.
  { codigo: "5", nome: "Caixa", tipo: "ATIVO", natureza: "DEVEDORA", status: "CONFIRMADA", codigoCompleto: "111010001" },
  { codigo: "6", nome: "Banco Conta Corrente", tipo: "ATIVO", natureza: "DEVEDORA", status: "CONFIRMADA", codigoCompleto: "111020001" },
  { codigo: "266", nome: "Impostos a Recolher", tipo: "PASSIVO", natureza: "CREDORA", status: "CONFIRMADA", codigoCompleto: "211030001" },
  { codigo: "400", nome: "Despesas Gerais", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA", codigoCompleto: "41102" },
  { codigo: "401", nome: "Aluguel", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA", codigoCompleto: "411020001" },
  { codigo: "402", nome: "Energia Elétrica", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA", codigoCompleto: "411020002" },
  { codigo: "464", nome: "Serviços Prestados Pessoa Jurídica", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA", codigoCompleto: null },
  { codigo: "700", nome: "Receitas de Serviços", tipo: "RECEITA", natureza: "CREDORA", status: "CONFIRMADA", codigoCompleto: "311020001" },
];

/**
 * ⚠ CÓPIA DECLARADA da regra de `apps/api/src/application/accounting/lib/derivacaoAnalitica.js`.
 *
 * Ela não é importável daqui: o `Dockerfile` não copia `packages/` e cruzar apps quebra o boot — o
 * mesmo motivo pelo qual `apps/web/src/lib/vocabulario.js` já é uma cópia declarada de
 * `parcelamento/contracts.js`. A fonte da verdade continua sendo o backend; isto existe só para o
 * mock responder como ele responde. Quem mudar a regra muda nos dois.
 *
 * ⚠ Ausência nunca é resposta: sem `codigoCompleto`, `analitica` é `null`, nunca `false`.
 */
function _derivarAnaliticaMock(lista) {
  const completos = lista.map((a) => (a.codigoCompleto ? String(a.codigoCompleto) : null)).filter(Boolean);
  return lista.map((a) => {
    const meu = a.codigoCompleto ? String(a.codigoCompleto) : null;
    if (!meu) return { ...a, codigoCompleto: null, analitica: null };
    const temFilha = completos.some((o) => o.length > meu.length && o.startsWith(meu));
    return { ...a, codigoCompleto: meu, analitica: !temFilha };
  });
}
/**
 * ⚠ CÓPIA DECLARADA da trava de `api/src/application/accounting/lib/gateContaSintetica.js` — mesmo
 * motivo de `_derivarAnaliticaMock` (o backend não é importável daqui).
 *
 * Existe porque **mock que não conhece a recusa é como um 400 chega à produção sem ninguém ver**: a
 * rota real responde `CONTA_SINTETICA` e o mock salvaria feliz.
 *
 * ⚠ Recusa a ENTRADA, nunca a permanência: `codigosAtuais` são os códigos já gravados no
 * lançamento, e a sintética que já estava lá não bloqueia a edição (é o que mantém possível a
 * correção dos lançamentos que já existem em conta de agregação).
 */
function _recusaContaSinteticaMock(companyId, lines, codigosAtuais = []) {
  const plano = mockChartOfAccounts.get(companyId) || [];
  if (!plano.length) return null;
  const porCodigo = new Map(plano.map((c) => [String(c.codigo), c]));
  const jaEstavam = new Set(codigosAtuais.map((c) => String(c ?? "").trim()).filter(Boolean));
  const achadas = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const codigo = String(l?.conta || "").trim();
    if (!codigo || jaEstavam.has(codigo) || achadas.some((a) => a.codigo === codigo)) continue;
    // ⚠ `=== false`, nunca `!analitica`: `null` é "não se sabe" e nunca recusa.
    if (porCodigo.get(codigo)?.analitica === false) achadas.push({ codigo, nome: porCodigo.get(codigo).nome || "" });
  }
  if (!achadas.length) return null;
  const err = new Error("CONTA_SINTETICA");
  err.code = "CONTA_SINTETICA";
  err.contas = achadas.map((a) => a.codigo);
  return err;
}

/**
 * ⚠ CÓPIA DECLARADA de `apps/api/src/application/accounting/payrollTemplate.js` — templates, dicas
 * de conta, as TRÊS passadas de match e a resolução do histórico. Mesmo motivo de
 * `_derivarAnaliticaMock`: o backend não é importável daqui.
 *
 * Existe porque `getPayrollTemplate` tinha implementação **só no `realApi`**: em "Funções →
 * + Folha / Pró-labore" o modo mock mostrava `api.getPayrollTemplate is not a function` no lugar da
 * tabela, e a folha — primeiro item do check-list de fechamento — era o único fluxo grande da aba
 * impossível de conferir offline. É o mesmo defeito que `getBaixaTemplate` teve, e o
 * `apps/web/CLAUDE.md` já dizia: *"toda feature nova deve ter implementação em AMBOS"*.
 *
 * ⚠ Nada aqui é invenção: os `accountHints`, os `role`, os `historicoTemplate` e a forma da
 * resposta foram copiados da rota. Mock que responde diferente do real esconde defeito.
 */
const PAYROLL_TEMPLATES_MOCK = Object.freeze({
  PROLABORE: {
    label: "Pró-labore",
    historicoTemplate: "PRÓ-LABORE - {{competencia}}",
    lines: [
      { side: "D", role: "salary", label: "Despesa de Pró-labore",
        accountHints: ["pro labore", "prolabore", "pro-labore", "pró labore", "despesa pro labore", "despesa prolabore", "remuneracao socios", "remuneração sócios", "honorarios diretoria"],
        historicoTemplate: "VR REF PRO LAB FP {{competencia}}" },
      { side: "C", role: "inss", label: "INSS a Recolher",
        accountHints: ["inss a recolher", "inss a pagar", "inss obrigacoes", "obrigacoes inss", "obrigações inss", "inss"],
        historicoTemplate: "VR REF INSS S/PRO LAB FP {{competencia}}" },
      { side: "C", role: "irrf", label: "IRRF a Recolher",
        accountHints: ["irrf a recolher", "irrf a pagar", "irrf obrigacoes", "obrigacoes irrf", "irf retido", "irrf"],
        historicoTemplate: "VR REF IRRF S/PRO LAB FP {{competencia}}" },
      { side: "C", role: "liquid", label: "Pró-labore a Pagar",
        accountHints: ["pro labore a pagar", "prolabore a pagar", "pro-labore a pagar", "pró labore a pagar", "honorarios a pagar"],
        historicoTemplate: "VR PRO LAB LIQ FP {{competencia}}" },
    ],
    baixa: {
      debitFromRole: "liquid",
      creditAccountHints: ["caixa matriz", "caixa geral", "caixa", "banco conta movimento", "banco conta corrente", "banco itau", "banco bradesco", "banco do brasil", "banco santander", "banco caixa", "bancos contas com movimentos", "banco"],
      historicoTemplate: "PAGO PRO-LAB {{competencia}}",
    },
  },
  FOLHA: {
    label: "Folha de Pagamento",
    historicoTemplate: "FOLHA DE PAGAMENTO - {{competencia}}",
    lines: [
      { side: "D", role: "salary", label: "Despesa de Salários",
        accountHints: ["salarios", "salários", "despesa salarios", "despesa de salarios", "salarios e ordenados", "remuneracao funcionarios", "ordenados"],
        historicoTemplate: "VR REF SALARIO FP {{competencia}}" },
      { side: "C", role: "inss", label: "INSS a Recolher",
        accountHints: ["inss a recolher", "inss a pagar", "obrigacoes inss", "obrigações inss", "inss"],
        historicoTemplate: "VR REF INSS S/SALARIO FP {{competencia}}" },
      { side: "C", role: "fgts", label: "FGTS a Recolher",
        accountHints: ["fgts a recolher", "fgts a pagar", "obrigacoes fgts", "obrigações fgts", "fgts"],
        historicoTemplate: "VR REF FGTS S/SALARIO FP {{competencia}}" },
      { side: "C", role: "irrf", label: "IRRF a Recolher",
        accountHints: ["irrf a recolher", "irrf a pagar", "obrigacoes irrf", "obrigações irrf", "irf retido", "irrf"],
        historicoTemplate: "VR REF IRRF S/SALARIO FP {{competencia}}" },
      { side: "C", role: "liquid", label: "Salários a Pagar",
        accountHints: ["salarios a pagar", "salários a pagar", "ordenados a pagar", "salario a pagar"],
        historicoTemplate: "VR SALARIO LIQ FP {{competencia}}" },
    ],
    baixa: {
      debitFromRole: "liquid",
      creditAccountHints: ["caixa matriz", "caixa geral", "caixa", "banco conta movimento", "banco conta corrente", "banco itau", "banco bradesco", "banco do brasil", "banco santander", "banco caixa", "bancos contas com movimentos", "banco"],
      historicoTemplate: "PAGO SALARIOS FP {{competencia}}",
    },
  },
});

// "2026-07" → "07/2026" (o histórico pede MM/AAAA).
function _payrollHistoricoMock(template, competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  const label = m ? `${m[2]}/${m[1]}` : String(competencia || "");
  return String(template || "").replace(/\{\{\s*competencia\s*\}\}/gi, label);
}

function _normalizarNomeContaMock(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s\-_/]+/g, " ")
    .trim();
}

// As TRÊS passadas do backend, nesta ordem: exato → começa com → contém. A ordem é o que faz
// "inss a recolher" vencer o genérico "inss"; invertê-la muda a conta sugerida.
function _acharContaPorDicasMock(accounts, hints) {
  const normalizadas = accounts.map((a) => ({ ...a, _norm: _normalizarNomeContaMock(a.nome) }));
  const dicas = (hints || []).map((h) => _normalizarNomeContaMock(h)).filter(Boolean);
  if (!dicas.length) return null;
  for (const dica of dicas) {
    const achada = normalizadas.find((a) => a._norm === dica);
    if (achada) return achada;
  }
  for (const dica of dicas) {
    const achada = normalizadas.find((a) => a._norm.startsWith(dica));
    if (achada) return achada;
  }
  for (const dica of dicas) {
    const achada = normalizadas.find((a) => a._norm.includes(dica));
    if (achada) return achada;
  }
  return null;
}

for (const company of mockCompanies) {
  mockChartOfAccounts.set(
    company.companyId,
    _derivarAnaliticaMock(_seedAccounts).map((a) => ({
      id: faker.string.uuid(),
      portalClientId: company.companyId,
      ...a,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  );
  mockEntriesByCompany.set(company.companyId, []);
}

// ── Plano de Contas GLOBAL (mock) ────────────────────────────────────────────
//
// ⚠ CÓPIA DECLARADA de `REQUIRED_GLOBAL_TIPOS` (`apps/api/src/application/accounting/
// globalChartStatus.js`) — mesmo motivo de `_derivarAnaliticaMock`: o backend não é importável
// daqui. Lançamento automático (DAS, faturamento) depende dos 5 tipos, e é por isso que o plano
// global é PRÉ-REQUISITO para criar empresa: com um tipo faltando, `isConfigured` é falso e a home
// bloqueia o botão "Nova empresa" com o aviso.
const REQUIRED_GLOBAL_TIPOS_MOCK = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];

// O escopo global é UMA lista, não um Map: no banco ele é `portalClientId: null` — não há chave.
// Seed = o mesmo plano das empresas MAIS uma conta de PATRIMÔNIO. Sem ela o mock nasceria com
// `isConfigured: false` e o botão "Nova empresa" abriria bloqueado, que é o oposto do estado que
// o mock existe para representar (escritório configurado).
const _seedGlobalAccounts = [
  ..._seedAccounts,
  { codigo: "800", nome: "Capital Social", tipo: "PATRIMONIO", natureza: "CREDORA", status: "CONFIRMADA", codigoCompleto: "241010001" },
];
// ⚠ A derivação é do ESCOPO — global com global, nunca cruzando com o plano de uma empresa.
let mockGlobalChartOfAccounts = _derivarAnaliticaMock(_seedGlobalAccounts).map((a) => ({
  id: faker.string.uuid(),
  // A conta global É a que não tem dono: é este `null` que a rota real traduz em `scope: "GLOBAL"`.
  portalClientId: null,
  ...a,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));

// Seed provisões para a primeira empresa
const _firstCompanyId = mockCompanies[0]?.companyId;
if (_firstCompanyId) {
  mockEntriesByCompany.set(_firstCompanyId, [
    {
      id: faker.string.uuid(), portalClientId: _firstCompanyId,
      data: new Date("2026-04-05").toISOString(), competencia: "2026-04",
      historico: "Provisão DAS Simples Nacional Abril/2026",
      tipo: "PROVISAO", subtipo: "SIMPLES", origem: "MANUAL",
      loteImportacao: null,
      status: "CONFIRMADO", statusPagamento: "ABERTO", openEntryId: null,
      lines: [
        { id: faker.string.uuid(), conta: "266", tipo: "D", valor: 1200, ordem: 0 },
        { id: faker.string.uuid(), conta: "266", tipo: "C", valor: 1200, ordem: 1 },
      ],
      totalD: 1200, totalC: 1200, valor: 1200,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: faker.string.uuid(), portalClientId: _firstCompanyId,
      data: new Date("2026-03-05").toISOString(), competencia: "2026-03",
      historico: "Provisão DAS Simples Nacional Março/2026",
      tipo: "PROVISAO", subtipo: "SIMPLES", origem: "MANUAL",
      loteImportacao: null,
      status: "CONFIRMADO", statusPagamento: "PAGO", openEntryId: null,
      lines: [
        { id: faker.string.uuid(), conta: "266", tipo: "D", valor: 980, ordem: 0 },
        { id: faker.string.uuid(), conta: "266", tipo: "C", valor: 980, ordem: 1 },
      ],
      totalD: 980, totalC: 980, valor: 980,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ]);
}

/**
 * O código IBGE do município emissor, com a MESMA regra do backend
 * (`validateAndNormalizeCompanyProfile` → `company_codigo_municipio_ibge_invalid`) e do CHECK do
 * banco (`^[0-9]{7}$`).
 *
 * Três respostas, e as três importam: ausente = não mexer · vazio = limpar a escolha · 7 dígitos =
 * gravar. Qualquer outra coisa é RECUSA — um mock que aceitasse "3304" faria a tela passar offline
 * e estourar no banco em produção.
 */
function normalizarCodigoMunicipioIbgeMock(valor, atual) {
  if (valor === undefined) return atual ?? null;
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  const digitos = texto.replace(/\D+/g, "");
  if (digitos.length !== 7) throw new Error("company_codigo_municipio_ibge_invalid");
  return digitos;
}

/**
 * Os TRÊS campos da emissão de NFS-e, com a MESMA regra do backend
 * (`validateAndNormalizeCompanyProfile`) e os MESMOS códigos de erro. Um mock permissivo aqui
 * deixaria passar offline exatamente o valor que o servidor recusa.
 *
 * Três respostas em cada um, como no município: ausente = não mexer · vazio = limpar · válido =
 * gravar (já normalizado, para que a recarga mostre o que ficou gravado de verdade).
 *
 * ⚠ Nada é inventado nem sugerido: a forma de cada campo sai de fonte já versionada no repositório
 * (`docs/nfse-preenchimento.md` §5 para os dois códigos; RN E0010 / `nfseNumeracao.js` para a
 * série). O CONTEÚDO — qual serviço é qual código — não é conferido em lugar nenhum, porque as
 * listas não estão no projeto.
 */
function normalizarCamposEmissaoNfseMock(entrada, atuais) {
  const so = (v) => String(v ?? "").trim().replace(/\D+/g, "");
  const resultado = {};

  if (entrada.codigoServicoNacional === undefined) {
    resultado.codigoServicoNacional = atuais.codigoServicoNacional ?? null;
  } else if (!String(entrada.codigoServicoNacional ?? "").trim()) {
    resultado.codigoServicoNacional = null;
  } else {
    const d = so(entrada.codigoServicoNacional);
    if (d.length !== 6) throw new Error("company_codigo_servico_nacional_invalid");
    resultado.codigoServicoNacional = d;
  }

  // ── A LISTA de códigos de serviço (decisão do dono, 16/08/2026) ────────────────────────────
  // Mesmas três respostas: ausente = não mexer · `[]` = apagar · itens = gravar normalizados.
  if (entrada.codigosServicoNacional !== undefined) {
    const lista = [];
    for (const item of Array.isArray(entrada.codigosServicoNacional) ? entrada.codigosServicoNacional : []) {
      const d = so(item);
      if (!d) continue;
      if (d.length !== 6) throw new Error("company_codigo_servico_nacional_invalid");
      if (!lista.includes(d)) lista.push(d);
    }
    resultado.codigosServicoNacional = lista;
  } else {
    resultado.codigosServicoNacional = Array.isArray(atuais.codigosServicoNacional)
      ? atuais.codigosServicoNacional
      : [];
  }

  // ⚠ A MESMA COERÊNCIA DO BACKEND (`validateAndNormalizeCompanyProfile`), com o MESMO código de
  // erro. Com um código só, ele é o que a nota leva; com vários, o marcado tem de estar na lista —
  // eleger "o primeiro" seria o sistema decidindo qual serviço a empresa declara ao fisco.
  if (resultado.codigosServicoNacional.length === 1) {
    resultado.codigoServicoNacional = resultado.codigosServicoNacional[0];
  } else if (
    resultado.codigosServicoNacional.length > 1
    && !resultado.codigosServicoNacional.includes(resultado.codigoServicoNacional)
  ) {
    throw new Error("company_codigo_servico_nacional_fora_da_lista");
  }

  if (entrada.codigoServicoMunicipal === undefined) {
    resultado.codigoServicoMunicipal = atuais.codigoServicoMunicipal ?? null;
  } else if (!String(entrada.codigoServicoMunicipal ?? "").trim()) {
    resultado.codigoServicoMunicipal = null;
  } else {
    const d = so(entrada.codigoServicoMunicipal);
    // Sem comprimento fixo: a fonte prova que o XML leva os ÚLTIMOS 3 dígitos, não que o código
    // publicado pelo município tenha 3.
    if (!d) throw new Error("company_codigo_servico_municipal_invalid");
    resultado.codigoServicoMunicipal = d;
  }

  if (entrada.rpsSerie === undefined) {
    resultado.rpsSerie = atuais.rpsSerie ?? null;
  } else if (!String(entrada.rpsSerie ?? "").trim()) {
    resultado.rpsSerie = null;
  } else {
    const bruta = String(entrada.rpsSerie).trim();
    const n = Number(bruta);
    // ⚠ "UNICA" é RECUSA, nunca conversão — a tradução "letra vira número" foi abandonada no
    // backend de propósito (série é identificação fiscal).
    if (!/^\d+$/.test(bruta) || !Number.isInteger(n) || n < 1 || n > 49999) {
      throw new Error("company_rps_serie_invalid");
    }
    resultado.rpsSerie = String(n).padStart(5, "0");
  }

  return resultado;
}

function buildCompanyPayload(input) {
  const ownerEmail = String(input.ownerEmail || "").trim().toLowerCase();
  const guideEmail =
    String(input.guideNotificationEmail || "").trim().toLowerCase() || ownerEmail || null;
  const hasProlabore = Boolean(input.hasProlabore);
  const temFolha = Boolean(input.temFolha);
  const regimeTributario = String(input.regimeTributario || "SIMPLES");
  return {
    companyId: faker.string.uuid(),
    portalId: faker.string.uuid(),
    myRole: "FIRM_ADMIN",
    scopes: ["*"],
    razao: String(input.razaoSocial || "").trim(),
    cnpj: String(input.cnpj || "").replace(/\D+/g, ""),
    inscricaoMunicipal: null,
    uf: String(input.enderecoUf || "").trim().toUpperCase() || null,
    municipio: String(input.enderecoCidade || "").trim() || null,
    ownerEmail: ownerEmail || null,
    guideNotificationEmail: guideEmail,
    hasProlabore,
    temFolha,
    email: null,
    telefone: String(input.telefone || "").trim() || null,
    portalCreatedAt: new Date().toISOString(),
    portalUpdatedAt: new Date().toISOString(),
    // ⚠ `codigoMunicipioIbge` nasce do que foi ESCOLHIDO no formulário, e nada mais. Derivá-lo de
    // `enderecoCidade` aqui faria o mock aceitar o que o real recusa — e ensinaria o de-para por
    // nome, que é justamente o erro (homônimo) que o seletor existe para impedir.
    legacyCompany: {
      regimeTributario,
      tipoTributario: regimeTributario,
      codigoMunicipioIbge: normalizarCodigoMunicipioIbgeMock(input.codigoMunicipioIbge, null),
      // Mesma regra dos três campos de emissão: só o que foi DIGITADO no formulário. Empresa nova
      // nasce sem eles e não emite — que é a verdade sobre uma empresa que ninguém configurou.
      ...normalizarCamposEmissaoNfseMock(input, {}),
    },
    guideCompliance: mockGuideComplianceRow({ hasProlabore, regimeTributario, inssOk: true, dasOk: true }),
  };
}

function makeCircularKey(companyId, competencia) {
  return `${companyId}::${competencia}`;
}

function synthesizeCircularEntries(companyId, circular) {
  const list = mockEntriesByCompany.get(companyId) || [];
  const rules = [
    { eventType: "RECEITA_SIMPLES", amountSource: "receitaBruta", debit: "5", credit: "301", tipo: "RECEITA", subtipo: null, statusPagamento: "NA", label: "VR REF RECEITA BRUTA DO SIMPLES NACIONAL - " },
    { eventType: "DAS_SIMPLES", amountSource: "dasTotal", debit: "401", credit: "5", tipo: "PROVISAO", subtipo: "DAS", statusPagamento: "ABERTO", label: "VR REF DAS SIMPLES NACIONAL - " },
    // INSS_DCTFWEB removido: INSS é lançado via folha/pró-labore manualmente.
  ];

  for (const rule of rules) {
    const amount = Number(circular?.[rule.amountSource] || 0);
    const entryId = `mock-circular-${companyId}-${circular.competencia}-${rule.eventType}`;
    const idx = list.findIndex((item) => item.id === entryId);
    if (!(amount > 0)) {
      if (idx >= 0) list.splice(idx, 1);
      continue;
    }
    const entry = {
      id: entryId,
      portalClientId: companyId,
      circularId: circular.id,
      ruleId: `rule-${rule.eventType}`,
      eventType: rule.eventType,
      data: new Date(`${circular.competencia}-28T00:00:00.000Z`).toISOString(),
      competencia: circular.competencia,
      historico: `${rule.label}${circular.competencia.slice(5)}/${circular.competencia.slice(0, 4)}`,
      tipo: rule.tipo,
      subtipo: rule.subtipo,
      origem: "SERPRO",
      loteImportacao: `SERPRO-${circular.competencia}`,
      status: circular.status || "RASCUNHO",
      statusPagamento: rule.statusPagamento,
      openEntryId: null,
      lines: [
        { id: `${entryId}-d`, entryId, conta: rule.debit, tipo: "D", valor: amount, ordem: 0 },
        { id: `${entryId}-c`, entryId, conta: rule.credit, tipo: "C", valor: amount, ordem: 1 },
      ],
      totalD: amount,
      totalC: amount,
      valor: amount,
      createdAt: circular.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
  }
  mockEntriesByCompany.set(companyId, list);
}

function getCircularRecord(companyId, competencia) {
  return mockMonthlyCirculars.get(makeCircularKey(companyId, competencia)) || null;
}

/**
 * O DETECTOR no mock — cópia DECLARADA de `api: application/accounting/divergenciaDeFonte.js`.
 *
 * Mesma razão de `_derivarAnaliticaMock`: o `Dockerfile` não copia `packages/` e cruzar apps quebra
 * o boot, então a regra vive duas vezes. Quem mudar uma muda a outra.
 *
 * ⚠ E ELE PRECISA CONSEGUIR ACUSAR. `synthesizeCircularEntries` gera as linhas A PARTIR da própria
 * circular, então offline nada jamais divergiria e o aviso seria inalcançável — o caminho feliz
 * escondendo exatamente o que esta tela existe para mostrar. Por isso o detector compara contra o
 * lançamento REAL da lista: editar o valor do lançamento de DAS pela aba Lançamentos (sem tocar na
 * circular) é o que reproduz, offline, o congelamento medido em produção.
 */
const CAMPO_DA_CIRCULAR_POR_EVENTO = Object.freeze({
  DAS_SIMPLES: { campo: "dasTotal", rotulo: "DAS (Simples Nacional)" },
  RECEITA_SIMPLES: { campo: "receitaBruta", rotulo: "Receita bruta" },
});

function mockDivergenciasFonte(companyId, competencia) {
  const circular = getCircularRecord(companyId, competencia);
  if (!circular) return [];
  const list = mockEntriesByCompany.get(companyId) || [];
  const out = [];
  for (const [eventType, def] of Object.entries(CAMPO_DA_CIRCULAR_POR_EVENTO)) {
    const bruto = circular[def.campo];
    // Ausência nunca é resposta: circular sem o número não afirma nada sobre o lançamento.
    if (bruto == null || bruto === "") continue;
    const esperado = Math.round(Number(bruto) * 100) / 100;
    const entry = list.find((e) => e.competencia === competencia && e.eventType === eventType && e.origem === "SERPRO");
    if (!entry) continue;
    const lancado = Math.round((entry.lines || [])
      .filter((l) => String(l.tipo).toUpperCase() === "D")
      .reduce((s, l) => s + Number(l.valor || 0), 0) * 100) / 100;
    if (Math.abs(esperado - lancado) <= 0.01) continue;
    out.push({
      eventType,
      rotulo: def.rotulo,
      campo: def.campo,
      esperado,
      lancado,
      diferenca: Math.round((esperado - lancado) * 100) / 100,
      entryId: entry.id,
      historico: entry.historico || null,
    });
  }
  return out;
}

/**
 * Faturamento da competência no mock — a mesma pergunta que `faturamentoEmitDaCompetencia` faz
 * contra as notas EMIT autorizadas. Aqui sai da circular sincronizada, que é a única receita que
 * o mock conhece. Competência ímpar devolve 0 para haver mês marcável e mês recusável na tela.
 */
/**
 * Conferência do ADN no mock. Os TRÊS estados precisam existir na tela, porque cada um leva a um
 * comportamento diferente do "mês sem faturamento": `ok` marca limpo, `nao_conferivel` marca com
 * aviso, `divergente` não marca. Um mock com um estado só deixaria dois caminhos sem prova.
 * Distribuição por empresa (não por competência): a conferência é da empresa+mês, mas variar por
 * empresa dá os três estados visíveis no mesmo mês.
 */
function mockConferenciaAdn(companyId, competencia) {
  const idx = mockCompanies.findIndex((c) => c.companyId === companyId);
  const status = idx < 0 ? null : ["ok", "nao_conferivel", "divergente", null][idx % 4];
  return { status, em: status ? `${competencia}-28T10:00:00.000Z` : null };
}

function mockFaturamentoDaCompetencia(companyId, competencia) {
  const circular = getCircularRecord(companyId, competencia);
  if (circular?.receitaBruta != null) return Number(circular.receitaBruta);
  const mes = Number(String(competencia || "").slice(5, 7));
  return mes % 2 === 0 ? 18500.75 : 0;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// RELATÓRIO "Faturamento no Período — Consolidado"
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ O MOCK EXISTE PARA OS ESTADOS RUINS SEREM CAMINHÁVEIS OFFLINE. Um mock que só conhece o
// caminho feliz esconde exatamente o que esta tela existe para mostrar — foi o que aconteceu com a
// caixa "Declarar SEM MOVIMENTO", inalcançável no mock justamente na empresa em que ela importa.
// Por isso a variação é por ÍNDICE DE EMPRESA (mesmo padrão de `mockConferenciaAdn`): pedir "abra
// outro mês" esconderia um caminho atrás de uma navegação.
//
//   forma 0 → NADA classificado + motor bloqueado (é o estado de 100% das empresas em produção)
//   forma 1 → classificado + DAS TRANSMITIDO à Receita (nosso × oficial, com a diferença)
//   forma 2 → classificado + conferência que NÃO fecha, em duas metades:
//               · `idx % 6 === 2` → DAS SIMULADO pela Receita (nada transmitido) — o normal hoje
//               · `idx % 6 === 5` → só a coluna de PROCEDÊNCIA AMBÍGUA — o snapshot LEGADO,
//                 gravado antes de a simulação ganhar coluna própria. Continua existindo em
//                 produção, e por isso continua caminhável aqui.
//
// ⚠ Os `rotuloOficial` abaixo são transcrição do Manual do PGDAS-D e DEFIS (itens 6.5 e 6.6.1),
// copiados de `RelatorioFaturamentoService.js`. Não reescrever para caber na tela.
const mockRelatoriosFaturamento = new Map(); // "companyId|competencia" -> registro salvo

const MOCK_SEGREGACAO_INDETERMINADA = {
  codigo: "INDETERMINADA",
  rotuloOficial: null,
  rotuloCurto: "Segregação não apurada",
  motivo: "O portal não extrai ST nem tributação monofásica do XML (`flagST`/`flagMonofasico` não "
    + "têm escritor, e não há CST/CSOSN em `NotaItem`). Escolher \"Sem\" por ausência de dado seria "
    + "responder ao PGDAS-D por default, em nome do contribuinte.",
  fonte: "sem_dado",
};

const MOCK_QUALIFICACOES_NAO_APURADAS = {
  estado: "NAO_APURADO",
  codigos: [],
  rotulos: [],
  motivo: "O portal não extrai qualificação de receita do XML. Ausência aqui é falta de leitura, "
    + "não ausência de qualificação.",
};

const MOCK_VOCABULARIO = {
  fonte: "Manual do PGDAS-D e DEFIS (RFB) — item 6.5 (pp. 23-26) e item 6.6.1 (p. 27)",
  avisoCodigos: "Os campos `codigo` são identificadores NOSSOS. A numeração oficial destas opções "
    + "não foi conferida — só os `rotuloOficial` vêm do manual, transcritos.",
  segregacaoRevenda: [
    { codigo: "SEM", rotuloOficial: "Sem substituição tributária/tributação monofásica/antecipação com encerramento de tributação", rotuloCurto: "Sem ST/monofásica/antecipação" },
    { codigo: "COM", rotuloOficial: "Com substituição tributária/tributação monofásica/antecipação com encerramento de tributação", rotuloCurto: "Com ST/monofásica/antecipação" },
    MOCK_SEGREGACAO_INDETERMINADA,
  ],
  qualificacoes: [
    { codigo: "ANTECIPACAO_COM_ENCERRAMENTO", rotuloOficial: "antecipação com encerramento de tributação" },
    { codigo: "SUBSTITUICAO_TRIBUTARIA", rotuloOficial: "substituição tributária" },
    { codigo: "TRIBUTACAO_MONOFASICA", rotuloOficial: "tributação monofásica" },
    { codigo: "EXIGIBILIDADE_SUSPENSA", rotuloOficial: "exigibilidade suspensa" },
    { codigo: "IMUNIDADE", rotuloOficial: "imunidade" },
    { codigo: "ISENCAO_REDUCAO", rotuloOficial: "isenção/redução" },
    { codigo: "ISENCAO_REDUCAO_CESTA_BASICA", rotuloOficial: "isenção/redução cesta básica" },
    { codigo: "LANCAMENTO_DE_OFICIO", rotuloOficial: "lançamento de ofício" },
  ],
  linhasAtividadeRfb: {
    fonte: "docs/segregacao-receitas-simples.md, seção (A) — transcrito do Manual do PGDAS-D e "
      + "DEFIS (RFB, 17/06/2025), item 6.5, pp. 23-25",
    baseLegal: "Resolução CGSN 140/2018, art. 25, §1º, incisos I a IX (§3º para exportação)",
    quantidade: 14,
    dimensoesFaltantes: {
      mercado: "Interno × exterior. `NotaItem.flagExportacao` é `false` em 16.153/16.153 itens.",
      segregacao: "As opções Com/Sem do item 6.5 (linhas 1 e 3) — hoje `INDETERMINADA` para todo item.",
    },
  },
};

const MOCK_LIMITACOES = [
  {
    codigo: "VALOR_CONTABIL_SEM_DESCONTOS",
    titulo: "O valor contábil não tem os descontos de IPI, ST e ICMS-ST",
    efeito: "Não extraímos `vIPI`, `vST` nem `vICMSST` do XML hoje. O valor de cada linha é o valor "
      + "contábil do documento rateado pelos itens; imprimir 0,00 nessas parcelas seria afirmar uma "
      + "conferência que não houve.",
  },
  {
    codigo: "SEGREGACAO_65_NAO_APURADA",
    titulo: "A segregação do item 6.5 (com/sem ST, monofásica, antecipação) não é apurada",
    efeito: "As linhas de revenda saem como \"Segregação não apurada\" em vez de serem lançadas na "
      + "opção \"Sem substituição tributária/…\" por default.",
  },
  {
    codigo: "QUALIFICACOES_NAO_APURADAS",
    titulo: "As 8 qualificações do item 6.6.1 não são apuradas",
    efeito: "A dimensão aparece com `estado: \"NAO_APURADO\"` e o vocabulário completo, em vez de "
      + "ser omitida — omitir faria o relatório parecer completo.",
  },
];

const MOCK_MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function mockLinhaAtividade(tipoReceita, segregacaoIndeterminada = false) {
  if (!tipoReceita) return { origem: "TIPO_RECEITA_LOCAL", codigo: null, rotulo: null, rfb: null };
  const dp = {
    REVENDA_MERCADORIA: { linha: 1, descricao: "Revenda de mercadorias, exceto para o exterior", faltam: ["mercado"], linhasAlternativas: [2] },
    SERVICO_ANEXO_III: { linha: 7, descricao: "Prestação de serviços, exceto para o exterior", faltam: ["mercado", "estado_iss", "subitem_lc116"], linhasAlternativas: [8, 9, 10] },
  }[tipoReceita] || null;
  const rotulos = {
    REVENDA_MERCADORIA: "Revenda de mercadoria (Anexo I)",
    SERVICO_ANEXO_III: "Serviço — Anexo III",
  };
  const base = { origem: "TIPO_RECEITA_LOCAL", codigo: tipoReceita, rotulo: rotulos[tipoReceita] || tipoReceita };
  if (!dp) return { ...base, rfb: null };
  const faltam = [...dp.faltam];
  if (segregacaoIndeterminada) faltam.push("segregacao");
  return {
    ...base,
    rfb: {
      linha: dp.linha, descricao: dp.descricao,
      // ⚠ Nunca `true`: o de-para do nosso enum (7 valores, para decidir ANEXO) para as 14 linhas
      // da RFB é PARCIAL por construção, e é isso que impede ler "linha 7" como "é a 7".
      completo: false, faltam, linhasAlternativas: dp.linhasAlternativas,
      fonte: MOCK_VOCABULARIO.linhasAtividadeRfb.fonte,
    },
  };
}

function mockLinhaNota({ i, competencia, valor, tipo = "NFSE", ...over }) {
  const nfe = tipo === "NFE";
  return {
    notaId: `mock-nota-${i}`,
    tipoDocumento: tipo,
    numero: String(1000 + i),
    serie: nfe ? "1" : null,
    chaveAcesso: nfe ? `3526${String(i).padStart(40, "0")}` : null,
    data: `${competencia}-1${(i % 9)}T12:00:00.000Z`,
    modelo: nfe ? "55" : null,
    modeloRotulo: nfe ? "55" : "NFS-e",
    modeloFonte: nfe ? "chaveAcesso" : "tipo_documento",
    tomadorNome: `TOMADOR MOCK ${i}`,
    tomadorDoc: `1234567800019${i % 10}`,
    itemId: `mock-item-${i}`,
    descricao: nfe ? `Mercadoria mock ${i}` : `Serviço mock ${i}`,
    cfop: nfe ? "5102" : null,
    codigoServico: nfe ? null : "17.19",
    codigoOperacao: nfe ? "5102" : "17.19",
    codigoOperacaoFonte: nfe ? "cfop" : "codigoServico",
    valorContabil: Math.round(valor * 100) / 100,
    ...over,
  };
}

/**
 * ⚠ O RATEIO TEM DE FECHAR NO CENTAVO. O backend rateia o total da nota pelos itens justamente
 * para o rodapé do relatório não discordar do faturamento da competência — um mock que arredonda
 * cada parte por conta própria produz a divergência de 1 centavo que a conferência existe para
 * acusar, e ensinaria offline um defeito que produção não tem.
 */
function mockRatearPesos(total, pesos) {
  const soma = pesos.reduce((s, p) => s + p, 0) || 1;
  const partes = pesos.map((p) => Math.round((total * p / soma) * 100) / 100);
  const resto = Math.round((total - partes.reduce((s, v) => s + v, 0)) * 100) / 100;
  if (partes.length) partes[partes.length - 1] = Math.round((partes[partes.length - 1] + resto) * 100) / 100;
  return partes;
}

function mockTotal(linhas) {
  return {
    itens: linhas.length,
    valorContabil: Math.round(linhas.reduce((s, l) => s + Number(l.valorContabil || 0), 0) * 100) / 100,
  };
}

/**
 * A FOTO. Espelha a forma de `montarRelatorioFaturamento` — mesmo formato, mesmos nomes, mesmos
 * três estados que a tela precisa distinguir.
 */
function mockRelatorioFaturamentoDados(companyId, competencia) {
  const empresa = mockCompanies.find((c) => c.companyId === companyId) || null;
  const idx = mockCompanies.findIndex((c) => c.companyId === companyId);
  const forma = idx < 0 ? 0 : idx % 3;
  const fat = mockFaturamentoDaCompetencia(companyId, competencia);
  const [ano, mes] = String(competencia).split("-").map(Number);

  const grupos = [];
  // Pesos das 6 linhas da forma "classificada" (2 revenda · 2 serviço · 1 sem detalhe · 1 não
  // classificado) e das 3 da forma "nada classificado" — sempre fechando no centavo.
  const p6 = mockRatearPesos(fat, [30, 30, 15, 15, 10, 10]);
  const p3 = mockRatearPesos(fat, [1, 1, 1]);
  if (fat > 0) {
    if (forma === 0) {
      // ⚠ O ESTADO REAL DA PRODUÇÃO: `tipoReceita` nulo em 16.153/16.153 itens. Tudo cai no grupo
      // não classificado, e o motor recusa calcular. Não é erro — é o relatório dizendo o que falta.
      const linhas = [0, 1, 2].map((i) => mockLinhaNota({
        i, competencia, valor: p3[i],
        linhaAtividade: mockLinhaAtividade(null),
        segregacao: null,
        qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Item sem `tipoReceita`." },
        motivoNaoClassificado: "item_sem_tipo_receita",
      }));
      grupos.push({
        chave: "NAO_CLASSIFICADO",
        rotulo: "NÃO CLASSIFICADO — a competência não foi classificada",
        tipoReceita: null, classificado: false, temDetalhe: true,
        linhaAtividade: mockLinhaAtividade(null), segregacao: null,
        qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Item sem `tipoReceita`." },
        linhas, total: mockTotal(linhas),
      });
    } else {
      // Revenda: a segregação do 6.5 fica INDETERMINADA — a tela NÃO pode escrever "Sem ST".
      const revenda = [0, 1].map((i) => mockLinhaNota({
        i, competencia, valor: p6[i], tipo: "NFE",
        linhaAtividade: mockLinhaAtividade("REVENDA_MERCADORIA", true),
        segregacao: MOCK_SEGREGACAO_INDETERMINADA,
        qualificacoes: MOCK_QUALIFICACOES_NAO_APURADAS,
      }));
      grupos.push({
        chave: "REVENDA_MERCADORIA|INDETERMINADA",
        rotulo: "Revenda de mercadoria (Anexo I) · Segregação não apurada",
        tipoReceita: "REVENDA_MERCADORIA", classificado: true, temDetalhe: true,
        linhaAtividade: mockLinhaAtividade("REVENDA_MERCADORIA", true),
        segregacao: MOCK_SEGREGACAO_INDETERMINADA,
        qualificacoes: MOCK_QUALIFICACOES_NAO_APURADAS,
        linhas: revenda, total: mockTotal(revenda),
      });

      const servico = [2, 3].map((i) => mockLinhaNota({
        i, competencia, valor: p6[i],
        linhaAtividade: mockLinhaAtividade("SERVICO_ANEXO_III"),
        segregacao: null, // o manual não faz a pergunta com/sem ST para serviço
        qualificacoes: MOCK_QUALIFICACOES_NAO_APURADAS,
      }));
      grupos.push({
        chave: "SERVICO_ANEXO_III",
        rotulo: "Serviço — Anexo III",
        tipoReceita: "SERVICO_ANEXO_III", classificado: true, temDetalhe: true,
        linhaAtividade: mockLinhaAtividade("SERVICO_ANEXO_III"), segregacao: null,
        qualificacoes: MOCK_QUALIFICACOES_NAO_APURADAS,
        linhas: servico, total: mockTotal(servico),
      });

      // ⚠ BLOCO PRÓPRIO: "nunca recebemos o detalhe" (resumo do DFe, `items: []`) não é "ninguém
      // classificou". Ações diferentes, responsáveis diferentes.
      const semDetalhe = [4].map((i) => mockLinhaNota({
        i, competencia, valor: p6[i], tipo: "NFE",
        itemId: null, descricao: null, cfop: null, codigoServico: null,
        codigoOperacao: null, codigoOperacaoFonte: null,
        linhaAtividade: mockLinhaAtividade(null), segregacao: null,
        qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Nota sem itens capturados — não há o que qualificar." },
        motivoNaoClassificado: "nota_sem_item",
      }));
      grupos.push({
        chave: "SEM_DETALHE_CAPTURADO",
        rotulo: "SEM DETALHE CAPTURADO — o resumo do DFe não traz os itens da nota",
        tipoReceita: null, classificado: false, temDetalhe: false,
        linhaAtividade: mockLinhaAtividade(null), segregacao: null,
        qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Nota sem itens capturados — não há o que qualificar." },
        linhas: semDetalhe, total: mockTotal(semDetalhe),
      });

      const naoClass = [5].map((i) => mockLinhaNota({
        i, competencia, valor: p6[i],
        linhaAtividade: mockLinhaAtividade(null), segregacao: null,
        qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Item sem `tipoReceita`." },
        motivoNaoClassificado: "item_sem_tipo_receita",
      }));
      grupos.push({
        chave: "NAO_CLASSIFICADO",
        rotulo: "NÃO CLASSIFICADO — a competência não foi classificada",
        tipoReceita: null, classificado: false, temDetalhe: true,
        linhaAtividade: mockLinhaAtividade(null), segregacao: null,
        qualificacoes: { estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "Item sem `tipoReceita`." },
        linhas: naoClass, total: mockTotal(naoClass),
      });
    }
  }

  const todasAsLinhas = grupos.flatMap((g) => g.linhas);
  const totalMes = mockTotal(todasAsLinhas);
  const gNaoClass = grupos.find((g) => g.chave === "NAO_CLASSIFICADO") || null;
  const gSemDet = grupos.find((g) => g.chave === "SEM_DETALHE_CAPTURADO") || null;

  const naoClassificado = {
    valorContabil: gNaoClass ? gNaoClass.total.valorContabil : 0,
    itens: gNaoClass ? gNaoClass.total.itens : 0,
    notasComItensSemValor: 0,
    fracaoDoTotal: totalMes.valorContabil > 0 && gNaoClass
      ? Math.round((gNaoClass.total.valorContabil / totalMes.valorContabil) * 10000) / 10000
      : 0,
    comoResolver: "Aba Apuração → sub-aba Sugestão → botão \"Classificar competência\". Enquanto os "
      + "itens não tiverem `tipoReceita`, o relatório não consegue dizer de que tipo de operação é a "
      + "receita — e o motor de apuração não calcula o DAS.",
  };

  const semDetalheCapturado = {
    valorContabil: gSemDet ? gSemDet.total.valorContabil : 0,
    notas: gSemDet ? gSemDet.total.itens : 0,
    fracaoDoTotal: totalMes.valorContabil > 0 && gSemDet
      ? Math.round((gSemDet.total.valorContabil / totalMes.valorContabil) * 10000) / 10000
      : 0,
    somaNoTotal: true,
    motivo: "A NF-e foi capturada pelo RESUMO do DFe (`resNFe`), que por definição não traz os itens "
      + "da nota. Não é falta de classificação: é falta do documento completo.",
    comoResolver: "Manifestar/baixar a NF-e completa (`procNFe`) na aba Notas Fiscais.",
  };

  // ⚠ Conferência que NÃO fecha na forma 2 — é o relatório acusando a si mesmo, e sem um caso no
  // mock esse aviso nunca é visto antes de produção.
  const faturamentoEmit = forma === 2 && totalMes.valorContabil > 0
    ? Math.round((totalMes.valorContabil - 250.4) * 100) / 100
    : totalMes.valorContabil;
  const conferencia = {
    totalRelatorio: totalMes.valorContabil,
    faturamentoEmit,
    diferenca: Math.round((totalMes.valorContabil - faturamentoEmit) * 100) / 100,
    confere: Math.abs(totalMes.valorContabil - faturamentoEmit) < 0.01,
  };

  const circular = mockMonthlyCirculars.get(makeCircularKey(companyId, competencia)) || {};
  const conferenciaAdn = mockConferenciaAdn(companyId, competencia);
  const podeAfirmarAusencia = circular.semFaturamento === true || conferenciaAdn.status === "ok";
  const ausenciaDeNotas = {
    aplicavel: totalMes.valorContabil === 0,
    total: totalMes.valorContabil,
    semFaturamentoAfirmado: {
      valor: circular.semFaturamento ?? null, // ⚠ tri-estado: `null` viaja como `null`
      em: circular.semFaturamentoEm || null,
      por: circular.semFaturamentoPor || null,
      conferenciaNoMomento: circular.semFaturamentoConferencia || null,
    },
    conferenciaAdn: { status: conferenciaAdn.status, em: conferenciaAdn.em },
    podeAfirmarAusencia,
    mensagem: totalMes.valorContabil !== 0
      ? null
      : (podeAfirmarAusencia
        ? "Nenhuma nota na competência, e há confirmação: "
          + (circular.semFaturamento === true
            ? "o contador afirmou que o mês não teve faturamento."
            : "a conferência com o ADN fechou (`ok`).")
        : "Nenhuma nota encontrada — isto NÃO é o mesmo que ausência de receita. Zero também é o "
          + "que aparece quando o município está fora do ADN, quando o certificado A1 venceu ou "
          + "quando o cursor NSU travou. Para afirmar ausência: marque \"mês sem faturamento\" na "
          + "aba Lançamentos, ou rode a conferência com o ADN."),
  };

  // ── O pré-apurado, com as três procedências ────────────────────────────────────────────────
  const oficialBase = { fonte: "ApuracaoSnapshot", estado: null, numeroDeclaracao: null, reciboNumero: null, transmitidoEm: null };
  let preApurado;
  if (forma === 0 || totalMes.valorContabil === 0) {
    // ⚠ COMPETÊNCIA SEM RECEITA NÃO É COMPETÊNCIA POR CLASSIFICAR. Sem nota nenhuma não há o que
    // classificar, e devolver `RECEITA_NAO_CLASSIFICADA` aqui mandaria o contador classificar o
    // vazio. `motivo: null` com `blockers: []` é forma que o serviço real produz (o motivo sai do
    // primeiro blocker, e sem blocker ele é `null`).
    const semReceita = totalMes.valorContabil === 0;
    preApurado = {
      origem: "MOTOR_LOCAL",
      ok: false,
      das: null, // ⚠ `null`, nunca 0 — zero afirmaria "o DAS deste mês é zero"
      estado: semReceita ? null : "bloqueada_pendencias",
      motivo: semReceita ? null : {
        code: "RECEITA_NAO_CLASSIFICADA",
        mensagem: "A receita da competência não está classificada — os itens das notas não têm "
          + "`tipoReceita`, e sem isso não há anexo, não há alíquota e não há DAS.",
        detalhe: null,
      },
      blockers: semReceita ? [] : [{ tipo: "RECEITA_NAO_CLASSIFICADA", mensagem: "Receita não classificada" }],
      semClassificacao: {
        valorContabil: naoClassificado.valorContabil, itens: naoClassificado.itens,
        fracaoDoTotal: naoClassificado.fracaoDoTotal, totalDaCompetencia: totalMes.valorContabil,
      },
      comoResolver: semReceita ? null : naoClassificado.comoResolver,
      receitaPorTipo: null,
      oficial: { ...oficialBase, dasRetornadoSerpro: null, dasSimuladoSerpro: null, dasCalculadoLocalNoSnapshot: null },
      diferenca: null,
    };
  } else {
    const nosso = Math.round(totalMes.valorContabil * 0.0812 * 100) / 100;
    // ⚠ A FORMA 2 TEM DUAS METADES, e é de propósito: depois da separação das colunas convivem em
    // produção o snapshot NOVO (simulação na coluna dela) e o snapshot VELHO (procedência que
    // ninguém consegue provar). Se o mock só tivesse o novo, o estado "ambíguo" — que continua
    // valendo e continua na tela — deixaria de ser caminhável offline no dia seguinte ao conserto.
    const legado = idx >= 0 && idx % 6 === 5;
    const oficial = forma === 1
      // Forma 1: a declaração foi TRANSMITIDA. Nosso × oficial, com a diferença. A simulação que a
      // precedeu fica gravada ao lado — o KPI prefere o transmitido, e é isso que se exercita.
      ? {
        ...oficialBase, estado: "transmitida", numeroDeclaracao: "MOCK-DECL-1", reciboNumero: "MOCK-REC-1",
        transmitidoEm: `${competencia}-20T14:00:00.000Z`,
        dasRetornadoSerpro: Math.round((nosso + 37.45) * 100) / 100,
        dasSimuladoSerpro: Math.round((nosso + 30.2) * 100) / 100,
        dasCalculadoLocalNoSnapshot: null,
      }
      : legado
        // ⚠ Forma 2 (legado): SÓ a coluna ambígua, como os snapshots gravados ANTES da separação.
        // A tela não pode afirmar de quem é aquele número, e não deve tentar.
        ? {
          ...oficialBase, estado: "calculada",
          dasRetornadoSerpro: null,
          dasSimuladoSerpro: null,
          dasCalculadoLocalNoSnapshot: {
            valor: Math.round((nosso + 12.1) * 100) / 100, procedenciaAmbigua: true,
            aviso: "Snapshot anterior à separação das colunas: a coluna `dasCalculadoLocal` era "
              + "gravada tanto pelo motor local quanto pela simulação oficial do PGDAS-D, e nada "
              + "na linha diz qual dos dois é este número. Não use como \"nosso cálculo\" sem conferir.",
          },
        }
        // Forma 2 (novo): a RFB calculou e NADA foi transmitido. Número oficial com dono, e a
        // diferença contra o nosso volta a ser calculável.
        : {
          ...oficialBase, estado: "calculada",
          dasRetornadoSerpro: null,
          dasSimuladoSerpro: Math.round((nosso + 12.1) * 100) / 100,
          dasCalculadoLocalNoSnapshot: null,
        };
    preApurado = {
      origem: "MOTOR_LOCAL",
      ok: true,
      das: nosso,
      persistido: false,
      rbt12: 480000,
      fatorR: null,
      receitaPorTipo: { REVENDA_MERCADORIA: Math.round(fat * 0.6 * 100) / 100, SERVICO_ANEXO_III: Math.round(fat * 0.3 * 100) / 100 },
      receitaPorAnexo: { I: Math.round(fat * 0.6 * 100) / 100, III: Math.round(fat * 0.3 * 100) / 100 },
      aliquotaEfetivaPorAnexo: { I: 0.0754, III: 0.0902 },
      divergencias: [],
      blockers: [],
      motivo: null,
      semClassificacao: {
        valorContabil: naoClassificado.valorContabil, itens: naoClassificado.itens,
        fracaoDoTotal: naoClassificado.fracaoDoTotal, totalDaCompetencia: totalMes.valorContabil,
      },
      oficial,
      diferenca: oficial.dasRetornadoSerpro != null
        ? Math.round((nosso - oficial.dasRetornadoSerpro) * 100) / 100
        : null,
    };
  }

  return {
    versao: 2,
    competencia,
    competenciaExtenso: `${MOCK_MESES_PT[(mes || 1) - 1]}/${ano}`,
    titulo: "Faturamento no Período - Consolidado",
    subtitulo: "Documentos Emitidos",
    empresa: {
      portalClientId: companyId,
      razaoSocial: empresa?.razao || "EMPRESA MOCK LTDA",
      cnpj: empresa?.cnpj || "00.000.000/0001-00",
      municipio: empresa?.municipio || "São Paulo",
      uf: empresa?.uf || "SP",
    },
    vocabulario: MOCK_VOCABULARIO,
    naoClassificado,
    semDetalheCapturado,
    ausenciaDeNotas,
    gruposPorTipoOperacao: grupos,
    totalMes,
    totalConsolidado: totalMes,
    resumoPorTipoOperacao: grupos.map((g) => ({
      chave: g.chave, rotulo: g.rotulo, classificado: g.classificado,
      segregacao: g.segregacao, qualificacoes: g.qualificacoes, ...g.total,
    })),
    conferencia,
    preApurado,
    limitacoes: MOCK_LIMITACOES,
  };
}

// Marca das buscas do Presumido já feitas — o equivalente, no mock, à guia com `sourceFileId`
// determinístico que o backend usa como chave de idempotência. É o que faz a confirmação
// "já buscado em <data>" ser exercitável offline; sem ela, o mock nunca chega ao segundo clique.
const mockBuscasLp = new Map(); // "companyId|competencia" -> ISO

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ESTORNO DA BAIXA — a fixture que faltava
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ TODA fixture da Circular era ABERTA, com `baixas: []`. Sem uma baixa PAGA no mock, o botão
// "↩ Desfazer baixa" nunca aparecia offline — o único fluxo da aba que não dava para conferir sem
// backend era justamente o que mais precisa ser conferido antes de subir.
//
// São TRÊS lançamentos (principal, juros, multa em contas diferentes), porque o lote é o caso real:
// uma fixture de um lançamento só produziria uma prévia e um `totalConferido` que o servidor de
// verdade nunca devolveria, e o mock passaria a esconder exatamente o que a tela existe para
// mostrar. É uma PARCELA de parcelamento de propósito — é ela que "volta para a fila".
const MOCK_ESTORNO_PROVISAO_ID = "mock-provisao-parcela-paga";
const MOCK_ESTORNO_GUIA_ID = "mock-guia-parcela-paga";
const MOCK_ESTORNO_LOTE = [
  {
    id: "mock-baixa-principal",
    historico: "PAGO PARCELA 03/12 - PARCELAMENTO SIMPLES NACIONAL",
    tipoLinha: "PRINCIPAL", codigoTributo: "DAS", valor: 392.58,
    linhas: [{ conta: "553", tipo: "D", valor: 392.58 }, { conta: "111", tipo: "C", valor: 392.58 }],
  },
  {
    id: "mock-baixa-juros",
    historico: "PAGO PARCELA 03/12 - PARCELAMENTO SIMPLES NACIONAL (juros)",
    tipoLinha: "JUROS", codigoTributo: "DAS", valor: 57.52,
    linhas: [{ conta: "501", tipo: "D", valor: 57.52 }, { conta: "111", tipo: "C", valor: 57.52 }],
  },
  {
    id: "mock-baixa-multa",
    historico: "PAGO PARCELA 03/12 - PARCELAMENTO SIMPLES NACIONAL (multa)",
    tipoLinha: "MULTA", codigoTributo: "DAS", valor: 78.48,
    linhas: [{ conta: "506", tipo: "D", valor: 78.48 }, { conta: "111", tipo: "C", valor: 78.48 }],
  },
];
// Só os DÉBITOS somam — igual ao `totalEstornado` do serviço. A perna de CAIXA em crédito, somada,
// contaria o mesmo dinheiro duas vezes na tela de confirmação.
const MOCK_ESTORNO_TOTAL = Math.round(
  MOCK_ESTORNO_LOTE.reduce(
    (s, l) => s + l.linhas.filter((x) => x.tipo === "D").reduce((a, x) => a + x.valor, 0), 0,
  ) * 100,
) / 100;

// ─── Busca de pagamento da PARCELA (PAGTOWEB) ────────────────────────────────────────────────
// ⚠ MOCK QUE SÓ CONHECE O CAMINHO FELIZ ESCONDE EXATAMENTE O QUE ESTA TELA PRECISA MOSTRAR.
// A busca do comprovante é uma chamada PAGA ao SERPRO, e ela recusa de seis maneiras diferentes,
// cada uma exigindo uma saída diferente do contador: esperar o cooldown, pedir liberação a um
// ADMIN, ligar uma flag de ambiente, recapturar a guia, ou simplesmente esperar mais alguns dias.
// Um mock que devolvesse sempre `encontrado: true` deixaria os cinco caminhos de recusa sem NENHUM
// exercício offline — que é a única forma de conferi-los sem gastar dinheiro no SERPRO real.
//
// O desfecho é escolhido pelo PREFIXO do guideId, para que cada caminho tenha uma linha clicável
// própria na aba Parcelamento.
const DESFECHO_BUSCA_MOCK = [
  ["mock-guia-ok", { encontrado: true }],
  ["mock-guia-naolocalizado", { encontrado: false, motivo: "Pagamento ainda não localizado no SERPRO." }],
  ["mock-guia-semdoc", { encontrado: false, motivo: "Guia sem número de documento — o comprovante é localizado por ele." }],
  ["mock-guia-cooldown", { falha: { code: "SERPRO_CHAMADA_REPETIDA", status: 502, message: "Esta mesma consulta ao SERPRO (COMPARRECADACAO72) foi feita há pouco e é paga. Aguarde 247s ou mude algo antes de repetir." } }],
  ["mock-guia-tetodia", { falha: { code: "SERPRO_TETO_DIARIO", status: 502, message: "Esta empresa já consumiu 60 consultas pagas ao SERPRO hoje (teto 60). Um ADMIN pode liberar, ou tente amanhã." } }],
  ["mock-guia-tetomes", { falha: { code: "SERPRO_TETO_MENSAL_ESCRITORIO", status: 502, message: "O escritório já consumiu 1240 consultas pagas ao SERPRO neste mês (teto 1240, = 31 empresas × 40). Um ADMIN pode liberar; se o consumo normal cresceu, aumente SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA." } }],
  ["mock-guia-desligado", { falha: { code: "SERPRO_PAGTOWEB_DISABLED", status: 502, message: "serpro_pagtoweb_disabled" } }],
  ["mock-guia-falhou", { falha: { code: "PAGTOWEB_FALHOU", status: 502, message: "socket hang up" } }],
];

// Pagamentos já localizados nesta sessão do mock — é o que faz a parcela MUDAR na tela depois da
// busca (vira "paga · falta lançar" e entra na fila de baixa pendente). Sem isto o clique
// terminaria com um texto na tela e a lista idêntica, e o fluxo nunca seria conferido de verdade.
const mockPagamentosLocalizados = new Map(); // guideId → comprovante
// Uma parcela já nasce paga-e-sem-lançamento, para que o painel "Parcelas pagas aguardando
// lançamento" (e o motivo pelo qual o botão de busca dela fica desabilitado) apareçam sem depender
// de alguém clicar antes.
mockPagamentosLocalizados.set("mock-guia-pendente-baixa", {
  dataArrecadacao: "05/07/2026", principal: 1180.22, juros: 12.94, multa: 6.84,
  total: 1200, meioPagamento: "PIX", confiavel: true,
  competencia: "2026-05", parcelamentoId: "parc-ok",
});

// ⚠ OS PARCELAMENTOS CRIADOS NESTA SESSÃO DO MOCK (F2.3 — parcelamento-first).
// O wizard "+ Novo parcelamento" cria o CONTRATO sem guia nenhuma; sem guardar o resultado aqui, a
// lista voltaria sempre a mesma e a criação pareceria não fazer nada — e o aceite da fase
// ("registrar um migrado, 23ª de 60, sem PDF, e o card mostrar 22 pagas / 38 restantes") não teria
// como ser exercido offline.
const mockParcelamentosCriados = new Map(); // id → parcelamento decorado (formato de listParcelamentos)

// ⚠ OS ATOS DO CONTRATO, no mock — e eles precisam ter CONSEQUÊNCIA VISÍVEL, senão o aceite não é
// exercível offline. Excluir tem de fazer o card SUMIR (das duas filas junto); desfazer a rescisão
// tem de fazer o contrato VOLTAR e suas prestações reaparecerem na fila "vencidas sem guia" — que é,
// literalmente, o problema que o dono relatou ("não consigo dar baixa em parcelamento sem guia").
// As fixturas são reconstruídas a cada chamada, então o estado da sessão mora nestes dois conjuntos.
const mockParcelamentosExcluidos = new Set(); // id → contrato que o contador excluiu nesta sessão
const mockRescisoesDesfeitas = new Set();     // id → contrato cuja rescisão foi desfeita nesta sessão

// Estornos já feitos no mock — é o que faz a parcela VOLTAR PARA A FILA depois do estorno, em vez
// de a tela recarregar idêntica e o fluxo terminar sem nenhuma consequência visível.
const mockEstornosFeitos = new Map(); // companyId -> Set(entryId de baixa)

function mockLoteJaEstornado(companyId) {
  return (mockEstornosFeitos.get(companyId) || new Set()).size > 0;
}

// A competência da baixa fica numa função só porque DUAS coisas a leem: a fixture da Circular e a
// prévia do estorno (que decide DELECAO × CONTRA_LANCAMENTO olhando se o mês está fechado). Duas
// cópias fariam o mock oferecer o botão num mês e conferir o fechamento de outro.
function mockEstornoCompetencia() {
  return `${new Date().getFullYear()}-08`;
}

/**
 * O LOTE que será desfeito, com valores — a mesma resposta que `previewEstorno` devolve.
 *
 * É função de módulo (e não um método do objeto) porque o `estornarBaixa` a chama para conferir o
 * total e os bloqueios: uma segunda cópia da regra faria o mock aprovar na prévia o que ele mesmo
 * recusaria na execução.
 */
function buildMockEstornoPreview(companyId, entryId) {
  if (!MOCK_ESTORNO_LOTE.some((l) => l.id === entryId) || mockLoteJaEstornado(companyId)) {
    throw mockRecusa("lancamento_nao_encontrado", "Lançamento não encontrado.");
  }
  const competenciaOriginal = mockEstornoCompetencia();
  // ⚠ MÊS FECHADO NÃO APAGA: o lançamento fica onde está e nasce um espelho invertido na
  // competência de HOJE. O mock lê o mesmo `mockMonthlyCirculars` que o cadeado da aba Lançamentos
  // escreve — fechar o mês pela tela é o que faz este caminho aparecer, como em produção.
  const mesFechado = Boolean(getCircularRecord(companyId, competenciaOriginal)?.fechadoContabilEm);
  const hoje = new Date();
  const competenciaHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const modo = mesFechado ? "CONTRA_LANCAMENTO" : "DELECAO";
  const bloqueios = [];
  if (modo === "CONTRA_LANCAMENTO"
    && Boolean(getCircularRecord(companyId, competenciaHoje)?.fechadoContabilEm)) {
    // Recusa explícita, COM O CAMINHO DE SAÍDA na mensagem: não existe terceiro lugar honesto para
    // pôr este lançamento, e escolher sozinho outra competência aberta seria inventar a data de um
    // fato contábil para não ter de dizer não.
    bloqueios.push({
      code: "MES_CORRENTE_FECHADO",
      competencia: competenciaHoje,
      message: `A baixa está em ${competenciaOriginal}, que já foi fechada, então o estorno tem de sair como contra-lançamento em ${competenciaHoje} — que também está fechada. Reabra ${competenciaHoje} para estornar.`,
    });
  }
  const dataDaBaixa = new Date(`${competenciaOriginal}-20T00:00:00.000Z`).toISOString();
  return {
    ok: true,
    modo,
    mesFechado,
    competenciaOriginal,
    competenciaContraLancamento: modo === "CONTRA_LANCAMENTO" ? competenciaHoje : null,
    lancamentos: MOCK_ESTORNO_LOTE.map((l) => ({
      id: l.id,
      historico: l.historico,
      competencia: competenciaOriginal,
      data: dataDaBaixa,
      tipoLinha: l.tipoLinha,
      codigoTributo: l.codigoTributo,
      valor: l.valor,
      linhas: l.linhas,
    })),
    totalEstornado: MOCK_ESTORNO_TOTAL,
    guia: {
      id: MOCK_ESTORNO_GUIA_ID, tipo: "DAS", competencia: competenciaOriginal,
      numeroParcela: 3, vencimento: dataDaBaixa, valor: MOCK_ESTORNO_TOTAL,
      parcelaEstado: "CONFIRMADA", parcelaEstadoAposEstorno: "ESTORNADA",
      paymentStatusSource: "MANUAL", pagamentoSeraDesfeito: true, reabre: true,
    },
    provisao: {
      id: "mock-abertura-parc", historico: "ABERTURA PARCELAMENTO SIMPLES NACIONAL",
      competencia: `${hoje.getFullYear()}-01`, statusPagamento: "PARCIAL",
    },
    parcelamentoId: "mock-parc-1",
    recalculoAtual: { risco: { nivel: "BAIXO", emAtraso: 0 } },
    motivoObrigatorio: true,
    bloqueios,
  };
}

/** Erro de recusa do mock — com o MESMO código do backend, senão o mock só conhece o caminho feliz. */
// ── FIXTURE DOS PARCELAMENTOS — no MÓDULO, e não dentro de um endpoint ───────────────────────
//
// ⚠ ELA SUBIU PARA CÁ porque agora DUAS filas leem os mesmos contratos: `parcelas-pendentes-baixa`
// (a prestação COM guia, cujo pagamento o SERPRO confirmou) e `parcelas-sem-guia-pendentes` (a
// prestação SEM documento nenhum, que só o contador pode declarar). Reconstruir os contratos
// dentro de cada endpoint faria as duas discordarem sobre quantas prestações existem e quais têm
// documento — a divergência que a fila nova existe justamente para NÃO criar.
/** "2026-07" a partir de um ISO — a competência que `calendarioDaParcela` grava em produção. */
function competenciaDoVencimentoMock(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function construirParcelamentosFixos() {
  const dia = 24 * 60 * 60 * 1000;
  const em = (n) => new Date(Date.now() + n * dia).toISOString();
      // ⚠ `linhas` descreve as PRESTAÇÕES, e é o que faz a busca de pagamento ser conferível
      // offline. Cada entrada vira uma `parcelaContratada` (o contrato: qual prestação existe e
      // quando vence) mais, quando há, uma `guide` (o fato: valor, pagamento, número do documento).
      // `guia: null` é o caso REAL do débito automático — prestação contratada sem documento
      // nenhum para consultar; ela existe aqui de propósito, senão o botão desabilitado por "sem
      // guia" nunca apareceria no mock.
      const parc = (over) => {
        const linhas = over.linhas || [];
        const guides = linhas.filter((l) => l.guia).map((l, i) => ({
          id: l.guia,
          numeroParcela: l.n,
          valor: 1200 + i,
          paymentStatus: l.pago ? "PAID" : "OPEN",
          baixada: Boolean(l.baixada),
          competencia: l.competencia,
          anoMesParcela: l.competencia,
          vencimento: l.vencimento,
          // ⚠ `null` aqui é o caso que o dono precisa ver desabilitado COM MOTIVO: sem número de
          // documento o PAGTOWEB não tem o que consultar (é a entrada de tudo lá).
          numeroDocumento: l.semDocumento ? null : `0720260000${1000 + l.n}`,
          comprovante: l.pago
            ? { dataArrecadacao: "05/07/2026", principal: 1180.22, juros: 12.94, multa: 6.84, total: 1200, meioPagamento: "PIX", confiavel: true }
            : null,
          paymentConfirmedAt: l.pago ? em(-3) : null,
          serproLastCheckedAt: l.jaConsultada ? em(-1) : null,
          serproLastCheckResult: l.jaConsultada ? "NAO_LOCALIZADO" : null,
        }));
        // ⚠ `principalTotal` PODE SER NULO, e é esse caso que produz `principalPago: null` em vez de
        // zero. Contrato do wizard cujo papel PRINCIPAL não foi declarado nasce assim; afirmar
        // "R$ 0,00 de principal pago" seria inventar. `?? 12000` mantém as fixtures antigas iguais.
        const principalTotalFix = over.principalTotal === null ? null : (over.principalTotal ?? 12000);
        const principalPorParcelaFix = principalTotalFix != null && linhas.length >= 1
          ? Math.round((principalTotalFix / linhas.length) * 100) / 100
          : null;
        const principalPagoFix = principalPorParcelaFix != null
          ? Math.round(over.parcelasPagas * principalPorParcelaFix * 100) / 100
          : null;
        return {
          id: over.id, label: over.label, tipo: over.tipo, status: over.status || "ATIVO",
          numeroParcelamento: over.numeroParcelamento, principalTotal: principalTotalFix, jurosTotal: 1800,
          // ⚠ `numParcelas` ACOMPANHA as linhas. Fixo em 12 com 3 ou 4 linhas, o mock ensinava uma
          // contradição: o card dizia "0 de 3" (prestações materializadas) e o modal de anexo dizia
          // "parcela 3 de 12" (cabeçalho do contrato) — dois denominadores para a mesma pergunta.
          // Em produção `sincronizarParcelas` materializa exatamente `numParcelas` linhas.
          valorMulta: 600, totalValue: 14400, principalPerParcela: 1200, numParcelas: linhas.length,
          valorParcelaReferencia: 1200,
          // F2.3: os três campos novos do contrato. `formaPagamento: null` no primeiro é o
          // NÃO DECLARADO — o terceiro estado, que não é nenhum dos outros dois.
          formaPagamento: over.formaPagamento ?? null,
          diaPagamento: over.diaPagamento ?? 1,
          saldoConsolidado: over.saldoConsolidado ?? null,
          parcelasPagas: over.parcelasPagas, parcelasTotal: linhas.length,
          // ⚠ O PRINCIPAL SAI DE `principalTotal / numParcelas`, NUNCA DE `principalPerParcela`.
          // Aqui `principalTotal = 12.000` e o contrato tem `linhas.length` prestações — 1.200 é o
          // valor CHEIO (`valorParcelaReferencia`), que é justamente o que a coluna legada guarda no
          // V2. Multiplicar por ela era amortizar o passivo pelo valor cheio.
          principalPorParcela: principalPorParcelaFix,
          principalPago: principalPagoFix,
          saldoContratual: principalTotalFix != null && principalPagoFix != null
            ? Math.max(0, Math.round((principalTotalFix - principalPagoFix) * 100) / 100)
            : null,
          // O passivo do razão. `null` aqui seria o contrato V1 (sem linha de papel `PARC`).
          saldoPassivo: Math.max(0, 14400 - over.parcelasPagas * 1200),
          observacoes: null, parcelas: [], guides, risco: over.risco,
          // ⚠ ESPELHA `SELECT_PARCELA_PARA_QUADRO` — inclusive nos campos que ele passou a trazer.
          // `competencia` e `valorPrevisto` ENTRARAM no select compartilhado do backend nesta fase
          // (a fila da prestação sem guia precisa dos dois para renderizar a linha inteira). Mock
          // que não os traga esconderia no offline exatamente a coluna que a tela nova mostra — foi
          // assim que o campo do modal de anexo nasceu vazio da última vez, só que ao contrário.
          //
          // ⚠ A competência é DERIVADA do vencimento quando a linha não a declara, porque é isso
          // que o backend faz: `calendarioDaParcela` a calcula de `competenciaInicial + n` e grava
          // em `parcelas.competencia`. Deixá-la nula aqui inventaria uma ausência que produção não
          // tem.
          parcelasContratadas: linhas.map((l) => ({
            id: `${over.id}-p${l.n}`,
            numeroParcela: l.n,
            competencia: l.competencia || competenciaDoVencimentoMock(l.vencimento),
            vencimento: l.vencimento,
            // ⚠ `over.valorPrevistoParcela: 0` NÃO é enfeite de fixture — é o estado em que TODO
            // contrato criado pelo wizard nasce hoje. `buildDTOsFromManual` deriva o valor da
            // parcela da SOMA DOS TRIBUTOS; sem guia e sem composição essa soma é 0, então
            // `valorParcelaReferencia` é 0 e `sincronizarParcelas` materializa as N prestações com
            // `valorPrevisto = 0`. A fila devolve `sem_valor_previsto` em todas. Um mock que só
            // conhecesse 1200 esconderia exatamente o caso que o dono está vivendo.
            valorPrevisto: over.valorPrevistoParcela ?? 1200,
            origemBaixa: l.historica ? "HISTORICO" : null,
            guia: l.guia
              ? { id: l.guia, vencimento: l.vencimento, paymentStatus: l.pago ? "PAID" : "OPEN", baixada: Boolean(l.baixada) }
              : null,
          })),
        };
      };
      const regra = {
        id: "IN_RFB_2063_2022_ART_18",
        descricao: "3 prestações, consecutivas ou não; ou 2 se as demais estiverem pagas ou a última vencida",
        limiteAbsoluto: 3, limiteComDemaisPagas: 2,
        // ⚠ false de propósito: é assim que o back devolve enquanto a redação vigente não for
        // conferida na fonte oficial, e a tela precisa saber esconder o número do artigo.
        citacaoConferida: false,
      };
      const fixos = [
        parc({
          id: "parc-ok", label: "PARCSN 2026 — em dia", tipo: "PARCSN", numeroParcelamento: "1010",
          parcelasPagas: 2, formaPagamento: "GUIA_MENSAL", diaPagamento: 20, saldoConsolidado: 12000,
          // As quatro situações da coluna Situação, em ordem: baixada · paga aguardando lançamento ·
          // em aberto com documento (é a que se clica) · em aberto SEM documento (desabilitada).
          linhas: [
            { n: 1, guia: "mock-guia-baixada-1", competencia: "2026-04", vencimento: em(-100), pago: true, baixada: true },
            { n: 2, guia: "mock-guia-pendente-baixa", competencia: "2026-05", vencimento: em(-70), pago: true },
            { n: 3, guia: "mock-guia-ok-3", competencia: "2026-06", vencimento: em(-40) },
            { n: 4, guia: "mock-guia-semdoc-4", competencia: "2026-07", vencimento: em(-10), semDocumento: true },
          ],
          risco: { nivel: "ok", caso: null, emAtraso: 0, vencidas: 4, faltamParaRescindir: 3, parcelasEmAtraso: [], regra, avaliavel: true },
        }),
        parc({
          id: "parc-atencao", label: "PARCMEI 2025 — uma em atraso", tipo: "PARCMEI", numeroParcelamento: "2020",
          parcelasPagas: 1, diaPagamento: 10,
          // As RECUSAS pagas do SERPRO, uma por linha — é o único jeito de exercê-las sem gastar
          // chamada real. `jaConsultada` faz a confirmação avisar que a guia já foi consultada.
          linhas: [
            // ⚠ `pago: true` aqui NÃO é enfeite: `parcelasPagas: 1` sem nenhuma linha quitada fazia
            // o card se contradizer — "1 de 4" no progresso e "próxima prestação: 1" logo abaixo.
            { n: 1, guia: "mock-guia-naolocalizado-1", competencia: "2026-04", vencimento: em(-95), pago: true, baixada: true, jaConsultada: true },
            { n: 2, guia: "mock-guia-cooldown-2", competencia: "2026-05", vencimento: em(-65) },
            { n: 3, guia: "mock-guia-tetodia-3", competencia: "2026-06", vencimento: em(-35) },
            { n: 4, guia: "mock-guia-tetomes-4", competencia: "2026-07", vencimento: em(-20) },
          ],
          risco: { nivel: "atencao", caso: null, emAtraso: 1, vencidas: 4, faltamParaRescindir: 2, parcelasEmAtraso: [{ numeroParcela: 4, vencimento: em(-20) }], regra, avaliavel: true },
        }),
        parc({
          id: "parc-risco", label: "PARCSN 2024 — risco de rescisão", tipo: "PARCSN", numeroParcelamento: "3030",
          parcelasPagas: 0, formaPagamento: "DEBITO_AUTOMATICO", diaPagamento: 5,
          // Integração desligada, falha de rede, e a prestação SEM GUIA (débito automático).
          linhas: [
            { n: 1, guia: "mock-guia-desligado-1", competencia: "2026-03", vencimento: em(-80) },
            { n: 2, guia: "mock-guia-falhou-2", competencia: "2026-04", vencimento: em(-50) },
            { n: 3, guia: null, competencia: "2026-05", vencimento: em(-20) },
          ],
          risco: {
            nivel: "rescindivel", caso: "I", emAtraso: 3, vencidas: 5, faltamParaRescindir: 0,
            parcelasEmAtraso: [{ numeroParcela: 3, vencimento: em(-80) }, { numeroParcela: 4, vencimento: em(-50) }, { numeroParcela: 5, vencimento: em(-20) }],
            regra, avaliavel: true,
          },
        }),
        // ⚠ O CASO REAL DO DONO (incidente de produção): um contrato MIGRADO de 60 prestações,
        // NENHUMA com guia capturada (a flag `INTEGRACAO_SERPRO_PARCELAMENTO` está OFF), e com
        // atraso. É a fixture que expõe o que 3 ou 4 linhas escondiam: 60 linhas idênticas, cada
        // uma repetindo o mesmo parágrafo de "sem guia", dentro de um card de ~360px.
        // Sem ela o mock só conhece contratos curtos, e o caminho feliz esconde o defeito.
        parc({
          id: "parc-migrado-60", label: "OUTRO 2026 — migrado, 60 prestações sem guia", tipo: "OUTRO",
          // ⚠ `formaPagamento` AUSENTE de propósito: é o default do backend e o valor de TODO
          // contrato criado antes de `139c4efe` — inclusive o do dono. É o caso em que a tela não
          // pode afirmar se a guia vai chegar ou se não existe.
          numeroParcelamento: "3", parcelasPagas: 0, diaPagamento: 20,
          saldoConsolidado: 38037.74,
          linhas: Array.from({ length: 60 }, (_, i) => ({
            n: i + 1, guia: null, competencia: null, vencimento: em(-35 + i * 30),
          })),
          risco: {
            nivel: "atencao", caso: null, emAtraso: 1, vencidas: 1, faltamParaRescindir: 2,
            parcelasEmAtraso: [{ numeroParcela: 1, vencimento: em(-35) }], regra, avaliavel: true,
          },
        }),
        // ⚠ O CONTRATO QUE NASCEU SEM VALOR — o que o wizard produz hoje, e o motivo de o "valor
        // original da parcela" ter virado pedido do dono. As três prestações vêm com
        // `valorPrevisto: 0`, então a fila as devolve com `motivoBloqueio: "sem_valor_previsto"` e a
        // mensagem manda "corrigir o valor da parcela no contrato" — que até agora era um caminho
        // nomeado e inexistente. É nesta fixture que a correção do valor contratado se exercita.
        parc({
          id: "parc-wizard-sem-valor", label: "PARCSN 2026 — criado pelo wizard, sem valor",
          tipo: "PARCSN", numeroParcelamento: "4040", parcelasPagas: 0,
          formaPagamento: "DEBITO_AUTOMATICO", diaPagamento: 15, saldoConsolidado: 3600,
          valorPrevistoParcela: 0,
          // ⚠ E SEM `principalTotal` CONFIÁVEL — é o outro lado do mesmo contrato torto: o wizard
          // não declarou quanto do acordo é principal, então `principalPago`, `principalPorParcela`
          // e `saldoContratual` saem **`null`**, não zero. É esta fixture que exerce a RECUSA do
          // modal de rescisão em vez do pré-preenchimento com R$ 0,00.
          principalTotal: null,
          linhas: [
            { n: 1, guia: null, competencia: "2026-05", vencimento: em(-45) },
            { n: 2, guia: null, competencia: "2026-06", vencimento: em(-15) },
            { n: 3, guia: null, competencia: "2026-07", vencimento: em(15) },
          ],
          risco: { nivel: "ok", caso: null, emAtraso: 0, vencidas: 0, faltamParaRescindir: 3, parcelasEmAtraso: [], regra, avaliavel: false },
        }),
        // ⚠ O CONTRATO RESCINDIDO — a CASCA VAZIA medida em produção (10/08/2026), e a fixture sem a
        // qual metade desta fase é invisível offline.
        //
        // O que ela reproduz, ponto por ponto: `status: "RESCINDIDO"`, ZERO lançamento contábil,
        // `aberturaEntryId` nulo (por isso `parcelasPagas: 0` e nenhuma provisão), prestações
        // VENCIDAS e SEM GUIA. É esse contrato que tira 12 prestações da fila de baixa sem uma
        // palavra — o silêncio que fez o dono concluir que a baixa sem guia não funcionava.
        //
        // ⚠ Ele tem de continuar aparecendo em `listParcelamentos` (o backend devolve rescindidos;
        // quem escondia era a tela). Se ele sumir daqui, a seção "Contratos rescindidos" e o botão
        // de desfazer a rescisão deixam de ser exercíveis, e volta o estado em que o contrato errado
        // era invisível e, portanto, incorrigível.
        parc({
          id: "parc-rescindido", label: "OUTRO 2026 — rescindido por engano", tipo: "OUTRO",
          numeroParcelamento: "3", parcelasPagas: 0, diaPagamento: 20,
          status: mockRescisoesDesfeitas.has("parc-rescindido") ? "ATIVO" : "RESCINDIDO",
          formaPagamento: "DEBITO_AUTOMATICO", saldoConsolidado: 38037.74,
          valorPrevistoParcela: 633.96,
          linhas: Array.from({ length: 12 }, (_, i) => ({
            n: i + 1, guia: null, competencia: null, vencimento: em(-330 + i * 30),
          })),
          // Rescindido, o risco é `null` no backend ("não há mais o que prevenir"). Depois de
          // desfeita a rescisão ele volta a ser avaliado — e é isso que o preview antecipa.
          risco: mockRescisoesDesfeitas.has("parc-rescindido")
            ? { nivel: "rescindivel", caso: "I", emAtraso: 12, vencidas: 12, faltamParaRescindir: 0, parcelasEmAtraso: [], regra, avaliavel: true }
            : null,
        }),
      ];
  return fixos.filter((p) => !mockParcelamentosExcluidos.has(p.id));
}

// ── A FILA DA PRESTAÇÃO SEM GUIA, no mock ────────────────────────────────────────────────────
//
// ⚠ ELA É DERIVADA DOS MESMOS CONTRATOS, e não de uma segunda lista escrita à mão: é assim que o
// mock consegue mostrar a prestação SAINDO da fila depois da declaração (que é o aceite da fase) em
// vez de fingir um sucesso sobre uma fixture congelada.
//
// O que ela reproduz do backend, condição por condição: sem guia · `origemBaixa` nulo · vencimento
// até o FIM DE HOJE (quem vence hoje entra, e entra como `VENCE_HOJE`, não como vencida) ·
// parcelamento não rescindido.

/** parcelaId → a declaração feita nesta sessão. É o `origemBaixa: "MANUAL"` do mock. */
const mockBaixasManuais = new Map();

/**
 * parcelaId → o valor CONTRATADO corrigido nesta sessão (`parcelas.valorPrevisto` do backend).
 *
 * ⚠ É UM MAPA SEPARADO DE `mockBaixasManuais` porque são dois fatos diferentes, e o mock existe
 * para não deixar essa diferença sumir: aqui mora quanto o ACORDO diz que a prestação vale; lá,
 * quanto foi PAGO (principal + juros + multa). Guardar os dois no mesmo lugar seria, no offline, o
 * mesmo colapso que a tela evita.
 */
const mockValoresPrevistosCorrigidos = new Map();

/**
 * As recusas por prestação — cada uma existe para exercer uma guarda da rota real.
 *
 * ⚠ Mock que só sabe o caminho feliz esconde exatamente o que esta tela existe para mostrar. As
 * outras quatro recusas (`parcela_ja_baixada`, `CONFERENCIA_OBRIGATORIA`, `CONFERENCIA_DIVERGENTE`
 * e `MES_FECHADO`) não precisam de fixture: elas caem sozinhas do estado — declarar duas vezes,
 * mandar total ausente/errado, ou escolher uma data em competência que o cadeado da aba Lançamentos
 * fechou.
 */
const RECUSAS_BAIXA_MANUAL_MOCK = Object.freeze({
  // A corrida real: a captura do SERPRO vinculou uma guia entre a listagem e o clique. A rota
  // recusa e APONTA o outro caminho, porque as duas guardas de idempotência não se enxergam.
  "parc-migrado-60-p2": "parcela_tem_guia",
  // Contrato migrado cuja adesão nunca foi lançada: sem provisão de abertura não há passivo a
  // amortizar. Esta chega DESABILITADA na tela, com o motivo à vista — nunca só desabilitada.
  "parc-risco-p3": "provisao_inexistente",
});

function construirFilaSemGuiaMock() {
  const agora = Date.now();
  const fimDeHoje = new Date();
  fimDeHoje.setHours(23, 59, 59, 999);

  const linhas = [];
  for (const p of [...mockParcelamentosCriados.values(), ...construirParcelamentosFixos()]) {
    if (p.status === "RESCINDIDO") continue;
    for (const c of p.parcelasContratadas || []) {
      if (c.guia || c.origemBaixa || mockBaixasManuais.has(c.id)) continue;
      if (!c.vencimento) continue; // sem data não se afirma que venceu
      if (new Date(c.vencimento).getTime() > fimDeHoje.getTime()) continue; // futura ≠ não paga
      const semProvisao = RECUSAS_BAIXA_MANUAL_MOCK[c.id] === "provisao_inexistente";
      // ⚠ A CORREÇÃO DO VALOR CONTRATADO VENCE A FIXTURE — é assim que o mock mostra a edição
      // PERSISTINDO (a prestação sai de "sem valor previsto" e passa a ser baixável). Sem isso o
      // contador corrigiria e veria o número antigo voltar, que é o defeito que a fase evita.
      const valorPrevisto = mockValoresPrevistosCorrigidos.has(c.id)
        ? mockValoresPrevistosCorrigidos.get(c.id)
        : (c.valorPrevisto ?? null);
      const bloqueio = semProvisao ? "provisao_inexistente" : (valorPrevisto ? null : "sem_valor_previsto");
      linhas.push({
        parcelaId: c.id,
        numeroParcela: c.numeroParcela ?? null,
        competencia: c.competencia ?? null,
        vencimento: c.vencimento,
        valorPrevisto,
        situacao: new Date(c.vencimento).getTime() < agora ? "VENCIDA" : "VENCE_HOJE",
        parcelamentoId: p.id,
        parcelamento: {
          id: p.id, label: p.label, tipo: p.tipo, numParcelas: p.numParcelas,
          numeroParcelamento: p.numeroParcelamento, formaPagamento: p.formaPagamento ?? null,
          temProvisaoDeAbertura: !semProvisao,
        },
        podeBaixar: !bloqueio,
        motivoBloqueio: bloqueio,
      });
    }
  }
  // A mais antiga primeiro — é a que está mais perto de contar para a regra de rescisão.
  linhas.sort((a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime());
  return linhas;
}

/**
 * ⚠ O QUE A FILA ESCONDEU — e é a razão de esta função existir separada, e não de um `if` dentro da
 * de cima.
 *
 * `construirFilaSemGuiaMock` pula o parcelamento RESCINDIDO (o backend também: fila de trabalho
 * sobre acordo morto é trabalho inventado). O problema nunca foi o filtro — foi ele ser MUDO: a fila
 * vazia é o mesmo pixel de "não há nada pendente", e foi assim que 69 prestações de dois contratos
 * sumiram sem uma palavra em produção.
 *
 * ⚠ AS CONDIÇÕES SÃO AS MESMAS DA FILA, com o status invertido — igualzinho ao backend
 * (`whereParcelaForaDaFilaPorRescisao` é derivado de `whereParcelaSemGuiaPendente`). Se as duas
 * divergirem, o aviso passa a contar linhas que não voltariam para a fila, e a tela mente.
 */
function construirForaDaFilaMock() {
  const fimDeHoje = new Date();
  fimDeHoje.setHours(23, 59, 59, 999);

  const porContrato = new Map();
  for (const p of [...mockParcelamentosCriados.values(), ...construirParcelamentosFixos()]) {
    if (p.status !== "RESCINDIDO") continue; // ← a única condição diferente da fila
    for (const c of p.parcelasContratadas || []) {
      if (c.guia || c.origemBaixa || mockBaixasManuais.has(c.id)) continue;
      if (!c.vencimento) continue;
      if (new Date(c.vencimento).getTime() > fimDeHoje.getTime()) continue;
      if (!porContrato.has(p.id)) {
        porContrato.set(p.id, {
          parcelamentoId: p.id, label: p.label, tipo: p.tipo,
          numeroParcelamento: p.numeroParcelamento, status: p.status, prestacoes: 0,
        });
      }
      porContrato.get(p.id).prestacoes += 1;
    }
  }
  const contratos = [...porContrato.values()].sort((a, b) => b.prestacoes - a.prestacoes);
  return {
    prestacoes: contratos.reduce((s, c) => s + c.prestacoes, 0),
    contratos,
    motivo: "PARCELAMENTO_RESCINDIDO",
  };
}

/**
 * A PRÉVIA DA EXCLUSÃO, montada a partir do contrato de verdade.
 *
 * ⚠ ELA NÃO É FIXTURE CONGELADA de propósito: é esta prévia que a tela mostra ANTES do clique, e é
 * ela que separa "tem certeza?" de uma confirmação que repete os DADOS. Números redondos escritos à
 * mão esconderiam exatamente o que esta fase existe para provar.
 *
 * ⚠ E o MÊS FECHADO sai do mesmo `mockMonthlyCirculars` que o cadeado da aba Lançamentos escreve —
 * fechar 01/2026 pela tela é o que faz o caminho do contra-lançamento aparecer aqui, como em
 * produção. Uma flag própria do mock deixaria as duas telas discordando.
 */
function construirPreviewExclusaoMock(companyId, parcId) {
  const parc = [...mockParcelamentosCriados.values(), ...construirParcelamentosFixos()]
    .find((p) => p.id === parcId);
  if (!parc) throw mockRecusa("parcelamento_nao_encontrado", "Parcelamento não encontrado.");

  const prestacoes = parc.parcelasContratadas || [];
  const quitadas = prestacoes.filter((c) => c.origemBaixa || c.guia?.baixada || c.guia?.paymentStatus === "PAID").length;
  const guias = (parc.guides || []).map((g) => ({
    id: g.id, tipo: parc.tipo === "INSS" ? "INSS" : "SIMPLES", competencia: g.competencia,
    numeroParcela: g.numeroParcela, valor: g.valor, baixada: Boolean(g.baixada),
    paymentStatus: g.paymentStatus,
    // O mesmo de-para do backend: sem `parcelamentoId` a guia sai da coluna PARC_DAS e volta a
    // valer como a guia do tributo dela naquele mês.
    deColuna: "PARC_DAS", paraColuna: parc.tipo === "INSS" ? "INSS" : "DAS",
  }));

  // A provisão da adesão, quando o contrato tem uma. `parc-risco` é o migrado sem provisão e
  // `parc-rescindido` é a casca vazia medida em produção (zero lançamento).
  const temProvisao = parc.id !== "parc-risco" && parc.id !== "parc-rescindido";
  const compProvisao = "2026-01";
  const fechada = Boolean(getCircularRecord(companyId, compProvisao)?.fechadoContabilEm);
  const lista = temProvisao
    ? [{
      id: `${parc.id}-prov`, tipo: "PROVISAO", competencia: compProvisao,
      historico: `PROVISÃO ${parc.tipo} — principal`, tipoLinha: "PRINCIPAL", status: "RASCUNHO",
      valor: Number(parc.principalTotal) || 0, mesFechado: fechada,
    }]
    : [];
  const hoje = new Date();
  const competenciaHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const contra = fechada && temProvisao;

  return {
    parcelamento: {
      id: parc.id, label: parc.label, tipo: parc.tipo,
      numeroParcelamento: parc.numeroParcelamento, status: parc.status,
      competenciaInicial: compProvisao, numParcelas: parc.numParcelas,
      totalValue: Number(parc.totalValue) || 0, temProvisaoDeAbertura: temProvisao,
    },
    modo: contra ? "CONTRA_LANCAMENTO" : "DELECAO",
    competenciaContraLancamento: contra ? competenciaHoje : null,
    competenciasFechadas: contra ? [compProvisao] : [],
    // ⚠ Sobrando lançamento em mês fechado, o cabeçalho NÃO é removido — é ele que segura o grupo
    // do fechamento. A tela diz isso; "excluí e ele ainda existe" sem explicação é pior.
    cabecalhoRemovido: !contra,
    prestacoes: { total: prestacoes.length, quitadas, semEvidencia: parc.parcelasSemEvidencia ?? 0 },
    guias: {
      total: guias.length,
      baixadas: guias.filter((g) => g.baixada).length,
      voltamAContarComo: [...new Set(guias.map((g) => g.paraColuna))],
      lista: guias,
    },
    lancamentos: {
      total: lista.length,
      apagados: contra ? 0 : lista.length,
      preservados: contra ? lista.length : 0,
      linhasDeRastreio: 0,
      lista,
    },
    totalDesfeito: lista.reduce((s, l) => s + l.valor, 0),
    motivoObrigatorio: true,
    avisos: [
      ...(quitadas > 0 ? [{ code: "PRESTACOES_COM_BAIXA", quantidade: quitadas }] : []),
      ...(guias.length ? [{ code: "GUIAS_DESVINCULADAS", quantidade: guias.length }] : []),
    ],
    bloqueios: [],
  };
}

function mockRecusa(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Provisões do Lucro Presumido: uma por tributo, como `generateProvisionsFromGuide` faz de verdade.
 * O mock antigo devolvia sucesso com `debitos: []` e não escrevia nada — o botão diria "deu certo"
 * e nenhum lançamento apareceria, que é o pior tipo de mock: passa no teste e esconde o defeito.
 */
function synthesizeLpEntries(companyId, competencia, debitos) {
  const list = mockEntriesByCompany.get(companyId) || [];
  const CONTA_POR_TRIBUTO = { PIS: "403", COFINS: "404", IRPJ: "405", CSLL: "406" };
  for (const d of debitos) {
    const entryId = `mock-lp-${companyId}-${competencia}-${d.tributo}`;
    const idx = list.findIndex((item) => item.id === entryId);
    const valor = Number(d.debitoApurado || 0);
    if (!(valor > 0)) { if (idx >= 0) list.splice(idx, 1); continue; }
    const entry = {
      id: entryId,
      portalClientId: companyId,
      circularId: `mock-circular-${companyId}-${competencia}`,
      ruleId: `rule-LP-${d.tributo}`,
      eventType: `PROVISAO_${d.tributo}`,
      data: new Date(`${competencia}-28T00:00:00.000Z`).toISOString(),
      competencia,
      historico: `VR REF ${d.tributo} - ${competencia.slice(5)}/${competencia.slice(0, 4)}`,
      tipo: "PROVISAO",
      subtipo: d.tributo,
      origem: "SERPRO",
      loteImportacao: `SERPRO-LP-${competencia}`,
      status: "RASCUNHO",
      statusPagamento: "ABERTO",
      openEntryId: null,
      lines: [
        { id: `${entryId}-d`, entryId, conta: CONTA_POR_TRIBUTO[d.tributo] || "", tipo: "D", valor, ordem: 0 },
        { id: `${entryId}-c`, entryId, conta: "5", tipo: "C", valor, ordem: 1 },
      ],
      totalD: valor,
      totalC: valor,
      valor,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
  }
  mockEntriesByCompany.set(companyId, list);
}

export function createMockApi() {
  let accessToken = "";

  return {
    setUnauthorizedHandler() {},
    setAccessToken(token) {
      accessToken = String(token || "").trim();
    },
    getAccessToken() {
      return accessToken;
    },
    clearSession() {
      accessToken = "";
    },
    async login({ identifier, password }) {
      await delay();
      if (!identifier || !password) {
        throw new Error("invalid_credentials");
      }
      accessToken = `mock-token-${faker.string.alphanumeric(12)}`;
      return {
        accessToken,
        refreshToken: `mock-refresh-${faker.string.alphanumeric(12)}`,
        user: {
          id: "mock-user-id",
          role: "contador",
          accountType: "FIRM",
          defaultClientId: null,
          name: "Usuario Mock",
        },
      };
    },
    async me() {
      await delay();
      if (!accessToken) throw new Error("invalid_token");
      return {
        id: "mock-user-id",
        role: "contador",
        accountType: "FIRM",
        defaultClientId: null,
        name: "Usuario Mock",
      };
    },
    async listCompanies(competencia) {
      await delay();
      // A competência da tela manda: sem isso o compliance ficava preso num mês fixo e o caminho
      // de SUCESSO de "marcar sem movimento" era intestável offline (o mês fixo tinha faturamento,
      // então a recusa disparava sempre).
      const comp = competencia || "2026-07";
      // Recalcula o compliance a cada chamada: é assim que marcar/desfazer "sem movimento" na tela
      // muda o chip de verdade. Devolvendo o objeto congelado da carga, o botão pareceria funcionar
      // e nada mudaria — o mesmo mock inerte que já escondeu bug duas vezes neste projeto.
      return mockCompanies.map((c, i) => ({
        ...c,
        guideCompliance: mockGuideComplianceRow({
          companyId: c.companyId,
          indice: i,
          hasProlabore: c.hasProlabore,
          regimeTributario: c.legacyCompany?.regimeTributario,
          competencia: comp,
          faturamento: mockFaturamentoDaCompetencia(c.companyId, comp),
        }),
      }));
    },
    async createCompany(input) {
      await delay();
      const company = buildCompanyPayload(input || {});
      mockCompanies.unshift(company);
      mockGuidesByCompany.set(company.companyId, []);
      return { ok: true, companyId: company.companyId, portalId: company.companyId };
    },
    async updateCompany(companyId, input) {
      await delay();
      const index = mockCompanies.findIndex((item) => item.companyId === companyId);
      if (index < 0) throw new Error("not_found");
      const body = input || {};
      // ⚠ ACEITA AS DUAS FORMAS, como a rota real (`companyInput = body.company ?? body`).
      // Faltava o segundo caso, e ele é justamente o que chega aqui: `updateCompany` é chamada com
      // o FORMULÁRIO CRU (`editCompanyForm.form`, achatado) — quem aninha em `{ company: … }` é o
      // `buildCompanyPayload` do realApi, que o mock não usa. Sem o fallback, `nested` era `{}` e
      // toda edição virava no-op offline: salvar, recarregar e ver o valor VELHO parecia campo
      // descartado pelo backend, quando era o mock que nunca lia o payload.
      const nested = body.company && typeof body.company === "object" ? body.company : body;
      const companyInput = { ...nested, ownerEmail: body.ownerEmail, ownerName: body.ownerName };
      const current = mockCompanies[index];
      const legacyCurrent = current.legacyCompany && typeof current.legacyCompany === "object"
        ? current.legacyCompany
        : {};
      // O form achatado manda `enderecoRua`/`enderecoCidade`/…; o payload aninhado manda `endereco`.
      const endereco = companyInput.endereco && typeof companyInput.endereco === "object"
        ? companyInput.endereco
        : {
          rua: companyInput.enderecoRua,
          numero: companyInput.enderecoNumero,
          bairro: companyInput.enderecoBairro,
          cidade: companyInput.enderecoCidade,
          uf: companyInput.enderecoUf,
          cep: companyInput.enderecoCep,
          complemento: companyInput.enderecoComplemento,
        };
      const next = {
        ...current,
        razao: String(companyInput.razaoSocial || current.razao || "").trim(),
        cnpj: String(companyInput.cnpj || current.cnpj || "").trim(),
        hasProlabore:
          body.hasProlabore !== undefined ? Boolean(body.hasProlabore) : Boolean(current.hasProlabore),
        temFolha:
          body.temFolha !== undefined ? Boolean(body.temFolha) : Boolean(current.temFolha),
        ownerEmail: String(companyInput.ownerEmail || current.ownerEmail || "").trim().toLowerCase() || null,
        guideNotificationEmail:
          companyInput.guideNotificationEmail !== undefined && companyInput.guideNotificationEmail !== null
            ? String(companyInput.guideNotificationEmail || "").trim().toLowerCase() || null
            : current.guideNotificationEmail ?? null,
        email: String(companyInput.email || current.email || "").trim().toLowerCase() || null,
        telefone: String(companyInput.telefone || current.telefone || "").trim() || null,
        uf: String(endereco.uf || current.uf || "").trim().toUpperCase() || null,
        municipio: String(endereco.cidade || current.municipio || "").trim() || null,
        inscricaoMunicipal:
          String(companyInput.inscricaoMunicipal || current.inscricaoMunicipal || "").trim() || null,
        portalUpdatedAt: new Date().toISOString(),
      };
      next.legacyCompany = {
        ...legacyCurrent,
        razaoSocial: String(companyInput.razaoSocial || legacyCurrent.razaoSocial || next.razao || "").trim(),
        nomeFantasia: String(companyInput.nomeFantasia || legacyCurrent.nomeFantasia || "").trim() || null,
        cnpj: next.cnpj,
        email: next.email,
        telefone: next.telefone,
        regimeTributario: String(
          companyInput.regimeTributario || legacyCurrent.regimeTributario || "SIMPLES"
        ),
        cnaePrincipal: String(companyInput.cnaePrincipal || legacyCurrent.cnaePrincipal || "").trim() || null,
        // ⚠ MESMA REGRA DO REAL: só dígitos, e 7 ou nada. O mock precisa RECUSAR o que o servidor
        // recusaria (o banco tem CHECK `^[0-9]{7}$`) — um mock permissivo aqui deixaria passar
        // offline exatamente o valor que estoura em produção. Vazio grava `null` (limpar a escolha
        // é uma operação legítima); qualquer outra coisa fora de 7 dígitos é erro.
        codigoMunicipioIbge: normalizarCodigoMunicipioIbgeMock(
          companyInput.codigoMunicipioIbge,
          legacyCurrent.codigoMunicipioIbge ?? null,
        ),
        // ⚠ A rota real grava a IM nos DOIS lados (`PortalClient` e `Company`), e quem
        // `buildMissingFields` lê é o da `Company` — ou seja, o `legacyCompany` daqui. Sem esta
        // linha o assistente diria "falta inscrição municipal" offline mesmo depois de salvá-la.
        inscricaoMunicipal: next.inscricaoMunicipal,
        // ⚠ MESMA REGRA DO REAL nos três, com os MESMOS códigos de erro. Sem isto, a edição virava
        // no-op offline: salvar, recarregar e ver o valor velho parece campo descartado pelo
        // backend — que é exatamente o defeito que este trabalho consertou no real.
        ...normalizarCamposEmissaoNfseMock(companyInput, legacyCurrent),
        enderecoJson: {
          rua: String(endereco.rua || legacyCurrent.enderecoJson?.rua || "").trim() || null,
          numero: String(endereco.numero || legacyCurrent.enderecoJson?.numero || "").trim() || null,
          bairro: String(endereco.bairro || legacyCurrent.enderecoJson?.bairro || "").trim() || null,
          cidade: String(endereco.cidade || legacyCurrent.enderecoJson?.cidade || next.municipio || "").trim() || null,
          uf: String(endereco.uf || legacyCurrent.enderecoJson?.uf || next.uf || "").trim().toUpperCase() || null,
          cep: String(endereco.cep || legacyCurrent.enderecoJson?.cep || "").trim() || null,
          complemento:
            String(endereco.complemento || legacyCurrent.enderecoJson?.complemento || "").trim() || null,
        },
      };
      next.guideCompliance = mockGuideComplianceRow({
        hasProlabore: next.hasProlabore,
        regimeTributario: next.legacyCompany.regimeTributario,
        inssOk: next.guideCompliance?.inss?.ok ?? true,
        dasOk: next.guideCompliance?.das?.ok ?? true,
      });
      mockCompanies[index] = next;
      return { ok: true, company: next };
    },
    async getCompanyGuides(companyId) {
      await delay();
      return (mockGuidesByCompany.get(companyId) || []).slice().sort((a, b) => {
        if (a.competencia < b.competencia) return 1;
        if (a.competencia > b.competencia) return -1;
        return 0;
      });
    },
    async uploadCompanyGuide(companyId, file, metadata) {
      await delay(600);
      if (!metadata?.tipo || !metadata?.competencia) {
        return {
          ok: false,
          needsMetadata: true,
          parsed: {
            tipo: metadata?.tipo || "",
            competencia: metadata?.competencia || "",
            valor: metadata?.valor ?? null,
            vencimento: metadata?.vencimento || null,
          },
        };
      }
      const id = `mock-guide-upload-${Date.now()}`;
      const guide = {
        id,
        guideId: id,
        tipo: String(metadata.tipo).toUpperCase(),
        competencia: metadata.competencia,
        valor: metadata.valor != null ? Number(metadata.valor) : null,
        vencimento: metadata.vencimento || null,
        status: "PROCESSED",
        paymentStatus: "OPEN",
        emailStatus: "SENT",
        source: "UPLOAD",
        canConfirmPayment: true,
        canRecalculate: false,
      };
      const list = mockGuidesByCompany.get(companyId) || [];
      list.unshift(guide);
      mockGuidesByCompany.set(companyId, list);
      return { ok: true, guide, emailStatus: "SENT", emailMessage: "Guia processada e e-mail enviado com sucesso." };
    },
    async fetchGuidePdfBlob() {
      await delay(120);
      // PDF de 1x1 vazio só pra abrir o iframe no mock sem erro
      const tinyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
      return new Blob([tinyPdf], { type: "application/pdf" });
    },
    async identifyGuide(companyId, guideId, metadata) {
      await delay(300);
      const list = mockGuidesByCompany.get(companyId) || [];
      const idx = list.findIndex((g) => g.id === guideId || g.guideId === guideId);
      if (idx < 0) return { ok: false, error: "guide_not_found" };
      const updated = {
        ...list[idx],
        tipo: String(metadata.tipo || "").toUpperCase(),
        competencia: metadata.competencia,
        valor: metadata.valor != null ? Number(metadata.valor) : list[idx].valor,
        vencimento: metadata.vencimento || list[idx].vencimento,
        status: "PROCESSED",
      };
      list[idx] = updated;
      mockGuidesByCompany.set(companyId, list);
      return { ok: true, guide: updated };
    },
    async sendLatestGuidesEmail(companyId) {
      await delay(500);
      const list = mockGuidesByCompany.get(companyId) || [];
      const pending = list.filter((item) => item.status === "PROCESSED" && item.emailStatus !== "SENT");
      const toSendNow = pending.slice(0, faker.number.int({ min: 1, max: 4 }));
      for (const guide of toSendNow) {
        guide.emailStatus = "SENT";
      }
      return {
        status: "sent",
        companyId,
        totalFound: list.length,
        sentNow: toSendNow.length,
        alreadySent: list.filter((item) => item.emailStatus === "SENT").length,
      };
    },
    async resendGuideEmail(guideId) {
      await delay();
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.emailStatus = "PENDING";
          return { ok: true, guideId, emailStatus: "PENDING" };
        }
      }
      throw new Error("not_found");
    },
    // Libera SÓ esta guia ao cliente e "envia" só ela (página da empresa).
    async liberarGuiaCliente(guideId) {
      await delay();
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.liberadaCliente = true;
          target.liberadaEm = new Date().toISOString();
          // ⚠ O CAMINHO DO LOCK PRESO PRECISA EXISTIR NO MOCK. É ele que produzia a mensagem
          // "ficará em fila" — a promessa de um mecanismo que não existe (o laço automático saiu na
          // Q55). Sem um jeito de exercê-lo, a única forma de ver o texto era em produção, com uma
          // guia real não chegando ao cliente.
          //
          // Regra: a PRIMEIRA tentativa de cada guia cai no lock; a segunda envia. É o roteiro real
          // (o lock vence em até 5 min e o clique volta a funcionar) e é o único jeito de conferir
          // que a mensagem honesta aparece E que "tentar de novo" resolve — que é exatamente o que
          // ela promete. Um mock que sempre envia deixaria o ramo do lock sem nenhuma prova.
          if (!mockLiberacoesTentadas.has(guideId)) {
            mockLiberacoesTentadas.add(guideId);
            return {
              // ⚠ O `emailStatus` NÃO muda: o worker nem chegou a rodar. Devolver "PENDING" aqui
              // era a segunda mentira da mesma resposta (idem backend).
              ok: true, guideId, liberadas: 1, emailStatus: target.emailStatus || null, sent: false,
              envio: { feito: false, motivo: "envio_ocupado", podeTentarNovamente: true },
              message: "Guia liberada ao cliente, mas o e-mail NÃO foi enviado: há outro envio em "
                + "andamento (ou um envio anterior que travou). Não há reenvio automático: se você "
                + "não clicar de novo, esta guia não sai. Tente novamente em até 5 minutos.",
            };
          }
          target.emailStatus = "SENT";
          return { ok: true, guideId, liberadas: 1, emailStatus: "SENT", sent: true, envio: { feito: true } };
        }
      }
      throw new Error("not_found");
    },
    async confirmGuidePayment(guideId) {
      await delay();
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.paymentStatus = "PAID";
          target.paymentStatusSource = "MANUAL";
          target.paymentConfirmedAt = new Date().toISOString();
          target.serproLastCheckResult = "MANUAL_CONFIRMED";
          target.canConfirmPayment = false;
          target.canRecalculate = false;
          return { ok: true, guide: { ...target, guideId: target.id, companyId: target.portalClientId } };
        }
      }
      throw new Error("not_found");
    },
    async recalculateGuide(guideId) {
      await delay(500);
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.valor = Number(faker.finance.amount({ min: 300, max: 5000, dec: 2 }));
          target.vencimento = faker.date.soon({ days: 10 }).toISOString();
          target.paymentStatus = "OPEN";
          target.paymentStatusSource = "SERPRO";
          target.paymentConfirmedAt = null;
          target.serproLastCheckedAt = new Date().toISOString();
          target.serproLastCheckResult = "FOUND";
          target.emailStatus = "PENDING";
          target.canConfirmPayment = true;
          target.canRecalculate = false;
          return {
            ok: true,
            result: {
              company: { id: target.portalClientId },
              guide: { ...target, guideId: target.id, companyId: target.portalClientId },
              integration: {
                sistema: "PGDASD",
                servico: "GERARDASCOBRANCA17",
                contratanteCnpj: "12345678000199",
                numeroDocumento: faker.string.numeric(14),
              },
            },
            emailDispatch: {
              skipped: false,
              total: 1,
              sent: 1,
              errors: 0,
              results: [{ guideId: target.id, status: "SENT" }],
            },
          };
        }
      }
      throw new Error("not_found");
    },
    async getExpectedGuides(_companyId, competencia) {
      await delay();
      return {
        ok: true,
        competencia: competencia || null,
        compliance: {
          competencia: competencia || null,
          das: { required: true, ok: false, state: "missing" },
          inss: { required: false, ok: true, state: "na" },
          irpj: { required: false, ok: true, state: "na" },
          csll: { required: false, ok: true, state: "na" },
          pisCofins: { required: false, ok: true, state: "na" },
          iss: { required: false, ok: true, state: "na" },
          ok: false,
        },
      };
    },
    // Marcar/desfazer "sem movimento" MEXE no estado do mock, e a recusa é aplicada de verdade:
    // é o único jeito de conferir offline a bifurcação do ciclo e a trava contra faturamento.
    async markGuideVazio(portalClientId, tipo, competencia, motivo) {
      await delay();
      const fat = mockFaturamentoDaCompetencia(portalClientId, competencia);
      if (fat > 0) {
        return {
          ok: false,
          error: "GUIA_VAZIA_COM_FATURAMENTO",
          faturamento: fat,
          message: `A competência tem R$ ${fat.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em notas emitidas autorizadas. Não dá para marcar esta guia como sem movimento.`,
        };
      }
      mockVazios.set(chaveVazio(portalClientId, tipo), {
        vazioEm: new Date().toISOString(),
        vazioPor: "Usuario Mock",
        vazioMotivo: String(motivo || "").trim() || null,
      });
      return { ok: true, status: "VAZIO", guideId: `mock-vazio-${portalClientId}-${tipo}` };
    },
    async undoGuideVazio(portalClientId, tipo) {
      await delay();
      const existia = mockVazios.delete(chaveVazio(portalClientId, tipo));
      return { ok: true, removed: existia ? 1 : 0 };
    },
    async getFechamentoContabil(companyId, competencia) {
      await delay();
      // O estado das buscas vem do MESMO estado que os mocks de busca escrevem — é isso que
      // permite exercitar offline a confirmação "já buscado em <data>" no segundo clique.
      const circular = getCircularRecord(companyId, competencia);
      const status = String(circular?.serproSyncStatus || "").toUpperCase();
      const lpEm = mockBuscasLp.get(`${companyId}|${competencia}`) || null;
      // ⚠ `fechado` sai do REGISTRO, não de um literal. Era `false` fixo: `fecharFechamentoContabil`
      // gravava em `mockMonthlyCirculars` e este GET seguia dizendo "aberto", então o selo de mês
      // fechado e o botão Reabrir eram inalcançáveis offline — exatamente os estados que o mock
      // existe para deixar conferir.
      const fechadoEm = circular?.fechadoContabilEm || null;
      // ⚠ O CHECK-LIST SAI DO REGISTRO, pelo mesmo motivo que o `fechado` saiu — e era o mesmo
      // defeito, um degrau adiante. Ele era um literal com dois itens pendentes ("de propósito, pra
      // dar pra ver o estado bloqueado"), e `setChecklistFechamento` não gravava nada: marcar as
      // caixas não mudava o retorno, `podeFechar` era `false` fixo, e **nenhum mês podia ser
      // fechado offline**. Tudo o que depende de competência FECHADA ficava inalcançável no mock —
      // inclusive o estorno em mês fechado (contra-lançamento) e a recusa `MES_CORRENTE_FECHADO`.
      // O estado bloqueado continua sendo o inicial: as duas caixas nascem desmarcadas.
      const checklist = {
        folhaProlabore: true, despesas: true, receitas: true, provisoes: false, pagamentos: false,
        ...(circular?.checklist || {}),
      };
      const ROTULOS_CHECKLIST = {
        folhaProlabore: "Folha/Pró-labore lançados", despesas: "Despesas lançadas",
        receitas: "Receitas lançadas", provisoes: "Provisões lançadas", pagamentos: "Pagamentos lançados",
      };
      const checklistPendentes = Object.entries(checklist)
        .filter(([, ok]) => !ok)
        .map(([chave]) => ({ chave, label: ROTULOS_CHECKLIST[chave] || chave }));
      return {
        ok: true, competencia,
        fechado: Boolean(fechadoEm),
        fechadoEm,
        fechadoPor: circular?.fechadoContabilPor || null,
        fechadoPorNome: fechadoEm ? "Usuário Mock" : null,
        folhaProlaboreOk: true,
        checklist,
        checklistPendentes,
        // Empresa já fechada não "pode fechar" — ela ESTÁ fechada (mesma regra do agregado real).
        podeFechar: !fechadoEm && checklistPendentes.length === 0,
        blockers: [],
        semFaturamento: circular?.semFaturamento === true,
        semFaturamentoEm: circular?.semFaturamentoEm || null,
        semFaturamentoConferencia: circular?.semFaturamentoConferencia || null,
        conferenciaAdn: mockConferenciaAdn(companyId, competencia),
        faturamentoEmit: mockFaturamentoDaCompetencia(companyId, competencia),
        // O detector: o razão ainda bate com a circular? Derivado, nunca coluna.
        divergenciasFonte: mockDivergenciasFonte(companyId, competencia),
        serpro: {
          // NOT_FOUND conta como buscado: a chamada saiu e foi cobrada do mesmo jeito.
          extrato: {
            buscado: status === "SUCCESS" || status === "NOT_FOUND",
            em: circular?.serproLastSyncAt || null,
            status: circular?.serproSyncStatus || null,
          },
          // No mock a integração é sempre "disponível": não há flag de servidor para consultar, e
          // desligar aqui esconderia a tela que se quer conferir offline.
          presumido: { buscado: Boolean(lpEm), em: lpEm, disponivel: true },
        },
      };
    },
    async setFolhaProlabore(_companyId, competencia, ok) {
      await delay();
      return { ok: true, competencia, folhaProlaboreOk: Boolean(ok) };
    },
    // A recusa é a regra que importa aqui, então o mock a aplica de verdade: com faturamento na
    // competência, devolve o mesmo 409 do backend. Um mock que aceitasse sempre esconderia
    // exatamente o caso que o campo existe para impedir.
    async setSemFaturamento(companyId, competencia, ok) {
      await delay();
      const fat = mockFaturamentoDaCompetencia(companyId, competencia);
      if (ok && fat > 0) {
        return {
          ok: false,
          error: "SEM_FATURAMENTO_COM_RECEITA",
          faturamento: fat,
          message: `A competência tem R$ ${fat.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em notas emitidas autorizadas. Não dá para marcar como sem faturamento.`,
        };
      }
      // A segunda recusa: divergência é PROVA de nota faltando, não falta de informação.
      const conf = mockConferenciaAdn(companyId, competencia).status;
      if (ok && conf === "divergente") {
        return {
          ok: false,
          error: "SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE",
          faltantes: 1,
          message: "A conferência contra o ADN encontrou 1 nota(s) que o ADN tem e nós não. Resolva a divergência antes de afirmar que o mês não teve faturamento.",
        };
      }
      const conferencia = conf === "ok" ? "ok" : (conf ? "nao_conferivel" : "sem_conferencia");
      const chave = makeCircularKey(companyId, competencia);
      const atual = mockMonthlyCirculars.get(chave) || {
        id: `mock-circular-${companyId}-${competencia}`, portalClientId: companyId, competencia,
      };
      mockMonthlyCirculars.set(chave, {
        ...atual,
        semFaturamento: Boolean(ok),
        semFaturamentoEm: ok ? new Date().toISOString() : null,
        semFaturamentoConferencia: ok ? conferencia : null,
      });
      return { ok: true, competencia, semFaturamento: Boolean(ok), conferencia: ok ? conferencia : null };
    },
    async listParcelasPendentesBaixa() {
      await delay();
      // A fila é alimentada pelo que a busca localizou nesta sessão — mais a parcela que já nasce
      // paga na fixture (`mock-guia-pendente-baixa`), pra a fila não depender de ninguém clicar.
      const parcelas = [...mockPagamentosLocalizados.entries()].map(([guideId, c], i) => ({
        parcelaId: `mock-parcela-${guideId}`,
        guideId,
        numeroParcela: i + 1,
        competencia: c.competencia || "2026-07",
        valor: c.total ?? 1200,
        vencimento: null,
        parcelamentoId: c.parcelamentoId || "parc-ok",
        confirmadoEm: c.confirmadoEm || new Date().toISOString(),
        comprovante: c,
      }));
      return { ok: true, parcelas };
    },
    // ⚠ A RECUSA TAMBÉM É UM DESFECHO, e ela vem do servidor como `skipped` com um MOTIVO — não
    // como erro. Enquanto o mock só sabia responder `ok:true`, o painel de baixa só podia ser
    // conferido offline no caminho feliz, e é justamente a recusa que a tela precisa mostrar na
    // linha (antes ela saía num `window.alert` que some ao clicar OK). Os prefixos espelham o
    // `DESFECHO_BUSCA_MOCK`: cada guia da fixture exerce um caminho.
    async lancarBaixaParcela(companyId, guideId) {
      await delay();
      const id = String(guideId || "");
      const RECUSAS = [
        ["mock-guia-naolocalizado", "comprovante_nao_e_parcela"],
        ["mock-guia-cooldown", "provisao_inexistente"],
        ["mock-guia-baixada", "ja_baixada"],
        ["mock-guia-semdoc", "sem_composicao"],
      ];
      const motivo = (RECUSAS.find(([prefixo]) => id.startsWith(prefixo)) || [])[1];
      if (motivo) return { ok: false, skipped: true, motivo };
      mockPagamentosLocalizados.delete(guideId);
      return { ok: true, resultado: { pagamentoId: "mock-baixa-parcela" } };
    },

    // ── A OUTRA FILA: prestação SEM GUIA, vencida e sem baixa ────────────────────────────────────
    // ⚠ Ela responde OUTRA pergunta. Acima, o SERPRO já disse que a guia foi paga e falta lançar;
    // aqui não há documento nenhum (débito automático), e quem afirma que o dinheiro saiu é o
    // contador. Por isso a resposta traz o CONTRATO junto de cada linha: sem isso o front faria uma
    // chamada por prestação, e são até 60 por acordo.
    // ⚠ `foraDaFila` VIAJA SEMPRE, inclusive vazio — é ele que faz a fila vazia parar de ser muda.
    async listParcelasSemGuiaPendentes() {
      await delay();
      return { ok: true, parcelas: construirFilaSemGuiaMock(), foraDaFila: construirForaDaFilaMock() };
    },

    // ⚠ TODAS AS GUARDAS DA ROTA REAL PASSAM POR AQUI — inclusive a conferência do total, que é o
    // ato de consequência desta via: o servidor recalcula `principal + juros + multa` e RECUSA se
    // não bater com o que a tela conferiu. Ele não deriva o acréscimo por subtração, e o mock
    // também não: um mock que aceitasse qualquer total deixaria a divergência aparecer só em
    // produção, no lançamento.
    async lancarBaixaManualParcela(companyId, parcelaId, body = {}) {
      await delay();
      const id = String(parcelaId || "");

      if (mockBaixasManuais.has(id)) {
        throw mockRecusa("parcela_ja_baixada", "Esta prestação já foi baixada.", {
          payload: { ok: false, skipped: true, motivo: "parcela_ja_baixada" },
        });
      }
      const linha = construirFilaSemGuiaMock().find((l) => l.parcelaId === id);
      if (!linha) {
        throw mockRecusa("parcela_not_found", "Prestação não encontrada.", {
          payload: { ok: false, skipped: true, motivo: "parcela_not_found" },
        });
      }
      const recusa = RECUSAS_BAIXA_MANUAL_MOCK[id];
      if (recusa) {
        throw mockRecusa(recusa, `O servidor recusou: ${recusa}.`, {
          payload: { ok: false, skipped: true, motivo: recusa },
        });
      }

      const principal = Number(linha.valorPrevisto);
      if (!Number.isFinite(principal) || principal <= 0) {
        throw mockRecusa("sem_valor_previsto", "A prestação não tem valor previsto no contrato.", {
          payload: { ok: false, skipped: true, motivo: "sem_valor_previsto" },
        });
      }
      const juros = Number(body.valorJuros || 0);
      const multa = Number(body.valorMulta || 0);
      if (juros < 0 || multa < 0) {
        throw mockRecusa("acrescimo_negativo", "Juros e multa não podem ser negativos.", {
          payload: { ok: false, skipped: true, motivo: "acrescimo_negativo" },
        });
      }
      const total = Math.round((principal + juros + multa + Number.EPSILON) * 100) / 100;
      if (body.totalConferido == null || !Number.isFinite(Number(body.totalConferido))) {
        throw mockRecusa("CONFERENCIA_OBRIGATORIA", "Confirme o total da baixa (principal + juros + multa).");
      }
      if (Math.abs(Number(body.totalConferido) - total) > 0.01) {
        throw mockRecusa(
          "CONFERENCIA_DIVERGENTE",
          `O total que o servidor calcula (R$ ${total.toFixed(2)}) não é o que foi conferido `
          + `(R$ ${Number(body.totalConferido).toFixed(2)}). Confira de novo.`,
        );
      }

      // ⚠ MÊS FECHADO pela competência da DATA DO PAGAMENTO — e o mock lê o MESMO
      // `mockMonthlyCirculars` que o cadeado da aba Lançamentos escreve. Fechar o mês pela tela é o
      // que faz este caminho aparecer, exatamente como em produção.
      const data = body.dataPagamento ? new Date(`${body.dataPagamento}T12:00:00`) : new Date();
      const competencia = competenciaDoVencimentoMock(data.toISOString());
      if (getCircularRecord(companyId, competencia)?.fechadoContabilEm) {
        throw mockRecusa("MES_FECHADO", `Mês ${competencia} fechado — reabra antes de baixar a parcela.`);
      }

      mockBaixasManuais.set(id, { declaradaEm: new Date().toISOString(), principal, juros, multa, total });
      return {
        ok: true,
        resultado: {
          pagamentoId: `mock-baixa-manual-${id}`,
          origemBaixa: "MANUAL", competencia, principal, juros, multa, total,
        },
      };
    },
    /**
     * O valor CONTRATADO da prestação — e ele NÃO é o valor pago.
     *
     * ⚠ TODAS AS GUARDAS DA ROTA REAL ESTÃO AQUI, inclusive a conferência do "era". Alterar o
     * contrato é ato de consequência: o servidor confere o valor anterior que a tela mostrou e
     * recusa (409 `CONFERENCIA_DIVERGENTE`) se ele tiver mudado no meio. Um mock que aceitasse
     * qualquer coisa deixaria a recusa aparecer só em produção — e ela é a que protege o contador
     * de reescrever um contrato a partir de um "antes" que ele nunca viu.
     */
    async corrigirValorPrevistoParcela(companyId, parcelaId, body = {}) {
      await delay();
      const id = String(parcelaId || "");

      if (mockBaixasManuais.has(id)) {
        throw mockRecusa(
          "parcela_ja_baixada",
          "Esta prestação já foi baixada, e o lançamento foi gravado com o valor antigo. Estorne a baixa antes.",
          { payload: { ok: false, skipped: true, motivo: "parcela_ja_baixada" } },
        );
      }
      const linha = construirFilaSemGuiaMock().find((l) => l.parcelaId === id);
      if (!linha) {
        throw mockRecusa("parcela_not_found", "Prestação não encontrada.", {
          payload: { ok: false, skipped: true, motivo: "parcela_not_found" },
        });
      }
      const novo = Math.round((Number(body.valorPrevisto) + Number.EPSILON) * 100) / 100;
      if (!Number.isFinite(novo) || novo <= 0) {
        throw mockRecusa("valor_invalido", "O valor contratado da prestação tem de ser maior que zero.", {
          payload: { ok: false, skipped: true, motivo: "valor_invalido" },
        });
      }
      const anterior = linha.valorPrevisto ?? null;
      const conferido = body.valorAnteriorConferido == null ? null : Number(body.valorAnteriorConferido);
      const bate = anterior == null ? conferido == null : (conferido != null && Math.abs(conferido - anterior) <= 0.01);
      if (!bate) {
        throw mockRecusa(
          "CONFERENCIA_DIVERGENTE",
          `O valor atual desta prestação no contrato é ${anterior == null ? "ausente" : `R$ ${anterior.toFixed(2)}`}, `
          + `e a tela conferiu ${conferido == null ? "ausente" : `R$ ${conferido.toFixed(2)}`}. Recarregue a fila.`,
        );
      }

      mockValoresPrevistosCorrigidos.set(id, novo);

      // A CONFERÊNCIA DO PASSIVO, calculada de verdade — a soma das prestações que ainda vão
      // amortizar × o principal que a adesão provisionou. ⚠ INFORMATIVA, nunca bloqueio: o número
      // certo sai do contrato, não deste código. Prestação `HISTORICO` fica de fora (não gera
      // lançamento nenhum), igual ao backend.
      const contrato = [...mockParcelamentosCriados.values(), ...construirParcelamentosFixos()]
        .find((p) => p.id === linha.parcelamentoId) || null;
      const amortizaveis = (contrato?.parcelasContratadas || []).filter((c) => c.origemBaixa !== "HISTORICO");
      const somaPrestacoes = Math.round(amortizaveis.reduce((s, c) => {
        const v = mockValoresPrevistosCorrigidos.has(c.id)
          ? mockValoresPrevistosCorrigidos.get(c.id)
          : Number(c.valorPrevisto || 0);
        return s + (Number.isFinite(v) ? v : 0);
      }, 0) * 100) / 100;
      const principalProvisionado = contrato?.principalTotal != null ? Number(contrato.principalTotal) : null;

      return {
        ok: true,
        resultado: {
          parcelaId: id,
          numeroParcela: linha.numeroParcela,
          competencia: linha.competencia,
          valorAnterior: anterior,
          valorPrevisto: novo,
          semMudanca: anterior != null && Math.abs(anterior - novo) <= 0.01,
          conferencia: {
            prestacoesAmortizaveis: amortizaveis.length,
            prestacoesHistoricas: (contrato?.parcelasContratadas || []).length - amortizaveis.length,
            somaPrestacoes,
            principalProvisionado,
            diferenca: principalProvisionado != null
              ? Math.round((somaPrestacoes - principalProvisionado) * 100) / 100
              : null,
          },
        },
      };
    },
    // ⚠ Mesmo shape do real (`POST /firm/guides/:id/buscar-pagamento`), INCLUSIVE nas recusas —
    // ver `DESFECHO_BUSCA_MOCK` acima para o porquê de cada caminho existir aqui.
    async buscarPagamentoGuia(guideId) {
      await delay();
      const id = String(guideId || "");
      const caso = (DESFECHO_BUSCA_MOCK.find(([prefixo]) => id.startsWith(prefixo)) || [])[1]
        || { encontrado: true };

      if (caso.falha) {
        // O `realApi` sobe `code`/`status` junto da mensagem; o mock faz igual, senão a tela
        // distinguiria as recusas em produção e não no mock — o oposto do que serve.
        const err = new Error(caso.falha.message);
        err.code = caso.falha.code;
        err.status = caso.falha.status;
        err.payload = { ok: false, error: caso.falha.code, reason: caso.falha.message };
        throw err;
      }
      if (!caso.encontrado) {
        return { ok: true, encontrado: false, motivo: caso.motivo };
      }
      const comprovante = {
        dataArrecadacao: "13/07/2026", principal: 178.31, juros: 12.94, multa: 1.78,
        total: 193.03, meioPagamento: "PIX", confiavel: true,
      };
      mockPagamentosLocalizados.set(id, { ...comprovante, competencia: "2026-07" });
      return { ok: true, encontrado: true, comprovante };
    },
    async setChecklistFechamento(companyId, competencia, item, ok) {
      await delay();
      // ⚠ GRAVA. Era um retorno de sucesso que não escrevia nada: a caixa marcava na tela, o
      // próximo GET devolvia o literal de novo, e o cadeado nunca destravava.
      const chave = makeCircularKey(companyId, competencia);
      const atual = mockMonthlyCirculars.get(chave)
        || { id: `mock-circular-${companyId}-${competencia}`, portalClientId: companyId, competencia };
      mockMonthlyCirculars.set(chave, {
        ...atual,
        checklist: { ...(atual.checklist || {}), [item]: Boolean(ok) },
      });
      return { ok: true, competencia, item, valor: Boolean(ok) };
    },
    // Fechar/reabrir GRAVAM na circular do mock. Sem isso o fechamento em lote "dava certo" e a
    // barra "Prontas para fechar" continuava com o mesmo número — ou seja, o único efeito
    // observável da funcionalidade era invisível offline.
    async fecharFechamentoContabil(companyId, competencia) {
      await delay();
      const chave = makeCircularKey(companyId, competencia);
      const atual = mockMonthlyCirculars.get(chave) || { id: `mock-circular-${companyId}-${competencia}`, portalClientId: companyId, competencia };
      mockMonthlyCirculars.set(chave, { ...atual, fechadoContabilEm: new Date().toISOString(), fechadoContabilPor: "Usuario Mock" });
      return { ok: true, competencia, fechado: true };
    },
    async reabrirFechamentoContabil(companyId, competencia) {
      await delay();
      const chave = makeCircularKey(companyId, competencia);
      const atual = mockMonthlyCirculars.get(chave);
      if (atual) mockMonthlyCirculars.set(chave, { ...atual, fechadoContabilEm: null, fechadoContabilPor: null });
      return { ok: true, competencia, fechado: false };
    },
    async getGuideSettings() {
      await delay();
      return { ...mockGuideSettings };
    },
    async updateGuideSettings() {
      await delay();
      return { ok: true, settings: { ...mockGuideSettings } };
    },
    async getSerproSettings() {
      await delay();
      return {
        ...mockSerproSettings,
        certificate: { ...mockSerproSettings.certificate },
        source: { ...mockSerproSettings.source },
      };
    },
    async getSerproStatus() {
      await delay();
      return {
        ok: true,
        workerEnabled: true,
        lastRun: mockSerproLastRun,
      };
    },
    async updateSerproSettings(input) {
      await delay();
      mockSerproSettings.enabled = Boolean(input?.enabled);
      mockSerproSettings.environment = String(input?.environment || mockSerproSettings.environment);
      mockSerproSettings.authUrl = String(input?.authUrl || "");
      mockSerproSettings.baseUrl = String(input?.baseUrl || "");
      mockSerproSettings.consumerKey = String(input?.consumerKey || "");
      mockSerproSettings.scope = String(input?.scope || "");
      mockSerproSettings.timeoutMs = Number(input?.timeoutMs || 30000);
      mockSerproSettings.fetchCron = String(input?.fetchCron || mockSerproSettings.fetchCron);
      if (String(input?.consumerSecret || "").trim()) {
        mockSerproSettings.consumerSecretConfigured = true;
      }
      return { ok: true, settings: await this.getSerproSettings() };
    },
    async uploadSerproCertificate({ file, password }) {
      await delay();
      if (!file || !password) throw new Error("pfx_required");
      mockSerproSettings.certificate = {
        hasCertificate: true,
        originalName: String(file.name || "certificado.pfx"),
        uploadedAt: new Date().toISOString(),
        expiresAt: null,
        passwordConfigured: true,
      };
      return { ok: true, settings: { certificate: { ...mockSerproSettings.certificate } } };
    },
    async deleteSerproCertificate() {
      await delay();
      mockSerproSettings.certificate = {
        hasCertificate: false,
        originalName: null,
        uploadedAt: null,
        expiresAt: null,
        passwordConfigured: false,
      };
      return { ok: true, deletedFile: true, settings: { certificate: { ...mockSerproSettings.certificate } } };
    },
    async getSerproCompanyProcuration(companyId) {
      await delay();
      return {
        ok: true,
        result:
          mockSerproProcurationByCompany.get(String(companyId)) || {
            companyId: String(companyId),
            status: "DESCONHECIDA",
            validUntil: null,
            systems: [],
            checkedAt: null,
            payload: null,
          },
      };
    },
    async checkSerproCompanyProcuration(companyId) {
      await delay();
      const result = {
        company: mockCompanies.find((item) => item.companyId === companyId) || null,
        procuradorCnpj: "12345678000199",
        status: faker.helpers.arrayElement(["ATIVA", "ATIVA", "AUSENTE"]),
        validUntil: faker.date.soon({ days: 180 }).toISOString(),
        systems: ["PGDASD", "PROCURACOES", "DCTFWEB"],
        checkedAt: new Date().toISOString(),
      };
      mockSerproProcurationByCompany.set(String(companyId), { ...result, companyId: String(companyId) });
      return { ok: true, result };
    },
    async captureSerproPgdasd(companyId, input = {}) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const serviceId = String(input?.serviceId || "GERARDAS12").trim() || "GERARDAS12";
      const guide = {
        guideId: faker.string.uuid(),
        companyId,
        competencia: String(input.competencia || "2026-04"),
        tipo: "SIMPLES",
        valor: Number(faker.finance.amount({ min: 300, max: 5000, dec: 2 })),
        vencimento: faker.date.soon({ days: 20 }).toISOString(),
        status: "PROCESSED",
        emailStatus: "PENDING",
        paymentStatus: "OPEN",
        paymentStatusSource: "SERPRO",
        paymentConfirmedAt: null,
        serproLastCheckedAt: new Date().toISOString(),
        serproLastCheckResult: "FOUND",
        serproService: serviceId,
        canConfirmPayment: true,
        canRecalculate: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const current = mockGuidesByCompany.get(companyId) || [];
      current.unshift({
        id: guide.guideId,
        portalClientId: companyId,
        tipo: guide.tipo,
        competencia: guide.competencia,
        valor: guide.valor,
        vencimento: guide.vencimento,
        status: guide.status,
        emailStatus: guide.emailStatus,
        paymentStatus: guide.paymentStatus,
        paymentStatusSource: guide.paymentStatusSource,
        paymentConfirmedAt: guide.paymentConfirmedAt,
        serproLastCheckedAt: guide.serproLastCheckedAt,
        serproLastCheckResult: guide.serproLastCheckResult,
        serproService: guide.serproService,
        canConfirmPayment: guide.canConfirmPayment,
        canRecalculate: guide.canRecalculate,
      });
      mockGuidesByCompany.set(companyId, current);
      mockSerproLastRun = {
        key: `serpro_pgdasd_log:${Date.now()}`,
        updatedAt: new Date().toISOString(),
        value: {
          worker: "serpro_pgdasd",
          createdAt: new Date().toISOString(),
          competencia: guide.competencia,
          summary: {
            totalCompanies: 1,
            captured: 1,
            failed: 0,
            skippedByProcuration: 0,
            durationMs: 850,
          },
        },
      };
      return {
        ok: true,
        result: {
          company: { id: companyId, razao: company.razao, cnpj: company.cnpj },
          guide,
          integration: {
            sistema: "PGDASD",
            servico: serviceId,
            contratanteCnpj: "12345678000199",
            numeroDocumento: faker.string.numeric(14),
          },
        },
      };
    },
    async captureSerproLp(companyId, input = {}) {
      await delay(500);
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const competencia = String(input.competencia || "2026-06");

      // A composição varia por mês DE PROPÓSITO: no Lucro Presumido o IRPJ e a CSLL são
      // trimestrais, então há competência com DARF só de PIS/COFINS. Um mock que devolvesse
      // sempre os quatro esconderia justamente esse caso — e é ele que prova que o rótulo da
      // guia lista os impostos REAIS dela, em vez de um texto fixo.
      //
      // ⚠ Isto é forma de mock, não regra fiscal: no caminho real quem decide o que entra na guia
      // é a declaração que o SERPRO devolve, nunca este `if`.
      const mesFechaTrimestre = [3, 6, 9, 12].includes(Number(competencia.slice(5, 7)));
      const debitos = [
        { codigoReceita: "8109", tributo: "PIS", descricao: "PIS/PASEP" },
        { codigoReceita: "2172", tributo: "COFINS", descricao: "COFINS" },
        ...(mesFechaTrimestre ? [
          { codigoReceita: "2089", tributo: "IRPJ", descricao: "IRPJ" },
          { codigoReceita: "2372", tributo: "CSLL", descricao: "CSLL" },
        ] : []),
      ].map((t) => {
        const v = Number(faker.finance.amount({ min: 120, max: 9000, dec: 2 }));
        return { ...t, debitoApurado: v, saldoAPagar: v };
      });
      const principal = Number(debitos.reduce((s, d) => s + d.debitoApurado, 0).toFixed(2));

      const chave = makeCircularKey(companyId, competencia);
      const circular = {
        ...(mockMonthlyCirculars.get(chave) || {
          id: `mock-circular-${companyId}-${competencia}`,
          portalClientId: companyId,
          competencia,
          createdAt: new Date().toISOString(),
        }),
        acrescimos: Object.fromEntries(
          debitos.map((d) => [d.tributo, { principal: d.debitoApurado, juros: 0, multa: 0 }]),
        ),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(chave, circular);
      synthesizeLpEntries(companyId, competencia, debitos);
      mockBuscasLp.set(`${companyId}|${competencia}`, new Date().toISOString());

      // UMA guia consolidada `tipo:"OUTRA"` — o DARF do LP não se divide. Quem separa os tributos
      // é a `composicao`, e é dela que a tabela tira o rótulo ("PIS · COFINS") em vez de "OUTRA".
      // Sem criar a guia aqui, esse rótulo não era verificável no mock.
      const guias = mockGuidesByCompany.get(companyId) || [];
      const sourceFileId = `serpro:dctfweb:lp:${String(company.cnpj).replace(/\D/g, "")}:${competencia}`;
      const guiaLp = {
        id: `mock-guia-lp-${companyId}-${competencia}`,
        portalClientId: companyId,
        sourceFileId,
        tipo: "OUTRA",
        competencia,
        valor: principal,
        valorOriginal: principal,
        vencimento: new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)), 20)).toISOString(),
        status: "PROCESSED",
        emailStatus: "PENDING",
        paymentStatus: "OPEN",
        paymentStatusSource: "SERPRO",
        paymentConfirmedAt: null,
        serproService: "CONSDECCOMPLETA33",
        canConfirmPayment: true,
        canRecalculate: false,
        extracted: {
          composicao: debitos.map((d) => ({
            codigo: d.codigoReceita,
            tributo: d.tributo,
            total: d.debitoApurado,
            denominacao: d.descricao,
          })),
        },
      };
      const iGuia = guias.findIndex((g) => g.sourceFileId === sourceFileId);
      if (iGuia >= 0) guias[iGuia] = guiaLp; else guias.push(guiaLp);
      mockGuidesByCompany.set(companyId, guias);

      return {
        ok: true,
        result: {
          cabecalho: { cnpj: company.cnpj, competencia, numeroRecibo: faker.string.numeric(17) },
          debitos,
          totais: { debitoApurado: principal, saldoAPagar: principal, porTributo: circular.acrescimos },
          provisao: { ok: true, guideId: `mock-guia-lp-${companyId}-${competencia}` },
        },
      };
    },
    async syncSerproInss(companyId, input = {}) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const competencia = String(input.competencia || "2026-04");
      const inssTotal = Number(faker.finance.amount({ min: 180, max: 12000, dec: 2 }));
      const inssVencimento = faker.date.soon({ days: 20 }).toISOString();
      const circular = {
        id: `mock-circular-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        receitaBruta: 0,
        receitaServicos: 0,
        receitaVendas: 0,
        dasTotal: 0,
        inssTotal,
        inssVencimento,
        inssPdfFileId: `mock-inss-${companyId}-${competencia}.pdf`,
        inssPdfUrl: `file:///mock/${companyId}/${competencia}.pdf`,
        inssStatus: "EMITTED",
        metadata: {
          integrationSource: "SERPRO_DCTFWEB",
          sistema: "DCTFWEB",
          servico: "GERARGUIA31",
          rawPayload: { inssTotal, inssVencimento },
        },
        hasAccountingDivergence: false,
        accountingDivergenceMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(makeCircularKey(companyId, competencia), circular);
      synthesizeCircularEntries(companyId, circular);
      return {
        ok: true,
        result: {
          company: { id: companyId, razao: company.razao, cnpj: company.cnpj },
          circular,
          accounting: { ok: true, generatedEntries: [] },
          inss: { status: "EMITTED", competencia, inssTotal, inssVencimento, pdfFileId: circular.inssPdfFileId, pdfUrl: circular.inssPdfUrl },
        },
      };
    },
    async captureSerproParcelamento(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return { ok: true, parcelamentos: [], skipped: "sem_parcelamento_ativo" };
    },
    // Q40 stubs
    async confirmarPagamentoSerpro(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return { ok: true, result: { total: 0, paid: 0, open: 0, errors: 0, results: [] } };
    },
    async getSitfis(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return { ok: true, processando: false, situacao: "REGULAR", protocolo: null, relatorioPdfFileId: null, relatorioTexto: null, verificadoTrial: false };
    },
    async getStoredSitfis(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return {
        ok: true,
        status: {
          situacao: "COM_PENDENCIA",
          checkedAt: new Date().toISOString(),
          // Relatório interpretado — o mesmo formato que o backend devolve (parseSitfisRelatorio).
          // Com um órgão COM pendência, um SEM, e um TERCEIRO que o parser não conseguiu ler:
          // esse último é o caso que a tabela precisa continuar mostrando em vez de esconder.
          // Espelha o formato REAL do parser (conferido contra a ATIM em produção): um bloco por
          // assunto, cada um com suas próprias colunas. Inclui de propósito um bloco ILEGÍVEL —
          // é o caso que precisa continuar visível em vez de sumir.
          relatorio: {
            emitidoEm: "29/07/2026 14:54:45",
            contribuinte: { cnpj: "52.682.158", nome: "EMPRESA MOCK" },
            diagnosticos: [
              {
                orgao: "Receita Federal", chave: "RFB", semPendencia: false,
                blocos: [
                  {
                    titulo: "Pendência - Parcelamento (PARCSN/PARCMEI)",
                    descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"],
                    colunas: ["Parcelas em atraso"],
                    registros: [{ "Parcelas em atraso": "4" }],
                    anotacoes: [], naoInterpretado: [],
                  },
                  {
                    titulo: "Pendência - Débito (SIEF)",
                    descricao: [],
                    colunas: ["Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Sdo. Devedor", "Multa", "Juros", "Sdo. Dev. Cons.", "Situação"],
                    registros: [
                      { "Receita": "4406-01 - MAED - PGDAS-D", "PA/Exerc.": "23/02/2026", "Dt. Vcto": "25/03/2026", "Vl. Original": "50,00", "Sdo. Devedor": "50,00", "Multa": "0,00", "Juros": "2,14", "Sdo. Dev. Cons.": "52,14", "Situação": "DEVEDOR" },
                      { "Receita": "1099-01 - CP-SEGUR.", "PA/Exerc.": "02/2026", "Dt. Vcto": "20/03/2026", "Vl. Original": "178,31", "Sdo. Devedor": "178,31", "Multa": "35,66", "Juros": "7,63", "Sdo. Dev. Cons.": "221,60", "Situação": "DEVEDOR" },
                      { "Receita": "SIMPLES NAC.", "PA/Exerc.": "12/2025", "Dt. Vcto": "21/01/2026", "Vl. Original": "2.382,50", "Sdo. Devedor": "2.382,50", "Multa": "476,50", "Juros": "154,62", "Sdo. Dev. Cons.": "3.013,62", "Situação": "DEVEDOR" },
                    ],
                    anotacoes: ["52682158202601001"], naoInterpretado: [],
                  },
                  {
                    // ⚠ O CASO DO LUCRO PRESUMIDO — que o mock não cobria.
                    // Só havia códigos do Simples aqui (4406, 1099, "SIMPLES NAC."), todos curtos.
                    // No Presumido a coluna "Receita" traz a DENOMINAÇÃO inteira do código, e são
                    // strings de ~40 caracteres: é com elas que a tabela de 9 colunas fica ilegível.
                    // As de PIS e COFINS abaixo são as REAIS, conferidas contra o relatório da
                    // DCTFWeb do dono (ver `classificacaoTributoDarf.test.js`); as de IRPJ e CSLL
                    // ficam só com código e tributo, porque a denominação exata não está confirmada
                    // por fonte oficial e o mock não é lugar de inventar rótulo fiscal.
                    titulo: "Pendência - Débito (SIEF) — Lucro Presumido",
                    descricao: [],
                    colunas: ["Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Sdo. Devedor", "Multa", "Juros", "Sdo. Dev. Cons.", "Situação"],
                    registros: [
                      { "Receita": "2089-01 IRPJ", "PA/Exerc.": "1º TRI/2026", "Dt. Vcto": "30/04/2026", "Vl. Original": "12.480,00", "Sdo. Devedor": "12.480,00", "Multa": "2.496,00", "Juros": "534,72", "Sdo. Dev. Cons.": "15.510,72", "Situação": "DEVEDOR" },
                      { "Receita": "2372-01 CSLL", "PA/Exerc.": "1º TRI/2026", "Dt. Vcto": "30/04/2026", "Vl. Original": "7.488,00", "Sdo. Devedor": "7.488,00", "Multa": "1.497,60", "Juros": "320,83", "Sdo. Dev. Cons.": "9.306,43", "Situação": "DEVEDOR" },
                      { "Receita": "8109-02 PIS - FATURAMENTO - PJ EM GERAL", "PA/Exerc.": "03/2026", "Dt. Vcto": "25/04/2026", "Vl. Original": "1.352,90", "Sdo. Devedor": "1.352,90", "Multa": "270,58", "Juros": "57,96", "Sdo. Dev. Cons.": "1.681,44", "Situação": "DEVEDOR" },
                      { "Receita": "2172-01 COFINS - FATURAMENTO/PJ EM GERAL", "PA/Exerc.": "03/2026", "Dt. Vcto": "25/04/2026", "Vl. Original": "6.240,00", "Sdo. Devedor": "6.240,00", "Multa": "1.248,00", "Juros": "267,36", "Sdo. Dev. Cons.": "7.755,36", "Situação": "DEVEDOR" },
                    ],
                    anotacoes: [], naoInterpretado: [],
                  },
                  {
                    titulo: "Pendência - Processo Fiscal (SIEF)",
                    descricao: [], colunas: ["Processo", "Situação", "Localização"],
                    registros: [{ "Processo": "10642.032.115/2026-17", "Situação": "DEVEDOR", "Localização": "SETOR PROC ELETRONICO REFIS-DRFRJ2-RJ" }],
                    anotacoes: [], naoInterpretado: [],
                  },
                  {
                    // ⚠ O BLOCO DO PARCELAMENTO (SIEFPAR) VIRA TABELA desde 17/08/2026 (decisão do
                    // dono). Ele não tem cabeçalho-e-dados: é rótulo/valor intercalado, e o parser
                    // o lê por PARES (`montarTabelaDePares`). Este mock reproduz a saída de lá.
                    // ⚠ "Parcelamento Simplificado" vem SOLTA no relatório, sem rótulo: não virou
                    // coluna (inventar o rótulo é proibido) e não sumiu — sai em `naoInterpretado`.
                    // ⚠ O número do parcelamento é FABRICADO (formato e comprimento reais).
                    titulo: "Pendência - Parcelamento (SIEFPAR)",
                    descricao: [],
                    colunas: ["Parcelamento", "Parcelas em Atraso", "Valor em Atraso"],
                    registros: [{
                      "Parcelamento": "0211.00012.0055566677.26-45",
                      "Parcelas em Atraso": "3",
                      "Valor em Atraso": "1.585,74",
                    }],
                    anotacoes: [], naoInterpretado: ["Parcelamento Simplificado"],
                  },
                  {
                    // O QUARTO ESTADO continua existindo e continua tendo dono: o bloco do
                    // PARCSN/PARCMEI traz UMA descrição livre e nenhum rótulo. Sem rótulo não há
                    // par — ele sai com o aviso, e é assim que a tela tem de mostrá-lo.
                    titulo: "Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)",
                    descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"],
                    colunas: [], registros: [], anotacoes: [], naoInterpretado: [],
                  },
                  {
                    titulo: "Pendência - Bloco de exemplo (ilegível)",
                    descricao: [], colunas: [], registros: [], anotacoes: [],
                    naoInterpretado: ["LINHA SOLTA A", "LINHA SOLTA B"],
                  },
                ],
              },
              { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: true, blocos: [] },
            ],
            naoInterpretado: [],
            temTexto: true,
          },
          // Sem PDF no mock → dá pra conferir que a tabela aparece SEM depender do PDF.
          relatorioPdfFileId: null,
          protocolo: null,
          podeConsultar: true,
          proximaConsultaEm: null,
        },
      };
    },
    async listFiscalPendencias() {
      await delay();
      return { items: mockCompanies.map((c) => ({ companyId: c.companyId, razao: c.razao, cnpj: c.cnpj, situacao: null, checkedAt: null, protocolo: null, relatorioPdfFileId: null })) };
    },
    async fetchSitfisPdfBlob() {
      await delay();
      const tinyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
      return new Blob([tinyPdf], { type: "application/pdf" });
    },
    async fetchPgdasPdfBlob() {
      await delay();
      const tinyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
      return new Blob([tinyPdf], { type: "application/pdf" });
    },
    async runSerproPaymentConfirmation() {
      await delay(500);
      return { ok: true, result: { total: 0, paid: 0, open: 0, errors: 0, results: [] } };
    },
    // Rotinas: espelha o shape do GET /firm/rotinas (rotinas + agenda + empresas).
    async getRotinas() {
      await delay();
      return {
        ok: true,
        rotinas: [
          { key: "das", label: "DAS" },
          { key: "inss", label: "INSS" },
          { key: "extrato", label: "Extrato" },
          { key: "presumido", label: "Presumido" },
          { key: "parcelamento", label: "Parcelamento" },
          { key: "pagamento", label: "Pagamento" },
        ],
        agenda: {
          das: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          inss: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          extrato: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          presumido: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          parcelamento: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          pagamento: { enabled: true, day: 20, hour: 8, cron: "0 8 20-22 * *" },
        },
        empresas: mockCompanies.map((c, i) => ({
          companyId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          status: "ATIVA",
          regime: i % 3 === 0 ? "LUCRO_PRESUMIDO" : "SIMPLES",
          rotinas: i % 3 === 0
            ? { das: false, inss: true, extrato: false, presumido: true, parcelamento: false, pagamento: true }
            : { das: true, inss: true, extrato: true, presumido: false, parcelamento: true, pagamento: true },
        })),
      };
    },
    async saveRotinas(input = {}) {
      await delay(400);
      const atualizadas = Array.isArray(input.empresas)
        ? input.empresas.reduce((s, e) => s + Object.keys(e.rotinas || {}).length, 0)
        : 0;
      return { ok: true, atualizadas, agenda: input.agenda || {} };
    },
    async runSerproCron(input = {}) {
      await delay(800);
      const competencia = String(input.competencia || "2026-04");
      return {
        ok: true,
        competencia,
        durationMs: 812,
        pgdasd: {
          ok: true,
          summary: { totalCompanies: 4, captured: 3, failed: 0, skippedByProcuration: 1, durationMs: 612 },
        },
        dctfweb: {
          ok: true,
          summary: { totalCompanies: 4, captured: 2, failed: 0, skippedByProcuration: 1, durationMs: 198 },
        },
      };
    },
    async uploadGuides(files) {
      await delay(700);
      const normalizedFiles = Array.isArray(files) ? files : [];
      const items = normalizedFiles.map((file) => {
        const fileName = String(file?.name || "guia.pdf");
        const identified = faker.datatype.boolean({ probability: 0.7 });
        if (!identified) {
          const pending = {
            guideId: faker.string.uuid(),
            fileName,
            hash: faker.string.hexadecimal({ length: 24, prefix: "" }),
            cnpj: faker.helpers.replaceSymbols("##############"),
            competencia: `2026-${String(faker.number.int({ min: 1, max: 12 })).padStart(2, "0")}`,
            tipo: faker.helpers.arrayElement(["SIMPLES", "INSS", "FGTS", "OUTRA"]),
            valor: Number(faker.finance.amount({ min: 120, max: 9500, dec: 2 })),
            vencimento: new Date().toISOString(),
            status: "ERROR",
            code: "GUIDE_NOT_PROCESSED",
            reason: "company_not_found_by_cnpj",
            message: "Não encontramos uma empresa cadastrada para o CNPJ extraído desta guia.",
            rawTextSample: faker.lorem.paragraph(),
            fields: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          mockUnidentifiedGuides.unshift(pending);
          return {
            status: "ERROR",
            guideId: pending.guideId,
            fileName,
            code: pending.code,
            reason: pending.reason,
            message: pending.message,
            extracted: {
              cnpj: pending.cnpj,
              competencia: pending.competencia,
              tipo: pending.tipo,
              valor: pending.valor,
              vencimento: pending.vencimento,
            },
          };
        }

        const company = faker.helpers.arrayElement(mockCompanies);
        const guideId = faker.string.uuid();
        const emailSent = faker.datatype.boolean({ probability: 0.8 });
        const guide = {
          id: guideId,
          portalClientId: company.companyId,
          tipo: faker.helpers.arrayElement(["SIMPLES", "INSS", "FGTS"]),
          competencia: `2026-${String(faker.number.int({ min: 1, max: 12 })).padStart(2, "0")}`,
          valor: faker.finance.amount({ min: 120, max: 9500, dec: 2 }),
          status: "PROCESSED",
          emailStatus: emailSent ? "SENT" : "ERROR",
          emailLastError: emailSent ? null : "smtp_mock_error",
        };
        const list = mockGuidesByCompany.get(company.companyId) || [];
        list.unshift(guide);
        mockGuidesByCompany.set(company.companyId, list);

        return {
          status: "PROCESSED",
          guideId,
          companyId: company.companyId,
          fileName,
          message: "Guia processada e salva com sucesso.",
          extracted: {
            cnpj: company.cnpj,
            competencia: guide.competencia,
            tipo: guide.tipo,
            valor: Number(guide.valor),
          },
          email: emailSent
            ? {
                status: "SENT",
                message: "Guia processada e e-mail enviado com sucesso.",
              }
            : {
                status: "ERROR",
                message: "A guia foi processada, mas o e-mail não pôde ser enviado.",
              },
        };
      });

      return {
        ok: true,
        result: {
          total: normalizedFiles.length,
          processed: items.filter((item) => item.status === "PROCESSED").length,
          errors: items.filter((item) => item.status === "ERROR").length,
          skipped: items.filter((item) => item.status === "SKIPPED").length,
          sent: items.filter((item) => item.email?.status === "SENT").length,
          failedToSend: items.filter((item) => item.email?.status === "ERROR").length,
          emailDispatch: {
            attempted: true,
            skipped: false,
            reason: null,
            message: null,
          },
          items,
        },
      };
    },
    async getUnidentifiedGuides() {
      await delay(250);
      return {
        data: [...mockUnidentifiedGuides],
        page: 1,
        limit: mockUnidentifiedGuides.length || 25,
        total: mockUnidentifiedGuides.length,
      };
    },
    async getPendingGuidesReport() {
      await delay(300);
      const data = [];
      for (const company of mockCompanies) {
        const companyGuides = mockGuidesByCompany.get(company.companyId) || [];
        for (const guide of companyGuides) {
          if (!["PENDING", "ERROR", "SENDING"].includes(String(guide.emailStatus || "").toUpperCase())) {
            continue;
          }
          data.push({
            guideId: guide.id,
            companyId: company.companyId,
            companyName: company.razao,
            cnpj: company.cnpj,
            tipo: guide.tipo,
            competencia: guide.competencia,
            valor: Number(guide.valor),
            vencimento: null,
            status: guide.status,
            // Espelha `toPendingGuideReportItem`: sem estes campos a parcela se chamaria "SIMPLES"
            // aqui e "PARCSN Nº … · 3/10" na aba Guias — a mesma guia com dois nomes.
            parcelamentoId: guide.parcelamentoId || null,
            numeroParcela: guide.numeroParcela ?? null,
            quantidadeParcelas: guide.quantidadeParcelas ?? null,
            parcelamentoTipo: guide.parcelamentoTipo || null,
            parcelamentoNumero: guide.parcelamentoNumero || null,
            emailStatus: guide.emailStatus,
            emailAttempts: faker.number.int({ min: 0, max: 3 }),
            emailLastError: guide.emailStatus === "ERROR" ? "smtp_timeout" : null,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return {
        data,
        page: 1,
        limit: data.length || 25,
        total: data.length,
      };
    },
    async sendSelectedPendingEmails(guideIds) {
      await delay(500);
      const normalized = [...new Set((Array.isArray(guideIds) ? guideIds : []).map((id) => String(id)))];
      let sent = 0;
      let failed = 0;
      const items = [];
      for (const id of normalized) {
        let found = false;
        for (const guides of mockGuidesByCompany.values()) {
          const target = guides.find((item) => item.id === id);
          if (!target) continue;
          found = true;
          const fail = faker.datatype.boolean({ probability: 0.2 });
          if (fail) {
            target.emailStatus = "ERROR";
            failed += 1;
            items.push({
              guideId: id,
              status: "ERROR",
              reason: "smtp_mock_error",
              code: "GUIDE_EMAIL_SEND_ERROR",
              willRetry: true,
            });
          } else {
            target.emailStatus = "SENT";
            sent += 1;
            items.push({
              guideId: id,
              status: "SENT",
              to: faker.internet.email().toLowerCase(),
            });
          }
          break;
        }
        if (!found) {
          failed += 1;
          items.push({
            guideId: id,
            status: "ERROR",
            reason: "guide_not_found_or_not_processed",
            code: "GUIDE_NOT_FOUND_OR_NOT_PROCESSED",
            willRetry: false,
          });
        }
      }
      return {
        ok: true,
        result: {
          totalRequested: normalized.length,
          sent,
          failed,
          items,
        },
      };
    },

    // ── Plano de Contas (mock) ─────────────────────────────────────────────
    async getChartOfAccounts(companyId) {
      await delay();
      return mockChartOfAccounts.get(companyId) || [];
    },
    async createChartOfAccount(companyId, input) {
      await delay();
      const list = mockChartOfAccounts.get(companyId) || [];
      if (list.find((a) => a.codigo === input.codigo)) throw new Error("codigo_ja_existe");
      const account = {
        id: faker.string.uuid(),
        portalClientId: companyId,
        codigo: String(input.codigo),
        nome: String(input.nome),
        tipo: String(input.tipo || "DESPESA").toUpperCase(),
        natureza: String(input.natureza || "DEVEDORA").toUpperCase(),
        codigoCompleto: String(input.codigoCompleto || "").trim() || null,
        status: "PENDENTE_ERP",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(account);
      // ⚠ A derivação é do ESCOPO, não da linha: a conta nova pode ser a FILHA que torna outra
      // sintética. É o que o backend faz (`rederivarAnaliticaDoEscopo`).
      const derivada = _derivarAnaliticaMock(list);
      mockChartOfAccounts.set(companyId, derivada);
      return { ok: true, account: derivada.find((a) => a.id === account.id) };
    },
    async updateChartOfAccount(companyId, codigo, input) {
      await delay();
      const list = mockChartOfAccounts.get(companyId) || [];
      const idx = list.findIndex((a) => a.codigo === codigo);
      if (idx < 0) throw new Error("conta_nao_encontrada");
      // ⚠ `codigo` NÃO entra: os lançamentos apontam para ele em texto, sem FK.
      const { codigo: _ignorado, ...patch } = input || {};
      if (patch.codigoCompleto !== undefined) patch.codigoCompleto = String(patch.codigoCompleto).trim() || null;
      list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
      const derivada = _derivarAnaliticaMock(list);
      mockChartOfAccounts.set(companyId, derivada);
      return { ok: true, account: derivada[idx] };
    },
    async deleteChartOfAccount(companyId, codigo) {
      await delay();
      const list = mockChartOfAccounts.get(companyId) || [];
      // Excluir a ÚLTIMA filha devolve a mãe à condição de analítica — por isso re-deriva.
      mockChartOfAccounts.set(companyId, _derivarAnaliticaMock(list.filter((a) => a.codigo !== codigo)));
      return { ok: true };
    },
    async importChartOfAccountsFile() {
      await delay(600);
      // ⚠ O contrato do import cresceu: `mantidas` (contas do banco fora do arquivo, que são
      // PRESERVADAS) e `semCodigoCompleto` são RELATÓRIO, não enfeite — sem eles um import parcial
      // fica indistinguível de um completo. O mock os devolve para a tela poder mostrá-los.
      return { ok: true, created: 0, skipped: 0, errors: [], novas: 0, atualizadas: 0, mantidas: 0, mantidasCodigos: [], semCodigoCompleto: 0 };
    },

    // ── Plano de Contas GLOBAL (mock) ──────────────────────────────────────
    //
    // Espelho de `/firm/chart-of-accounts/global*`. Sem estas seis, a `GlobalChartOfAccountsPage`
    // não abre no modo mock — e ela é justamente a tela onde o arquivo do ERP com a conta mãe é
    // importado.
    async getGlobalChartOfAccounts() {
      await delay();
      // ⚠ `scope` é DERIVADO na leitura, como na rota real: o que está guardado é
      // `portalClientId: null`. Gravá-lo no registro daria duas fontes para o mesmo fato.
      return mockGlobalChartOfAccounts.map((a) => ({ ...a, scope: "GLOBAL" }));
    },
    async getGlobalChartStatus() {
      await delay();
      // Formato de `GET /firm/chart-of-accounts/global/status` (`getGlobalChartStatus` no backend):
      // conta os tipos PRESENTES e reporta os que faltam para o mínimo obrigatório.
      const tiposPresentes = [
        ...new Set(mockGlobalChartOfAccounts.map((a) => String(a.tipo || "").toUpperCase()).filter(Boolean)),
      ];
      const tiposFaltantes = REQUIRED_GLOBAL_TIPOS_MOCK.filter((t) => !tiposPresentes.includes(t));
      return {
        ok: true,
        isConfigured: tiposFaltantes.length === 0,
        totalAccounts: mockGlobalChartOfAccounts.length,
        tiposPresentes,
        tiposFaltantes,
      };
    },
    async createGlobalChartOfAccount(input) {
      await delay();
      if (mockGlobalChartOfAccounts.find((a) => a.codigo === String(input.codigo))) {
        throw new Error("codigo_ja_existe");
      }
      const account = {
        id: faker.string.uuid(),
        portalClientId: null,
        codigo: String(input.codigo),
        nome: String(input.nome),
        tipo: String(input.tipo || "DESPESA").toUpperCase(),
        natureza: String(input.natureza || "DEVEDORA").toUpperCase(),
        codigoCompleto: String(input.codigoCompleto || "").trim() || null,
        status: "PENDENTE_ERP",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // ⚠ A derivação é do ESCOPO, não da linha: a conta nova pode ser a FILHA que torna outra
      // sintética. É o que o backend faz (`rederivarAnaliticaDoEscopo(null)`).
      mockGlobalChartOfAccounts = _derivarAnaliticaMock([...mockGlobalChartOfAccounts, account]);
      return { ok: true, account: mockGlobalChartOfAccounts.find((a) => a.id === account.id) };
    },
    async updateGlobalChartOfAccount(codigo, input) {
      await delay();
      const idx = mockGlobalChartOfAccounts.findIndex((a) => a.codigo === codigo);
      if (idx < 0) throw new Error("conta_nao_encontrada");
      // ⚠ `codigo` NÃO entra: os lançamentos apontam para ele em texto, sem FK.
      const { codigo: _ignorado, ...patch } = input || {};
      if (patch.codigoCompleto !== undefined) patch.codigoCompleto = String(patch.codigoCompleto).trim() || null;
      const lista = [...mockGlobalChartOfAccounts];
      lista[idx] = { ...lista[idx], ...patch, updatedAt: new Date().toISOString() };
      mockGlobalChartOfAccounts = _derivarAnaliticaMock(lista);
      return { ok: true, account: mockGlobalChartOfAccounts[idx] };
    },
    async deleteGlobalChartOfAccount(codigo) {
      await delay();
      if (!mockGlobalChartOfAccounts.some((a) => a.codigo === codigo)) throw new Error("conta_nao_encontrada");
      // Excluir a ÚLTIMA filha devolve a mãe à condição de analítica — por isso re-deriva.
      mockGlobalChartOfAccounts = _derivarAnaliticaMock(
        mockGlobalChartOfAccounts.filter((a) => a.codigo !== codigo)
      );
      return { ok: true };
    },
    async importGlobalChartOfAccountsFile() {
      await delay(600);
      /**
       * ⚠ O mock NÃO LÊ O ARQUIVO — parsear aqui seria uma segunda cópia do parser do ERP (que tem
       * a armadilha das duas colunas de código) vivendo no front. Então nada é criado, e TODA conta
       * que já está no plano cai no caso "estava no banco e não veio no arquivo": **mantida como
       * está**, exatamente a decisão do dono no import real.
       *
       * `mantidas` e `semCodigoCompleto` saem do estado real do mock, não de zeros fixos: são
       * RELATÓRIO, e é com eles na tela que se distingue um import parcial de um completo.
       */
      const mantidasCodigos = mockGlobalChartOfAccounts.map((a) => a.codigo);
      return {
        ok: true,
        created: 0,
        skipped: 0,
        errors: [],
        novas: 0,
        atualizadas: 0,
        mantidas: mantidasCodigos.length,
        // O backend corta em 20 — a lista é para a mensagem, não para conferência linha a linha.
        mantidasCodigos: mantidasCodigos.slice(0, 20),
        // ⚠ `analitica == null` é o "sem resposta" de `resumirDerivacao`, não `!analitica`:
        // `false` é SINTÉTICA, que é uma resposta.
        semCodigoCompleto: mockGlobalChartOfAccounts.filter((a) => a.analitica == null).length,
      };
    },

    // ── Lançamentos (mock) ─────────────────────────────────────────────────
    async getAccountingEntries(companyId, params = {}) {
      await delay();
      let list = mockEntriesByCompany.get(companyId) || [];
      if (params.competencia) list = list.filter((e) => e.competencia === params.competencia);
      if (params.tipo) list = list.filter((e) => e.tipo === params.tipo);
      if (params.subtipo) list = list.filter((e) => e.subtipo === params.subtipo);
      if (params.origem) list = list.filter((e) => e.origem === params.origem);
      if (params.status) list = list.filter((e) => e.status === params.status);
      if (params.statusPagamento) list = list.filter((e) => e.statusPagamento === params.statusPagamento);
      const page = Math.max(1, Number(params.page || 1));
      const limit = Math.min(200, Number(params.limit || 50));
      const paged = list.slice((page - 1) * limit, page * limit);
      return { data: paged, total: list.length, page, limit };
    },
    async createAccountingEntry(companyId, input) {
      await delay();
      const lines = Array.isArray(input.lines) ? input.lines : [];
      const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
      if (Math.abs(totalD - totalC) > 0.01) throw new Error("entry_nao_balanceada");
      // Lançamento NOVO: não há sintética preexistente a preservar, então qualquer uma recusa.
      const recusa = _recusaContaSinteticaMock(companyId, lines);
      if (recusa) throw recusa;
      const data = input.data ? new Date(input.data) : new Date();
      const entryId = faker.string.uuid();
      const entry = {
        id: entryId,
        portalClientId: companyId,
        data: data.toISOString(),
        competencia: `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`,
        historico: String(input.historico || ""),
        tipo: String(input.tipo || "DESPESA").toUpperCase(),
        subtipo: input.subtipo ? String(input.subtipo).toUpperCase() : null,
        origem: "MANUAL",
        loteImportacao: null,
        status: "RASCUNHO",
        statusPagamento: input.statusPagamento ? String(input.statusPagamento).toUpperCase() : "NA",
        openEntryId: null,
        lines: lines.map((l, idx) => ({
          id: faker.string.uuid(),
          entryId,
          conta: String(l.conta || ""),
          tipo: String(l.tipo || "D").toUpperCase(),
          valor: Number(l.valor || 0),
          ordem: idx,
        })),
        totalD,
        totalC,
        valor: totalD,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const list = mockEntriesByCompany.get(companyId) || [];
      list.push(entry);
      mockEntriesByCompany.set(companyId, list);

      // Auto-save do histórico no mock
      if (input.historico && lines.length > 0) {
        const compList = mockHistoricosByCompany.get(companyId) || [];
        const dLine = lines.find((l) => String(l.tipo || "").toUpperCase() === "D");
        const cLine = lines.find((l) => String(l.tipo || "").toUpperCase() === "C");
        const existing = compList.find((h) => h.text === input.historico && h.companyPortalClientId === companyId);
        if (existing) {
          existing.usageCount += 1;
        } else {
          compList.push({
            id: faker.string.uuid(), createdByUserId: "mock-user", companyPortalClientId: companyId,
            text: input.historico,
            contaDebito: dLine ? String(dLine.conta || "") : null,
            contaCredito: cLine ? String(cLine.conta || "") : null,
            usageCount: 1, scope: "COMPANY",
          });
        }
        mockHistoricosByCompany.set(companyId, compList);
      }

      return { ok: true, entry };
    },
    // Q52: folha/pró-labore — cada linha vira 1 entry individual (mesmo lote).
    async createFolhaEntries(companyId, payload = {}) {
      await delay();
      const subtipo = String(payload.subtipo || "FOLHA").toUpperCase() === "PROLABORE" ? "PROLABORE" : "FOLHA";
      const loteImportacao = `${subtipo}-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      const created = [];
      const mk = (data, historico, lines) => {
        const entryId = faker.string.uuid();
        const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        const entry = {
          id: entryId, portalClientId: companyId,
          data: new Date(data).toISOString(),
          competencia: String(payload.competencia || ""),
          historico, tipo: "FOLHA", subtipo, origem: "MANUAL", loteImportacao,
          status: "RASCUNHO", statusPagamento: "NA", openEntryId: null,
          lines: lines.map((l, idx) => ({ id: faker.string.uuid(), entryId, conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: idx })),
          totalD, totalC: lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0),
          valor: totalD,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        list.push(entry);
        created.push({ entryId, historico, valor: Number(lines[0]?.valor || 0) });
      };
      for (const p of payload.provisoes || []) mk(p.data, p.historico || subtipo, [p.line]);
      for (const b of payload.baixas || []) mk(b.data, b.historico || `PAGO ${subtipo}`, b.lines || []);
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, loteImportacao, created };
    },
    // ⚠ ESTA FUNÇÃO NÃO EXISTIA NO MOCK — mesmo defeito, mesma classe, do `getBaixaTemplate` logo
    // abaixo: `handleLoadPayrollTemplate` chamava `api.getPayrollTemplate` e o modo mock estourava
    // `TypeError`, que o `.catch` do `PayrollEntryModal` colocava CRU na tela no lugar da tabela.
    //
    // Espelha `GET /firm/companies/:id/payroll/template?kind=&competencia=` e
    // `resolvePayrollTemplate` — envelope `{ ok, template }`, os mesmos campos por linha, a mesma
    // resolução de conta por dicas (`PAYROLL_TEMPLATES_MOCK`, lá em cima) e o mesmo
    // `UNKNOWN_PAYROLL_KIND` para tipo desconhecido.
    async getPayrollTemplate(companyId, kind, competencia) {
      await delay();
      const chave = String(kind || "").toUpperCase();
      const template = PAYROLL_TEMPLATES_MOCK[chave];
      if (!template) {
        // O real responde 400 com este código; um mock que devolvesse `{template: null}` faria o
        // modal abrir vazio e sem motivo, que é o desfecho que este par existe para impedir.
        const err = new Error(`unknown_payroll_kind: ${kind}`);
        err.code = "UNKNOWN_PAYROLL_KIND";
        err.status = 400;
        throw err;
      }

      // Empresa + global, com a da empresa vencendo no mesmo código (o `byCodigo` do backend).
      const porCodigo = new Map();
      for (const acc of [...mockGlobalChartOfAccounts, ...(mockChartOfAccounts.get(companyId) || [])]) {
        const existente = porCodigo.get(acc.codigo);
        if (!existente || (acc.portalClientId && !existente.portalClientId)) porCodigo.set(acc.codigo, acc);
      }
      const accounts = [...porCodigo.values()];

      const lines = template.lines.map((line) => {
        const casada = _acharContaPorDicasMock(accounts, line.accountHints);
        return {
          side: line.side,
          role: line.role,
          label: line.label,
          // ⚠ `null` quando o plano não casa com nenhuma dica — é o que o real devolve, e é o que
          // faz o campo abrir vazio para o contador escolher. Preencher "a conta mais parecida"
          // seria o mock ensinando um comportamento que não existe.
          accountCode: casada?.codigo || null,
          accountName: casada?.nome || null,
          value: 0,
          historico: _payrollHistoricoMock(line.historicoTemplate || "", competencia),
        };
      });

      let baixa = null;
      if (template.baixa) {
        const liquida = lines.find((l) => l.role === template.baixa.debitFromRole);
        const credito = _acharContaPorDicasMock(accounts, template.baixa.creditAccountHints || []);
        baixa = {
          debitAccountCode: liquida?.accountCode || null,
          debitAccountName: liquida?.accountName || null,
          creditAccountCode: credito?.codigo || null,
          creditAccountName: credito?.nome || null,
          historico: _payrollHistoricoMock(template.baixa.historicoTemplate || "", competencia),
        };
      }

      // A guia de INSS da competência — o rodapé do modal mostra o valor dela. Sai das guias do
      // mock, com o MESMO filtro do real (tipo INSS + competência + PROCESSED); não havendo, é
      // `null`, que é o caso normal e não um erro.
      const guias = mockGuidesByCompany.get(companyId) || [];
      const inss = guias.find(
        (g) => String(g.tipo).toUpperCase() === "INSS"
          && String(g.competencia) === String(competencia)
          && String(g.status).toUpperCase() === "PROCESSED",
      );

      return {
        ok: true,
        template: {
          kind: chave,
          label: template.label,
          competencia: String(competencia),
          historicoTemplate: template.historicoTemplate,
          lines,
          baixa,
          inssGuide: inss
            ? {
                guideId: inss.id,
                valor: inss.valor != null ? Number(inss.valor) : null,
                vencimento: inss.vencimento || null,
                paymentStatus: inss.paymentStatus,
              }
            : null,
        },
      };
    },
    async updateAccountingEntry(companyId, entryId, input) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const idx = list.findIndex((e) => e.id === entryId);
      if (idx < 0) throw new Error("lancamento_nao_encontrado");
      const updated = { ...list[idx], updatedAt: new Date().toISOString() };
      if (input.data !== undefined) updated.data = input.data;
      if (input.historico !== undefined) updated.historico = input.historico;
      if (input.tipo !== undefined) updated.tipo = input.tipo;
      if (input.subtipo !== undefined) updated.subtipo = input.subtipo;
      if (input.status !== undefined) updated.status = input.status;
      if (input.statusPagamento !== undefined) updated.statusPagamento = input.statusPagamento;
      if (Array.isArray(input.lines)) {
        const totalD = input.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        const totalC = input.lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
        if (Math.abs(totalD - totalC) > 0.01) throw new Error("entry_nao_balanceada");
        // ⚠ Só o que a edição ACRESCENTA — a sintética que já estava no lançamento não bloqueia,
        // senão o lançamento errado ficaria preso no caminho que existe para corrigi-lo.
        const recusaEdicao = _recusaContaSinteticaMock(
          companyId, input.lines, (list[idx].lines || []).map((l) => l.conta),
        );
        if (recusaEdicao) throw recusaEdicao;
        updated.lines = input.lines.map((l, i) => ({
          id: faker.string.uuid(), entryId,
          conta: String(l.conta || ""), tipo: String(l.tipo || "D").toUpperCase(),
          valor: Number(l.valor || 0), ordem: i,
        }));
        updated.totalD = totalD;
        updated.totalC = totalC;
        updated.valor = totalD;
      }
      list[idx] = updated;
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, entry: list[idx] };
    },
    async deleteAccountingEntry(companyId, entryId) {
      await delay();
      let list = mockEntriesByCompany.get(companyId) || [];
      const target = list.find((e) => e.id === entryId);
      if (target?.tipo === "BAIXA" && target?.openEntryId) {
        list = list.map((e) =>
          e.id === target.openEntryId ? { ...e, statusPagamento: "ABERTO" } : e
        );
      }
      mockEntriesByCompany.set(companyId, list.filter((e) => e.id !== entryId));
      return { ok: true };
    },

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ESTORNO DA BAIXA — mock com os MESMOS códigos de recusa do backend
    // ═══════════════════════════════════════════════════════════════════════════════════════
    //
    // ⚠ Um mock que só conhece o caminho feliz esconde exatamente o que esta tela existe para
    // mostrar. As recusas são a razão de ser da confirmação: motivo curto, total divergente e mês
    // corrente fechado precisam CHEGAR À TELA com o motivo, e não há como conferir isso offline se
    // o mock sempre responde 200. Por isso as três estão aqui, com `err.code` igual ao do servidor.
    async previewEstornoBaixa(companyId, entryId) {
      await delay();
      return buildMockEstornoPreview(companyId, entryId);
    },
    async estornarBaixa(companyId, entryId, { motivo, totalConferido } = {}) {
      await delay();
      // ⚠ O MOTIVO É A PRIMEIRA COISA CHECADA, antes de qualquer leitura — igual ao serviço. E o
      // teste é sobre o texto APARADO: campo obrigatório que aceita espaço em branco não é
      // obrigatório.
      const motivoLimpo = String(motivo || "").trim();
      if (motivoLimpo.length < 5) {
        throw mockRecusa(
          "MOTIVO_OBRIGATORIO",
          "Informe o motivo do estorno (mínimo 5 caracteres). Desfazer uma baixa confirmada é o tipo de operação que alguém vai questionar meses depois.",
          { minimo: 5 },
        );
      }
      const preview = buildMockEstornoPreview(companyId, entryId);
      if (preview.bloqueios.length) {
        const b = preview.bloqueios[0];
        throw mockRecusa(b.code, b.message, { competencia: b.competencia });
      }
      if (totalConferido != null && Math.abs(Number(totalConferido) - preview.totalEstornado) > 0.01) {
        throw mockRecusa(
          "CONFERENCIA_DIVERGENTE",
          `O que está para ser estornado (R$ ${preview.totalEstornado.toFixed(2)}) não é o que foi confirmado (R$ ${Number(totalConferido).toFixed(2)}). A baixa mudou desde que a tela foi aberta — confira de novo.`,
          { totalEstornado: preview.totalEstornado, totalConferido: Number(totalConferido) },
        );
      }
      const feitos = mockEstornosFeitos.get(companyId) || new Set();
      for (const l of MOCK_ESTORNO_LOTE) feitos.add(l.id);
      mockEstornosFeitos.set(companyId, feitos);
      return {
        ok: true,
        modo: preview.modo,
        motivo: motivoLimpo,
        estornoIds: MOCK_ESTORNO_LOTE.map((l) => `estorno-${l.id}`),
        lancamentosDesfeitos: preview.lancamentos,
        totalEstornado: preview.totalEstornado,
        contraLancamentos: preview.modo === "CONTRA_LANCAMENTO"
          ? preview.lancamentos.map((l) => ({ id: `espelho-${l.id}`, historico: `ESTORNO ${l.historico} (${l.competencia})`, competencia: preview.competenciaContraLancamento }))
          : [],
        competenciaContraLancamento: preview.competenciaContraLancamento,
        guia: { id: MOCK_ESTORNO_GUIA_ID, baixada: false, parcelaEstado: "ESTORNADA", paymentStatus: "OPEN" },
        parcelaEstadoAnterior: "CONFIRMADA",
        parcelaEstadoNovo: "ESTORNADA",
        recalculo: { risco: { nivel: "BAIXO", emAtraso: 0 } },
      };
    },
    // ⚠ ESTA FUNÇÃO NÃO EXISTIA NO MOCK, e é por isso que o defeito da baixa da Circular não se
    // reproduzia offline. `handleLoadBaixaTemplate` chama `api.getBaixaTemplate`; sem par no mock a
    // chamada estourava `TypeError`, engolido pelo `.catch(() => {})` do `BaixaModal` — resultado:
    // no mock o modal NUNCA recebia `saldoInfo` nem `acrescimo`, nunca pré-preenchia nada, e a
    // divergência entre o valor proposto e o saldo da provisão era **inalcançável**.
    // "Toda feature nova precisa de entrada no `mockApi.js`" — esta ficou de fora.
    //
    // Espelha `GET /firm/companies/:id/entries/:entryId/baixa-template`, inclusive no cálculo do
    // saldo: principal = débitos da provisão; abatido = débitos NÃO-acréscimo das baixas penduradas
    // (juros 501 / multa 506 são despesa, não amortização).
    async getBaixaTemplate(companyId, entryId) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const entry = list.find((e) => e.id === entryId);
      if (!entry) throw new Error("lancamento_nao_encontrado");

      const CONTAS_ACRESCIMO = new Set(["501", "506"]);
      const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
      const principal = r2((entry.lines || [])
        .filter((l) => l.tipo === "D")
        .reduce((s, l) => s + Number(l.valor || 0), 0));
      const penduradas = list.filter((e) => e.openEntryId === entryId);
      const baixas = penduradas.filter((e) => String(e.tipo).toUpperCase() !== "ESTORNO");
      const estornos = penduradas.filter((e) => String(e.tipo).toUpperCase() === "ESTORNO");
      const somaLado = (es, lado) => es
        .flatMap((e) => e.lines || [])
        .filter((l) => String(l.tipo).toUpperCase() === lado && !CONTAS_ACRESCIMO.has(String(l.conta).trim()))
        .reduce((s, l) => s + Number(l.valor || 0), 0);
      const abatido = r2(Math.max(0, somaLado(baixas, "D") - somaLado(estornos, "C")));
      const saldoRaw = r2(principal - abatido);
      const saldoInfo = {
        principal,
        abatido,
        saldo: saldoRaw > 0 ? saldoRaw : 0,
        quotasPagas: Math.max(0, baixas.length - estornos.length),
      };
      const quotaNumero = saldoInfo.quotasPagas + 1;

      // Sem regra nem memória o real devolve `template: null` e o modal inverte as linhas da
      // provisão — o mock repete isso em vez de inventar contas.
      if (!entry.lines?.length) {
        return { ok: true, template: null, acrescimo: null, saldoInfo, quotaNumero, reason: "sem_memoria_nem_regra" };
      }
      const debito = entry.lines.find((l) => l.tipo === "D");
      const credito = entry.lines.find((l) => l.tipo === "C");
      return {
        ok: true,
        acrescimo: null,
        saldoInfo,
        quotaNumero,
        template: {
          eventType: entry.eventType || null,
          // A baixa é a contrapartida: debita o que a provisão creditou, e vice-versa.
          debitAccountCode: credito?.conta || "",
          creditAccountCode: debito?.conta || "",
          historico: `PAGAMENTO ${entry.subtipo || "PROVISÃO"} - ${entry.competencia}`,
          // ⚠ O SALDO, não o principal cheio — é o que o real sugere na baixa parcial por quota.
          valor: saldoInfo.saldo > 0 ? saldoInfo.saldo : saldoInfo.principal,
          ruleId: null,
          scope: "FALLBACK",
        },
      };
    },
    async createBaixa(companyId, entryId, { data, historico, lines }) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const openIdx = list.findIndex((e) => e.id === entryId);
      if (openIdx < 0) throw new Error("lancamento_nao_encontrado");
      if (list[openIdx].statusPagamento !== "ABERTO") throw new Error("lancamento_nao_esta_aberto");
      const linesArr = Array.isArray(lines) ? lines : [];
      const totalD = linesArr.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalC = linesArr.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
      if (Math.abs(totalD - totalC) > 0.01) throw new Error("entry_nao_balanceada");
      // ⚠ A RECUSA QUE FALTAVA AQUI — e um mock que só sabe aceitar esconde exatamente o que a tela
      // existe para mostrar (mesmo argumento do detector de divergência de fonte, acima).
      // O real recusa com 400 `baixa_excede_saldo` quando o principal desta baixa passa do saldo da
      // provisão; a soma é por CONTA (501/506 fora), igual ao servidor. Foi essa recusa, invisível,
      // que produziu "a baixa da junho do Simples não está funcionando".
      const CONTAS_ACRESCIMO_BAIXA = new Set(["501", "506"]);
      const principalDestaBaixa = Math.round(linesArr
        .filter((l) => String(l.tipo).toUpperCase() === "D" && !CONTAS_ACRESCIMO_BAIXA.has(String(l.conta ?? "").trim()))
        .reduce((s, l) => s + Number(String(l.valor ?? "").replace(",", ".") || 0), 0) * 100) / 100;
      const saldoProvisao = Math.round((list[openIdx].lines || [])
        .filter((l) => l.tipo === "D")
        .reduce((s, l) => s + Number(l.valor || 0), 0) * 100) / 100;
      if (principalDestaBaixa - saldoProvisao > 0.01) {
        const err = new Error(
          `A baixa (principal R$ ${principalDestaBaixa.toFixed(2)}) excede o saldo da provisão `
          + `(R$ ${saldoProvisao.toFixed(2)}).`,
        );
        err.code = "baixa_excede_saldo";
        err.status = 400;
        throw err;
      }
      const baixaId = faker.string.uuid();
      const dt = data ? new Date(data) : new Date();
      const baixa = {
        id: baixaId,
        portalClientId: companyId,
        data: dt.toISOString(),
        competencia: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`,
        historico: String(historico || ""),
        tipo: "BAIXA",
        subtipo: null,
        origem: "MANUAL",
        loteImportacao: null,
        status: "CONFIRMADO",
        statusPagamento: "NA",
        openEntryId: entryId,
        lines: linesArr.map((l, i) => ({
          id: faker.string.uuid(), entryId: baixaId,
          conta: String(l.conta || ""), tipo: String(l.tipo || "D").toUpperCase(),
          valor: Number(l.valor || 0), ordem: i,
        })),
        totalD, totalC, valor: totalD,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      list.push(baixa);
      list[openIdx] = { ...list[openIdx], statusPagamento: "PAGO", updatedAt: new Date().toISOString() };
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, entry: baixa, openEntry: list[openIdx] };
    },
    // Q47: baixa do INSS (guia sintética) — stubs para o modo mock.
    async getInssBaixaTemplate() {
      await delay();
      return { ok: true, template: null, reason: "mock" };
    },
    async saveInssBaixa() {
      await delay();
      return { ok: true, inssBaixa: { ok: true } };
    },
    // ⚠ `createParcelamentoSimples` FOI REMOVIDA (F2.3), junto da rota
    // `POST /firm/companies/:id/entries/parcelamento` que ela espelhava. O par mock/real precisa
    // sumir junto: um mock que continua respondendo `ok:true` para uma rota que o backend removeu
    // é a forma mais eficiente de esconder um 404 até a produção.
    async getBatchEmailReport(competencia) {
      await delay(200);
      const ref = competencia || "2026-04";
      // Gera dataset mock baseado nas empresas mockadas. Cada empresa simula um regime.
      const REGIMES = ["SIMPLES", "LUCRO_PRESUMIDO"];
      const simples = [];
      const presumidos = [];
      mockCompanies.forEach((c, idx) => {
        const regime = REGIMES[idx % REGIMES.length];
        const row = {
          portalClientId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          regimeTributario: regime,
          tiposGuias: {
            DAS: null, INSS: null, IRPJ: null, CSLL: null,
            PIS_COFINS: null, ISS: null, FGTS: null, PARC_DAS: null,
          },
          pendingGuideIds: [],
        };
        // Aleatoriamente "captura" 0-3 guias do regime correspondente
        const captured = faker.helpers.arrayElement([0, 1, 2, 2, 3]);
        if (regime === "SIMPLES") {
          if (captured >= 1) row.tiposGuias.DAS = { guideId: faker.string.uuid(), valor: 500 };
          // ⚠ Uma em cada cinco empresas tem o INSS em ERROR, com o motivo. A célula "✖ falhou" e a
          // faixa de aviso do topo não têm como ser conferidas num mock em que todo envio ou está
          // pendente ou já saiu — e era assim que a matriz pintava ERROR igual a PENDING.
          if (captured >= 2) {
            const falhou = idx % 5 === 2;
            row.tiposGuias.INSS = falhou
              ? {
                guideId: faker.string.uuid(), valor: 250, emailStatus: "ERROR", falhou: true,
                emailAttempts: 2, emailLastError: "connect ETIMEDOUT smtp.gmail.com:465",
              }
              : { guideId: faker.string.uuid(), valor: 250 };
          }
          // A coluna PARC carrega DOIS conteúdos e o mock precisa dos dois: guia de parcela
          // capturada (com PDF — ENVIÁVEL, entra em pendingGuideIds) e rastreio do parcelamento
          // sem documento (só informa). Enquanto o mock só tinha o segundo, a regressão que fazia a
          // parcela sumir do envio em lote não aparecia em lugar nenhum.
          if (idx % 4 === 0) {
            row.tiposGuias.PARC_DAS = { entryId: faker.string.uuid(), isParcelamento: true };
          } else if (idx % 4 === 1) {
            const parcelaId = faker.string.uuid();
            row.tiposGuias.PARC_DAS = { guideId: parcelaId, valor: 320, emailStatus: "PENDING" };
            row.pendingGuideIds.push(parcelaId);
          }
          simples.push(row);
        } else {
          if (captured >= 1) row.tiposGuias.IRPJ = { guideId: faker.string.uuid(), valor: 800 };
          if (captured >= 2) row.tiposGuias.CSLL = { guideId: faker.string.uuid(), valor: 400 };
          if (captured >= 3) row.tiposGuias.PIS_COFINS = { guideId: faker.string.uuid(), valor: 350 };
          if (idx % 3 === 0) row.tiposGuias.ISS = { guideId: faker.string.uuid(), valor: 200 };
          if (idx % 2 === 0) row.tiposGuias.INSS = { guideId: faker.string.uuid(), valor: 250 };
          presumidos.push(row);
        }
      });
      return { competencia: ref, simples, presumidos, outros: [] };
    },
    async sendBatchEmails(items) {
      await delay(800);
      return {
        ok: true,
        total: items.length,
        sent: items.length,
        results: items.map((it) => ({
          portalClientId: it.portalClientId, competencia: it.competencia,
          ok: true, status: "sent", sentNow: 2, attachmentsCount: 2,
        })),
      };
    },
    async getCircular(companyId, { year } = {}) {
      await delay();
      const y = year || new Date().getFullYear();
      const meses = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
      const list = mockEntriesByCompany.get(companyId) || [];
      const provisoes = list.filter(
        (e) => e.tipo === "PROVISAO" && ["ABERTO", "PAGO"].includes(e.statusPagamento) && meses.includes(e.competencia)
      );
      const receitas = {};
      for (const e of list.filter((e) => e.tipo === "RECEITA" && meses.includes(e.competencia))) {
        const total = (e.lines || []).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        receitas[e.competencia] = (receitas[e.competencia] || 0) + total;
      }
      // Fixture: uma provisão ABERTA garante o botão "Dar baixa" no mock (o modal de baixa só
      // aparece a partir dela). Sem isso não dá pra conferir o modal sem backend.
      //
      // ⚠ São DUAS abertas, com vencimentos opostos de propósito: uma já vencida e uma ainda no
      // prazo. A distinção "vencida × a vencer" é a mudança central da Circular, e com uma única
      // fixture (ou com guias sem `vencimento`) ela seria invisível offline — o mock mostraria a
      // tela antiga e passaria a impressão de que nada mudou.
      if (provisoes.length === 0) {
        const hoje = new Date();
        const diasAtras = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n).toISOString();
        const daquiA = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n).toISOString();
        provisoes.push({
          id: "mock-provisao-das",
          competencia: meses[5],
          tipo: "PROVISAO",
          subtipo: "DAS",
          eventType: "DAS_SIMPLES",
          statusPagamento: "ABERTO",
          valor: 1234.56,
          totalD: 1234.56,
          totalC: 1234.56,
          lines: [
            { conta: "265", tipo: "D", valor: 1234.56, ordem: 0 },
            { conta: "553", tipo: "C", valor: 1234.56, ordem: 1 },
          ],
          baixas: [],
          // Vencida há 12 dias e JÁ ENVIADA por WhatsApp — exercita o vermelho com contagem de
          // atraso e a linha "Enviada ao cliente" saindo de `envios`, não de `emailStatus`.
          sourceGuide: {
            id: "mock-guia-das", tipo: "DAS", vencimento: diasAtras(12),
            paymentStatus: "OPEN", emailStatus: "PENDING",
            envios: [{ canal: "WHATSAPP", status: "entregue", destino: "5521999998888", enviadoEm: diasAtras(14), entregueEm: diasAtras(14) }],
          },
        });
        provisoes.push({
          id: "mock-provisao-inss",
          competencia: meses[6],
          tipo: "PROVISAO",
          subtipo: "INSS",
          eventType: "INSS",
          statusPagamento: "ABERTO",
          valor: 487.3,
          totalD: 487.3,
          totalC: 487.3,
          lines: [
            { conta: "240", tipo: "D", valor: 487.3, ordem: 0 },
            { conta: "553", tipo: "C", valor: 487.3, ordem: 1 },
          ],
          baixas: [],
          // Ainda no prazo e NÃO enviada — o âmbar "A vencer · dd/mm" e o "ainda não" do envio.
          sourceGuide: {
            id: "mock-guia-inss", tipo: "INSS", vencimento: daquiA(9),
            paymentStatus: "OPEN", emailStatus: "PENDING", envios: [],
          },
        });

        // ⚠ PIS e COFINS da MESMA competência, com VALORES DIFERENTES e vindos do MESMO DARF.
        // É a fixture que torna o defeito visível: enquanto os dois compartilhavam o subtipo
        // `PIS_COFINS`, a matriz (indexada por `subtipo__competencia`) descartava um deles — a
        // célula mostrava 1.100,00 OU 4.800,00, nunca os dois, e o "Total em aberto" somava 5.900,00.
        // Valores distintos de propósito: se voltarem a colidir, dá para ver QUAL sumiu.
        const darfLp = {
          id: "mock-guia-darf-lp", tipo: "OUTRA", vencimento: daquiA(11),
          paymentStatus: "OPEN", emailStatus: "PENDING", envios: [],
        };
        provisoes.push({
          id: "mock-provisao-pis",
          competencia: meses[6],
          tipo: "PROVISAO", subtipo: "PIS", eventType: "DARF_PIS",
          statusPagamento: "ABERTO",
          valor: 1100, totalD: 1100, totalC: 1100,
          lines: [
            { conta: "268", tipo: "D", valor: 1100, ordem: 0 },
            { conta: "553", tipo: "C", valor: 1100, ordem: 1 },
          ],
          baixas: [], sourceGuide: darfLp,
        });
        provisoes.push({
          id: "mock-provisao-cofins",
          competencia: meses[6],
          tipo: "PROVISAO", subtipo: "COFINS", eventType: "DARF_COFINS",
          statusPagamento: "ABERTO",
          valor: 4800, totalD: 4800, totalC: 4800,
          lines: [
            { conta: "269", tipo: "D", valor: 4800, ordem: 0 },
            { conta: "553", tipo: "C", valor: 4800, ordem: 1 },
          ],
          baixas: [], sourceGuide: darfLp,
        });
      }

      // ⚠ A PARCELA JÁ PAGA — a única fixture com `baixas`, e por isso a única célula que oferece
      // "↩ Desfazer baixa". Depois do estorno ela volta ABERTA, com a guia de novo `OPEN`: é o
      // aceite do fluxo ("a parcela volta para a fila") acontecendo de verdade offline, e não um
      // recarregamento que devolve a tela idêntica.
      //
      // ⚠ FORA do `if (provisoes.length === 0)` de propósito. As demais fixtures são um fallback
      // para empresa sem lançamento; esta cobre um FLUXO, e dentro do `if` ela desaparecia
      // exatamente nas empresas que têm dados — que são as que alguém abre para conferir.
      const compEstorno = mockEstornoCompetencia();
      if (meses.includes(compEstorno)) {
        const estornada = mockLoteJaEstornado(companyId);
        const hojeMenos = (n) => {
          const d = new Date();
          d.setDate(d.getDate() - n);
          return d.toISOString();
        };
        provisoes.push({
          id: MOCK_ESTORNO_PROVISAO_ID,
          competencia: compEstorno,
          tipo: "PROVISAO", subtipo: "DAS", eventType: "PARC_DAS_PAGAMENTO",
          statusPagamento: estornada ? "ABERTO" : "PAGO",
          valor: MOCK_ESTORNO_TOTAL, totalD: MOCK_ESTORNO_TOTAL, totalC: MOCK_ESTORNO_TOTAL,
          lines: [
            { conta: "553", tipo: "D", valor: MOCK_ESTORNO_TOTAL, ordem: 0 },
            { conta: "111", tipo: "C", valor: MOCK_ESTORNO_TOTAL, ordem: 1 },
          ],
          baixas: estornada ? [] : MOCK_ESTORNO_LOTE.map((l) => ({ id: l.id })),
          sourceGuide: {
            id: MOCK_ESTORNO_GUIA_ID, tipo: "DAS", vencimento: hojeMenos(20),
            paymentStatus: estornada ? "OPEN" : "PAID",
            paymentStatusSource: estornada ? null : "MANUAL",
            paymentConfirmedAt: estornada ? null : hojeMenos(18),
            emailStatus: "SENT", envios: [],
          },
        });
      }
      // ⚠ O mock NUNCA devolvia `extrato`, então a coluna "Extrato" da Circular (os PDFs da
      // declaração e do recibo do PGDAS-D) era invisível offline — não dava para conferir nem o
      // botão, nem o aviso de arquivo ausente, nem o selo "◌ zerado". Três meses cobrindo os três
      // casos que a tela precisa distinguir.
      const extrato = {
        [meses[3]]: { temDeclaracao: true, temRecibo: true, semFaturamento: false },
        [meses[4]]: { temDeclaracao: true, temRecibo: false, semFaturamento: true },
        [meses[5]]: { temDeclaracao: true, temRecibo: true, semFaturamento: false },
      };
      return { year: y, provisoes, receitas, extrato };
    },
    async getCircularAccountingEntries(companyId, competencia) {
      await delay();
      const circular = getCircularRecord(companyId, competencia);
      const list = mockEntriesByCompany.get(companyId) || [];
      const entries = list.filter((entry) => entry.competencia === competencia && entry.origem === "SERPRO");
      return { circular, entries, allEntries: entries };
    },
    async updateCircular(companyId, competencia, input = {}) {
      await delay();
      const receitaServicos = Number(input.receitaServicos ?? 0);
      const receitaVendas = Number(input.receitaVendas ?? 0);
      const receitaBruta = input.receitaBruta != null ? Number(input.receitaBruta) : receitaServicos + receitaVendas;
      const circular = {
        id: `mock-circular-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        receitaBruta,
        receitaServicos,
        receitaVendas,
        dasTotal: input.dasTotal ?? null,
        inssTotal: input.inssTotal ?? null,
        inssVencimento: input.inssVencimento ? new Date(input.inssVencimento).toISOString() : null,
        inssPdfFileId: input.inssPdfFileId || null,
        inssPdfUrl: input.inssPdfUrl || null,
        inssStatus: input.inssStatus || null,
        metadata: input.metadata || null,
        hasAccountingDivergence: false,
        accountingDivergenceMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(makeCircularKey(companyId, competencia), circular);
      synthesizeCircularEntries(companyId, circular);
      return { ok: true, circular, accounting: { ok: true, generatedEntries: [] } };
    },
    async syncPgdasCircular(companyId, competencia) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const receitaBruta = Number(faker.finance.amount({ min: 15000, max: 95000, dec: 2 }));
      const isServico = faker.datatype.boolean();
      const receitaServicos = isServico ? receitaBruta : 0;
      const receitaVendas = isServico ? 0 : receitaBruta;
      const dasTotal = Number(faker.finance.amount({ min: 800, max: 8000, dec: 2 }));
      const circular = {
        id: `mock-circular-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        receitaBruta,
        receitaServicos,
        receitaVendas,
        dasTotal,
        inssTotal: 0,
        pgdasNumeroDeclaracao: `${company.cnpj.replace(/\D/g, "").slice(0, 8)}${competencia.replace(/\D/g, "")}001`,
        pgdasDeclaracaoFileId: `mock-pgdas-declaracao-${companyId}-${competencia}.pdf`,
        pgdasDeclaracaoFileUrl: `file:///mock/${companyId}/${competencia}-pgdas-declaracao.pdf`,
        pgdasReciboFileId: `mock-pgdas-recibo-${companyId}-${competencia}.pdf`,
        pgdasReciboFileUrl: `file:///mock/${companyId}/${competencia}-pgdas-recibo.pdf`,
        receitaStatus: "SUCCESS",
        dasStatus: "SUCCESS",
        serproSyncStatus: "SUCCESS",
        serproLastSyncAt: new Date().toISOString(),
        serproLastError: null,
        metadata: {
          integrationSource: "SERPRO_PGDASD_DECLARACAO",
          sistema: "PGDASD",
          servico: "CONSULTIMADECREC14",
        },
        hasAccountingDivergence: false,
        accountingDivergenceMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(makeCircularKey(companyId, competencia), circular);
      synthesizeCircularEntries(companyId, circular);
      return { ok: true, result: { company: { id: companyId, razao: company.razao, cnpj: company.cnpj }, circular, accounting: { ok: true, generatedEntries: [] } } };
    },
    async approveAccountingEntry(companyId, entryId) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const idx = list.findIndex((entry) => entry.id === entryId);
      if (idx < 0) throw new Error("lancamento_nao_encontrado");
      list[idx] = { ...list[idx], status: "CONFIRMADO", updatedAt: new Date().toISOString() };
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, entry: list[idx] };
    },
    async previewOFX() {
      await delay(400);
      // Mock: parte das linhas vem com match (simulando histórico salvo), parte sem.
      const SAMPLE_DESCS = [
        { desc: "PAGAMENTO FORNECEDOR", match: { historicoSugerido: "Pagamento fornecedor", contaDebito: "411", contaCredito: "5", matchType: "exact", usageCount: 4, scope: "COMPANY" } },
        { desc: "TARIFA BANCARIA", match: { historicoSugerido: "Tarifa bancária", contaDebito: "425", contaCredito: "5", matchType: "exact", usageCount: 12, scope: "GLOBAL" } },
        { desc: "TED RECEBIDA CLIENTE XYZ 12345", match: null },
        { desc: "COMPRA CARTAO POSTO ABC", match: null },
        { desc: "DEBITO AUTOMATICO LUZ", match: { historicoSugerido: "Energia elétrica", contaDebito: "423", contaCredito: "5", matchType: "substring", usageCount: 2, scope: "COMPANY" } },
      ];
      const transactions = Array.from({ length: faker.number.int({ min: 3, max: 8 }) }).map((_, idx) => {
        const sample = faker.helpers.arrayElement(SAMPLE_DESCS);
        return {
          rowIndex: idx,
          fitId: faker.string.alphanumeric(12),
          trnType: "DEBIT",
          data: faker.date.recent({ days: 30 }).toISOString().slice(0, 10),
          descricaoOfx: sample.desc,
          valor: Number(faker.finance.amount({ min: 50, max: 5000, dec: 2 })),
          sinal: "DEBITO",
          match: sample.match,
        };
      });
      return { ok: true, transactions, total: transactions.length };
    },
    async importOFX(companyId, { transactions = [] } = {}) {
      await delay(600);
      const loteImportacao = `OFX-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      for (const t of transactions) {
        const data = t.data ? new Date(t.data) : new Date();
        const valor = Number(t.valor || 0);
        const entryId = faker.string.uuid();
        list.push({
          id: entryId,
          portalClientId: companyId,
          data: data.toISOString(),
          competencia: `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`,
          historico: t.historico || t.descricaoOfx || "",
          tipo: t.tipo || "DESPESA",
          subtipo: null,
          origem: "OFX",
          loteImportacao,
          status: "RASCUNHO",
          statusPagamento: "NA",
          openEntryId: null,
          lines: [
            { id: faker.string.uuid(), entryId, conta: t.contaDebito, tipo: "D", valor, ordem: 0 },
            { id: faker.string.uuid(), entryId, conta: t.contaCredito, tipo: "C", valor, ordem: 1 },
          ],
          totalD: valor, totalC: valor, valor,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, created: transactions.length, failed: 0, loteImportacao };
    },
    /**
     * ── Importação de Excel — o PAR do OFX acima ────────────────────────────────────────────
     *
     * ⚠ Estes dois só existiam no `realApi`, e por isso o modal era INCONFERÍVEL offline: o
     * "Pré-visualizar" morria em `api.previewExcelImport is not a function` e a tabela de revisão
     * — que é a tela inteira — nunca chegava a renderizar. No modo em que ela se desenvolve.
     *
     * A forma é a da rota (`POST /entries/import/excel`, `routes/firm/accountingEntries.js`):
     *   preview → `{ ok, transactions: [{ rowIndex, data, descricao, valor, match }], total }`
     *   commit  → `{ ok, created, failed, loteImportacao, details: { created[], failed[] } }`
     *
     * ⚠ `match` é o objeto INTEIRO de `findHistoricoMatches`, não só as duas contas que o
     * `renderImportExcelModal` lê hoje. Devolver `{matchType, contaDebito, contaCredito}` passaria
     * na tela de hoje e mentiria para a próxima que ler `usageCount` ou `scope` — é o mesmo motivo
     * pelo qual o `previewOFX` daqui de cima carrega o match completo.
     */
    async previewExcelImport(companyId, file) {
      await delay(400);
      // A rota devolve 400 `file_required` sem arquivo. O modal já barra antes, mas mock que
      // aceita o que o servidor recusa é uma recusa descoberta em produção.
      if (!file) throw mockRecusa("file_required", "Selecione um arquivo Excel.");

      // ⚠ O mock NÃO parseia a planilha (o `xlsx` é do backend) — o que ele espelha é o RESULTADO
      // do parse. Por isso as linhas são FIXAS, e não sorteadas como no OFX: elas cobrem de
      // propósito os três desfechos que a revisão desenha — casada exata, casada parcial (o
      // substring do backend) e pendente. Sorteio devolveria ora uma tela, ora outra.
      const AMOSTRA = [
        { descricao: "PAGO ALUGUEL", valor: 3200 },                    // exato   → 426 / 1
        { descricao: "PAGO CONTA DE ENERGIA CEMIG", valor: 418.77 },   // parcial → 464 / 5
        { descricao: "MERCADO CENTRAL", valor: 88 },                   // pendente
        { descricao: "TARIFA PACOTE DE SERVICOS", valor: 34.9 },       // pendente
        { descricao: "PAGO INTERNET", valor: 199.9 },                  // exato   → 465 / 5
        { descricao: "COMPRA DE MATERIAL DE ESCRITORIO", valor: 256.4 }, // pendente
      ];

      // ⚠ Datas no mês ANTERIOR, que é a competência com que a aba Lançamentos abre
      // (`competenciaPadrao`). Linhas fora dela seriam importadas e a lista continuaria vazia: o
      // modal diria "6 linhas importadas" e a tela atrás dele não mostraria nenhuma.
      const hoje = new Date();
      const mesAnterior = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - 1, 1));
      const diaDoMes = (d) =>
        `${mesAnterior.getUTCFullYear()}-${String(mesAnterior.getUTCMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

      const transactions = AMOSTRA.map((linha, i) => ({
        // `rowIndex` é a linha da PLANILHA (o parser conta do 0, e a 0 é o cabeçalho), não o
        // índice do array — é ele que volta no commit nomeando a linha que falhou.
        rowIndex: i + 1,
        data: diaDoMes(2 + i * 4),
        descricao: linha.descricao,
        valor: linha.valor,
        match: acharMatchDeHistorico(companyId, linha.descricao),
      }));
      return { ok: true, transactions, total: transactions.length };
    },
    /**
     * ⚠ A assinatura é a do real: um ARRAY de transações, **não** `{ transactions }` como o
     * `importOFX` logo acima. Os dois modais chamam diferente e o mock segue cada um.
     */
    async commitExcelImport(companyId, transactions) {
      await delay(600);
      const linhas = Array.isArray(transactions) ? transactions : [];
      if (!linhas.length) throw mockRecusa("transactions_required", "Nenhum lançamento para importar.");

      const loteImportacao = `EXCEL-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      const compList = mockHistoricosByCompany.get(companyId) || [];
      const created = [];
      const failed = [];

      for (const t of linhas) {
        const contaDebito = String(t.contaDebito || "").trim();
        const contaCredito = String(t.contaCredito || "").trim();
        const valor = Number(t.valor);
        const descricao = String(t.descricao || "").trim();
        const dataStr = String(t.data || "").slice(0, 10);
        // Mesma recusa da rota: importa com ≥1 conta preenchida; só pula quando as DUAS faltam
        // (a outra se aprende depois). `failed` é contagem E lista — a linha que ficou de fora
        // tem nome, senão "5 de 6" não diz qual.
        if ((!contaDebito && !contaCredito) || !descricao || !valor || !dataStr) {
          failed.push({ rowIndex: t.rowIndex, reason: "campos_obrigatorios" });
          continue;
        }
        const data = new Date(`${dataStr}T00:00:00.000Z`);
        if (Number.isNaN(data.getTime())) {
          failed.push({ rowIndex: t.rowIndex, reason: "data_invalida" });
          continue;
        }
        // ⚠ Mesma recusa POR LINHA da rota: conta de agregação não recebe lançamento (ECD, I250).
        // O lote não cai por causa dela — 1 linha errada não derruba 200 boas.
        const recusaLinha = _recusaContaSinteticaMock(companyId, [{ conta: contaDebito }, { conta: contaCredito }]);
        if (recusaLinha) {
          failed.push({ rowIndex: t.rowIndex, reason: "conta_sintetica", contas: recusaLinha.contas });
          continue;
        }

        const entryId = faker.string.uuid();
        list.push({
          id: entryId,
          portalClientId: companyId,
          data: data.toISOString(),
          competencia: `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`,
          historico: descricao,
          tipo: String(t.tipo || "DESPESA").toUpperCase(),
          subtipo: null,
          origem: "EXCEL",
          loteImportacao,
          status: "RASCUNHO",
          statusPagamento: "NA",
          openEntryId: null,
          lines: [
            { id: faker.string.uuid(), entryId, conta: contaDebito, tipo: "D", valor, ordem: 0 },
            { id: faker.string.uuid(), entryId, conta: contaCredito, tipo: "C", valor, ordem: 1 },
          ],
          totalD: valor, totalC: valor, valor,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        created.push({ rowIndex: t.rowIndex, entryId });

        // Auto-save do histórico, como `upsertHistoricoFromImport` faz no commit real (e com a
        // mesma condição: só com as DUAS contas). É o que a própria tela promete — "a partir dali
        // ficam memorizadas para próximos imports" —, e sem isso o segundo preview do mock
        // continuaria pendente, desmentindo a frase offline.
        if (contaDebito && contaCredito) {
          const existente = compList.find((h) => h.text === descricao);
          if (existente) {
            existente.usageCount += 1;
          } else {
            compList.push({
              id: faker.string.uuid(), createdByUserId: "mock-user", companyPortalClientId: companyId,
              text: descricao, contaDebito, contaCredito, usageCount: 1, scope: "COMPANY",
            });
          }
        }
      }

      mockEntriesByCompany.set(companyId, list);
      mockHistoricosByCompany.set(companyId, compList);
      return {
        ok: true,
        created: created.length,
        failed: failed.length,
        loteImportacao,
        details: { created, failed },
      };
    },
    /**
     * ⚠ CSV DE VERDADE, não `#mock-...`.
     * Devolvendo uma âncora falsa, `handleExportEntriesCsv` batia em `url.startsWith("#")` e
     * abortava com "não disponível no modo mock" — e junto com ele abortavam a marcação de
     * exportado, o feedback de quantos foram marcados e o alerta de reexportação. Ou seja: o ciclo
     * inteiro da exportação era inconferível offline, que é justamente onde ele se confere.
     * `data:` URL é buscável por `fetch` e vira blob igual à resposta do servidor.
     */
    /**
     * Relatório de resumo — calculado sobre os MESMOS lançamentos do mock.
     *
     * ⚠ Inclui a competência SEM lançamento com `semLancamento: true`, como o backend. Um mock que
     * devolvesse só os meses com movimento faria a série parecer contínua offline e esconderia
     * justamente o caso que a tela trata em separado (barra tracejada e "sem lançamento").
     */
    async getRelatorioResumo(companyId, de, ate) {
      await delay(160);
      const lista = (mockEntriesByCompany.get(companyId) || [])
        .filter((e) => e.competencia >= de && e.competencia <= ate)
        .filter((e) => String(e.tipo || "").toUpperCase() !== "PARCELA");
      const porComp = new Map();
      for (const e of lista) {
        if (!porComp.has(e.competencia)) porComp.set(e.competencia, { competencia: e.competencia, porTipo: {}, total: 0 });
        const b = porComp.get(e.competencia);
        const v = (e.lines || []).filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        const tipo = String(e.tipo || "OUTRO").toUpperCase();
        b.porTipo[tipo] = (b.porTipo[tipo] || 0) + v;
        b.total += v;
      }
      const linhas = [];
      let [ano, mes] = de.split("-").map(Number);
      const [af, mf] = ate.split("-").map(Number);
      while (ano < af || (ano === af && mes <= mf)) {
        const comp = `${ano}-${String(mes).padStart(2, "0")}`;
        linhas.push(porComp.get(comp) || { competencia: comp, porTipo: {}, total: 0, semLancamento: true });
        mes += 1; if (mes > 12) { mes = 1; ano += 1; }
      }
      return { ok: true, de, ate, linhas };
    },

    // ── Entrega por arquivo (EFD-Contribuições, ECD, ECF) ─────────────────
    async getEntregasObrigacao(companyId, tipo) {
      await delay(120);
      const entregas = [...mockEntregasObrigacao.values()]
        .filter((e) => e.portalClientId === companyId && e.tipo === tipo)
        .sort((a, b) => b.competencia.localeCompare(a.competencia));
      return { ok: true, tipo, entregas };
    },
    async salvarEntregaObrigacao(companyId, tipo, competencia, patch = {}) {
      await delay(180);
      const chave = `${companyId}|${tipo}|${competencia}`;
      const atual = mockEntregasObrigacao.get(chave) || { portalClientId: companyId, tipo, competencia };
      const novo = { ...atual };
      // ⚠ Mesma regra parcial da rota real: só o que veio é tocado. Se o mock zerasse os outros
      // campos, anexar o recibo apagaria o arquivo AQUI e não em produção — e o mock mentiria
      // sobre o próprio fluxo que existe para exercitar.
      for (const c of ["arquivoFileId", "arquivoNome", "reciboFileId", "reciboNome", "observacao"]) {
        if (patch[c] !== undefined) novo[c] = patch[c] || null;
      }
      if (patch.transmitida === true) novo.transmitidaEm = new Date().toISOString();
      if (patch.transmitida === false) novo.transmitidaEm = null;
      mockEntregasObrigacao.set(chave, novo);
      return { ok: true, entrega: novo };
    },

    getEntriesExportCsvUrl(companyId, params = {}) {
      const ini = params.competenciaInicio || params.competencia || "";
      const fim = params.competenciaFim || params.competencia || "";
      const lista = (mockEntriesByCompany.get(companyId) || [])
        .filter((e) => (!ini || e.competencia >= ini) && (!fim || e.competencia <= fim))
        .filter((e) => String(e.tipo || "").toUpperCase() !== "PARCELA");
      const linhas = ["Data;Debito;Credito;Historico;Valor"];
      for (const e of lista) {
        const d = (e.lines || []).find((l) => String(l.tipo).toUpperCase() === "D");
        const c = (e.lines || []).find((l) => String(l.tipo).toUpperCase() === "C");
        const valor = Number(d?.valor || c?.valor || 0).toFixed(2).replace(".", ",");
        linhas.push([e.data || "", d?.conta || "", c?.conta || "", String(e.historico || "").replace(/;/g, ","), valor].join(";"));
      }
      return `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${linhas.join("\n")}`)}`;
    },

    /**
     * Emissão de NFS-e no mock.
     *
     * ⚠ RECUSA COM AS MESMAS REGRAS DO VALIDADOR REAL (`validators/nfsePayload.js`). Um mock que
     * aceita tudo faz o wizard parecer pronto e esconde exatamente o que ele existe para evitar:
     * mandar para a prefeitura um payload que o servidor recusaria.
     *
     * Devolve `issued` — o caminho `pending` (prefeitura demorando) é real, mas simulá-lo aqui
     * exigiria inventar um relógio de retorno que não corresponde a nada.
     *
     * ⚠ RECUSA TAMBÉM SEM `totTrib.pTotTribSN`, e essa é a recusa que importa.
     * O `NfseService` declara toda empresa como `opSimpNac="3"` (Simples ME/EPP) e, sendo Simples,
     * exige o percentual: sem ele lança `MISSING_P_TOT_TRIB_SN`. O mock aceitava o payload sem o
     * campo — ou seja, o assistente parecia completo offline e falharia 100% das vezes no real,
     * com o erro chegando ao banco como `rejected` (rejeição fiscal) por não ser mapeado na rota.
     * Com a recusa aqui, dá para caminhar o caso de falta sem emitir nada em lugar nenhum.
     */
    async emitirNfse(payload) {
      await delay(400);
      // ⚠ SEM MUNICÍPIO EMISSOR NÃO SAI NADA — e o servidor recusa ANTES de qualquer coisa
      // (`NFSE_MUNICIPIO_NAO_CONFIGURADO`, em `resolverCLocEmi`): o código é o `cLocEmi` e entra no
      // `Id` da DPS. Sem esta recusa aqui, o caminho da empresa não configurada passaria offline —
      // e é exatamente ele que o assistente aprendeu a mostrar antes do clique.
      const empresa = mockCompanies.find((c) => c.companyId === payload?.companyId);
      if (empresa && !String(empresa.legacyCompany?.codigoMunicipioIbge || "").trim()) {
        throw new Error("nfse_municipio_nao_configurado");
      }
      // ⚠ E `buildMissingFields` recusa ANTES DE TUDO — antes até do certificado. Estes três campos
      // existiam na coluna e não tinham formulário: a emissão recusava por eles e não havia por
      // onde preenchê-los. Agora há, e o mock precisa recusar igual, senão o caminho da empresa
      // não configurada volta a passar offline e a morrer só no real.
      const faltando = ["inscricaoMunicipal", "codigoServicoNacional", "codigoServicoMunicipal", "rpsSerie"]
        .filter((campo) => empresa && !String(empresa.legacyCompany?.[campo] || "").trim());
      if (faltando.length) {
        const err = new Error("company_missing_fields");
        err.missing = faltando;
        throw err;
      }
      const doc = String(payload?.tomador?.cnpjCpf || "").replace(/\D/g, "");
      if (doc.length !== 11 && doc.length !== 14) throw new Error("tomador_documento_invalido");
      if (!String(payload?.tomador?.nome || "").trim()) throw new Error("tomador_nome_obrigatorio");
      if (!String(payload?.servico?.descricao || "").trim()) throw new Error("servico_descricao_obrigatoria");
      const valor = Number(payload?.servico?.valorServicos);
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("servico_valor_invalido");
      // ⚠ Com ISS retido o provedor exige alíquota > 0 (erro E0625 do Padrão Nacional); o servidor
      // recusa antes de emitir (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`). O mock recusa igual — senão a
      // combinação "retido + alíquota da prefeitura" passa offline e morre no real.
      const aliq = Number(payload?.servico?.aliquota);
      if (payload?.servico?.issRetido === true && !(Number.isFinite(aliq) && aliq > 0)) {
        throw new Error("nfse_iss_retido_sem_aliquota");
      }
      const pTotTribSNCru = payload?.totTrib?.pTotTribSN;
      const pTotTribSN = pTotTribSNCru === undefined || pTotTribSNCru === null || pTotTribSNCru === ""
        ? null
        : Number(pTotTribSNCru);
      if (pTotTribSN === null || Number.isNaN(pTotTribSN)) {
        throw new Error("missing_p_tot_trib_sn");
      }
      // Faixa do validador real (`p_tot_trib_sn_invalido`): fora de 0–100 é outra unidade, não um
      // número grande — provavelmente o valor em reais no lugar do percentual.
      if (pTotTribSN < 0 || pTotTribSN > 100) throw new Error("p_tot_trib_sn_invalido");
      const seq = (mockNfseSeq += 1);
      return {
        status: "issued",
        nfse: {
          id: `mock-nfse-${seq}`,
          status: "issued",
          numeroNfse: String(1000 + seq),
          chaveAcesso: `35${String(seq).padStart(42, "0")}`,
          tomadorNome: payload.tomador.nome,
          tomadorDoc: doc,
          valorServicos: valor,
        },
      };
    },

    // As duas escrevem no MESMO estado que o pré-voo lê — é o que permite exercitar offline o
    // ciclo inteiro: exportar → reexportar (com o alerta) → reabrir → o alerta some.
    async confirmarExportacao(companyId, { competenciaInicio, competenciaFim }) {
      await delay(80);
      const lista = mockEntriesByCompany.get(companyId) || [];
      let marcados = 0;
      for (const e of lista) {
        if (e.competencia >= competenciaInicio && e.competencia <= competenciaFim && e.status === "CONFIRMADO") {
          e.status = "EXPORTADO"; marcados += 1;
        }
      }
      return { ok: true, marcados };
    },
    async reabrirExportacao(companyId, { competenciaInicio, competenciaFim }) {
      await delay(80);
      const lista = mockEntriesByCompany.get(companyId) || [];
      let reabertos = 0;
      for (const e of lista) {
        if (e.competencia >= competenciaInicio && e.competencia <= competenciaFim && e.status === "EXPORTADO") {
          e.status = "CONFIRMADO"; reabertos += 1;
        }
      }
      return { ok: true, reabertos };
    },

    // Pré-voo da exportação. Calculado sobre os MESMOS lançamentos do mock, não inventado: é assim
    // que dá para conferir offline a tela de erros/alertas — inclusive o caso de lote limpo.
    async getExportPreflight(companyId, competencia) {
      await delay(120);
      const lista = (mockEntriesByCompany.get(companyId) || [])
        .filter((e) => e.competencia === competencia && String(e.tipo || "").toUpperCase() !== "PARCELA");
      const erros = []; const alertas = [];
      let totalD = 0; let totalC = 0; let linhas = 0;
      const plano = new Set((mockChartOfAccounts.get(companyId) || []).map((a) => String(a.codigo)));
      for (const e of lista) {
        const ls = e.lines || [];
        if (!ls.length) { erros.push({ entryId: e.id, historico: e.historico, motivo: "lançamento sem nenhuma linha", ocorrencias: 1 }); continue; }
        let d = 0; let c = 0;
        for (const l of ls) {
          linhas += 1;
          const v = Number(l.valor || 0);
          if (String(l.tipo).toUpperCase() === "D") { d += v; totalD += v; } else { c += v; totalC += v; }
          const cod = String(l.conta || "").trim();
          if (!cod) erros.push({ entryId: e.id, historico: e.historico, motivo: "linha sem conta", ocorrencias: 1 });
          else if (plano.size && !plano.has(cod)) erros.push({ entryId: e.id, historico: e.historico, motivo: `conta ${cod} não existe no plano`, ocorrencias: 1 });
        }
        if (Math.abs(d - c) > 0.01 && !e.parcelamentoId) {
          erros.push({ entryId: e.id, historico: e.historico, motivo: "débito ≠ crédito", ocorrencias: 1 });
        }
      }
      const circ = getCircularRecord(companyId, competencia);
      const mesFechado = Boolean(circ?.fechadoContabilEm);
      if (!mesFechado) alertas.push({ entryId: null, historico: null, motivo: "o mês ainda não foi fechado contabilmente", ocorrencias: 1 });
      const jaExportados = lista.filter((e) => e.status === "EXPORTADO").length;
      if (jaExportados > 0) {
        alertas.push({ entryId: null, historico: null, motivo: `${jaExportados} lançamento${jaExportados > 1 ? "s" : ""} desta competência já foi exportado antes`, ocorrencias: 1 });
      }
      return {
        ok: true, competencia, erros, alertas, mesFechado, jaExportados,
        totais: { entries: lista.length, linhas, totalD, totalC, diferenca: Math.abs(totalD - totalC) },
      };
    },

    // ── Históricos (mock) ──────────────────────────────────────────────────
    async getAllHistoricos(companyId) {
      await delay(200);
      const companySpecific = mockHistoricosByCompany.get(companyId) || [];
      return [...mockHistoricos, ...companySpecific]
        .sort((a, b) => b.usageCount - a.usageCount)
        .map((h) => ({ ...h, scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL" }));
    },
    async updateHistorico(companyId, id, input) {
      await delay(150);
      // procura globais
      const gi = mockHistoricos.findIndex((h) => h.id === id);
      if (gi >= 0) {
        const h = mockHistoricos[gi];
        if (input.scope === "COMPANY") { h.companyPortalClientId = companyId; h.scope = "COMPANY"; }
        if (input.scope === "GLOBAL") { h.companyPortalClientId = null; h.scope = "GLOBAL"; }
        if (input.contaDebito !== undefined) h.contaDebito = input.contaDebito || null;
        if (input.contaCredito !== undefined) h.contaCredito = input.contaCredito || null;
        return { ok: true, historico: { ...h } };
      }
      const compList = mockHistoricosByCompany.get(companyId) || [];
      const ci = compList.findIndex((h) => h.id === id);
      if (ci >= 0) {
        const h = compList[ci];
        if (input.scope === "GLOBAL") {
          // promove para global: remove da lista da empresa, adiciona nos globais
          compList.splice(ci, 1);
          mockHistoricosByCompany.set(companyId, compList);
          h.companyPortalClientId = null; h.scope = "GLOBAL";
          mockHistoricos.push(h);
        } else {
          if (input.contaDebito !== undefined) h.contaDebito = input.contaDebito || null;
          if (input.contaCredito !== undefined) h.contaCredito = input.contaCredito || null;
        }
        return { ok: true, historico: { ...h } };
      }
      return { ok: false, error: "not_found" };
    },
    async searchHistoricos(companyId, q) {
      await delay(150);
      const companySpecific = mockHistoricosByCompany.get(companyId) || [];
      const all = [...mockHistoricos, ...companySpecific];
      const nq = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const filtered = nq.length < 2
        ? all
        : all.filter((h) => h.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(nq));
      return filtered
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 12)
        .map((h) => ({ ...h, scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL" }));
    },
    async getHistoricosByCode(companyId, codigo) {
      await delay(150);
      const companySpecific = mockHistoricosByCompany.get(companyId) || [];
      const all = [...mockHistoricos, ...companySpecific];
      return all
        .filter((h) => h.contaDebito === codigo || h.contaCredito === codigo)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10)
        .map((h) => ({ ...h, scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL" }));
    },
    async deleteHistorico(companyId, id) {
      await delay(100);
      const compList = mockHistoricosByCompany.get(companyId) || [];
      const globalIdx = mockHistoricos.findIndex((h) => h.id === id);
      if (globalIdx >= 0) { mockHistoricos.splice(globalIdx, 1); return { ok: true }; }
      const compIdx = compList.findIndex((h) => h.id === id);
      if (compIdx >= 0) { compList.splice(compIdx, 1); mockHistoricosByCompany.set(companyId, compList); return { ok: true }; }
      return { ok: false, error: "not_found" };
    },

    async runCompanyFiscalAction(companyId, input) {
      await delay(500);
      const action = String(input?.action || "").toLowerCase();
      const competencia = input?.competencia;

      if (!action) throw new Error("action_required");
      if (!competencia) throw new Error("competencia_required");

      const startedAt = new Date().toISOString();
      let result;

      switch (action) {
        case "search_guides": {
          result = {
            action: "search_guides",
            competencia,
            status: "completed",
            guidesFound: faker.number.int({ min: 0, max: 5 }),
            guidesCaptured: faker.number.int({ min: 0, max: 3 }),
            guidesUpdated: faker.number.int({ min: 0, max: 2 }),
            circularUpdated: faker.datatype.boolean(),
            entriesGenerated: faker.number.int({ min: 0, max: 10 }),
            timestamp: startedAt,
          };
          break;
        }
        case "check_payments": {
          const total = faker.number.int({ min: 2, max: 8 });
          const paid = faker.number.int({ min: 0, max: total });
          const overdue = faker.number.int({ min: 0, max: total - paid });
          result = {
            action: "check_payments",
            competencia,
            status: "completed",
            guidesChecked: total,
            guidesPaid: paid,
            guidesOverdue: overdue,
            guidesOpen: total - paid - overdue,
            timestamp: startedAt,
          };
          break;
        }
        case "sync_inss": {
          result = {
            action: "sync_inss",
            competencia,
            status: "completed",
            guidesFound: faker.number.int({ min: 0, max: 2 }),
            guidesCaptured: faker.number.int({ min: 0, max: 1 }),
            circularUpdated: faker.datatype.boolean(),
            timestamp: startedAt,
          };
          break;
        }
        default: {
          const err = new Error(`Unknown action: ${action}`);
          err.code = "UNKNOWN_FISCAL_ACTION";
          throw err;
        }
      }

      // Persist execution to mock store
      const logEntry = {
        id: faker.string.uuid(),
        portalClientId: companyId,
        competencia,
        action,
        status: result.status,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: faker.number.int({ min: 200, max: 2000 }),
        guidesFound: result.guidesFound ?? null,
        guidesCaptured: result.guidesCaptured ?? null,
        guidesUpdated: result.guidesUpdated ?? null,
        guidesChecked: result.guidesChecked ?? null,
        guidesPaid: result.guidesPaid ?? null,
        guidesOverdue: result.guidesOverdue ?? null,
        guidesOpen: result.guidesOpen ?? null,
        circularUpdated: result.circularUpdated ?? null,
        entriesGenerated: result.entriesGenerated ?? null,
        errorCode: null,
        errorMessage: null,
        skipReason: result.reason ?? null,
        triggeredBy: null,
      };

      const existing = mockFiscalExecutions.get(companyId) || [];
      mockFiscalExecutions.set(companyId, [logEntry, ...existing]);

      return result;
    },

    async getFiscalExecutions(companyId, params = {}) {
      await delay(200);
      const all = mockFiscalExecutions.get(companyId) || [];
      let filtered = all;
      if (params.competencia) filtered = filtered.filter((e) => e.competencia === params.competencia);
      if (params.action) filtered = filtered.filter((e) => e.action === params.action);
      const limit = Math.min(Number(params.limit) || 20, 100);
      return filtered.slice(0, limit);
    },

    // ── Q12.A: stubs do módulo Notas (mock não persiste) ──
    async listProcuracoes() { await delay(60); return []; },
    async createProcuracao() { await delay(60); return { ok: true, procuracao: null }; },
    async revogarProcuracao() { await delay(60); return { ok: true }; },
    async listCompetenciasNotas(_id, ano) {
      await delay(80);
      const y = ano || new Date().getUTCFullYear();
      return {
        ano: y,
        competencias: Array.from({ length: 12 }, (_, i) => ({
          id: null, competencia: `${y}-${String(i + 1).padStart(2, "0")}`,
          estado: "aberto", lockedAt: null, reopenedAt: null,
          rb12: null, fs12Manual: null, fs12Origem: null, fatorR: null,
          notasCount: 0, pendenciasAbertas: 0,
        })),
      };
    },
    async getCompetenciaNotas(_id, competencia) {
      await delay(60);
      return { competencia, estado: "aberto", notasCount: 0, pendenciasAbertas: 0 };
    },
    async fecharCompetencia() { await delay(60); return { ok: true, competencia: { estado: "fechado" } }; },
    async reabrirCompetencia() { await delay(60); return { ok: true, competencia: { estado: "em_conferencia" } }; },
    async listPendenciasPosFechamento() { await delay(60); return []; },
    async resolverPendencia() { await delay(60); return { ok: true }; },
    async syncDfe() { await delay(80); return { ok: true, result: { totalDocs: 0, byType: {}, newCursor: "0" } }; },
    async getDfeState() { await delay(60); return null; },
    async clearDfeError() { await delay(40); return { ok: true }; },
    async syncAdn() { await delay(80); return { ok: true, result: { totalDocs: 0, byStatus: {}, newCursor: "0" } }; },
    async getAdnState() { await delay(60); return null; },
    async clearAdnError() { await delay(40); return { ok: true }; },
    async importInvoicesXml() { await delay(120); return { created: 0, updated: 0, duplicates: 0, errors: [] }; },
    // Q48: download de notas em lote — job fake que "conclui" no primeiro poll.
    async createNotasDownload(payload = {}) {
      await delay(80);
      return { ok: true, jobId: `mock-notas-dl-${Date.now()}` };
    },
    // ── Calendário fiscal (mock) ───────────────────────────────────────────────────────────
    // Popula o mês pedido: guias em dias fixos, um marco do escritório e um da empresa. Mês vazio
    // não deixaria conferir a grade, que é justamente o que precisa ser visto.
    // `companyId` é filtro OPCIONAL, como no backend. O mock antigo ignorava o argumento, então a
    // visão por empresa (aba dentro da empresa) era invisível offline.
    async getCalendario(mes, companyId) {
      await delay(80);
      const [y, m] = String(mes || "2026-07").split("-").map(Number);
      const diasNoMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const iso = (d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      // Ids REAIS das empresas do mock — com ids fictícios ("c1") o filtro por empresa descartaria
      // todas as guias e a visão dentro da empresa mostraria só obrigações.
      const e0 = mockCompanies[0] || {}; const e1 = mockCompanies[1] || {}; const e2 = mockCompanies[2] || {};
      const porDia = {
        15: [
          { tipo: "guia", id: "g1", titulo: "INSS", companyId: e0.companyId, empresa: e0.razao, competencia: mes, valor: 193.03, resolvido: false },
          { tipo: "guia", id: "g2", titulo: "INSS", companyId: e1.companyId, empresa: e1.razao, competencia: mes, valor: 421.9, resolvido: true },
        ],
        20: [
          { tipo: "guia", id: "g3", titulo: "SIMPLES", companyId: e0.companyId, empresa: e0.razao, competencia: mes, valor: 1441.25, resolvido: false },
          { tipo: "guia", id: "g4", titulo: "SIMPLES", companyId: e2.companyId, empresa: e2.razao, competencia: mes, valor: 2380.11, resolvido: false },
        ],
        1: [{ tipo: "marco", id: "mk1", titulo: "CBS passa a ser cobrada", descricao: "Fim da fase de teste", importancia: "ALTA", companyId: null, empresa: null, doEscritorio: true }],
        8: [{ tipo: "marco", id: "mk2", titulo: "Reuniao com o cliente", importancia: "BAIXA", companyId: e0.companyId, empresa: e0.razao, doEscritorio: false }],
      };

      // Quinta fonte: as obrigações cadastradas, no mesmo formato do backend. Vêm do estado real do
      // mock (não de uma lista fixa), então criar uma obrigação na aba aparece aqui na hora.
      const hojeStr = new Date().toISOString().slice(0, 10);
      for (const o of mockObrigacoes) {
        if (!o.ativa) continue;
        if (companyId && o.companyId !== companyId) continue;
        for (const oc of o.ocorrencias) {
          if (!oc.dataVencimento.startsWith(mes)) continue;
          const dia = Number(oc.dataVencimento.slice(8));
          const situacao = oc.status === "CONCLUIDA" ? "CONCLUIDA"
            : oc.dataVencimento < hojeStr ? "VENCIDA" : "PENDENTE";
          porDia[dia] = [...(porDia[dia] || []), {
            tipo: "obrigacao", id: oc.ocorrenciaId, obrigacaoId: o.obrigacaoId,
            // Mesma chave do backend: regra quando vem de regra, senão o nome normalizado.
            grupoChave: o.regraId || `nome:${String(o.nome || "").trim().toLowerCase()}`,
            titulo: o.nome, categoria: o.categoria,
            cor: o.cor, companyId: o.companyId, empresa: o.empresa,
            // Sem estes dois o ciclo (aguardando → aberta → urgente) cai sempre no default de 5
            // dias no mock, e a distinção entre uma anual a 40 dias e uma a 2 ficaria invisível
            // offline — que é justamente o que esta entrega acrescenta.
            periodicidade: o.periodicidade || "MENSAL",
            antecedenciaLembreteDias: o.antecedenciaLembreteDias ?? 5,
            competencia: oc.competenciaRef, data: oc.dataVencimento, situacao,
            resolvido: oc.status === "CONCLUIDA",
            conclusaoAutomatica: Boolean(o.verificador), fonteConclusao: oc.fonteConclusao,
          }];
        }
      }

      // Guias e marcos também respeitam o filtro de empresa (o backend filtra na query).
      if (companyId) {
        for (const dia of Object.keys(porDia)) {
          porDia[dia] = porDia[dia].filter((i) => i.companyId == null || i.companyId === companyId);
          if (!porDia[dia].length) delete porDia[dia];
        }
      }
      return {
        ok: true, competencia: mes, diasNoMes,
        dias: Array.from({ length: diasNoMes }, (_, i) => ({
          dia: i + 1,
          data: iso(i + 1),
          itens: porDia[i + 1] || [],
          // Feriado é propriedade do DIA, não item: não se clica nem se conclui.
          feriado: MOCK_FERIADOS[iso(i + 1)] || null,
        })),
        // Mesma regra dos itens do dia: id REAL e filtro respeitado. Com id fictício e sem filtro,
        // a aba de Obrigações de uma empresa listava a pendência de OUTRA — exatamente o vazamento
        // de escopo que o backend evita usando `alvos` em todas as queries.
        pendenciasDoMes: [
          { tipo: "apuracao", companyId: e0.companyId, empresa: e0.razao, competencia: mes, titulo: "Apuracao nao transmitida", estado: "calculada" },
          { tipo: "fechamento", companyId: e1.companyId, empresa: e1.razao, competencia: mes, titulo: "Mes contabil nao fechado" },
        ].filter((p) => !companyId || p.companyId === companyId),
        totais: { guias: 4, marcos: 2, apuracoes: 1, fechamentos: 1 },
      };
    },
    // ── Obrigações (mock com estado em memória) ────────────────────────────────────────────
    // Estado de verdade, não retorno fixo: as regras que importam aqui só aparecem mexendo — a
    // janela de 12 ocorrências, a recusa do clique em obrigação automática e o VENCIDA derivado.
    // Um mock imutável passaria por todas elas sem testar nenhuma.
    async listObrigacoes({ companyId, incluirInativas } = {}) {
      await delay(70);
      const hoje = new Date().toISOString().slice(0, 10);
      const emSeteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      let pendentes = 0, vencendoEm7Dias = 0, vencidas = 0;

      const lista = mockObrigacoes
        .filter((o) => (companyId ? o.companyId === companyId : true))
        .filter((o) => (incluirInativas ? true : o.ativa))
        .map((o) => {
          const ocorrencias = o.ocorrencias.map((oc) => {
            const situacao =
              oc.status === "CONCLUIDA" ? "CONCLUIDA" : oc.dataVencimento < hoje ? "VENCIDA" : "PENDENTE";
            return { ...oc, situacao };
          });
          for (const oc of ocorrencias) {
            if (oc.situacao === "VENCIDA") vencidas += 1;
            else if (oc.situacao === "PENDENTE") {
              pendentes += 1;
              if (oc.dataVencimento <= emSeteDias) vencendoEm7Dias += 1;
            }
          }
          const proxima = ocorrencias.find((oc) => oc.situacao === "PENDENTE");
          return {
            ...o,
            conclusaoAutomatica: Boolean(o.verificador),
            proximoVencimento: proxima?.dataVencimento || null,
            ocorrencias,
          };
        });

      return {
        ok: true,
        obrigacoes: lista,
        resumo: { pendentes, vencendoEm7Dias, vencidas },
        opcoes: {
          periodicidades: ["MENSAL", "TRIMESTRAL", "ANUAL"],
          ajustesDiaUtil: ["ANTECIPAR", "POSTERGAR", "MANTER"],
          verificadores: [
            { chave: "APURACAO_TRANSMITIDA", rotulo: "Quando a apuração da competência for transmitida" },
            { chave: "MES_FECHADO", rotulo: "Quando o mês contábil da competência for fechado" },
          ],
        },
      };
    },
    async createObrigacao(companyId, dados) {
      await delay(90);
      const empresa = mockCompanies.find((c) => c.companyId === companyId);
      const obrigacao = mockCriarObrigacao(companyId, empresa?.razao || null, dados);
      mockObrigacoes.push(obrigacao);
      return { ok: true, obrigacao, ocorrenciasCriadas: obrigacao.ocorrencias.length };
    },
    async updateObrigacao(obrigacaoId, patch) {
      await delay(80);
      const i = mockObrigacoes.findIndex((o) => o.obrigacaoId === obrigacaoId);
      if (i < 0) return { ok: false, error: "nao_encontrada", message: "Obrigação não encontrada." };
      const antes = mockObrigacoes[i];
      // Concluída é histórico: sobrevive à regeração, igual ao backend.
      const concluidas = antes.ocorrencias.filter((oc) => oc.status === "CONCLUIDA");
      const nova = mockCriarObrigacao(antes.companyId, antes.empresa, { ...antes, ...patch });
      nova.obrigacaoId = antes.obrigacaoId;
      const jaTem = new Set(concluidas.map((oc) => oc.dataVencimento));
      nova.ocorrencias = [...concluidas, ...nova.ocorrencias.filter((oc) => !jaTem.has(oc.dataVencimento))]
        .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
      if (nova.ativa === false) nova.ocorrencias = concluidas;
      mockObrigacoes[i] = nova;
      return { ok: true, obrigacao: nova, ocorrenciasCriadas: 0, ocorrenciasRemovidas: 0 };
    },
    async deleteObrigacao(obrigacaoId) {
      await delay(60);
      const i = mockObrigacoes.findIndex((o) => o.obrigacaoId === obrigacaoId);
      if (i < 0) return { ok: false, error: "nao_encontrada" };
      const [removida] = mockObrigacoes.splice(i, 1);
      return { ok: true, removida: { id: removida.obrigacaoId, nome: removida.nome } };
    },
    async concluirOcorrencia(ocorrenciaId) {
      await delay(60);
      for (const o of mockObrigacoes) {
        const oc = o.ocorrencias.find((x) => x.ocorrenciaId === ocorrenciaId);
        if (!oc) continue;
        // Mesma recusa do backend: o que se conclui sozinho não aceita clique.
        if (o.verificador) {
          return {
            ok: false,
            error: "conclusao_automatica",
            message: "Esta obrigação se conclui sozinha quando o sistema observa o serviço feito.",
          };
        }
        oc.status = "CONCLUIDA";
        oc.concluidaEm = new Date().toISOString();
        oc.fonteConclusao = "MANUAL";
        return { ok: true, ocorrencia: oc };
      }
      return { ok: false, error: "nao_encontrada" };
    },
    async reabrirOcorrencia(ocorrenciaId) {
      await delay(60);
      for (const o of mockObrigacoes) {
        const oc = o.ocorrencias.find((x) => x.ocorrenciaId === ocorrenciaId);
        if (!oc) continue;
        oc.status = "PENDENTE";
        oc.concluidaEm = null;
        oc.fonteConclusao = null;
        return { ok: true, ocorrencia: oc };
      }
      return { ok: false, error: "nao_encontrada" };
    },
    // ── Regras do escritório (mock com propagação de verdade) ─────────────────────────────
    // A propagação é o comportamento que precisa ser visto: quem entra no filtro, quem sai, e o
    // que acontece com a empresa editada localmente. Um retorno fixo mostraria a tela e esconderia
    // exatamente isso.
    async listRegrasObrigacao() {
      await delay(70);
      return {
        ok: true,
        regras: mockRegras.map((r) => {
          const aplicadas = mockObrigacoes.filter((o) => o.regraId === r.regraId);
          return {
            ...r,
            totalEmpresas: aplicadas.length,
            totalExcecoes: r.excecoes.length,
            totalSobrescritas: aplicadas.filter((o) => o.sobrescritaLocal).length,
            resumoEscopo: mockResumoEscopo(r, aplicadas.length),
            empresas: aplicadas.map((o) => ({
              companyId: o.companyId, razao: o.empresa, obrigacaoId: o.obrigacaoId,
              sobrescritaLocal: o.sobrescritaLocal,
            })),
          };
        }),
        opcoes: {
          escopos: ["TODAS", "POR_FILTRO", "SELECAO_MANUAL"],
          regimes: ["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"],
          periodicidades: ["MENSAL", "TRIMESTRAL", "ANUAL"],
          ajustesDiaUtil: ["ANTECIPAR", "POSTERGAR", "MANTER"],
          verificadores: [
            { chave: "APURACAO_TRANSMITIDA", rotulo: "Quando a apuração da competência for transmitida" },
            { chave: "MES_FECHADO", rotulo: "Quando o mês contábil da competência for fechado" },
          ],
        },
      };
    },
    async previewEscopoRegra({ escopo, filtros }) {
      await delay(50);
      const empresas = mockEmpresasDoEscopo(escopo, filtros);
      return { ok: true, total: empresas.length, empresas };
    },
    async createRegraObrigacao(dados) {
      await delay(120);
      const regraId = `mock-regra-${Math.random().toString(36).slice(2, 9)}`;
      const regra = { ...dados, regraId, excecoes: [], ativa: true };
      mockRegras.push(regra);
      const efeito = mockPropagarRegra(regra);
      return { ok: true, regra, ...efeito };
    },
    async updateRegraObrigacao(regraId, patch) {
      await delay(120);
      const i = mockRegras.findIndex((r) => r.regraId === regraId);
      if (i < 0) return { ok: false, error: "regra_nao_encontrada", message: "Regra não encontrada." };
      mockRegras[i] = { ...mockRegras[i], ...patch };
      const efeito = mockPropagarRegra(mockRegras[i]);
      return { ok: true, regra: mockRegras[i], ...efeito };
    },
    async deleteRegraObrigacao(regraId, modo) {
      await delay(90);
      const i = mockRegras.findIndex((r) => r.regraId === regraId);
      if (i < 0) return { ok: false, error: "regra_nao_encontrada" };
      const [regra] = mockRegras.splice(i, 1);
      const ligadas = mockObrigacoes.filter((o) => o.regraId === regraId);
      if (modo === "desvincular") {
        for (const o of ligadas) { o.regraId = null; o.sobrescritaLocal = false; }
        return { ok: true, nome: regra.nome, desvinculadas: ligadas.length, removidas: 0 };
      }
      for (const o of ligadas) {
        const idx = mockObrigacoes.indexOf(o);
        if (idx >= 0) mockObrigacoes.splice(idx, 1);
      }
      return { ok: true, nome: regra.nome, desvinculadas: 0, removidas: ligadas.length };
    },
    async addExcecaoRegra(regraId, companyId, motivo) {
      await delay(80);
      const regra = mockRegras.find((r) => r.regraId === regraId);
      if (!regra) return { ok: false, error: "regra_nao_encontrada" };
      if (!regra.excecoes.some((e) => e.companyId === companyId)) regra.excecoes.push({ companyId, motivo });
      return { ok: true, ...mockPropagarRegra(regra) };
    },
    async removeExcecaoRegra(regraId, companyId) {
      await delay(80);
      const regra = mockRegras.find((r) => r.regraId === regraId);
      if (!regra) return { ok: false, error: "regra_nao_encontrada" };
      regra.excecoes = regra.excecoes.filter((e) => e.companyId !== companyId);
      return { ok: true, ...mockPropagarRegra(regra) };
    },
    async listMarcosFiscais() { await delay(50); return { ok: true, marcos: [] }; },
    async createMarcoFiscal(input) { await delay(80); return { ok: true, marco: { id: `mk-${Date.now()}`, ...input } }; },
    async updateMarcoFiscal(marcoId, patch) { await delay(60); return { ok: true, marco: { id: marcoId, ...patch } }; },
    async deleteMarcoFiscal(marcoId) { await delay(50); return { ok: true, removido: { id: marcoId } }; },
    // ── Documentos e anotações (mock com estado em memória) ────────────────────────────────
    // Estado de verdade, não retorno fixo: as duas features têm REGRAS que só dá pra conferir
    // mexendo (fixação exclusiva, seleção múltipla), e um mock imutável passaria por elas.
    async listCompanyDocuments() {
      await delay(60);
      return { ok: true, documentos: mockDocumentos, tipos: MOCK_TIPOS_DOC, tipoLabels: MOCK_TIPO_DOC_LABELS };
    },
    async uploadCompanyDocument(_companyId, { arquivo, tipo, nome }) {
      await delay(120);
      const doc = {
        id: `mock-doc-${mockDocumentos.length + 1}`,
        tipo: tipo || "OUTRO",
        nome: nome || arquivo?.name || "documento.pdf",
        mimeType: arquivo?.type || "application/pdf",
        bytes: arquivo?.size || 1024,
        validade: null,
        createdAt: "2026-07-28T12:00:00.000Z",
      };
      mockDocumentos = [doc, ...mockDocumentos];
      return { ok: true, documento: doc };
    },
    async fetchCompanyDocumentBlob() {
      await delay(60);
      return new Blob(["mock"], { type: "application/pdf" });
    },
    async deleteCompanyDocument(_companyId, documentId) {
      await delay(60);
      mockDocumentos = mockDocumentos.filter((d) => d.id !== documentId);
      return { ok: true, removido: { id: documentId } };
    },
    async sendCompanyDocuments(_companyId, documentIds) {
      await delay(150);
      const docs = mockDocumentos.filter((d) => documentIds.includes(d.id));
      return {
        ok: true, enviados: docs.length, destinatario: "cliente@exemplo.com.br",
        documentos: docs.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo })),
      };
    },
    async listCompanyNotes(_companyId, ordenarPor = "data") {
      await delay(60);
      const PESO = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
      const porData = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
      const criterio = ordenarPor === "importancia"
        ? (a, b) => ((PESO[a.importancia] ?? 9) - (PESO[b.importancia] ?? 9)) || porData(a, b)
        : porData;
      // Espelha a regra do backend: fixada sempre no topo, em qualquer ordenação.
      const anotacoes = [...mockAnotacoes].sort((a, b) => {
        if (a.fixada !== b.fixada) return a.fixada ? -1 : 1;
        return criterio(a, b);
      });
      return { ok: true, anotacoes, importancias: ["ALTA", "MEDIA", "BAIXA"] };
    },
    async createCompanyNote(_companyId, { texto, importancia, fixada }) {
      await delay(80);
      if (fixada) mockAnotacoes = mockAnotacoes.map((n) => ({ ...n, fixada: false }));
      const nota = {
        id: `mock-nota-${mockAnotacoes.length + 1}`, texto,
        importancia: importancia || "MEDIA", fixada: Boolean(fixada),
        createdAt: new Date().toISOString(),
      };
      mockAnotacoes = [nota, ...mockAnotacoes];
      return { ok: true, anotacao: nota };
    },
    async updateCompanyNote(_companyId, noteId, patch) {
      await delay(80);
      // Fixação EXCLUSIVA, igual ao backend — é o que a tela precisa exercitar.
      if (patch.fixada === true) mockAnotacoes = mockAnotacoes.map((n) => ({ ...n, fixada: false }));
      mockAnotacoes = mockAnotacoes.map((n) => (n.id === noteId ? { ...n, ...patch } : n));
      return { ok: true, anotacao: mockAnotacoes.find((n) => n.id === noteId) };
    },
    async deleteCompanyNote(_companyId, noteId) {
      await delay(60);
      mockAnotacoes = mockAnotacoes.filter((n) => n.id !== noteId);
      return { ok: true, removida: { id: noteId } };
    },
    // ── Cofre de senhas (mock) ─────────────────────────────────────────────────────────────
    // ⚠ Espelha a invariante do backend: a listagem NUNCA carrega a senha. `_senhaFalsa` é retirada
    // aqui, num `map` explícito, e não por `delete` sobre o objeto — o `delete` mutaria a fixture e
    // a senha sumiria do mock a partir da primeira listagem, fazendo "Ver senha" quebrar depois de
    // um refresh e parecer um defeito da tela.
    async listCompanyCredentials() {
      await delay(60);
      const credenciais = mockCredenciais.map(({ _senhaFalsa, ...c }) => ({ ...c, temSenha: Boolean(_senhaFalsa) }));
      // `podeRevelar: true` para o caminho feliz ser exercitável no mock. Quem quiser ver a recusa
      // de papel troca para `false` aqui — a tela nomeia o motivo com `papelMinimoRevelar`.
      return { ok: true, credenciais, cofre: mockCofre, podeRevelar: true, papelMinimoRevelar: "FIRM_ADMIN" };
    },
    async createCompanyCredential(_companyId, { rotulo, login, senha, observacao }) {
      await delay(100);
      const cred = {
        id: `mock-cred-${mockCredenciais.length + 1}`,
        rotulo, login: login || null, observacao: observacao || null,
        senhaAtualizadaEm: senha ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
        vezesRevelada: 0,
        _senhaFalsa: senha || null,
      };
      mockCredenciais = [cred, ...mockCredenciais];
      const { _senhaFalsa, ...semSenha } = cred;
      return { ok: true, credencial: { ...semSenha, temSenha: Boolean(_senhaFalsa) } };
    },
    async updateCompanyCredential(_companyId, credentialId, patch) {
      await delay(80);
      // Espelha a regra do backend: `senha` ausente não mexe; `senha: ""` apaga.
      const temSenhaNoPatch = Object.prototype.hasOwnProperty.call(patch || {}, "senha");
      mockCredenciais = mockCredenciais.map((c) => {
        if (c.id !== credentialId) return c;
        const novo = { ...c };
        if (patch.rotulo !== undefined) novo.rotulo = patch.rotulo;
        if (patch.login !== undefined) novo.login = patch.login || null;
        if (patch.observacao !== undefined) novo.observacao = patch.observacao || null;
        if (temSenhaNoPatch) {
          novo._senhaFalsa = patch.senha || null;
          novo.senhaAtualizadaEm = patch.senha ? new Date().toISOString() : null;
        }
        return novo;
      });
      const atual = mockCredenciais.find((c) => c.id === credentialId);
      // ⚠ LANÇA, não devolve `{ ok: false }`: o real responde 404 e o `request` transforma isso em
      // exceção. Devolvendo um objeto, a tela trataria a recusa como sucesso — recarregaria a lista
      // e ficaria calada, e o defeito só apareceria em produção.
      if (!atual) { const e = new Error("Credencial não encontrada."); e.code = "credencial_nao_encontrada"; e.status = 404; throw e; }
      const { _senhaFalsa, ...semSenha } = atual;
      return { ok: true, credencial: { ...semSenha, temSenha: Boolean(_senhaFalsa) } };
    },
    async deleteCompanyCredential(_companyId, credentialId) {
      await delay(60);
      const alvo = mockCredenciais.find((c) => c.id === credentialId);
      mockCredenciais = mockCredenciais.filter((c) => c.id !== credentialId);
      // `removida` traz `rotulo` igual ao real (`remover` devolve `{ id, rotulo }`) — é o que uma
      // mensagem de confirmação teria de citar, e um mock mais pobre esconderia a falta dele.
      return { ok: true, removida: { id: credentialId, rotulo: alvo?.rotulo ?? null } };
    },
    // ⚠ Recusa sem `confirmado`, igual ao servidor. Um mock permissivo aqui faria a tela passar
    // sem nunca mandar o campo, e a recusa só apareceria em produção.
    async revealCompanyCredential(_companyId, credentialId, { confirmado } = {}) {
      await delay(120);
      if (confirmado !== true) {
        const err = new Error("Ver uma senha é registrado em auditoria. Confirme a ação para continuar.");
        err.code = "CONFIRMACAO_OBRIGATORIA";
        throw err;
      }
      const cred = mockCredenciais.find((c) => c.id === credentialId);
      if (!cred) { const e = new Error("Credencial não encontrada."); e.code = "credencial_nao_encontrada"; throw e; }
      if (!cred._senhaFalsa) {
        const e = new Error("Esta credencial foi cadastrada sem senha — não há valor para mostrar.");
        e.code = "sem_senha";
        throw e;
      }
      cred.vezesRevelada = (cred.vezesRevelada || 0) + 1;
      // `acessoId` acompanha o real (`revelarSenha` devolve o id da linha de auditoria gravada
      // ANTES da decifra). Sem ele, o mock diria que a revelação não deixa rastro.
      return {
        ok: true, id: cred.id, rotulo: cred.rotulo, login: cred.login,
        senha: cred._senhaFalsa, acessoId: `mock-acesso-${Date.now()}`,
      };
    },
    async listCompanyCredentialAccesses() {
      await delay(60);
      return {
        ok: true,
        acessos: [
          { id: "mock-ac-1", acao: "REVELADA", rotuloNoMomento: "gov.br", usuarioEmail: "contador@exemplo.com.br", createdAt: "2026-08-01T14:22:00.000Z" },
          { id: "mock-ac-2", acao: "CRIADA", rotuloNoMomento: "gov.br", usuarioEmail: "admin@exemplo.com.br", createdAt: "2026-01-10T12:00:00.000Z" },
        ],
      };
    },
    // ── "Outras informações" (mock) — NÃO cifradas ─────────────────────────────────────────
    async listCompanyInfos() {
      await delay(50);
      return { ok: true, informacoes: mockInformacoes, cifrado: false };
    },
    async createCompanyInfo(_companyId, { rotulo, valor }) {
      await delay(80);
      const info = { id: `mock-info-${mockInformacoes.length + 1}`, rotulo, valor, createdAt: new Date().toISOString() };
      mockInformacoes = [info, ...mockInformacoes];
      return { ok: true, informacao: info };
    },
    async updateCompanyInfo(_companyId, infoId, patch) {
      await delay(60);
      mockInformacoes = mockInformacoes.map((i) => (i.id === infoId ? { ...i, ...patch } : i));
      return { ok: true, informacao: mockInformacoes.find((i) => i.id === infoId) };
    },
    async deleteCompanyInfo(_companyId, infoId) {
      await delay(60);
      mockInformacoes = mockInformacoes.filter((i) => i.id !== infoId);
      return { ok: true, removida: { id: infoId } };
    },
    // ─── CONSULTA DE NOTAS EM LOTE ──────────────────────────────────────────────────────────
    // ⚠ Este mock NÃO pode ser "tudo deu certo". A tela existe para mostrar POR QUE uma empresa
    // não foi consultada — se o mock só devolve sucesso, o único caminho que importa nunca é
    // exercitado, e foi assim que a rotina quebrada passou meses sem ser vista.
    // Um desfecho diferente por empresa, ciclando: capturou · nada novo · sem A1 · aguardando · erro.
    async createNotasCaptura({ companyIds, alvos } = {}) {
      await delay(200);
      const ids = (companyIds || []).filter(Boolean);
      const alvosOk = (alvos || ["NFSE"]).map((a) => String(a).toUpperCase());
      const DESFECHOS = [
        { status: "capturou", motivo: null, totalDocs: 12, novos: 12 },
        { status: "nada_novo", motivo: null, totalDocs: 0, novos: 0 },
        { status: "pulada", motivo: "sem certificado A1 da empresa", totalDocs: 0, novos: 0 },
        { status: "aguardando", motivo: "consultada há 18 min — a SEFAZ só permite 1×/hora (faltam 42 min)", totalDocs: 0, novos: 0 },
        { status: "erro", motivo: "ADN_REJEICAO: cursor NSU inválido para o contribuinte", totalDocs: 0, novos: 0 },
        // O desfecho que era invisível: o ADN devolveu documento e a guarda de CNPJ descartou.
        // Sem ele no mock, a tela que existe para expor esse caso nunca o mostra.
        {
          status: "recusado", totalDocs: 8, novos: 0, recusadas: 8,
          motivo: "8 documento(s) recusado(s): nem prestador nem tomador é o CNPJ desta empresa. Confira o CNPJ do cadastro (matriz × filial, CPF) — ou são notas de outro contribuinte.",
        },
      ];
      const itens = [];
      ids.forEach((id, i) => {
        const c = mockCompanies.find((x) => x.companyId === id) || {};
        alvosOk.forEach((alvo, j) => {
          const d = DESFECHOS[(i + j) % DESFECHOS.length];
          itens.push({
            portalClientId: id, razao: c.razao || "Empresa mock", cnpj: c.cnpj || null,
            alvo, ...d,
            cursorAntes: "1200", cursorDepois: d.status === "capturou" ? "1212" : "1200",
          });
        });
      });
      const job = {
        jobId: `mock-captura-${Date.now()}`,
        status: "concluido",
        alvos: alvosOk,
        totalEmpresas: ids.length,
        processadas: ids.length,
        totalNotas: itens.reduce((s, i) => s + i.totalDocs, 0),
        erroMensagem: null,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        itens,
      };
      mockCapturas = [job, ...mockCapturas].slice(0, 10);
      return { ok: true, job };
    },
    async listNotasCapturas() { await delay(60); return { ok: true, jobs: mockCapturas.map(({ itens, ...j }) => j) }; },
    async getNotasCaptura(jobId) {
      await delay(60);
      const job = mockCapturas.find((j) => j.jobId === jobId);
      return job ? { ok: true, job } : { ok: false, error: "job_not_found" };
    },

    async listNotasDownloads() { await delay(60); return { ok: true, jobs: [] }; },
    async getNotasDownload(jobId) {
      await delay(60);
      return {
        ok: true,
        job: {
          id: jobId, status: "concluido", competenciaDe: "2026-01", competenciaAte: "2026-01",
          totalEmpresas: 1, processadas: 1, totalNotas: 0,
          arquivoNome: "notas-mock.zip", arquivoBytes: 0, erroMensagem: null,
        },
      };
    },
    async fetchNotasDownloadBlob() {
      await delay(60);
      return new Blob(["mock"], { type: "application/zip" });
    },
    // Q62: download em lote das SITFIS (mock)
    async createSitfisDownload() { await delay(80); return { ok: true, jobId: `mock-sitfis-dl-${Date.now()}` }; },
    async getSitfisDownload(jobId) {
      await delay(60);
      return { ok: true, job: { id: jobId, status: "concluido", totalEmpresas: 1, processadas: 1, comPdf: 1, arquivoNome: "situacao-fiscal-mock.zip", arquivoBytes: 0, erroMensagem: null } };
    },
    async fetchSitfisDownloadBlob() { await delay(60); return new Blob(["mock"], { type: "application/zip" }); },
    // C9: no mock não há job de verdade rodando — sempre zero (o selo simplesmente não aparece).
    async getJobsAtivos() { await delay(40); return { ok: true, total: 0, jobs: [] }; },
    // C8: grade anual de mentira, só pra conferir o layout (meses passados variam, futuros vazios).
    async getCompaniesAnnual(ano) {
      await delay(80);
      const y = Number(ano) || new Date().getUTCFullYear();
      return {
        ok: true,
        ano: y,
        empresas: mockCompanies.map((c, idx) => ({
          companyId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          meses: Array.from({ length: 12 }, (_, i) => {
            const passado = i < 6;
            return {
              competencia: `${y}-${String(i + 1).padStart(2, "0")}`,
              mes: i + 1,
              fechado: passado && (i + idx) % 3 !== 0,
              fechadoEm: null,
              apurada: passado && (i + idx) % 2 === 0,
              estadoApuracao: passado && (i + idx) % 2 === 0 ? "transmitida" : null,
            };
          }),
        })),
      };
    },
    // F2: o que trava a carteira. Os BLOQUEIOS saem dos lançamentos de verdade do mock (mesma
    // regra do backend: sem linhas, conta em branco ou D≠C), então mexer nos lançamentos muda a
    // resposta. O check-list é sintético e variado de propósito: o mock não guarda essas caixas
    // por empresa, e um check-list igual para todas deixaria o filtro sem nada para separar.
    async getCarteiraFechamento(competencia) {
      await delay(90);
      const comp = String(competencia || "");
      const CHECKLIST = [
        { chave: "folhaProlabore", label: "Folha/Pró-labore lançada" },
        { chave: "despesas", label: "Despesas lançadas" },
        { chave: "receitas", label: "Receitas lançadas" },
        { chave: "provisoes", label: "Provisões lançadas" },
        { chave: "pagamentos", label: "Pagamentos lançados" },
      ];
      const empresas = mockCompanies.map((c, idx) => {
        const lancamentos = (mockEntriesByCompany.get(c.companyId) || []).filter(
          (e) => e.competencia === comp && String(e.tipo || "").toUpperCase() !== "PARCELA",
        );
        const blockers = [];
        for (const e of lancamentos) {
          const lines = e.lines || [];
          if (!lines.length) { blockers.push({ entryId: e.id, historico: e.historico, motivo: "em_branco" }); continue; }
          if (lines.some((l) => !String(l.conta || "").trim())) { blockers.push({ entryId: e.id, historico: e.historico, motivo: "conta_em_branco" }); continue; }
          const d = lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
          const cr = lines.filter((l) => String(l.tipo).toUpperCase() === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
          if (Math.abs(d - cr) > 0.01) blockers.push({ entryId: e.id, historico: e.historico, motivo: "desbalanceado", totalD: d, totalC: cr });
        }
        const circular = getCircularRecord(c.companyId, comp);
        const fechado = Boolean(circular?.fechadoContabilEm);
        const pendentes = CHECKLIST.slice(0, idx % 3); // 0, 1 ou 2 itens em aberto
        return {
          companyId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          fechado,
          fechadoEm: circular?.fechadoContabilEm || null,
          podeFechar: !fechado && !blockers.length && !pendentes.length,
          checklistPendentes: pendentes,
          blockers,
          totalLancamentos: lancamentos.length,
        };
      });
      return { ok: true, competencia: comp, empresas };
    },
    // ⚠ PAGINA DE VERDADE. Com 2 notas fixas (como era antes) a paginação e o rodapé
    // "mostrando 1–100 de 247" eram inalcançáveis offline — e truncar em silêncio foi exatamente
    // o defeito relatado. `total` é o do UNIVERSO filtrado, nunca o tamanho da página: é essa
    // diferença que a tela precisa mostrar.
    async listNotas(_companyId, filters = {}) {
      await delay(60);
      const universo = mockFiltrarNotas(filters);
      const limit = Math.min(Number(filters.limit) || 100, 500);
      const offset = Math.max(Number(filters.offset) || 0, 0);
      // Mesma ordenação da rota real: emissão desc.
      const ordenadas = [...universo].sort(
        (a, b) => new Date(b.issueDate) - new Date(a.issueDate) || String(a.id).localeCompare(String(b.id)),
      );
      return {
        ok: true, total: universo.length, limit, offset,
        notas: ordenadas.slice(offset, offset + limit).map(mockNotaDeLista),
      };
    },
    // A ÍNTEGRA de uma nota — mesmo contrato do backend, inclusive nos casos em que NÃO temos:
    // NF-e sem XML e sem nenhum item, nota sem chave identificada só pelo `idNfse`.
    async getNota(_companyId, notaId) {
      await delay(60);
      const n = mockNotas.find((x) => x.id === notaId);
      if (!n) {
        const err = new Error("Nota não encontrada nesta empresa.");
        err.code = "nota_nao_encontrada";
        throw err;
      }
      const xml = n.__temXml ? mockXmlDaNota(n) : null;
      // Sem item é caso REAL (29 de 29 NF-e), não falha do mock.
      const itens = n.__descricao || n.__codigoServico || n.__cfop ? [{
        id: `${n.id}-item-1`,
        descricao: n.__descricao, codigoServico: n.__codigoServico,
        cfop: n.__cfop, ncm: n.__ncm, valor: n.total,
        // Classificação v2 nunca rodou na base real: 16.127 de 16.127 itens com `tipoReceita` nulo.
        tipoReceita: null, anexoResolvido: null, sujeitoFatorR: false,
        flagST: false, flagMonofasico: false, flagExportacao: false, classificadoEm: null,
      }] : [];
      return {
        ok: true,
        nota: {
          ...mockNotaDeLista(n),
          idNfse: n.idNfse, idDps: n.idDps, pdfUrl: n.pdfUrl, xmlHash: n.xmlHash,
          lastSyncAt: n.lastSyncAt, createdAt: n.createdAt, updatedAt: n.updatedAt,
          // ⚠ PARIDADE COM O REAL. A rota devolve TODOS os eventos da nota na íntegra (a lista traz
          // só o mais específico, dentro de `ciclo`). Sem isto aqui, o bloco de ciclo do detalhe era
          // inalcançável offline — dava para ver a substituição na tabela e não dava para exercitar
          // a tela que a explica.
          eventos: n.__eventos || [],
          itens,
          xml: {
            disponivel: Boolean(xml),
            bytes: xml ? xml.length : null,
            conteudo: xml,
            truncadoPorTamanho: false,
          },
        },
      };
    },
    async getNotasSummary(_companyId, filtros = {}) {
      await delay(60);
      // ⚠ Sai do MESMO conjunto que a tabela pagina. Antes eram números fixos (14 notas) — com a
      // tabela mostrando 247, as caixas do resumo e o rodapé se contradiziam dentro da mesma tela,
      // e offline não dava pra distinguir "o resumo está errado" de "o mock é grosseiro".
      // O resumo NÃO respeita `papel` (as caixas Emitidas/Recebidas SÃO o seletor de papel).
      const universo = mockFiltrarNotas({ ...filtros, papel: null, incluirCanceladas: "1" });
      let totalNotas = 0, totalEmitido = 0, totalRecebido = 0, countNfe = 0, countNfse = 0, countCanceladas = 0;
      for (const n of universo) {
        if (n.statusEfetivo === "cancelada") { countCanceladas++; continue; }
        totalNotas++;
        if (n.type === "NFE") countNfe++; else if (n.type === "NFSE") countNfse++;
        const v = Number(n.total || 0);
        if (n.papel === "DEST") totalRecebido += v; else totalEmitido += v;
      }
      return {
        ok: true,
        ano: filtros.ano || new Date().getUTCFullYear(),
        filtersApplied: { type: filtros.type || null, competencia: filtros.competencia || null },
        totals: { totalNotas, totalEmitido, totalRecebido, countNfe, countNfse, countCanceladas },
        byMonth: [],
      };
    },
    async listApuracao({ competencia } = {}) { await delay(60); return { competencia, items: [] }; },
    async calcularApuracao() { await delay(120); return { ok: true, result: { rb12: 0, fs12: 0, fatorR: 0, receitaMes: 0, receitaPorAnexo: {}, divergencias: 0 } }; },
    async getApuracao() { await delay(60); return null; },
    async revisarApuracao() { await delay(60); return { ok: true }; },
    async transmitirApuracao() { await delay(200); return { ok: true, result: { estado: "transmitida", numeroDeclaracao: "MOCK-001", reciboNumero: "MOCK-REC-001", dasValor: 0 } }; },
    async conferirApuracao() { await delay(150); return { ok: true, result: { estado: "confirmada", conferiu: true, divergencias: 0, totalDeclaracoesNoSerpro: 1 } }; },
    async classificarNotas() { await delay(80); return { ok: true, result: { processed: 0, classified: 0, defaultUsed: 0, byAnexo: {} } }; },
    // Q14.2 — apuração v2
    async getCadastroFiscal() { await delay(40); return { ok: true, cadastro: null, cnaePrincipalRef: null }; },
    async saveCadastroFiscal() { await delay(60); return { ok: true, cadastro: null }; },
    async getPerfilFiscal() { await delay(40); return { ok: true, regime: null, usaFatorR: false, temCadastro: false, temFatorR: false, candidatos: [] }; },
    async savePerfilFiscal() { await delay(60); return { ok: true, candidatos: [] }; },
    async listProdutosServicos() { await delay(40); return { ok: true, items: [] }; },
    async createProdutoServico() { await delay(60); return { ok: true, produto: null }; },
    async updateProdutoServico() { await delay(60); return { ok: true, produto: null }; },
    async deleteProdutoServico() { await delay(40); return { ok: true }; },
    async listPendencias() { await delay(40); return { ok: true, items: [], counts: [] }; },
    async resolverPendencia() { await delay(60); return { ok: true, result: { regraCriada: null, produtoCriado: null, reclassificacao: null } }; },
    async classificarV2() { await delay(120); return { ok: true, result: { processed: 0, classified: 0, pendentes: 0, byTipo: {}, byFonte: {} } }; },
    async apurarV2() { await delay(150); return { ok: true, result: { ok: true, snapshot: null, dasCalculadoLocal: 0, rbt12: 0, receitaPorAnexo: {}, aliquotaEfetivaPorAnexo: {} } }; },
    async getApuracaoSnapshot(companyId, competencia) {
      await delay(40);
      // ⚠ Era `snapshot: null` fixo, e por isso o KPI "DAS apurado" da aba não tinha COMO ser
      // conferido offline — nem o valor, nem (agora) a procedência dele. O snapshot sai da mesma
      // fonte que o relatório usa em `preApurado.oficial`: um mock com duas leituras do mesmo
      // número acabaria mostrando um valor no KPI e outro logo abaixo, na mesma tela.
      const dados = mockRelatorioFaturamentoDados(companyId, competencia);
      const of = dados.preApurado?.oficial || {};
      if (of.dasRetornadoSerpro == null && of.dasSimuladoSerpro == null && of.dasCalculadoLocalNoSnapshot == null) {
        return { ok: true, snapshot: null };
      }
      return {
        ok: true,
        snapshot: {
          portalClientId: companyId, competencia,
          estado: of.estado || null,
          dasRetornadoSerpro: of.dasRetornadoSerpro ?? null,
          dasSimuladoSerpro: of.dasSimuladoSerpro ?? null,
          // ⚠ Só o LEGADO chega aqui com valor, e ele vem SEM marca de procedência — que é
          // exatamente o que o KPI precisa ver para dizer "ambígua". Snapshot novo com número
          // nosso viria com `dasCalculadoLocalProcedencia: "MOTOR_LOCAL"`.
          dasCalculadoLocal: of.dasCalculadoLocalNoSnapshot?.valor ?? null,
          dasCalculadoLocalProcedencia: null,
          numeroDeclaracao: of.numeroDeclaracao || null,
          reciboNumero: of.reciboNumero || null,
          transmitidoEm: of.transmitidoEm || null,
          conferenciaStatus: mockConferenciaAdn(companyId, competencia).status,
        },
      };
    },
    // ── Relatório "Faturamento no Período — Consolidado" ──────────────────────────────────────
    //
    // ⚠ LER NÃO GERA, e o mock precisa disso para o estado "nunca gerado" ser caminhável: abrir a
    // aba tem de mostrar o vazio com o botão, não uma foto que apareceu sozinha.
    async getRelatorioFaturamento(companyId, competencia) {
      await delay(60);
      const salvo = mockRelatoriosFaturamento.get(`${companyId}|${competencia}`) || null;
      return { ok: true, relatorio: salvo };
    },
    async gerarRelatorioFaturamento(companyId, competencia) {
      await delay(140);
      if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
        return { ok: false, error: "INVALID_COMPETENCIA", message: `Formato YYYY-MM esperado, recebido: ${competencia}` };
      }
      const relatorio = {
        id: `mock-relatorio-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        dados: mockRelatorioFaturamentoDados(companyId, competencia),
        geradoEm: new Date().toISOString(),
        geradoPor: "mock-user",
      };
      mockRelatoriosFaturamento.set(`${companyId}|${competencia}`, relatorio);
      return { ok: true, relatorio };
    },
    async getSugestaoAnexo() { await delay(60); return { ok: true, competencia: null, totalNotas: 0, perfilConfigurado: false, anexosAtivos: [], resumo: { alta: 0, media: 0, revisao: 0, porAnexo: {} }, notas: [] }; },
    // ─── Planejamento tributário — dados da empresa, cada campo com a PROCEDÊNCIA ──────────────
    //
    // ⚠ O CASO QUE ESTE MOCK EXISTE PARA TORNAR CAMINHÁVEL É O DA FOLHA AUSENTE (4ª empresa, com
    // atividade sujeita ao Fator R e nenhuma folha conhecida). É ele que prova offline que a tela
    // deixa o campo VAZIO, diz que não foi possível apurar, e o Simples sai INDISPONÍVEL — em vez
    // de virar Fator R 0%, Anexo V e um vencedor calculado sobre um zero que ninguém informou.
    //
    // Os demais cenários existem porque cada FONTE de folha/RBT12 se lê diferente na tela: folha do
    // fechamento, folha digitada na circular, folha somada dos lançamentos, e o nada.
    async getDadosPlanejamento(companyId) {
      await delay(70);
      const idx = mockCompanies.findIndex((c) => c.companyId === companyId);
      const empresa = idx >= 0 ? mockCompanies[idx] : null;
      if (!empresa) return { ok: false, error: "company_not_found" };

      const hoje = new Date();
      const ref = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;
      const de = new Date(Date.UTC(hoje.getUTCFullYear() - 1, hoje.getUTCMonth(), 1));
      const janelaRotulo = `${String(de.getUTCMonth() + 1).padStart(2, "0")}/${de.getUTCFullYear()}`
        + ` a ${String(hoje.getUTCMonth() || 12).padStart(2, "0")}/${hoje.getUTCMonth() === 0 ? hoje.getUTCFullYear() - 1 : hoje.getUTCFullYear()}`;

      const ok = (valor, origem) => ({ valor, apurado: true, origem, motivoAusencia: null });
      const nao = (motivoAusencia) => ({ valor: null, apurado: false, origem: null, motivoAusencia });

      const semAtividadePresumido = nao(
        "A atividade do Lucro Presumido não é derivada do CNAE: o projeto não tem de-para CNAE→presunção "
        + "de IRPJ/CSLL, e errar entre 8% e 32% inverteria a comparação. Escolha na tela.",
      );

      const cenarios = [
        // 0 — tudo apurado, Fator R com folha vinda do fechamento.
        {
          receitaAnual: ok(1_850_000, `notas fiscais emitidas e autorizadas de ${janelaRotulo} (214 notas)`),
          rbt12: ok(1_790_000, "apuração de 05/2026 (transmitida)"),
          folhaAnual: ok(560_000, "folha de 12 meses informada no fechamento de 05/2026"),
          regimeAtual: ok("SIMPLES_NACIONAL", "cadastro fiscal da empresa"),
          anexo: nao("Atividade sujeita ao Fator R: o anexo sai da folha (III a partir de 28%, V abaixo), não do cadastro."),
          sujeitoFatorR: ok(true, "cadastro fiscal da empresa (campo \"usa Fator R\")"),
          aliquotaIss: ok(0.05, "perfil de atividades — CNAE 6202300 (5%)"),
          atividadePresumido: semAtividadePresumido,
        },
        // 1 — Lucro Presumido, folha digitada na circular, sem ISS no perfil.
        {
          receitaAnual: ok(4_100_000, `notas fiscais emitidas e autorizadas de ${janelaRotulo} (98 notas)`),
          rbt12: ok(4_050_000, "circular de 06/2026 (soma móvel de 12 meses)"),
          folhaAnual: ok(1_240_000, "folha de 12 meses digitada na circular de 06/2026 (MANUAL)"),
          regimeAtual: ok("LUCRO_PRESUMIDO", "cadastro da empresa (regime tributário: \"LUCRO_PRESUMIDO\")"),
          anexo: nao("Anexo do Simples não cadastrado — escolha na tela."),
          sujeitoFatorR: ok(false, "cadastro fiscal da empresa (campo \"usa Fator R\")"),
          aliquotaIss: nao("Alíquota de ISS não informada no perfil de atividades da empresa."),
          atividadePresumido: semAtividadePresumido,
        },
        // 2 — a folha vem dos LANÇAMENTOS, e parcial: 9 dos 12 meses. A origem diz isso.
        {
          receitaAnual: ok(820_000, `notas fiscais emitidas e autorizadas de ${janelaRotulo} (63 notas)`),
          rbt12: ok(810_000, "extrato de RBT12 de 06/2026 · origem PARCIAL_LOCAL"),
          folhaAnual: ok(198_400, `soma dos lançamentos de folha/pró-labore de ${janelaRotulo} (9 de 12 meses com lançamento)`),
          regimeAtual: ok("SIMPLES_NACIONAL", "cadastro fiscal da empresa"),
          anexo: ok("III", "cadastro da empresa (anexo do Simples)"),
          sujeitoFatorR: ok(false, "cadastro fiscal da empresa (campo \"usa Fator R\")"),
          aliquotaIss: ok(0.02, "perfil de atividades — CNAE 4711302 (2%)"),
          atividadePresumido: semAtividadePresumido,
        },
        // 3 — ⚠⚠ FOLHA AUSENTE COM ATIVIDADE DE FATOR R. O caso caro, e o único que prova a regra.
        {
          receitaAnual: ok(1_200_000, `notas fiscais emitidas e autorizadas de ${janelaRotulo} (140 notas)`),
          rbt12: ok(1_150_000, "apuração de 06/2026 (fechada)"),
          folhaAnual: nao(
            "Não foi possível apurar a folha dos 12 meses. Sem ela o Fator R não se calcula — e um zero "
            + "aqui jogaria a empresa no Anexo V sem que ninguém tivesse informado a folha.",
          ),
          regimeAtual: ok("SIMPLES_NACIONAL", "cadastro fiscal da empresa"),
          anexo: nao("Atividade sujeita ao Fator R: o anexo sai da folha (III a partir de 28%, V abaixo), não do cadastro."),
          sujeitoFatorR: ok(true, "cadastro fiscal da empresa (campo \"usa Fator R\")"),
          aliquotaIss: nao("Alíquota de ISS não informada no perfil de atividades da empresa."),
          atividadePresumido: semAtividadePresumido,
        },
        // 4 — regime NÃO cadastrado: a tela tem de dizer que não sabe, não supor Simples.
        {
          receitaAnual: ok(390_000, `notas fiscais emitidas e autorizadas de ${janelaRotulo} (22 notas)`),
          rbt12: ok(380_000, "extrato de RBT12 de 06/2026 · origem PARCIAL_LOCAL"),
          folhaAnual: nao(
            "Não foi possível apurar a folha dos 12 meses. Sem ela o Fator R não se calcula — e um zero "
            + "aqui jogaria a empresa no Anexo V sem que ninguém tivesse informado a folha.",
          ),
          regimeAtual: nao("Regime atual não cadastrado. Sem ele a comparação continua valendo, mas ninguém pode dizer de onde a empresa está saindo."),
          anexo: nao("Anexo do Simples não cadastrado — escolha na tela."),
          sujeitoFatorR: nao("Sem cadastro fiscal não há como saber se a atividade é sujeita ao Fator R."),
          aliquotaIss: nao("Alíquota de ISS não informada no perfil de atividades da empresa."),
          atividadePresumido: semAtividadePresumido,
        },
        // 5 — empresa zerada: NENHUMA nota no período. Receita AUSENTE, não R$ 0,00.
        {
          receitaAnual: nao(`Não foi possível apurar a receita: nenhuma nota emitida autorizada em ${janelaRotulo}.`),
          rbt12: nao("Não foi possível apurar o RBT12: nenhuma apuração, extrato ou circular com receita acumulada nos 12 meses anteriores."),
          folhaAnual: nao(
            "Não foi possível apurar a folha dos 12 meses. Sem ela o Fator R não se calcula — e um zero "
            + "aqui jogaria a empresa no Anexo V sem que ninguém tivesse informado a folha.",
          ),
          regimeAtual: ok("SIMPLES_NACIONAL", "cadastro fiscal da empresa"),
          anexo: ok("I", "cadastro da empresa (anexo do Simples)"),
          sujeitoFatorR: ok(false, "cadastro fiscal da empresa (campo \"usa Fator R\")"),
          aliquotaIss: nao("Alíquota de ISS não informada no perfil de atividades da empresa."),
          atividadePresumido: semAtividadePresumido,
        },
      ];

      return {
        ok: true,
        empresa: { id: empresa.companyId, razao: empresa.razao, cnpj: empresa.cnpj },
        referencia: { competencia: ref, janela: [], janelaRotulo },
        campos: cenarios[idx % cenarios.length],
      };
    },
    // Mock com atividade SUJEITA A FATOR R e folha derivada dos lançamentos — é a única forma de
    // conferir a comparação da folha sem backend. A folha digitada vem DIFERENTE da derivada de
    // propósito: o caso que precisa avisar é a divergência, não a coincidência.
    async getFechamento(companyId, competencia) {
      await delay(60);
      const pas = [];
      const [y, m] = String(competencia || "2026-06").split("-").map(Number);
      for (let i = 12; i >= 1; i--) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        // `pa` como STRING "YYYY-MM": é o formato que o modal usa (`pasAnteriores`) e que ele
        // envia de volta ao salvar. Usar número aqui fazia o prefill não casar.
        pas.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }
      // ⚠ A EMPRESA SEM FATURAMENTO PRECISA EXISTIR AQUI — era ela que faltava.
      // O mock devolvia 120.000 fixos, então a competência zerada (`semMovimentoDisponivel`) e a
      // caixa "Declarar SEM MOVIMENTO" eram **inalcançáveis offline** — e foi exatamente esse o
      // caminho que quebrou em produção sem ninguém ver. A regra é a MESMA que o resto do mock já
      // usa (`mockFaturamentoDaCompetencia`: competência ímpar = 0), não uma convenção nova.
      //
      // E a lista de atividades vem preenchida com **R$ 0,00**, reproduzindo o que
      // `montarAtividadesDoCnae` faz no backend ("emite a linha mesmo com faturamento 0, só pra
      // TRAZER o ANEXO"): é essa linha que escondia a caixa dentro do ramo "lista vazia".
      const fat = mockFaturamentoDaCompetencia(companyId, competencia);
      const zerada = fat === 0;
      // ⚠ A MARCA DE "EMPRESA ZERADA" E O ESTADO DA ENTREGA PRECISAM SOBREVIVER AO RELOAD AQUI.
      // Era `semFaturamento: false` fixo: marcar a competência e reabrir o modal mostrava tudo de
      // novo como se ninguém tivesse marcado nada — justamente o caminho que se quer conferir
      // offline. Agora lê a mesma Circular que `setSemFaturamento` escreve.
      const circular = mockMonthlyCirculars.get(makeCircularKey(companyId, competencia)) || {};
      const entregaFora = mockEntregaPgdasExterna.get(makeCircularKey(companyId, competencia)) || null;
      // `razao`/`cnpj` fazem parte do contrato do backend (`getDadosFechamento`) e faltavam aqui.
      // A confirmação de "empresa zerada" REPETE empresa e competência — sem o CNPJ, o mock
      // mostrava uma confirmação diferente da de produção, que é justamente onde o erro custa.
      const empresa = mockCompanies.find((c) => c.companyId === companyId) || null;
      // ─── O VALOR VEM DA PRÓPRIA COMPETÊNCIA, E A FORMA VEM DA MEMÓRIA ────────────────────────
      //
      // A memória perdeu o valor (`ApuracaoConfigMemory` não tem competência: guardar valor ali
      // carregava o faturamento de um mês para dentro de outro). Sobraram TRÊS caminhos, e o mock
      // precisa dos três — o segundo e o terceiro são os que não existiam offline:
      //
      //  1. uma atividade, mercado interno → o total da competência entra em `valorInterno`;
      //  2. uma atividade, mercado EXTERNO → o total entra em `valorExterno`. É o caso da empresa
      //     que presta serviço ao exterior; `flagExportacao` nunca é escrita para NFS-e, então SÓ a
      //     memória sabe disso, e é aqui que se confere que a informação sobrevive;
      //  3. DUAS atividades → valor `null` nas duas, porque não existe regra de rateio. É o caso que
      //     prova o `?? ""` do input: com `|| 0` a tela mostraria um zero fabricado.
      //
      // Distribuição por índice de empresa (mesmo padrão de `mockConferenciaAdn`) — variar por
      // competência esconderia um caminho atrás de "abra outro mês".
      const idxEmpresa = mockCompanies.findIndex((c) => c.companyId === companyId);
      const formaMock = idxEmpresa < 0 ? 0 : idxEmpresa % 3;
      const atividadeFatorR = { idAtividade: 11, descricao: "Serviços sujeitos ao Fator R", anexoImplicito: "III", sujeitoFatorR: true, tipoReceita: "SERVICO_FATOR_R" };
      const atividadesMock = formaMock === 2
        ? [
          { ...atividadeFatorR, mercado: "INTERNO", valorInterno: null, valorExterno: null },
          { idAtividade: 1, descricao: "Revenda de mercadorias", anexoImplicito: "I", mercado: "INTERNO", sujeitoFatorR: false, tipoReceita: "REVENDA", valorInterno: null, valorExterno: null },
        ]
        : formaMock === 1
          ? [{ ...atividadeFatorR, mercado: "EXTERNO", valorInterno: 0, valorExterno: fat }]
          : [{ ...atividadeFatorR, mercado: "INTERNO", valorInterno: fat, valorExterno: 0 }];
      const prefillValorMock = formaMock === 2
        ? {
          total: fat, indefinido: true, mercadoAplicado: null, origem: "faturamento_da_competencia",
          motivo: "A configuração lembrada desta empresa tem 2 atividades, e o portal não tem como "
            + "saber quanto do faturamento da competência cabe a cada uma — não existe regra de "
            + "rateio. Preencha os valores.",
        }
        : {
          total: fat, indefinido: false, motivo: null,
          mercadoAplicado: formaMock === 1 ? "EXTERNO" : "INTERNO",
          origem: "faturamento_da_competencia",
        };
      return {
        ok: true,
        dados: {
          razao: empresa?.razao || null,
          cnpj: empresa?.cnpj || null,
          // ⚠ O faturamento exibido é o MESMO que `mockFaturamentoDaCompetencia` devolve. Eram
          // 120.000 fixos aqui contra 18.500,75 lá: a tela dizia um número e a recusa do Calcular
          // citava outro — offline, o contador conferia uma incoerência que produção não tem.
          faturamento: { interno: formaMock === 1 ? 0 : fat, externo: formaMock === 1 ? fat : 0, total: fat },
          semMovimentoDisponivel: zerada,
          empresaZerada: false,
          semFaturamento: circular.semFaturamento === true,
          semFaturamentoEm: circular.semFaturamentoEm || null,
          semFaturamentoConferencia: circular.semFaturamentoConferencia || null,
          // Fatos crus, como no backend: quem os combina é `features/apuracao/lib/entregaPgdas.js`.
          entregaPgdas: {
            numeroDeclaracaoRfb: circular.pgdasNumeroDeclaracao || null,
            temPdfDaDeclaracao: Boolean(circular.pgdasDeclaracaoFileId),
            extratoStatus: circular.serproSyncStatus || null,
            extratoConsultadoEm: circular.serproLastSyncAt || null,
            declaradaForaEm: entregaFora?.transmitidaEm || null,
            declaradaForaPor: entregaFora?.transmitidaPorId || null,
            declaradaForaObservacao: entregaFora?.observacao || null,
          },
          atividades: atividadesMock,
          origemAtividades: "memoria(2026-07-31)",
          prefillValor: prefillValorMock,
          rbt12: 480000, disparidades: [], estado: "aberta", regimeApuracao: "COMPETENCIA",
          // Digitado: 5.000 em todos os meses. Derivado: 5.000, MENOS num mês (4.200) — divergência
          // de 800, que é a que a tela precisa apontar, inclusive na célula do mês.
          folhaMensal12: pas.map((pa) => ({ pa, valor: 5000 })),
          folhaDerivada: {
            disponivel: true,
            total: 59200,
            mesesComLancamento: 12,
            competencias: pas,
            porMes: pas.map((pa, i) => ({ competencia: pa, valor: i === 3 ? 4200 : 5000, lancamentos: 1 })),
            serie: pas.map((pa, i) => ({ pa: Number(pa.replace("-", "")), valor: i === 3 ? 4200 : 5000 })),
          },
        },
      };
    },
    // Antes devolvia SEMPRE `ok:true` com `dasValor: 0` — ou seja, o caminho de erro do Calcular
    // não existia offline, e foi exatamente ali que o bug morava (o erro chegava e era engolido).
    // Agora o mock reproduz os DOIS desfechos que o backend real produz:
    //  1. recusa `ok:false` — a guarda anti-zero da Q55 (`APURACAO_ZERADA_COM_FATURAMENTO`): as
    //     atividades somam zero numa empresa que TEM faturamento. É alcançável na tela (basta
    //     zerar o valor da atividade) e o mock tem 120.000 fixos de faturamento;
    //  2. 200 SEM `valoresDevidos` — a RFB responde só com mensagens, `dasValor` fica null e a
    //     caixa de resultado precisa avisar em vez de pintar de verde com "—".
    // ⚠ A mensagem do caso 2 é ROTULADA como mock de propósito: não inventamos texto da RFB.
    async calcularFechamento(companyId, competencia, payload = {}) {
      await delay(150);
      const atividades = Array.isArray(payload.atividades) ? payload.atividades : [];
      const somaAtividades = atividades.reduce(
        (s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0,
      );
      // ⚠ A DECISÃO É PELA SOMA, igual ao backend — lista vazia e lista de R$ 0,00 produzem o
      // mesmo payload, porque `buildDeclaracaoPayload` descarta a linha de valor 0.
      if (somaAtividades === 0) {
        // ⚠ Faturamento consultado ANTES da mensagem, na mesma ordem do backend: mandar quem tem
        // nota "marcar sem movimento" é apontar para uma ação que a trava seguinte recusa.
        const fat = mockFaturamentoDaCompetencia(companyId, competencia);
        if (fat > 0) {
          return payload.semMovimento
            ? {
              ok: false,
              error: "SEM_MOVIMENTO_COM_FATURAMENTO",
              message: `Não é possível declarar sem movimento: a empresa tem faturamento de R$ ${fat.toFixed(2)} na competência.`,
            }
            : {
              ok: false,
              error: "APURACAO_ZERADA_COM_FATURAMENTO",
              message: `Empresa com faturamento de R$ ${fat.toFixed(2)} na competência, mas as atividades somam R$ 0,00. Classifique/preencha as receitas antes de apurar.`,
            };
        }
        if (!payload.semMovimento) {
          return {
            ok: false,
            error: "NO_ATIVIDADES",
            message: atividades.length
              ? "As atividades somam R$ 0,00. Preencha os valores, ou marque \"Declarar SEM MOVIMENTO\" se o mês realmente não teve receita."
              : "Sem atividades pra calcular. Adicione a atividade, ou marque \"Declarar SEM MOVIMENTO\" se o mês realmente não teve receita.",
          };
        }
        // ⚠ A DECLARAÇÃO ZERADA PASSA — e é o desfecho que precisa ser caminhável offline.
        //
        // O mock devolvia aqui a recusa da RFB ("O valor da atividade deve ser maior que zero"),
        // que era o desfecho real enquanto o payload saía com `atividades: []`. A causa foi
        // corrigida em `buildDeclaracaoPayload` (a chave é OMITIDA quando não há atividade, como a
        // documentação do TRANSDECLARACAO11 manda), então manter a recusa aqui ensinaria offline um
        // comportamento que o backend não tem mais.
        //
        // ⚠ A recusa continua coberta — em `apuracao/v2/__tests__/declaracaoZerada.test.js`, onde
        // ela é exceção testada, e não a paisagem de quem abre a tela.
        //
        // ⚠ E o DAS zero não é "nada a pagar por engano": mês sem receita não gera DAS, e a
        // declaração continua sendo obrigatória (Manual PGDAS-D/DEFIS §6.4.1).
        return {
          ok: true,
          result: {
            dasValor: 0,
            rbt12: 0,
            mensagens: ["MOCK: declaração sem movimento — receita R$ 0,00, nenhuma atividade informada."],
          },
        };
      }
      const folha = Array.isArray(payload.folhaMensal12) ? payload.folhaMensal12 : [];
      const totalFolha = folha.reduce((s, f) => s + Number(f?.valor || 0), 0);
      if (atividades.some((a) => a?.sujeitoFatorR) && totalFolha === 0) {
        return {
          ok: true,
          result: {
            dasValor: null,
            rbt12: null,
            mensagens: ["MOCK: cenário de retorno sem valores devidos, para conferir a tela. Não é texto da RFB."],
          },
        };
      }
      return { ok: true, result: { dasValor: 12345.67, rbt12: 480000, mensagens: [] } };
    },
    async salvarFechamento() { await delay(80); return { ok: true, result: { snapshot: { estado: "fechada" } } }; },
    async transmitirFechamento() { await delay(200); return { ok: true, result: { numeroDeclaracao: "MOCK-1", dasValor: 0 } }; },
    async reabrirFechamento() { await delay(80); return { ok: true, result: { snapshot: { estado: "calculada" } } }; },
    async retificarFechamento() { await delay(200); return { ok: true, result: { numeroDeclaracao: "MOCK-RET-1", dasValor: 0 } }; },
    // ⚠ Registra a AFIRMAÇÃO de entrega feita fora do portal — não transmite nada e não vira prova.
    // A recusa da confirmação é reproduzida de propósito: é ato de consequência.
    async registrarEntregaPgdasExterna(companyId, competencia, { entregue, confirmCompetencia, observacao } = {}) {
      await delay(80);
      if (entregue === true && confirmCompetencia !== competencia) {
        return {
          ok: false,
          error: "confirm_competencia_mismatch",
          message: "Confirme a competência exata para registrar a entrega feita fora do portal.",
        };
      }
      const chave = makeCircularKey(companyId, competencia);
      if (entregue === true) {
        mockEntregaPgdasExterna.set(chave, {
          transmitidaEm: new Date().toISOString(),
          transmitidaPorId: "mock-user",
          observacao: String(observacao || "").trim() || null,
        });
      } else {
        mockEntregaPgdasExterna.delete(chave);
      }
      return { ok: true, result: { competencia, entregueFora: entregue === true } };
    },
    async listAtividadesPgdasd() { await delay(40); return { ok: true, atividades: [] }; },
    async criarApuracaoBatch() { await delay(100); return { ok: true, jobId: "mock-job", totalEmpresas: 0 }; },
    async getApuracaoBatch() { await delay(60); return { ok: true, job: { status: "completed", okCount: 0, errorCount: 0, pendenteCount: 0, totalEmpresas: 0 }, items: [] }; },
    async runApuracaoBatch() { await delay(80); return { ok: true, job: { status: "completed", okCount: 0, errorCount: 0, pendenteCount: 0, totalEmpresas: 0 } }; },
    async getCompanyCert() { await delay(60); return { hasCertificate: false, uploadedAt: null, expiresAt: null }; },
    async uploadCompanyCert() { await delay(150); return { ok: true, certificate: { uploadedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365*86400000).toISOString() } }; },
    async deleteCompanyCert() { await delay(60); return { ok: true }; },

    // ── Q6: stubs (mock não persiste; só retorna estrutura básica para não quebrar UI) ──
    async listAccountingFunctions() { await delay(80); return []; },
    async createAccountingFunction() { await delay(80); return { ok: true, data: null }; },
    async updateAccountingFunction() { await delay(80); return { ok: true, data: null }; },
    async deleteAccountingFunction() { await delay(80); return { ok: true }; },
    async applyAccountingFunction() { await delay(80); return { ok: true, entries: [] }; },

    // ── Parcelamentos (mock COM ESTADO) ─────────────────────────────────
    // ⚠ Este mock era `[]`, e por isso a aba Parcelamento não tinha COMO ser conferida offline —
    // nenhuma mudança no card aparecia. Os três casos fixos abaixo existem para exercitar o aviso
    // de risco de rescisão nos seus três desfechos: em dia, uma em atraso, e já rescindível.
    // As datas são relativas a hoje, senão o mock envelhece e os três viram "rescindível".
    //
    // ⚠ F2.3 — ELE AGORA GUARDA O QUE O WIZARD CRIA. Sem isso o aceite da fase ("registrar um
    // parcelamento migrado — 23ª de 60, saldo declarado, débito automático — SEM NENHUM PDF, e o
    // card mostrar 22 pagas (históricas) / 38 restantes") não teria como ser exercido offline: a
    // lista voltaria sempre a mesma e a criação pareceria não fazer nada. Mock que só sabe o
    // caminho feliz esconde exatamente o que a tela existe para mostrar.
    async listParcelamentos() {
      await delay(80);
      // Os criados nesta sessão vêm primeiro — é o que o contador acabou de fazer.
      return [...mockParcelamentosCriados.values(), ...construirParcelamentosFixos()];
    },
    async createParcelamento() { await delay(80); return { ok: true, data: null }; },

    // ⚠ A PORTA DO PARCELAMENTO-FIRST. `guideId` AUSENTE é o caminho principal, não a exceção:
    // cria o CONTRATO sem documento nenhum. Com `guideId`, apenas ANEXA a guia a uma prestação de
    // um contrato que já existe — e NÃO confirma pagamento nem lança baixa.
    async ingestParcelamento(companyId, body = {}) {
      await delay(120);
      const header = body.header || {};
      const numero = String(header.numeroParcelamento || "").trim();

      // ── Caminho de RECUSA, exercitável na tela: nº "0" devolve o erro de composição do backend.
      if (numero === "0") {
        const err = new Error("Σ dos tributos não fecha com o valor total da parcela.");
        err.error = "COMPOSICAO_INVALIDA";
        throw err;
      }
      if (!numero) {
        const err = new Error("Informe o nº do parcelamento.");
        err.error = "numero_parcelamento_required";
        throw err;
      }

      const chave = `${header.tipo}|${numero}`;
      const existente = [...mockParcelamentosCriados.values()].find((p) => `${p.tipo}|${p.numeroParcelamento}` === chave);

      // ── ANEXAR guia a um contrato existente ────────────────────────────────────────────────────
      if (body.guideId) {
        const alvo = existente;
        if (!alvo) {
          const err = new Error("Parcelamento não encontrado para esta guia.");
          err.error = "parcelamento_not_found";
          throw err;
        }
        const n = Number(header.numeroParcela);
        const linha = alvo.parcelasContratadas.find((p) => p.numeroParcela === n);
        if (linha) {
          linha.guia = { id: body.guideId, vencimento: header.vencimento || linha.vencimento, paymentStatus: "OPEN", baixada: false };
          alvo.guides.push({
            id: body.guideId, numeroParcela: n, valor: alvo.valorParcelaReferencia,
            paymentStatus: "OPEN", baixada: false,
            competencia: (header.anoMesParcela || "").replace(/^(\d{4})(\d{2})$/, "$1-$2"),
            anoMesParcela: header.anoMesParcela, vencimento: header.vencimento || linha.vencimento,
            numeroDocumento: `07202600009${String(n).padStart(3, "0")}`,
            comprovante: null, paymentConfirmedAt: null,
            serproLastCheckedAt: null, serproLastCheckResult: null,
          });
        }
        // ⚠ NADA DE PAGAMENTO AQUI. Anexar é só anexar — o `paymentStatus` continua OPEN.
        return { ok: true, data: { parcelamentoId: alvo.id, criouParcelamento: false, marcadasHistorico: 0 } };
      }

      // ── CRIAR o contrato, SEM GUIA ─────────────────────────────────────────────────────────────
      const total = Math.max(1, Number(header.quantidadeParcelas) || 1);
      const jaPagas = Math.max(0, Math.min(total - 1, Number(body.parcelasJaPagas) || 0));
      const compInicial = String(header.anoMesParcela || "").replace(/^(\d{4})(\d{2})$/, "$1-$2");
      const diaVenc = Math.min(31, Math.max(1, Number(header.diaPagamento) || 1));
      const linhas = [];
      for (let n = 1; n <= total; n += 1) {
        const m = compInicial.match(/^(\d{4})-(\d{2})$/);
        let vencimento = null;
        if (m) {
          const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + (n - 1), 1));
          const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
          vencimento = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(diaVenc, ultimo), 12)).toISOString();
        }
        linhas.push({
          id: `novo-${numero}-p${n}`,
          numeroParcela: n,
          // ⚠ SEM `competencia`, de propósito: `SELECT_PARCELA_PARA_QUADRO` (o select real que
          // alimenta `parcelasContratadas`) não a traz. Um mock que a mandasse esconderia o campo
          // Competência do modal de anexo nascendo vazio em produção — foi assim que o defeito
          // apareceu. Quem precisa dela a deriva do vencimento (`competenciaDaParcela`).
          vencimento,
          // ⚠ `HISTORICO` é VOCABULÁRIO de `origemBaixa`, não coluna nova: as N primeiras contam
          // como quitadas e NÃO geram lançamento nenhum.
          origemBaixa: n <= jaPagas ? "HISTORICO" : null,
          guia: null,
        });
      }
      // ⚠ O VALOR DA PRESTAÇÃO VEM DO PAYLOAD, e não mais de uma derivação inventada aqui.
      // O mock dividia `valorPrincipal` pelas restantes — o real NÃO faz isso: `buildDTOsFromManual`
      // deriva a parcela da composição por tributo e, sem guia e sem tributos, ela é ZERO. O mock
      // "resolvia" sozinho o defeito que fez a SINTROPIA nº 1 nascer com `valorParcelaReferencia = 0`,
      // e por isso ele nunca apareceu offline. Agora o wizard envia `header.valorParcela` (o valor
      // CHEIO da prestação) e os dois lados leem o mesmo campo.
      const valorParcela = Number(header.valorParcela) > 0 ? Math.round(Number(header.valorParcela) * 100) / 100 : 0;
      // ⚠ O PRINCIPAL POR PRESTAÇÃO É OUTRA COISA — sai de `principalTotal / numParcelas`, e é
      // `null` quando não se sabe (`principalPorParcelaDoContrato`, no backend).
      const principalTotalMock = Number(header.valorPrincipal) || 0;
      const principalPorParcela = principalTotalMock > 0 && total >= 1
        ? Math.round((principalTotalMock / total) * 100) / 100
        : null;
      const principalPagoMock = principalPorParcela != null
        ? Math.round(jaPagas * principalPorParcela * 100) / 100
        : null;
      const novo = {
        id: `novo-${numero}`,
        label: `PARCELAMENTO ${header.tipo}${numero ? ` Nº ${numero}` : ""}`,
        tipo: header.tipo,
        numeroParcelamento: numero,
        status: "ATIVO",
        numParcelas: total,
        principalTotal: Number(header.valorPrincipal) || 0,
        jurosTotal: Number(header.valorJuros) || 0,
        valorMulta: Number(header.valorMulta) || 0,
        totalValue: Number(header.valorTotal) || Number(header.valorPrincipal) || 0,
        principalPerParcela: valorParcela,
        valorParcelaReferencia: valorParcela,
        formaPagamento: header.formaPagamento || null,
        diaPagamento: diaVenc,
        saldoConsolidado: header.saldoConsolidado ?? null,
        observacoes: header.descricao || null,
        parcelasPagas: jaPagas,
        parcelasTotal: total,
        // Prestação sem guia e sem baixa não tem evidência nenhuma — e isso NÃO é inadimplência.
        parcelasSemEvidencia: total - jaPagas,
        // ⚠ OS QUATRO NÚMEROS DERIVADOS, com os mesmos nomes e a mesma NULABILIDADE do backend
        // (`decorateParcelamento`). `saldoRestante` SAIU: ele misturava o consolidado do acordo com
        // um "principal" que vinha de `principalPerParcela` — coluna que guarda o valor CHEIO no V2.
        principalPorParcela,
        principalPago: principalPagoMock,
        saldoContratual: principalTotalMock > 0 && principalPagoMock != null
          ? Math.max(0, Math.round((principalTotalMock - principalPagoMock) * 100) / 100)
          : null,
        // O passivo do razão: a provisão da adesão credita `PARC` pela soma das linhas.
        saldoPassivo: Number(header.valorTotal) || null,
        parcelas: [],
        guides: [],
        parcelasContratadas: linhas,
        // ⚠ Sem evidência de pagamento nenhuma, o risco NÃO é avaliável — acender "rescindível" num
        // débito automático saudável seria inventar inadimplência a partir de ausência de dado.
        risco: { avaliavel: false, nivel: null, emAtraso: 0, parcelasEmAtraso: [], regra: null },
      };
      mockParcelamentosCriados.set(novo.id, novo);
      return { ok: true, data: { parcelamentoId: novo.id, criouParcelamento: true, marcadasHistorico: jaPagas } };
    },

    // ⚠ A MEMÓRIA DE CONTAS É DO ESCRITÓRIO E NASCE VAZIA numa modalidade nova. É essa distinção
    // que o passo 3 do wizard usa para abrir em modo edição na PRIMEIRA VEZ de uma modalidade —
    // um mock que sempre devolvesse contas esconderia esse caminho inteiro.
    async getContasProvisao(companyId, tipo) {
      await delay(40);
      const comMemoria = ["PARCSN", "PARCMEI"];
      if (comMemoria.includes(String(tipo || "").toUpperCase())) {
        return { ok: true, contas: { PRINCIPAL: "265", PARC: "553", JUROS: "501", CAIXA: "111" } };
      }
      return { ok: true, contas: { PRINCIPAL: "", PARC: "", JUROS: "", CAIXA: "" } };
    },

    // ⚠ CAMINHO DE FALHA ESPERADO, e é o estado REAL de produção: a flag
    // `INTEGRACAO_SERPRO_PARCELAMENTO` está DESLIGADA, então a rota responde 400 com a mensagem.
    // O mock que devolvia dados fazia o atalho do wizard parecer funcionar offline e falhar só no
    // ar — exatamente o caso que a tela precisa tratar como recusa nomeada.
    // O número `999` devolve dados, para o caminho feliz também ser exercível.
    async consultarParcelamentoSerpro(companyId, { numeroParcelamento } = {}) {
      await delay(60);
      if (String(numeroParcelamento || "").trim() === "999") {
        return { ok: true, parcelamento: { tipo: "PARCSN", numeroParcelamento: "999", valorTotal: 45600, quantidadeParcelas: 60, situacao: "EM_DIA", origem: "SERPRO" } };
      }
      const err = new Error("Integração SERPRO de parcelamento está desligada — ative após validar no sandbox para buscar por código.");
      err.error = "SERPRO_PARC_FLAG_OFF";
      throw err;
    },
    async getParcelamentoConfig() { await delay(40); return { ok: true, parcelamento: { id: "mock", configProvisao: null, configPagamento: null } }; },
    async saveParcelamentoConfig() { await delay(40); return { ok: true, parcelamento: { id: "mock" } }; },
    async getConferenciaParcelas() { await delay(40); return { ok: true, items: [] }; },
    async aprovarConferenciaParcelas() { await delay(40); return { ok: true, aprovadas: 0 }; },
    async rescindirParcelamento(companyId, parcId) {
      await delay(80);
      mockParcelamentosCriados.delete(parcId);
      return { ok: true };
    },

    // ── OS ATOS DO CONTRATO ─────────────────────────────────────────────────────────────────────
    //
    // ⚠ O PREVIEW É A METADE QUE IMPORTA, e por isso o mock o monta de verdade a partir do contrato
    // (prestações, guias, quitadas), em vez de devolver uma fixture congelada: é ele que a tela
    // mostra antes do clique, e um mock que devolvesse números redondos esconderia exatamente o que
    // esta fase existe para provar — que a confirmação repete os DADOS, não um "tem certeza?".
    //
    // ⚠ O MOCK TAMBÉM CONHECE OS CAMINHOS DE RECUSA (mês fechado e motivo curto). Mock que só sabe o
    // caminho feliz deixa a recusa aparecer pela primeira vez em produção.
    async previewExclusaoParcelamento(companyId, parcId) {
      await delay(60);
      return construirPreviewExclusaoMock(companyId, parcId);
    },

    async excluirParcelamento(companyId, parcId, { motivo, totalConferido } = {}) {
      await delay(120);
      if (String(motivo || "").trim().length < 5) {
        throw mockRecusa("MOTIVO_OBRIGATORIO", "Informe o motivo (mínimo 5 caracteres).");
      }
      const preview = construirPreviewExclusaoMock(companyId, parcId);
      // ⚠ A CONFERÊNCIA DO TOTAL É REAL NO MOCK, pelo mesmo motivo da baixa manual: ela é a guarda
      // que impede excluir algo diferente do que foi confirmado, e um mock permissivo deixaria a
      // divergência aparecer só em produção.
      if (totalConferido != null && Math.abs(Number(totalConferido) - preview.totalDesfeito) > 0.01) {
        throw mockRecusa("CONFERENCIA_DIVERGENTE", "O contrato mudou desde que a tela abriu — confira de novo.");
      }
      mockParcelamentosExcluidos.add(parcId);
      mockParcelamentosCriados.delete(parcId);
      return {
        ok: true, atoId: `mock-ato-${parcId}`, modo: preview.modo,
        cabecalhoRemovido: preview.cabecalhoRemovido,
        prestacoesRemovidas: preview.prestacoes.total,
        guiasDesvinculadas: preview.guias.total,
        lancamentosApagados: preview.lancamentos.apagados,
        lancamentosPreservados: preview.lancamentos.preservados,
        totalDesfeito: preview.totalDesfeito,
      };
    },

    async previewDesfazerRescisao(companyId, parcId) {
      await delay(60);
      const parc = [...mockParcelamentosCriados.values(), ...construirParcelamentosFixos()]
        .find((p) => p.id === parcId);
      if (!parc) throw mockRecusa("parcelamento_nao_encontrado", "Parcelamento não encontrado.");
      const bloqueios = parc.status === "RESCINDIDO" ? [] : [{
        code: "PARCELAMENTO_NAO_RESCINDIDO",
        message: `Este parcelamento está ${parc.status} — não há rescisão a desfazer.`,
      }];
      const fimDeHoje = new Date();
      fimDeHoje.setHours(23, 59, 59, 999);
      const voltamParaFila = (parc.parcelasContratadas || []).filter((c) => !c.guia && !c.origemBaixa
        && c.vencimento && new Date(c.vencimento).getTime() <= fimDeHoje.getTime()).length;
      return {
        parcelamento: {
          id: parc.id, label: parc.label, tipo: parc.tipo,
          numeroParcelamento: parc.numeroParcelamento, status: parc.status, numParcelas: parc.numParcelas,
        },
        modo: "DELECAO",
        competenciaContraLancamento: null,
        competenciasFechadas: [],
        // ⚠ ZERO LANÇAMENTO É O CASO REAL: os dois contratos rescindidos de produção são cascas
        // vazias — a rescisão não gerou lançamento nenhum porque não havia provisão a estornar.
        lancamentos: { total: 0, preservados: 0, lista: [] },
        totalDesfeito: 0,
        prestacoes: {
          total: (parc.parcelasContratadas || []).length,
          quitadas: 0,
          semEvidencia: parc.parcelasSemEvidencia ?? 0,
          voltamParaFila,
        },
        riscoAoReativar: { avaliavel: true, nivel: "rescindivel", emAtraso: voltamParaFila },
        motivoObrigatorio: true,
        bloqueios,
      };
    },

    async desfazerRescisaoParcelamento(companyId, parcId, { motivo } = {}) {
      await delay(120);
      if (String(motivo || "").trim().length < 5) {
        throw mockRecusa("MOTIVO_OBRIGATORIO", "Informe o motivo (mínimo 5 caracteres).");
      }
      mockRescisoesDesfeitas.add(parcId);
      return { ok: true, atoId: `mock-ato-${parcId}`, status: "ATIVO", modo: "DELECAO" };
    },
    async vincularEntryParcelamento() { await delay(40); return { ok: true }; },

    // ── Onboarding (funil pré-cadastro) ─────────────────────────────────
    async criarOnboarding(origem) {
      await delay(180);
      const registro = {
        id: `mock-onb-${++mockOnboardingSeq}`,
        origem: String(origem || "").toUpperCase(),
        status: "RASCUNHO",
        origemPreenchimento: "ESCRITORIO",
        cnpj: null, razaoSocial: null,
        responsavelNome: null, responsavelEmail: null, responsavelTelefone: null,
        emailJaCadastrado: false,
        dados: {},
        ultimoPasso: null, enviadoEm: null, portalClientId: null,
        convertidoEm: null, desistiuEm: null, motivoDesistencia: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      mockOnboardings.set(registro.id, registro);
      mockOnboardingEtapas.set(registro.id, []);
      return { ok: true, onboarding: { ...registro, etapas: [] } };
    },

    async listarOnboardings({ origem, status, q, incluirRascunhos } = {}) {
      await delay(120);
      const busca = String(q || "").trim().toLowerCase();
      const digitos = busca.replace(/\D+/g, "");
      const itens = [...mockOnboardings.values()]
        .filter((o) => (origem ? o.origem === origem : true))
        .filter((o) => (status ? o.status === status : (incluirRascunhos ? true : o.status !== "RASCUNHO")))
        .filter((o) => {
          if (!busca) return true;
          const alvo = [o.razaoSocial, o.responsavelNome, o.responsavelEmail].filter(Boolean).join(" ").toLowerCase();
          return alvo.includes(busca) || (digitos.length >= 3 && String(o.cnpj || "").includes(digitos));
        })
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((o) => {
          const etapas = mockEtapasDe(o.id);
          return { ...o, progresso: { total: etapas.length, concluidas: etapas.filter((e) => e.concluidaEm).length } };
        });
      return { ok: true, itens };
    },

    async getOnboarding(id) {
      await delay(120);
      const registro = mockOnboardingComEtapas(id);
      if (!registro) {
        const err = new Error("Onboarding não encontrado.");
        err.code = "onboarding_nao_encontrado";
        err.status = 404;
        throw err;
      }
      return { ok: true, onboarding: registro };
    },

    async salvarOnboarding(id, patch = {}) {
      await delay(180);
      const atual = mockOnboardings.get(id);
      if (!atual) throw Object.assign(new Error("Onboarding não encontrado."), { code: "onboarding_nao_encontrado", status: 404 });
      // ⚠ Convertido é SOMENTE LEITURA — o mock repete a trava do servidor, senão o único caminho
      // que a exercita fica offline.
      if (atual.status === "CONVERTIDO") {
        throw Object.assign(new Error("Este onboarding já virou empresa."), { code: "onboarding_convertido", status: 409 });
      }

      // ⚠ TROCAR DE ORIGEM ZERA `dados`, e o mock faz isso DE VERDADE. Se só o servidor zerasse, o
      // modo mock deixaria o rascunho antigo sobreviver e a regressão só apareceria em produção.
      if (patch.origem && patch.origem !== atual.origem) {
        atual.origem = patch.origem;
        atual.dados = {};
        atual.ultimoPasso = null;
        Object.assign(atual, mockColunasDoOnboarding({}));
      } else if (patch.dados !== undefined) {
        // SUBSTITUI, não mescla.
        atual.dados = patch.dados || {};
        Object.assign(atual, mockColunasDoOnboarding(atual.dados));
      }

      if (patch.ultimoPasso !== undefined && !patch.origem) {
        atual.ultimoPasso = patch.ultimoPasso || null;
      }

      if (patch.finalizar === true) {
        if (atual.status === "RASCUNHO") {
          atual.status = "RECEBIDO";
          atual.enviadoEm = new Date().toISOString();
        }
        mockMaterializarEtapas(atual.id, atual.origem);
      }

      atual.updatedAt = new Date().toISOString();
      mockOnboardings.set(atual.id, atual);
      return { ok: true, onboarding: mockOnboardingComEtapas(atual.id) };
    },

    async salvarEtapaOnboarding(id, etapaId, patch = {}) {
      await delay(180);
      const registro = mockOnboardings.get(id);
      const etapas = mockOnboardingEtapas.get(id) || [];
      const etapa = etapas.find((e) => e.id === etapaId);
      if (!registro || !etapa) throw Object.assign(new Error("Etapa não encontrada."), { code: "etapa_nao_encontrada", status: 404 });
      if (patch.concluida !== undefined) {
        etapa.concluidaEm = patch.concluida ? new Date().toISOString() : null;
        etapa.concluidaPorId = patch.concluida ? "mock-user" : null;
      }
      if (patch.observacao !== undefined) etapa.observacao = patch.observacao || null;
      // A primeira etapa concluída promove sozinha.
      if (patch.concluida === true && registro.status === "RECEBIDO") registro.status = "EM_TRILHA";
      registro.updatedAt = new Date().toISOString();
      return { ok: true, etapa, onboarding: mockOnboardingComEtapas(id) };
    },

    async converterOnboarding(id, payload = {}) {
      await delay(180);
      const registro = mockOnboardings.get(id);
      if (!registro) throw Object.assign(new Error("Onboarding não encontrado."), { code: "onboarding_nao_encontrado", status: 404 });
      if (registro.status === "CONVERTIDO") {
        throw Object.assign(new Error("Este onboarding já foi convertido."), { code: "onboarding_convertido", status: 409 });
      }
      const portalClientId = payload.vincularPortalClientId || `mock-portal-${++mockOnboardingSeq}`;
      registro.portalClientId = portalClientId;
      registro.status = "CONVERTIDO";
      registro.convertidoEm = new Date().toISOString();
      registro.updatedAt = new Date().toISOString();
      return {
        ok: true,
        vinculado: Boolean(payload.vincularPortalClientId),
        portalClientId,
        regrasAplicadas: { regrasAvaliadas: 0, obrigacoesCriadas: 0 },
        onboarding: mockOnboardingComEtapas(id),
      };
    },

    async desistirOnboarding(id, motivo) {
      await delay(180);
      const registro = mockOnboardings.get(id);
      if (!registro) throw Object.assign(new Error("Onboarding não encontrado."), { code: "onboarding_nao_encontrado", status: 404 });
      registro.status = "DESISTIU";
      registro.desistiuEm = new Date().toISOString();
      registro.motivoDesistencia = motivo || null;
      registro.updatedAt = new Date().toISOString();
      return { ok: true, onboarding: mockOnboardingComEtapas(id) };
    },

    async descartarOnboarding(id) {
      await delay(180);
      const registro = mockOnboardings.get(id);
      if (registro && registro.status !== "RASCUNHO") {
        throw Object.assign(new Error("Só um rascunho pode ser descartado."), {
          code: "somente_rascunho_pode_ser_descartado", status: 409,
        });
      }
      mockOnboardings.delete(id);
      mockOnboardingEtapas.delete(id);
      return { ok: true };
    },

    // ── Q11.1: stubs Suspender/Reativar/Excluir ─────────────────────────
    async suspendCompany() { await delay(80); return { ok: true }; },
    async resumeCompany() { await delay(80); return { ok: true }; },
    async deleteCompany() { await delay(80); return { ok: true }; },
  };
}
