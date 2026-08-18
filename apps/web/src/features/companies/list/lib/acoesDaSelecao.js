// O QUE DÁ PARA FAZER COM AS EMPRESAS QUE ESTÃO SELECIONADAS NA TABELA.
//
// POR QUE ESTE ARQUIVO EXISTE
// As cinco operações em lote do backend já existiam, cada uma atrás de um botão da barra do topo,
// rodando sobre "todas as empresas" ou sobre uma lista que o contador NÃO VÊ. O defeito foi nomeado
// pelo próprio dono: *"'Envio de e-mails em lote' não diz para quem vai enviar"*.
//
// Aqui a pergunta é outra e é sempre a mesma: **dadas ESTAS empresas, o que se aplica a cada uma, e
// por que não se aplica às outras?** Uma regra só, consumida pela barra de seleção e pela prévia —
// duas leituras divergiriam, e divergir aqui significa a barra oferecer uma ação que a prévia
// depois recusa.
//
// ⚠ NENHUMA AÇÃO SOME. Ação que não se aplica volta `disponivel: false` COM `motivo` — desabilitado
// mudo é proibido neste projeto, e o motivo é texto de tela, não `title`.
//
// ⚠ ESTE MÓDULO NÃO CHAMA NADA. Ele lê o payload que a listagem já tem na mão e devolve um plano.
// Quem executa é a página; quem confere de verdade é o servidor (toda rota revalida).

import { getComplianceTags } from "../components/renderCompanyCard";
import { estadoCertificado } from "./certificado";
import { empresaSemObrigacoes } from "./estadoDominante";
// ⚠ A LEITURA DO REGIME MORA EM `abaRegime.js` e é IMPORTADA — não recopiada. É a mesma função
// que decide em qual aba a empresa aparece na página principal. Com duas cópias, dava para a
// empresa cair na aba do Simples e esta barra recusá-la dizendo "Lucro Presumido/Real", na mesma
// tela. (A função nasceu aqui; mudou de arquivo para o módulo do regime — quem importa é este.)
import { regimeDe } from "./abaRegime";

/**
 * A trava de 4 h da consulta SITFIS, espelhada do backend (`SITFIS_MIN_INTERVALO_MS`).
 *
 * ⚠ ELA VIVE NOS DOIS LADOS E O BACKEND É A AUTORIDADE. Quem impede a consulta paga é a rota, que
 * responde `throttled:true` com o relatório salvo **sem chamar o SERPRO**. O número aqui existe
 * para a PRÉVIA poder dizer *quais* empresas estão dentro da janela antes do clique — não para
 * autorizar nada. Mudou lá, muda aqui.
 */
export const HORAS_TRAVA_SITFIS = 4;

/** Estados de guia que ainda pedem envio. `enviada` e `vazio` são terminais; `missing` não tem guia. */
const ESTADOS_ENVIAVEIS = new Set(["gerada", "falhou"]);

export const ACOES = {
  email: {
    chave: "email",
    rotulo: "Enviar guias por e-mail",
    irreversivel: true,
    criaJob: false,
    // A prévia desta ação NÃO é calculada aqui: ela vem de `GET /firm/guides/batch-report`, que é a
    // mesma fonte que o envio consome. Ver `resumoEnvioDoRelatorio`.
    descricao: "Um e-mail por empresa, com as guias da competência anexadas.",
    aviso: "O e-mail chega ao cliente. Não há desfazer.",
  },
  apurar: {
    chave: "apurar",
    rotulo: "Apurar e transmitir (PGDAS-D)",
    irreversivel: true,
    criaJob: false,
    descricao: "Cria a fila de transmissão do PGDAS-D para as empresas do Simples Nacional.",
    aviso: "TRANSMITE a declaração à Receita Federal. Não há desfazer — só retificadora.",
  },
  capturarNotas: {
    chave: "capturarNotas",
    rotulo: "Capturar notas (ADN/SEFAZ)",
    irreversivel: false,
    criaJob: true,
    descricao: "Consulta o ADN (NFS-e) e a SEFAZ (NF-e) e traz nota nova. Idempotente.",
    // ⚠ Não é irreversível, mas é chamada externa com limite de taxa: o ADN devolve 429 e a SEFAZ
    // bloqueia o CNPJ por 1 h (cStat 656, NT 2014.002). Disparar duas vezes piora, não acelera.
    aviso: "Chamada externa com limite de taxa (ADN 429 · SEFAZ 1 h por CNPJ). Uma vez basta.",
  },
  baixarNotas: {
    chave: "baixarNotas",
    rotulo: "Baixar XMLs (ZIP)",
    irreversivel: false,
    criaJob: true,
    // ⚠ Zipa o que JÁ está no banco — não consulta ninguém. Empresa sem captura gera pasta vazia.
    descricao: "Zipa os XMLs já capturados. Não consulta o ADN nem a SEFAZ.",
    aviso: null,
  },
  baixarSitfis: {
    chave: "baixarSitfis",
    rotulo: "Baixar situação fiscal (ZIP)",
    irreversivel: false,
    criaJob: true,
    // ⚠ NÃO é a consulta paga. Zipa o PDF do relatório que já está armazenado.
    descricao: "Zipa o relatório SITFIS já salvo. Não consulta o SERPRO — não é chamada paga.",
    aviso: null,
  },
};

