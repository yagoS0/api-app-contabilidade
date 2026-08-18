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
      portalCreatedAt: "2024-03-11T13:04:00.000Z",
      portalUpdatedAt: "2026-08-01T10:22:00.000Z",
      legacyCompany: null,
    },
    {
      // Segunda empresa: mesma pessoa, papel menor, e SEM guia liberada — o
      // estado vazio precisa ser alcançável sem editar código.
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
      portalCreatedAt: "2025-01-20T09:00:00.000Z",
      portalUpdatedAt: "2026-07-30T18:41:00.000Z",
      legacyCompany: null,
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
      empresas: ["pc-001", "pc-002"],
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

  for (const empresa of empresas) {
    const rand = prng(empresa.companyId === "pc-001" ? 20260818 : 771203);
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

  return { empresas, usuarios, notas, guias, circular, sessoes: new Map(), tokensRedefinicao };
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
  };
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