/** Ordem de leitura da barra: do que sai para o cliente ao que só olha. */
export const ORDEM_ACOES = ["email", "apurar", "capturarNotas", "baixarNotas", "baixarSitfis"];

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

function horasDesde(iso, agora) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (agora - t) / 3600000;
}

/** Quantas guias desta empresa ainda pedem envio, segundo a listagem. */
export function guiasPendentesDeEnvio(company) {
  if (empresaSemObrigacoes(company)) return [];
  return getComplianceTags(company?.guideCompliance).filter((t) => ESTADOS_ENVIAVEIS.has(t.state));
}


/**
 * O plano de UMA ação sobre a seleção.
 *
 * `classificar(company)` devolve `null` (entra) ou uma string com o MOTIVO de ficar de fora.
 */
function montarAcao(meta, empresas, classificar, detalhar) {
  const alvos = [];
  const fora = [];
  for (const c of empresas) {
    const motivo = classificar(c);
    if (motivo) fora.push({ companyId: c.companyId, razao: c.razao || "—", motivo });
    else alvos.push({ companyId: c.companyId, razao: c.razao || "—", detalhe: detalhar ? detalhar(c) : null });
  }
  return { ...meta, alvos, fora };
}

/**
 * O plano completo para a seleção atual.
 *
 * @param {object[]} empresas  linhas de `GET /firm/companies` JÁ filtradas para a seleção
 * @param {string}   competencia "YYYY-MM"
 * @param {number}   agora      Date.now() injetável — a janela de 4 h do SITFIS depende dele
 * @param {number}   jobsAtivos `useBackgroundJobs().total` (ver a regra abaixo)
 */
export function planoDaSelecao({ empresas = [], competencia = null, agora = Date.now(), jobsAtivos = 0 } = {}) {
  const total = empresas.length;

  const acoes = [];

  // ── ENVIAR GUIAS ────────────────────────────────────────────────────────────────────────────
  // ⚠ O número que aparece na CONFIRMAÇÃO não sai daqui — sai de `resumoEnvioDoRelatorio`, sobre a
  // resposta de `batch-report`, que é a mesma fonte do envio. O que se calcula aqui é só quem tem
  // motivo NOMEADO para ficar de fora, para a barra saber se a ação se aplica a alguém.
  acoes.push(montarAcao(
    ACOES.email,
    empresas,
    (c) => {
      if (empresaSemObrigacoes(c)) return "empresa zerada — não há guia a entregar";
      const tags = getComplianceTags(c.guideCompliance);
      if (!tags.length) return "nenhuma obrigação de guia nesta competência";
      if (guiasPendentesDeEnvio(c).length) return null;
      if (tags.every((t) => t.state === "enviada" || t.state === "vazio")) {
        return "todas as guias já estão enviadas ou marcadas sem movimento";
      }
      return "nenhuma guia gerada ainda — falta apurar";
    },
    (c) => {
      const n = guiasPendentesDeEnvio(c).length;
      return `${plural(n, "guia", "guias")} pendente${n === 1 ? "" : "s"} na listagem`;
    },
  ));

  // ── APURAR / TRANSMITIR ─────────────────────────────────────────────────────────────────────
  // ⚠ NÃO APURAMOS LUCRO PRESUMIDO neste portal — é por isso que a empresa de LP nem tem aba
  // Apuração. A ação não some da barra: ela diz isso.
  acoes.push(montarAcao(
    ACOES.apurar,
    empresas,
    (c) => {
      const regime = regimeDe(c);
      if (!regime) return "regime não cadastrado — não dá para afirmar se apura";
      if (regime !== "SIMPLES") return "Lucro Presumido/Real — o portal ainda não apura este regime";
      // `apurada: true` quer dizer PGDAS-D já transmitido nesta competência. Reapurar seria
      // retificadora, que é decisão do contador dentro da empresa, não de um lote.
      if (c?.apuracao?.apurada) return "já apurada nesta competência — reapurar geraria retificadora";
      return null;
    },
    () => "o servidor só aceita quem já está com a apuração fechada",
  ));

  // ── CAPTURAR NOTAS ──────────────────────────────────────────────────────────────────────────
  // ⚠ Sem A1 da própria empresa o ADN recusa (`NO_COMPANY_CERT`) — regra do dono, e o cert do
  // escritório NÃO substitui. A leitura é a mesma da pílula "A1" da linha.
  acoes.push(montarAcao(
    ACOES.capturarNotas,
    empresas,
    (c) => {
      const cert = estadoCertificado(c, agora);
      if (cert.chave === "ausente") return "sem certificado A1 — o ADN recusa a consulta";
      if (cert.chave === "vencido") return "certificado A1 vencido — o ADN recusa a consulta";
      return null;
    },
  ));

  // ── BAIXAR XMLs ─────────────────────────────────────────────────────────────────────────────
  // Zipa o que já está no banco: não há pré-condição por empresa. Empresa sem nota gera pasta
  // vazia, e isso é dito na descrição em vez de virar exclusão inventada.
  acoes.push(montarAcao(ACOES.baixarNotas, empresas, () => null));

  // ── BAIXAR SITFIS ───────────────────────────────────────────────────────────────────────────
  // ⚠ Empresa NUNCA CONSULTADA não tem relatório salvo — entra no ZIP como nada. Dizer isso antes
  // é diferente de entregar um ZIP com menos arquivos do que empresas e deixar o contador contar.
  acoes.push(montarAcao(
    ACOES.baixarSitfis,
    empresas,
    (c) => (c?.fiscalCheckedAt ? null : "nunca consultada — não há relatório salvo para zipar"),
    (c) => {
      const h = horasDesde(c.fiscalCheckedAt, agora);
      if (h == null) return null;
      if (h < HORAS_TRAVA_SITFIS) return `consultada há menos de ${HORAS_TRAVA_SITFIS} h`;
      const dias = Math.floor(h / 24);
      return dias > 0 ? `relatório de ${dias} dia(s) atrás` : "relatório de hoje";
    },
  ));

  // ── AS DUAS RAZÕES QUE DESABILITAM QUALQUER AÇÃO, DEPOIS DAS REGRAS DE CADA UMA ──────────────
  return {
    total,
    competencia,
    acoes: acoes.map((a) => {
      // ⚠ REGRA 5 DO DONO: processo rodando não pode ser disparado duas vezes. O sinal é o MESMO
      // `useBackgroundJobs` que já desenha o selo "⏳ N processos em segundo plano" — não há
      // indicador novo. Vale só para as ações que criam JOB; o envio de e-mail é chamada
      // bloqueante e nunca aparece em `/firm/jobs/ativos` (comentário no topo do hook).
      // ⚠ O contador de `/firm/jobs/ativos` é GLOBAL, não escopado por carteira: ele pode acender
      // por um lote de outro usuário do escritório. Por isso o motivo diz "há processo rodando",
      // não "o SEU processo".
      if (a.criaJob && jobsAtivos > 0) {
        return {
          ...a,
          disponivel: false,
          motivo: `há ${plural(jobsAtivos, "processo", "processos")} em segundo plano — aguarde para não disparar o mesmo lote duas vezes`,
        };
      }
      // ⚠ O ENVIO NÃO É GATEADO PELA LEITURA LOCAL, e as outras quatro são. A diferença tem causa:
      // para regime, certificado e `fiscalCheckedAt` a listagem é a fonte — não existe segunda
      // opinião. Para as GUIAS existe, e ela é melhor: `batch-report` é o que o envio consome.
      //
      // Enquanto `alvos` desabilitava o botão, um `guideCompliance` velho na tela ("todas já
      // enviadas") trancava a porta ANTES de o relatório poder ser lido — e o contador ficava sem
      // caminho para uma guia que de fato estava pendente. Abrir o modal é um GET; quem decide
      // continua sendo o relatório, e "não há o que enviar" é resposta que o modal sabe dar.
      const semAlvos = a.chave === "email" ? total === 0 : !a.alvos.length;
      if (semAlvos) {
        return {
          ...a,
          disponivel: false,
          motivo: total === 0
            ? "nenhuma empresa selecionada"
            : `nenhuma das ${plural(total, "empresa selecionada", "empresas selecionadas")} se aplica`,
        };
      }
      return { ...a, disponivel: true, motivo: null };
    }),
  };
}

/** A ação `chave` dentro de um plano. */
export function acaoDoPlano(plano, chave) {
  return (plano?.acoes || []).find((a) => a.chave === chave) || null;
}

/**
 * A PRÉVIA DO ENVIO DE GUIAS, sobre a resposta de `GET /firm/guides/batch-report`.
 *
 * ⚠ ELA NÃO É O `guideCompliance` CONTADO DE NOVO, e isso é o ponto. `batch-report` é a MESMA
 * leitura que `batch-send` consome (`pendingGuideIds`); o compliance da listagem é outro caminho,
 * e os dois podem discordar por um recálculo que aconteceu entre uma carga e outra. Numa ação
 * irreversível, o número que se mostra tem de ser o número que vai sair.
 *
 * ⚠ RELATÓRIO AUSENTE NÃO VIRA ZERO. Sem resposta, devolve `conhecido: false` — a tela diz que não
 * sabe e a confirmação fica bloqueada. "0 guias" seria uma afirmação sobre a carteira feita a
 * partir de uma chamada que não voltou.
 *
 * @param {object|null} report      resposta de `getBatchEmailReport`
 * @param {string[]}    companyIds  a seleção
 * @param {string}      competencia "YYYY-MM"
 */
export function resumoEnvioDoRelatorio(report, companyIds = [], competencia = null) {
  if (!report || typeof report !== "object") {
    return { conhecido: false, linhas: [], fora: [], totalGuias: 0, totalEmpresas: 0 };
  }
  const linhasDoRelatorio = [
    ...(Array.isArray(report.simples) ? report.simples : []),
    ...(Array.isArray(report.presumidos) ? report.presumidos : []),
    ...(Array.isArray(report.outros) ? report.outros : []),
  ];
  // Uma linha por (empresa, competência). Com o filtro `?competencia=` todas batem, mas o campo
  // vem na resposta e é ele que manda — não a competência que pedimos.
  const porEmpresa = new Map();
  for (const row of linhasDoRelatorio) {
    if (competencia && row?.competencia && row.competencia !== competencia) continue;
    if (!row?.portalClientId) continue;
    porEmpresa.set(row.portalClientId, row);
  }

  const linhas = [];
  const fora = [];
  for (const id of companyIds) {
    const row = porEmpresa.get(id);
    const pendentes = Array.isArray(row?.pendingGuideIds) ? row.pendingGuideIds.length : 0;
    if (!row) {
      fora.push({ companyId: id, razao: null, motivo: "não aparece no relatório desta competência" });
    } else if (pendentes === 0) {
      fora.push({ companyId: id, razao: row.razao || null, motivo: "nenhuma guia pendente de envio nesta competência" });
    } else {
      linhas.push({
        companyId: id,
        razao: row.razao || "—",
        cnpj: row.cnpj || null,
        guias: pendentes,
        // Os tributos que de fato têm guia pendente — é o "linha a linha" da prévia.
        tributos: Object.entries(row.tiposGuias || {})
          .filter(([, cell]) => cell && !cell.vazio && !cell.isParcelamento && cell.emailStatus !== "SENT")
          .map(([tipo]) => tipo),
      });
    }
  }
  return {
    conhecido: true,
    linhas,
    fora,
    totalEmpresas: linhas.length,
    totalGuias: linhas.reduce((s, l) => s + l.guias, 0),
  };
}

/**
 * A frase que a confirmação de um ATO IRREVERSÍVEL repete, com os números.
 *
 * ⚠ É o padrão que `EstornoBaixaService`, a baixa de parcela e o lote do WhatsApp já usam: quem
 * confirma tem de ler de novo o que vai acontecer, com quantidade e competência. "Tem certeza?" não
 * é confirmação de nada.
 */
export function fraseDeConfirmacao(chave, { empresas = 0, guias = null, competencia = null } = {}) {
  const comp = competencia ? `, competência ${formatarCompetencia(competencia)}` : "";
  if (chave === "email") {
    const g = guias == null ? null : plural(guias, "guia", "guias");
    return g
      ? `Enviar ${g} de ${plural(empresas, "empresa", "empresas")}${comp}?`
      : `Enviar as guias de ${plural(empresas, "empresa", "empresas")}${comp}?`;
  }
  if (chave === "apurar") {
    return `Transmitir o PGDAS-D de ${plural(empresas, "empresa", "empresas")}${comp}?`;
  }
  return `Executar sobre ${plural(empresas, "empresa", "empresas")}${comp}?`;
}

/** "2026-07" → "07/2026". Sem `Date`: competência é texto, não instante. */
export function formatarCompetencia(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : String(competencia || "—");
}
