import { lazy, Suspense, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { DeleteCompanyModal } from "../components/DeleteCompanyModal";
import { Modal } from "../../../../components/ui/Modal";
import { CompanySectionHeader } from "../components/renderCompanyDetailHeader";
import { CompanyTabLayout, CompanyTabLoading } from "../components/CompanyTabLayout";
// A URL das abas da empresa — a MESMA fonte que a navegação por clique usa. Ver `rotasDaEmpresa`.
import { companyTabPath } from "../lib/rotasDaEmpresa";
import { telaDeApuracao, APURACAO } from "../../../apuracao-lp/lib/regimeDaAba";
import { CompanyFichaTab } from "../components/renderCompanyFichaTab";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { BackButton } from "../../../../components/ui/BackButton";
import { ErrorBoundary } from "../../../../components/ui/ErrorBoundary";
// Q14.2: hook próprio da Apuração v2 (escopo da empresa atual)
import { useApuracaoV2 } from "../../../apuracao-v2/hooks/useApuracaoV2";
// Q41: hook próprio da aba Situação Fiscal (SITFIS)
import { useSitfis } from "../../../fiscal/sitfis/hooks/useSitfis";
import { createApiClient } from "../../../../api/client";
import { competenciaPadrao, deslocarCompetencia, formatCompetencia } from "../../../../lib/competencia";
import { ENTREGA_POR_ARQUIVO_LIBERADA } from "../../../obrigacoes/entregas/lib/liberacao";
// ⚠ A regra de QUEM DEVE a DEFIS entra EAGER, ao contrário do `EspelhoDefis`: a decisão precisa
// acontecer antes de qualquer chunk, e ela é uma função pura. Ela continua sendo a fonte de quem vê
// o fluxo — o que saiu da tela foi a APRESENTAÇÃO da dispensa, não a regra.
import { obrigatoriedadeDefis } from "../../../obrigacoes/defis/lib/obrigatoriedadeDefis";
import { useCompanyDocuments, useCompanyNotes } from "../../documents/hooks/useCompanyDocuments";
import { useCompanyCredentials } from "../../credentials/hooks/useCompanyCredentials";
import { useAcessoPortalCliente } from "../../credentials/hooks/useAcessoPortalCliente";
import { useContatosWhatsapp } from "../../credentials/hooks/useContatosWhatsapp";
import { ContatosWhatsapp } from "../../credentials/components/ContatosWhatsapp";

// Q8.C.3: lazy load das tabs pesadas. Bundle inicial cai (~30-40% segundo medições típicas),
// e cada tab só carrega seu JS quando o contador clica nela pela 1ª vez.
// Vantagem extra: erro em uma tab (parse error, missing prop) NÃO derruba as outras.
// ⚠ O chat entra LAZY como as outras abas pesadas: ele arrasta o hook de conversas e o fio. Erro
// dentro dele não derruba as Anotações, que são a aba DEFAULT da empresa.
const ChatDaEmpresa = lazy(() =>
  import("../../../whatsapp/components/ChatDaEmpresa").then((m) => ({ default: m.ChatDaEmpresa }))
);
const CompanyGuidesTable = lazy(() =>
  import("../../../guides/list/components/renderCompanyGuidesTable").then((m) => ({ default: m.CompanyGuidesTable }))
);
const CompanyForm = lazy(() =>
  import("../../form/components/renderCompanyForm").then((m) => ({ default: m.CompanyForm }))
);
// A configuração de emissão de NFS-e, que era um bloco de 264 linhas dentro do formulário de
// edição e virou ABA PRÓPRIA (dono, 19/08/2026) — com salvar próprio, por rota própria.
const EmissaoNfseTab = lazy(() =>
  import("../components/renderEmissaoNfseTab").then((m) => ({ default: m.EmissaoNfseTab }))
);
// ⚠ A MESMA `PlanejamentoPage` da tela global — não uma segunda tela. Duas implementações do
// mesmo comparativo divergiriam na primeira correção fiscal, e a que ninguém abre é a que erra.
// O que muda é o MODO: aqui ela nasce presa à empresa e sem o seletor (`empresaFixa`).
const PlanejamentoPage = lazy(() =>
  import("../../../planejamento/pages/renderPlanejamentoPage.jsx").then((m) => ({ default: m.PlanejamentoPage })),
);
const AccountingEntriesTab = lazy(() =>
  import("../../../accounting/entries/components/renderAccountingEntriesTab").then((m) => ({ default: m.AccountingEntriesTab }))
);
const CircularTab = lazy(() =>
  import("../../../accounting/circular/components/renderCircularTab").then((m) => ({ default: m.CircularTab }))
);
const ChartOfAccountsPage = lazy(() =>
  import("../../../accounting/chart-of-accounts/pages/renderChartOfAccountsPage").then((m) => ({ default: m.ChartOfAccountsPage }))
);
const ParcelamentoTab = lazy(() =>
  import("../../../accounting/parcelamento/pages/renderParcelamentoTab").then((m) => ({ default: m.ParcelamentoTab }))
);
// Aba Obrigações da empresa = o calendário do dashboard travado numa empresa.
const CalendarioGrid = lazy(() =>
  import("../../../calendario/components/renderCalendarioGrid").then((m) => ({ default: m.CalendarioGrid }))
);
// Q12.A: módulo Notas Fiscais — lazy, sem inflar o bundle inicial.
const NotasFiscaisTab = lazy(() =>
  import("../../../notas/components/renderNotasFiscaisTab").then((m) => ({ default: m.NotasFiscaisTab }))
);
// Auditoria pré-apuração das notas — SÓ LEITURA (autônoma: faz a própria chamada, como o SITFIS).
const ConferenciaTab = lazy(() =>
  import("../../../conferencia/components/renderConferenciaTab").then((m) => ({ default: m.ConferenciaTab }))
);

const AuditoriaTab = lazy(() =>
  import("../../../notas/components/renderAuditoriaTab").then((m) => ({ default: m.AuditoriaTab }))
);
// Q14.2: Apuração v2 — cadastro fiscal + produtos/serviços + pendências
// Perfil fiscal (regime + atividades permitidas). ⚠ Saiu de DENTRO da aba Apuração em 24/08/2026 —
// era a seção "Perfil fiscal", terceiro nível de navegação sem URL. Mesmo hook, mesmo painel.
const PerfilFiscalTab = lazy(() =>
  import("../../../apuracao-v2/pages/renderPerfilFiscalTab").then((m) => ({ default: m.PerfilFiscalTab }))
);
// A apuração do LUCRO PRESUMIDO — autônoma (faz a própria chamada), como a Conferência e o SITFIS.
// ⚠ Ela e a `ApuracaoV2Tab` nunca renderizam juntas: `telaDeApuracao` escolhe uma das duas.
const ApuracaoLpTab = lazy(() =>
  import("../../../apuracao-lp/components/ApuracaoLpTab").then((m) => ({ default: m.ApuracaoLpTab }))
);
const ApuracaoV2Tab = lazy(() =>
  import("../../../apuracao-v2/pages/renderApuracaoV2Tab").then((m) => ({ default: m.ApuracaoV2Tab }))
);
// Q41: aba Situação Fiscal (SITFIS)
const SitfisTab = lazy(() =>
  import("../../../fiscal/sitfis/components/renderSitfisTab").then((m) => ({ default: m.SitfisTab }))
);
// Q12.B+++: painel de cert A1 da empresa
const CompanyCertificatePanel = lazy(() =>
  import("../../certificate/components/CompanyCertificatePanel").then((m) => ({ default: m.CompanyCertificatePanel }))
);

// ⚠ ERAM DOIS "Carregando…" NESTE ARQUIVO, com cores diferentes: este, com `#aeb6d3` cravado, e o
// `CompanyTabLoading` do primitivo — importado e nunca chamado. Ficou o do primitivo; este virou
// um apelido, para não reescrever as 18 chamadas.
const TabLoadingFallback = CompanyTabLoading;

// Documentos e Anotações da empresa (grupo Cadastro). Lazy como as demais abas: só carregam o JS
// quando o contador abre a aba.
const CompanyDocumentsTab = lazy(() =>
  import("../../documents/components/renderCompanyDocumentsTab").then((m) => ({ default: m.CompanyDocumentsTab }))
);
const CompanyNotesTab = lazy(() =>
  import("../../documents/components/renderCompanyNotesTab").then((m) => ({ default: m.CompanyNotesTab }))
);
// Cofre de senhas + "outras informações" (grupo Empresa). Lazy pelo mesmo motivo das demais.
const CompanyCredentialsTab = lazy(() =>
  import("../../credentials/components/renderCompanyCredentialsTab").then((m) => ({ default: m.CompanyCredentialsTab }))
);

function CompanyDocumentsTabWrapper({ companyId, feedback }) {
  const docs = useCompanyDocuments({ api: companyDocsApi, companyId, feedback });
  return <CompanyDocumentsTab docs={docs} />;
}

// ⚠⚠ ANOTAÇÕES E CHAT LADO A LADO (F2, 06/09/2026) — decisão do dono: *"em cada cliente tenha um
// chat, no mesmo lugar de anotações, assim podemos falar com o cliente e usar as anotações para algo
// importante"*. Anotações à ESQUERDA (é a aba dela), chat à direita.
//
// ⚠ A largura vem de MEDIA QUERY (`.anotacoes-com-chat`, no `App.css`), nunca de uma leitura de
// largura em JavaScript — essa erra na rotação da tela, no zoom e na gaveta do navegador, e erra em
// silêncio. Abaixo de 1000px o chat DESCE — nunca some: escondê-lo faria a aba responder "esta
// empresa não fala por WhatsApp" para quem só estreitou a janela.
//
// ⚠ O hook do chat monta com `companyDocsApi` — o cliente de MÓDULO —, nunca com uma prop `api`:
// `CompanyDetailPage` não recebe `api`, e esse erro já compilou, passou nos testes e explodiu só no
// navegador.
function CompanyNotesTabWrapper({ companyId, feedback }) {
  const notes = useCompanyNotes({ api: companyDocsApi, companyId, feedback });
  return (
    <div className="anotacoes-com-chat">
      <div style={{ minWidth: 0 }}>
        <CompanyNotesTab notes={notes} />
      </div>
      <div className="anotacoes-com-chat__chat">
        <Suspense fallback={<CompanyTabLoading />}>
          <ChatDaEmpresa api={companyDocsApi} companyId={companyId} feedback={feedback} />
        </Suspense>
      </div>
    </div>
  );
}

// ⚠ `feedback` INTEIRO, nunca `{ message, error }`. O hook do cofre chama `notifyError` — com a
// função ausente o optional call vira no-op silencioso, e toda falha de carga/revelação sumiria
// sem uma linha na tela. É o defeito que já custou uma semana no FechamentoModal.
// ⚠ DOIS HOOKS, e não um com três naturezas. `useAcessoPortalCliente` guarda uma senha que NÃO tem
// como ser recuperada por ninguém; o cofre guarda segredos que podem ser revelados de novo. Regras
// de descarte diferentes não moram no mesmo estado — a mais frouxa venceria na primeira mexida.
// ⚠ `razaoSocial` viaja para a CONFIRMAÇÃO nomear a empresa junto do usuário.
function CompanyCredentialsTabWrapper({ companyId, feedback, razaoSocial }) {
  const vault = useCompanyCredentials({ api: companyDocsApi, companyId, feedback });
  const acesso = useAcessoPortalCliente({ api: companyDocsApi, companyId, feedback });
  // ⚠ OS DESTINATÁRIOS SAÍRAM DAQUI EM 05/09/2026 (decisão do dono: *"a tela de configuração de
  // envio deve ser dentro de guias, e não em senha e acesso"*). Esta aba guarda SEGREDO e ACESSO;
  // quem recebe a guia é assunto do envio, e mora na aba Guias.
  return <CompanyCredentialsTab vault={vault} acesso={acesso} razaoSocial={razaoSocial} />;
}

/**
 * A CONFIGURAÇÃO DE ENVIO — dentro da aba Guias (05/09/2026).
 *
 * ⚠ É a MESMA lista e o MESMO hook de antes; o que mudou foi o lugar. Duplicar o cadastro em duas
 * abas faria as duas discordarem sobre quem recebe a guia, com o cliente no meio.
 * ⚠ Os usuários do portal chegam por `useAcessoPortalCliente` porque o vínculo com a PESSOA é o que
 * dá o papel RBAC — sem eles o seletor "Pessoa do portal" nasceria vazio.
 */
function ConfiguracaoDeEnvioWrapper({ companyId, feedback }) {
  const whatsapp = useContatosWhatsapp({ api: companyDocsApi, companyId, feedback });
  const acesso = useAcessoPortalCliente({ api: companyDocsApi, companyId, feedback });
  return <ContatosWhatsapp whatsapp={whatsapp} usuarios={acesso?.usuarios || []} />;
}

// Q14.2: wrapper que instancia hook próprio da Apuração v2 (state da empresa atual)
const apuracaoV2Api = createApiClient();
const companyDocsApi = createApiClient();
// O CalendarioGrid chama a API por conta própria (mesmo padrão do SITFIS e do Apuração v2) —
// a página de detalhe não tem `api` em escopo.
const obrigacoesApi = createApiClient();
// ⚠⚠ CLIENTE PRÓPRIO, e não `api` solto — foi assim que eu quebrei a aba na primeira tentativa.
// `CompanyDetailPage` NÃO recebe `api` por prop (a assinatura dela é `{ company, guidesPanel, … }`),
// e `<PlanejamentoPage api={api} …>` compilou, passou nos testes e explodiu **só no navegador**,
// com `ReferenceError: api is not defined` e a página em branco.
// ⚠ QUARTA VEZ que um identificador órfão atravessa o `npm run build` neste projeto: o build não o
// pega, e os testes desta aba são varredura de TEXTO, que também não. Quem pegou foi abrir a tela.
const planejamentoApi = createApiClient();
const RelatoriosTab = lazy(() =>
  import("../../../relatorios/components/RelatoriosTab").then((m) => ({ default: m.RelatoriosTab })),
);
// Carregado sob demanda: são ~40 campos e a especificação inteira da DEFIS, e quem abre a aba de
// Obrigações quase sempre quer o calendário, não o espelho.
const EspelhoDefis = lazy(() =>
  import("../../../obrigacoes/defis/components/EspelhoDefis").then((m) => ({ default: m.EspelhoDefis })),
);
const EntregaPorArquivo = lazy(() =>
  import("../../../obrigacoes/entregas/components/EntregaPorArquivo").then((m) => ({ default: m.EntregaPorArquivo })),
);
/**
 * A aba Obrigações da empresa: o calendário + a porta de entrada do ESPELHO DA DEFIS.
 *
 * ⚠ O espelho é o trabalho anual que não cabe no calendário — a DEFIS tem ~40 campos numerados e
 * uma ficha por estabelecimento. Deixá-lo só como uma ocorrência no dia 31/03 seria transformar a
 * entrega mais pesada do ano numa linha de agenda. Aqui ele é botão, ao lado do calendário.
 *
 * ⚠ O ANO PADRÃO é o ANTERIOR: a DEFIS de 2025 se entrega em 2026, então quem abre a tela em
 * qualquer mês de 2026 quer o espelho de 2025. Abrir no ano corrente mostraria um espelho de um
 * ano que nem terminou.
 */
const setaEfd = {
  background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6,
  padding: "2px 9px", font: "inherit", fontSize: "0.85rem", cursor: "pointer", lineHeight: 1.2,
};

function ObrigacoesDaEmpresa({ companyId, companyRegime }) {
  const [abrirDefis, setAbrirDefis] = useState(false);
  const [anoDefis, setAnoDefis] = useState(() => new Date().getFullYear() - 1);
  const [espelhoSalvo, setEspelhoSalvo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  // A EFD-Contribuições é MENSAL e a DEFIS é ANUAL — dois períodos diferentes na mesma aba, cada um
  // com o seu seletor. Um só campo obrigaria um dos dois a mentir sobre o próprio período.
  const [competenciaEfd, setCompetenciaEfd] = useState(() => competenciaPadrao());

  // ⚠ A TELA NÃO PERGUNTAVA O REGIME. O botão "📄 Espelho da DEFIS" era oferecido a TODA empresa —
  // o defeito relatado pelo dono ("empresas do presumido estão com espelho da DEFIS, mas empresas
  // presumidas não têm DEFIS") era AUSÊNCIA de regra, não regra errada. A DEFIS é declaração do
  // Simples Nacional; a regra (com a fonte oficial) vive em `defis/lib/obrigatoriedadeDefis.js`.
  //
  // Três respostas, não duas: só `obrigada` abre o fluxo. `dispensada` e `indefinida` NÃO oferecem
  // o espelho — e, desde 15/08/2026, também não dizem nada na tela (ver abaixo).
  const vereditoDefis = obrigatoriedadeDefis({ regime: companyRegime, anoCalendario: anoDefis });
  const defisDevida = vereditoDefis.situacao === "obrigada";

  async function abrir() {
    setCarregando(true);
    try {
      const r = await obrigacoesApi.getDefisEspelho?.(companyId, anoDefis);
      setEspelhoSalvo(r?.dados || r?.espelho?.dados || null);
    } catch { setEspelhoSalvo(null); }
    finally { setCarregando(false); setAbrirDefis(true); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ⚠ QUEM NÃO DEVE A DEFIS NÃO VÊ NADA SOBRE DEFIS — decisão do dono, 15/08/2026, com a tela
          na frente dele: *"empresas do Presumido que não têm DEFIS estão aparecendo uma legenda
          explicando que elas não têm, isso é horrível, é apenas tirar isso de lá"*.
          Havia aqui um painel (`DefisNaoDevida`) que anunciava a dispensa com motivo e norma, pelo
          argumento de que sumir confunde dispensa com esquecimento. O dono reverteu: no Presumido a
          dispensa é a regra, não a exceção, e um parágrafo fixo em toda empresa não-optante é ruído.
          ⚠ O QUE NÃO MUDA: a regra (`defis/lib/obrigatoriedadeDefis.js`, com a fonte oficial)
          continua decidindo, e `dispensada`/`indefinida` continuam SEM o fluxo — agora em silêncio.
          Trocar este `&&` por um render incondicional devolveria o espelho da DEFIS a empresa do
          Lucro Presumido, que é o defeito fiscal que a regra existe para impedir. */}
      {defisDevida && (
        <div style={{ width: "var(--content-wide)", margin: "0 auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Entrega anual:</span>
          <input
            type="number"
            value={anoDefis}
            onChange={(e) => setAnoDefis(Number(e.target.value) || anoDefis)}
            style={{ width: 92, background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "5px 8px", fontSize: "0.82rem" }}
            aria-label="Ano-calendário da DEFIS"
          />
          <button
            type="button"
            onClick={abrir}
            disabled={carregando}
            style={{ background: "transparent", border: "1px solid #BD93F9", color: "var(--accent-purple)", borderRadius: 6, padding: "5px 12px", font: "inherit", fontSize: "0.8rem", cursor: "pointer" }}
          >
            {carregando ? "Abrindo…" : "📄 Espelho da DEFIS"}
          </button>
        </div>
      )}

      {/* ⚠ A EFD-Contribuições fica ACIMA do calendário, não como uma ocorrência dentro dele.
          Ela não é um dia na agenda: é um trabalho de três passos, dois deles FORA do app, e a
          pergunta que ela precisa responder ("esta competência já foi entregue?") não cabe num
          marcador de célula.

          ⚠ O BLOCO APARECE SEMPRE, mas o que ele mostra depende do REGIME: optante do Simples
          Nacional nunca entrega EFD-Contribuições (IN RFB 1.252/2012), e para ela o bloco diz a
          dispensa com a norma citada, no lugar dos três passos. Não é o mesmo que sumir — some da
          tela quem não deve nada, e aí ninguém sabe se foi dispensa ou esquecimento. */}
      {/* ⚠ DESLIGADO em 07/08/2026 por decisão do dono — ver `entregas/lib/liberacao.js` e
          `docs/efd-contribuicoes-onde-paramos.md`. Não é bug: o fluxo nunca foi exercido contra a
          API real, e a EFD merece desenvolvimento próprio. Nada foi apagado; é uma trava de uma
          linha, e o backend recusa pelo mesmo motivo. */}
      {ENTREGA_POR_ARQUIVO_LIBERADA && (
        <div style={{ width: "var(--content-wide)", margin: "0 auto", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Entrega mensal:</span>
            <button type="button" onClick={() => setCompetenciaEfd((c) => deslocarCompetencia(c, -1))} style={setaEfd} aria-label="Competência anterior">‹</button>
            <strong style={{ fontSize: "0.82rem", minWidth: 130, textAlign: "center" }}>{formatCompetencia(competenciaEfd)}</strong>
            <button type="button" onClick={() => setCompetenciaEfd((c) => deslocarCompetencia(c, 1))} style={setaEfd} aria-label="Próxima competência">›</button>
          </div>
          <Suspense fallback={<TabLoadingFallback />}>
            <EntregaPorArquivo companyId={companyId} regime={companyRegime} competencia={competenciaEfd} />
          </Suspense>
        </div>
      )}

      <CalendarioGrid api={obrigacoesApi} companyIdFixo={companyId} />

      {abrirDefis && (
        <Suspense fallback={<TabLoadingFallback />}>
          <EspelhoDefis
            anoCalendario={anoDefis}
            valorInicial={espelhoSalvo}
            onSalvar={(e) => obrigacoesApi.salvarDefisEspelho?.(companyId, anoDefis, e)}
            onMarcarTransmitida={async (e) => {
              await obrigacoesApi.salvarDefisEspelho?.(companyId, anoDefis, e);
              await obrigacoesApi.marcarDefisTransmitida?.(companyId, anoDefis);
              setAbrirDefis(false);
            }}
            onClose={() => setAbrirDefis(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

function ApuracaoV2TabWrapper({ companyId, feedback, razao, myRole, competencia, onCompetenciaChange, onAbrirPerfilFiscal }) {
  const panel = useApuracaoV2({ api: apuracaoV2Api, companyId, feedback });
  return (
    <ApuracaoV2Tab
      panel={panel} api={apuracaoV2Api} companyId={companyId} feedback={feedback} razao={razao}
      // ⚠ O papel decide se a tela OFERECE resolver a pendência para toda a carteira. Ela não é a
      // permissão — o servidor reconfere a cada resolução —, mas sem ele a tela ofereceria um botão
      // que volta 403.
      myRole={myRole}
      competencia={competencia} onCompetenciaChange={onCompetenciaChange}
      onAbrirPerfilFiscal={onAbrirPerfilFiscal}
    />
  );
}

// ⚠ Wrapper PRÓPRIO para o Perfil fiscal, e não um `panel` emprestado do de cima: `useApuracaoV2` é
// instanciado DENTRO do `ApuracaoV2TabWrapper`, que só existe no ramo `cadastroFiscal`. As duas
// abas são rotas distintas e nunca renderizam ao mesmo tempo, então cada uma instancia o seu — o
// que NÃO se duplica é o cliente HTTP (`apuracaoV2Api`, de módulo) nem a leitura das atividades,
// que continua sendo a do mesmo hook.
function PerfilFiscalTabWrapper({ companyId, feedback }) {
  const panel = useApuracaoV2({ api: apuracaoV2Api, companyId, feedback });
  return <PerfilFiscalTab panel={panel} />;
}

// Q41: wrapper que instancia o hook da Situação Fiscal (SITFIS) — companyId = portalClient id.
const sitfisApi = createApiClient();
function SitfisTabWrapper({ companyId }) {
  const panel = useSitfis({ api: sitfisApi, companyId });
  return <SitfisTab sitfisPanel={panel} />;
}

import { useEmpresasDoResponsavel } from "../../form/hooks/useEmpresasDoResponsavel";

export function CompanyDetailPage({ company, guidesPanel, editPanel, accountingPanel, circularPanel, notasPanel, certPanel, feedback, dangerActions }) {
  const { selectedCompany, canEditCompany, companyDetailTab, setCompanyDetailTab, onBack } = company;
  const companyId = selectedCompany?.companyId;
  // ⚠ O regime mora em `legacyCompany` (é do cadastro legado) e NUNCA no topo do payload — o
  // `buildFirmCompanyPayload` só o inclui dentro de `legacyCompany`. Ler do topo devolvia
  // `undefined` sempre, e três telas dependiam disso em silêncio: "+ Parcelamento Simples" nunca
  // aparecia, e o filtro por regime da Circular e do "+ Subir Guia" recebia undefined.
  const companyRegime =
    selectedCompany?.legacyCompany?.regimeTributario
    || selectedCompany?.legacyCompany?.tipoTributario
    || selectedCompany?.regimeTributario
    || selectedCompany?.tipoTributario
    || null;
  // Q11.1: state do modal de exclusão (zona de risco)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // A gaveta da configuração de envio, dentro da aba Guias (05/09/2026).
  const [abrirEnvio, setAbrirEnvio] = useState(false);
  // ⚠ QUAIS EMPRESAS O E-MAIL DIGITADO JÁ ATENDE — só leitura, e só para AVISAR embaixo do campo.
  // ⚠ Reusa `companyDocsApi` (a mesma instância do cofre e do acesso ao portal); um cliente novo
  // por tela é o começo de dois contratos para a mesma rota.
  // ⚠ O hook roda com o formulário de edição carregado ou não: sem e-mail válido ele nem consulta.
  const empresasDoResponsavel = useEmpresasDoResponsavel({
    api: companyDocsApi,
    email: editPanel?.form?.ownerEmail,
  });
  // R4 — "＋ Criar novo…" no modal de anexo de guia: leva à aba Parcelamentos E abre o wizard.
  // Sem esta intenção, o clique só trocava de aba e o contador tinha de achar o botão de novo —
  // que é onde a intenção se perde. A criação continua tendo UMA porta só (o wizard).
  const [abrirWizardParcelamento, setAbrirWizardParcelamento] = useState(false);

  function switchTab(tab) {
    setCompanyDetailTab(tab);
    if (tab === "lancamentos") { accountingPanel.onLoadAccounts(); accountingPanel.onLoadEntries(); }
    // ⚠ A CIRCULAR NÃO CARREGA MAIS DAQUI — e não é esquecimento.
    // Enquanto a troca de aba era o ÚNICO disparo, um F5 (ou o link direto) abria a aba vazia
    // dizendo "Clique em Atualizar". Quem carrega agora é o effect de
    // `useManageAccountingWorkspace`, no mesmo molde da aba Lançamentos — e ele cobre os três
    // caminhos (troca de aba, recarga da página e mudança de ano/competência). Chamar aqui também
    // faria duas requisições por clique.
    if (tab === "planoContas") { accountingPanel.onLoadAccounts(); }
    // Guias precisa do plano de contas: o modal de ingestão de parcelamento sugere as contas D/C.
    if (tab === "guides") { accountingPanel.onLoadAccounts(); }
    // Parcelamento: o modal de config de contas usa o plano de contas.
    if (tab === "parcelamento") { accountingPanel.onLoadAccounts(); }
    if (tab === "notasFiscais") { notasPanel?.reload?.(); }
  }

  // ─── Aba Lançamentos: layout full-screen com barra de topo compacta ────────

  if (companyDetailTab === "lancamentos") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="lancamentos"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        {/* Conteúdo full-width — sem restrição de max-width */}
        <div style={{ flex: 1 }}>
          <Suspense fallback={<TabLoadingFallback />}>
          <AccountingEntriesTab
            companyId={companyId}
            entries={accountingPanel.entries}
            total={accountingPanel.total}
            loading={accountingPanel.loading}
            filters={accountingPanel.filters}
            onFilterChange={accountingPanel.onFilterChange}
            onLoad={accountingPanel.onLoadEntries}
            onSyncSerproPgdas={accountingPanel.onSyncSerproPgdas}
            onCaptureSerproLp={accountingPanel.onCaptureSerproLp}
            onCreateEntry={accountingPanel.onCreateEntry}
            onCreateFolha={accountingPanel.onCreateFolha}
            onLoadPayrollTemplate={accountingPanel.onLoadPayrollTemplate}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onDeleteEntry={accountingPanel.onDeleteEntry}
            onBulkDeleteEntries={accountingPanel.onBulkDeleteEntries}
            onPreviewOFX={accountingPanel.onPreviewOFX}
            onImportOFX={accountingPanel.onImportOFX}
            onPreviewExcel={accountingPanel.onPreviewExcel}
            onImportExcel={accountingPanel.onImportExcel}
            companyRegime={companyRegime}
            accountingFunctions={accountingPanel.accountingFunctions}
            savingEntry={accountingPanel.savingEntry}
            accounts={accountingPanel.accounts}
            onLoadAccounts={accountingPanel.onLoadAccounts}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportAccountsFile={accountingPanel.onImportAccountsFile}
            onOpenChartOfAccountsTab={() => switchTab("planoContas")}
            /* ⚠⚠ A CONFERÊNCIA VIROU BOTÃO DAQUI EM 29/08/2026 (ela era aba do cabeçalho). O destino
               é o MESMO segmento de sempre — o que mudou foi a porta. Ver a lápide em
               `renderCompanyDetailHeader.jsx`. */
            onOpenConferencia={() => switchTab("conferencia")}
            onExportCsv={accountingPanel.onExportCsv}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onLoadBaixaTemplate={accountingPanel.onLoadBaixaTemplate}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            onLoadAllHistoricos={accountingPanel.onLoadAllHistoricos}
            onUpdateHistorico={accountingPanel.onUpdateHistorico}
            onDeleteHistorico={accountingPanel.onDeleteHistorico}
            message={accountingPanel.message}
            error={accountingPanel.error}
          />
          </Suspense>
        </div>
      </div>
    );
  }

  if (companyDetailTab === "guides") {
      return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="guides"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <AppShell className="guides-page-shell">
          {/* ⚠ A CONFIGURAÇÃO DE ENVIO MORA AQUI desde 05/09/2026 (decisão do dono) — é onde se
              decide quem recebe a guia, ao lado da guia. Ela sai da aba de senha e acesso, que
              guarda segredo. Gaveta, e não seção fixa: a tabela de guias é o assunto da aba. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-2)" }}>
            <Button variant="secondary" type="button" onClick={() => setAbrirEnvio(true)}>
              Configuração de envio
            </Button>
          </div>
          {abrirEnvio ? (
            <Modal titulo="Configuração de envio" tamanho="lg" aoFechar={() => setAbrirEnvio(false)}>
              <ConfiguracaoDeEnvioWrapper companyId={companyId} feedback={feedback} />
            </Modal>
          ) : null}

          {/* ⚠ `onRefresh` alimenta a espera da coluna "Envio": a confirmação de entrega do WhatsApp
              chega pelo webhook SEGUNDOS depois do envio, e sem recarregar a célula congela em
              "aceita, sem confirmação" até alguém apertar F5 — que foi o que aconteceu em
              05/09/2026. A tabela pede a recarga sozinha, e para sozinha. */}
          <Suspense fallback={<TabLoadingFallback />}>
          <CompanyGuidesTable
            companyId={companyId}
            competencia={circularPanel?.competencia}
            companyRegime={companyRegime}
            guides={guidesPanel.guides}
            loadingGuides={guidesPanel.loading}
            onResendGuide={guidesPanel.onResendGuide}
            onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment}
            onDeleteGuide={guidesPanel.onDeleteGuide}
            onRecalculateGuide={guidesPanel.onRecalculateGuide}
            onRecalcularInss={guidesPanel.onRecalcularInss}
            recalcInssBusy={guidesPanel.recalcInssBusy}
            onLiberarGuia={guidesPanel.onLiberarGuia}
            liberarGuiasBusy={guidesPanel.liberarGuiasBusy}
            resendingGuideId={guidesPanel.resendingGuideId}
            confirmingGuideId={guidesPanel.confirmingGuideId}
            recalculatingGuideId={guidesPanel.recalculatingGuideId}
            onRefresh={guidesPanel.onRefresh}
            onUploadGuide={guidesPanel.onUploadGuide}
            uploadingGuide={guidesPanel.uploadingGuide}
            onIdentifyGuide={guidesPanel.onIdentifyGuide}
            onFetchGuidePdf={guidesPanel.onFetchGuidePdf}
            parcelamentos={accountingPanel.parcelamentos}
            /* "＋ Criar novo…" no modal de anexo leva ao WIZARD, que vive na aba Parcelamentos —
               uma porta de criação só, em vez de um segundo formulário aqui. */
            onCriarParcelamento={() => { setAbrirWizardParcelamento(true); switchTab("parcelamento"); }}
            accounts={accountingPanel.accounts}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            /* Competência sem guia porque ainda não foi apurada: o vazio leva ao trabalho que
               falta. ⚠ A aba de Apuração é a `cadastroFiscal` (segmento `cadastro-fiscal`) —
               `apuracao-v2` saiu do menu e virou sub-aba interna. */
            onIrParaApuracao={() => switchTab("cadastroFiscal")}
          />
          </Suspense>

          <Feedback message={feedback.message} error={feedback.error} />
        </AppShell>
      </div>
    );
  }

  if (companyDetailTab === "planoContas") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="planoContas"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <Suspense fallback={<TabLoadingFallback />}>
          <ChartOfAccountsPage
            accounts={accountingPanel.accounts || []}
            onCreateAccount={accountingPanel.onCreateAccount}
            onUpdateAccount={accountingPanel.onUpdateAccount}
            onDeleteAccount={accountingPanel.onDeleteAccount}
            onImportFile={accountingPanel.onImportAccountsFile}
            onBack={() => switchTab("lancamentos")}
          />
          </Suspense>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // Ficha de cadastro (read-only) — a tela de consulta. Editar leva à aba `edit`.
  if (companyDetailTab === "cadastro") {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="cadastro"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        largura="leitura"
        feedback={feedback}
      >
        <CompanyFichaTab
          selectedCompany={selectedCompany}
          canEditCompany={canEditCompany}
          onEdit={() => switchTab("edit")}
        />
      </CompanyTabLayout>
    );
  }

  // ⚠⚠ ANOTAÇÕES SAIU DO RAMO COMPARTILHADO COM DOCUMENTOS (06/09/2026), e a largura mudou junto.
  //
  // O argumento do `leitura` era não haver SALTO entre sub-abas irmãs do grupo "Empresa" — e ele não
  // alcança este caso: Anotações é grupo PRÓPRIO, com uma aba só, e não tem irmã de onde saltar.
  // Com o chat ao lado, `leitura` (1200px) espremeria as duas colunas contra a mesma dobra.
  if (companyDetailTab === "anotacoes") {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="anotacoes"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        largura="trabalho"
        feedback={feedback}
        suspense
      >
        <CompanyNotesTabWrapper companyId={companyId} feedback={feedback} />
      </CompanyTabLayout>
    );
  }

  if (companyDetailTab === "documentos") {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="documentos"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        /* ⚠ O GRUPO "EMPRESA" É `leitura` — Cadastro, Documentos e Senhas. ⚠⚠ Esta linha dizia "o
           grupo INTEIRO", e Anotações era o quarto membro dela até 06/09/2026: ela saiu para
           `trabalho` quando ganhou o chat ao lado, e é grupo próprio, sem irmã de onde saltar.
           Documentos TEM
           uma tabela, mas ela tem seis colunas curtas e cabe folgada em `--content-max`; e o que o
           dono viu na tela foi exatamente o salto de largura ao passar de uma sub-aba para a
           vizinha. `trabalho` fica para quem precisa: Lançamentos (7 colunas + histórico),
           Circular (12 meses × N tributos), Guias e Apuração. Largura é para caber o conteúdo,
           não para marcar que ali existe um `<table>`. */
        largura="leitura"
        feedback={feedback}
        suspense
      >
        <CompanyDocumentsTabWrapper companyId={companyId} feedback={feedback} />
      </CompanyTabLayout>
    );
  }

  // Cofre de senhas + "outras informações". Mesmo molde de Documentos/Anotações: ErrorBoundary por
  // fora do Suspense, e nenhuma competência (a aba não filtra por mês).
  if (companyDetailTab === "credenciais") {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="credenciais"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        largura="leitura"
        feedback={feedback}
        suspense
      >
        <CompanyCredentialsTabWrapper
          companyId={companyId}
          feedback={feedback}
          razaoSocial={selectedCompany?.razao}
        />
      </CompanyTabLayout>
    );
  }

  // ─── Aba Emissão de NFS-e (grupo Fiscal): a configuração, com o salvar dela ───────────────
  //
  // ⚠ TERCEIRA PEÇA DAS TRÊS. Sem este bloco, a entrada em `GROUPS` e o par em
  // `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` levariam a URL a uma tela que não existe.
  if (companyDetailTab === "emissaoNfse") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="emissaoNfse"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <AppShell className="company-form-page-shell">
          <Suspense fallback={<TabLoadingFallback />}>
            <EmissaoNfseTab
              /* ⚠ A EMPRESA INTEIRA, e a aba lê dela só o que é dela (`legacyCompany`, pela MESMA
                 leitura do formulário do cadastro). */
              company={selectedCompany}
              podeEditar={canEditCompany}
              /* ⚠ O SALVAR PRÓPRIO — `PATCH .../emissao-nfse`, que aceita SÓ os sete campos. NÃO é
                 o `editPanel.onSubmit`: aquele manda a empresa inteira. */
              onSalvar={
                editPanel?.onSalvarEmissaoNfse && companyId
                  ? (campos) => editPanel.onSalvarEmissaoNfse(companyId, campos)
                  : null
              }
              salvando={editPanel?.emissaoNfseSaving}
              /* O PORTÃO DA EMISSÃO PELO CLIENTE veio junto, como bloco à parte: rota própria, com
                 confirmação e auditoria, e fora de qualquer salvar. Prop ausente = "esta tela não
                 recebeu o estado", e o bloco não renderiza — não é o mesmo que "não liberada". */
              emissaoCliente={selectedCompany?.emissaoCliente}
              onSetEmissaoCliente={
                editPanel?.onSetEmissaoCliente && companyId
                  ? (liberada) => editPanel.onSetEmissaoCliente(companyId, liberada)
                  : null
              }
              emissaoClienteSaving={editPanel?.emissaoClienteSaving}
            />
          </Suspense>

          <Feedback message={feedback.message} error={feedback.error} />
        </AppShell>
      </div>
    );
  }

  if (companyDetailTab === "edit") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="edit"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <AppShell className="company-form-page-shell">
          <section className="company-form-page__panel">
            <div className="company-form-page__intro">
              <h1 className="company-form-page__title">Editar cadastro</h1>
              <p className="company-form-page__description">
                Atualize os dados cadastrais da empresa no mesmo padrão visual das demais telas.
              </p>
            </div>

            {!canEditCompany ? (
              <p className="text-muted">Apenas admin ou contador pode alterar os dados.</p>
            ) : (
              <Suspense fallback={<TabLoadingFallback />}>
              <CompanyForm
                form={editPanel.form}
                onChange={editPanel.onChange}
                onSubmit={editPanel.onSubmit}
                submitting={editPanel.submitting}
                submitLabel="Salvar alterações"
                showOwnerPassword={false}
                cnpjReadOnly
                /* Conferência do município emissor: o que o cadastro (PortalClient) diz, em texto.
                   Não escolhe nada — ver `SeletorMunicipioIbge`. */
                municipioCadastrado={selectedCompany?.municipio}
                ufCadastrado={selectedCompany?.uf}
                /* ⚠ O PORTÃO DA EMISSÃO PELO CLIENTE NÃO É PASSADO AQUI desde 19/08/2026: ele
                   mora no bloco "Emissão de NFS-e", que virou ABA PRÓPRIA (`emissaoNfse`). Passá-lo
                   ainda assim seria prop morta — o formulário não renderiza mais aquele bloco em
                   modo edição. O controle, a confirmação e a rota com auditoria continuam
                   exatamente os mesmos, um clique adiante. */
                // Q11.1: zona de risco
                status={selectedCompany?.status}
                dangerSaving={dangerActions?.saving}
                onSuspend={dangerActions?.onSuspend}
                onResume={dangerActions?.onResume}
                onDelete={dangerActions?.onDelete ? () => setShowDeleteModal(true) : null}
                /* ⚠ O E-MAIL DO RESPONSÁVEL QUE ATENDE VÁRIAS EMPRESAS — as duas horas em que a
                   consequência precisa aparecer: ao DIGITAR (a consulta abaixo) e ao SALVAR (o que
                   o servidor devolveu no 409, vindo pelo `editPanel`). */
                empresasDoResponsavel={empresasDoResponsavel}
                empresaAtualId={companyId}
                razaoSocialAtual={selectedCompany?.razao}
                confirmacaoAcessoProprio={editPanel?.confirmacaoAcessoProprio}
                onConfirmarAcessoProprio={editPanel?.onConfirmarAcessoProprio}
                onCancelarAcessoProprio={editPanel?.onCancelarAcessoProprio}
                acessoProprioCriado={editPanel?.acessoProprioCriado}
                vinculoCriado={editPanel?.vinculoCriado}
              />
              </Suspense>
            )}

            {/* Q12.B+++: cert A1 da empresa, abaixo do form e acima do feedback */}
            {canEditCompany && certPanel?.api && (
              <Suspense fallback={<TabLoadingFallback />}>
                <CompanyCertificatePanel
                  api={certPanel.api}
                  companyId={selectedCompany?.companyId}
                  feedback={certPanel.feedback}
                />
              </Suspense>
            )}

            <Feedback message={feedback.message} error={feedback.error} />
          </section>
        </AppShell>

        {/* Q11.1: modal de confirmação de exclusão por CNPJ */}
        {showDeleteModal && dangerActions?.onDelete && (
          <DeleteCompanyModal
            company={selectedCompany}
            saving={dangerActions.saving}
            onConfirm={async ({ confirmCnpj }) => {
              await dangerActions.onDelete({ confirmCnpj });
              setShowDeleteModal(false);
              // hook handler já navega de volta pra /companies
            }}
            onClose={() => setShowDeleteModal(false)}
          />
        )}
      </div>
    );
  }

  // ─── Aba Notas Fiscais (Q12.A): layout full-screen ───────────────────────────

  if (companyDetailTab === "notasFiscais") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="notasFiscais"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <NotasFiscaisTab
                notasPanel={notasPanel}
                /* ⚠ `hasInscricaoEstadual` SAIU daqui em 23/08/2026, e não foi limpeza: enquanto
                   existiu, ele escondia a janela de NF-e de TODA empresa sem inscrição estadual —
                   ou seja, das 3 de 3 que têm nota de COMPRA na base (SINTROPIA 34, LENTE 11,
                   ALBATROZ 2). Receber NF-e não exige IE; emitir é que exige. Não reintroduza:
                   o argumento inteiro está no cabeçalho de `renderNotasFiscaisTab.jsx`. */
                competencia={circularPanel?.competencia}
                /* O assistente de emissão MOSTRA o regime que a nota vai declarar e o confronta
                   com o do cadastro. Mesmo `companyRegime` do resto da página (mora em
                   `legacyCompany`, nunca no topo do payload). */
                regime={companyRegime}
                /* Município emissor da DPS — mesma fonte do formulário (`legacyCompany`), nunca o
                   `municipio` de texto do topo do payload. */
                codigoMunicipioIbge={selectedCompany?.legacyCompany?.codigoMunicipioIbge || null}
                /* ⚠ O QUE `buildMissingFields` CONFERE, lido da MESMA linha que ele lê: a `Company`
                   (aqui, `legacyCompany`) — nunca o `inscricaoMunicipal` do topo do payload, que é
                   do `PortalClient` e pode estar preenchido enquanto a coluna da `Company` não
                   está. Ler do lugar errado faria a tela liberar uma emissão que o servidor recusa. */
                cadastroEmissao={{
                  cnpj: selectedCompany?.legacyCompany?.cnpj || selectedCompany?.cnpj || null,
                  inscricaoMunicipal: selectedCompany?.legacyCompany?.inscricaoMunicipal || null,
                  codigoServicoNacional: selectedCompany?.legacyCompany?.codigoServicoNacional || null,
                  /* Os N códigos que a empresa pode usar. É esta lista que o assistente mostra na
                     hora de emitir — "aparecem apenas aqueles pré-cadastrados" (dono, 16/08/2026). */
                  codigosServicoNacional: selectedCompany?.legacyCompany?.codigosServicoNacional || [],
                  codigoServicoMunicipal: selectedCompany?.legacyCompany?.codigoServicoMunicipal || null,
                  rpsSerie: selectedCompany?.legacyCompany?.rpsSerie || null,
                  /* ⚠ A CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) — o que o não optante precisa
                     ter para emitir. Sem estas três linhas o assistente não teria como saber que
                     ela falta, e a empresa do Lucro Presumido chegaria ao botão Emitir para ser
                     recusada pelo servidor (`MISSING_TOT_TRIB_NAO_SIMPLES`).
                     ⚠⚠ `??`, NUNCA `||`: `0` é um percentual LEGÍTIMO e declarado (a NFS-e real de
                     referência traz 0,00 no estadual e no municipal). Com `||` o zero conferido
                     pelo contador viraria `null`, a tela diria "falta o estadual" e mandaria
                     redigitar o que já está gravado. */
                  pTotTribFed: selectedCompany?.legacyCompany?.pTotTribFed ?? null,
                  pTotTribEst: selectedCompany?.legacyCompany?.pTotTribEst ?? null,
                  pTotTribMun: selectedCompany?.legacyCompany?.pTotTribMun ?? null,
                  /* ⚠ O BENEFÍCIO MUNICIPAL VIAJA PARA A EMISSÃO POR UM MOTIVO SÓ: para a tela da
                     nota poder DIZER que ele não entra nela. O XML da DPS ainda não leva o grupo
                     `BM`, e o contador que acabou de cadastrar um benefício é exatamente quem
                     precisa ver isso na hora de emitir — não depois, na nota já autorizada.
                     ⚠ Não bloqueia nada: não está em `buildMissingFields`. */
                  beneficioMunicipalNumero: selectedCompany?.legacyCompany?.beneficioMunicipalNumero || null,
                  beneficioMunicipalTipoReducao:
                    selectedCompany?.legacyCompany?.beneficioMunicipalTipoReducao || null,
                  beneficioMunicipalPRedBC:
                    selectedCompany?.legacyCompany?.beneficioMunicipalPRedBC ?? null,
                  /* ⚠ A ATIVIDADE CADASTRADA — é o que SUGERE a descrição do serviço na emissão
                     (dono, 18/08/2026: *"a atividade é pré-configurada no cadastro do cliente no
                     portal do contador, devemos usar o máximo dos dados que já temos"*). Ver
                     `notas/lib/descricaoSugerida.js`.
                     ⚠ Estes dois campos NÃO entram em `buildMissingFields` e não bloqueiam nada:
                     sem eles a sugestão simplesmente não existe e o campo fica vazio.
                     ⚠ As duas colunas já vinham no `legacyCompanySelect` (`routes/firm/index.js`),
                     então isto é leitura, não coluna nova — o defeito que este projeto já pagou
                     três vezes (campo no banco sem caminho até a tela) não se repete aqui. */
                  atividades: selectedCompany?.legacyCompany?.atividades || [],
                  cnaePrincipal: selectedCompany?.legacyCompany?.cnaePrincipal || null,
                }}
                /* ⚠ A ENGRENAGEM DE CONFIGURAÇÃO (dono, 19/08/2026) — a ENTRADA da tela de emissão
                   passou a ser daqui, e a aba irmã no grupo Fiscal saiu. O destino é o MESMO e a
                   URL é a MESMA: `companyTabPath` é a função que a navegação por clique já usa, e
                   o `href` sai dela — duas construções da mesma URL divergem na primeira correção.
                   Clique normal navega por dentro do app (`switchTab`); Ctrl/Cmd/meio abrem em
                   nova guia, de graça, porque é um `<a href>` de verdade. */
                hrefConfiguracaoEmissao={companyId ? companyTabPath(companyId, "emissaoNfse") : null}
                onAbrirConfiguracaoEmissao={() => switchTab("emissaoNfse")}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // ⚠⚠ A ABA "APURAÇÃO" DESPACHA POR REGIME desde 27/08/2026 — o Presumido tem a tela dele.
  //
  // ⚠ ESTE RAMO JÁ ERA ALCANÇÁVEL PELO LUCRO PRESUMIDO ANTES DA MUDANÇA: aqui nunca houve guarda de
  // regime, então a URL `/companies/:id/cadastro-fiscal` renderizava o PGDAS-D para uma empresa do
  // Presumido — só não havia botão que levasse até ela. Ao ligar o botão, esse ramo passa a ser
  // percorrido de verdade, e sem o despacho a empresa do Presumido abriria a tela do Simples.
  //
  // ⚠ `telaDeApuracao` só tem dois desfechos, e é isso que garante que uma das duas SEMPRE renderiza
  // — regime desconhecido cai no Simples, que é o comportamento de sempre.
  if (companyDetailTab === "cadastroFiscal" && telaDeApuracao(selectedCompany) === APURACAO.PRESUMIDO) {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="cadastroFiscal"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        largura="trabalho"
        feedback={feedback}
        suspense
      >
        <ApuracaoLpTab
          companyId={companyId}
          competencia={circularPanel?.competencia}
          razao={selectedCompany?.razao}
        />
      </CompanyTabLayout>
    );
  }

  // Grupo Fiscal — sub-abas Cadastro Fiscal / Sugestão / Pendências (mesmo hook via wrapper único).
  // Fiscal → Cadastro. Sugestão e Pendências são sub-abas INTERNAS deste painel (estado local).
  if (companyDetailTab === "cadastroFiscal") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="cadastroFiscal"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1, padding: 24 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <ApuracaoV2TabWrapper
                companyId={companyId} feedback={feedback} razao={selectedCompany?.razao}
                myRole={selectedCompany?.myRole}
                competencia={circularPanel?.competencia}
                onCompetenciaChange={circularPanel?.onCompetenciaChange}
                onAbrirPerfilFiscal={() => switchTab("perfilFiscal")}
              />
            </Suspense>
          </ErrorBoundary>

          {/* ⚠⚠ SEM ISTO A ABA INTEIRA É MUDA — relatado pelo dono em 25/08/2026: *"ao clicar em
              classificar competência nada acontece"*. E não acontecia MESMO: a classificação
              rodava, `useApuracaoV2` chamava `notifySuccess("Classificou 0/0…")`, e **ninguém
              desenhava a mensagem**. Medido na tela: depois do clique, o texto do documento não
              mudou em um caractere.

              ⚠ O `feedback` estava sendo passado certo o caminho todo (página → wrapper → hook) —
              o que faltava era o CONSUMIDOR. As abas que usam `CompanyTabLayout` ganham este
              componente de graça (ele o renderiza por dentro); as que montam o layout à mão, como
              esta, precisam declará-lo.

              ⚠ É primo do defeito que o `apps/web/CLAUDE.md` já registra (*"o sintoma era 'o botão
              Calcular não faz nada'"*), mas não o mesmo: lá o objeto `feedback` era mutilado na
              passagem; aqui ele chega inteiro e não tem quem o mostre. Mesma consequência, outra
              causa — e por isso o conserto de lá não protegeu esta aba. */}
          <Feedback message={feedback.message} error={feedback.error} />
        </div>
      </div>
    );
  }

  // Perfil fiscal (grupo Empresa) — regime + atividades permitidas por CNAE.
  // ⚠ A TERCEIRA PEÇA da aba nova: sem este bloco a URL `/perfil-fiscal` cai em Anotações **sem
  // erro nenhum** (as outras duas são a entrada em `GROUPS` e o par em `rotasDaEmpresa.js`).
  // ⚠ SEM `competencia` no header, de propósito: atividade permitida é cadastro da empresa, não do
  // mês — um seletor aqui sugeriria que a lista muda por competência.
  if (companyDetailTab === "perfilFiscal") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="perfilFiscal"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />
        <div style={{ flex: 1, padding: 24 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <PerfilFiscalTabWrapper companyId={companyId} feedback={feedback} />
            </Suspense>
          </ErrorBoundary>
          {/* ⚠⚠ ESTA LINHA FALTAVA ATÉ 27/08/2026, e a aba era MUDA: "Salvar perfil" gravava, o hook
              chamava `notifySuccess`/`notifyError`, e **ninguém desenhava a mensagem**.
              ⚠⚠ É O MESMO DEFEITO QUE A ABA APURAÇÃO PAGOU EM 25/08/2026 — o dono relatou como *"ao
              clicar em classificar competência nada acontece"* — repetido na aba que nasceu no mesmo
              dia, oito linhas acima neste arquivo. Nem o conserto de lá nem o comentário longo que
              ficou ao lado dele protegeram esta.
              ⚠ A causa é estrutural: abas que usam `CompanyTabLayout` ganham o `Feedback` de graça
              (ele o renderiza por dentro); as que montam a moldura à mão precisam declará-lo, e
              **nada obriga**. Migrar esta aba para o primitivo resolveria a classe inteira — é
              trabalho à parte, e fica nomeado. */}
          <Feedback message={feedback.message} error={feedback.error} />
        </div>
      </div>
    );
  }

  // ⚠⚠ PLANEJAMENTO TRIBUTÁRIO DENTRO DA EMPRESA — a TERCEIRA das três peças (as outras são a
  // entrada em `GROUPS` e o par em `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT`). Faltando esta, o clique na
  // aba abriria Anotações **sem erro nenhum**.
  //
  // ⚠⚠ É A MESMA TELA DA PÁGINA GLOBAL, presa à empresa por `empresaFixa`. Não é uma segunda
  // implementação: duas telas do mesmo comparativo divergiriam na primeira correção fiscal, e a
  // que ninguém abre é a que erra. O que muda é o MODO — aqui não há seletor de empresa e não há
  // simulação livre; lá não há empresa e não há como guardar.
  if (companyDetailTab === "planejamento") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="planejamento"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
        />
        <div style={{ flex: 1, padding: 24 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              {/* ⚠ `empresas` NÃO é passada: sem ela o seletor não renderiza, e a tela não oferece
                  trocar de empresa de dentro da empresa. */}
              <PlanejamentoPage api={planejamentoApi} empresa={{ id: companyId }} empresaFixa />
            </Suspense>
          </ErrorBoundary>
          {/* ⚠ O `Feedback` é declarado à mão porque esta aba monta a moldura à mão — a mesma
              lacuna estrutural que o comentário do Perfil fiscal, oito linhas acima, registra. */}
          <Feedback message={feedback.message} error={feedback.error} />
        </div>
      </div>
    );
  }

  // Auditoria pré-apuração — autônoma (faz a própria chamada), e por competência.
  //
  // ⚠ Ela recebe a competência GLOBAL (`circularPanel.competencia`), a mesma que Lançamentos,
  // Circular, Guias e Notas Fiscais leem. Uma competência própria aqui faria a auditoria conferir um
  // mês e a apuração fechar outro — que é exatamente o defeito que a competência global corrigiu.
  /**
   * ⚠⚠ A CONFERÊNCIA DEIXOU DE SER ABA EM 29/08/2026 — ela virou um BOTÃO dentro de Lançamentos.
   *
   * > Dono: *"essas saídas que o cliente digitar aparecem para o contador na aba de conferência,
   * > aba essa que deve estar dentro dos lançamentos, como um botão com aviso quando há conferência
   * > a ser feita, como notas recebidas"*.
   *
   * ⚠⚠ **A ROTA E ESTE BLOCO FICAM.** O que saiu foi o botão no cabeçalho (`GROUPS`); o segmento
   * `/conferencia` continua respondendo, porque é para cá que o botão novo leva — e porque link
   * antigo não pode virar tela em branco (o defeito que `rotasDaEmpresa.js` já registra).
   *
   * ⚠ **ELA MONTA COM `activeTab="lancamentos"`**, que é a aba de onde se chega: sem isso o
   * cabeçalho ficaria sem nenhuma aba marcada, e a pessoa não saberia onde está. E a migalha
   * *"‹ Voltar aos lançamentos"* é obrigatória — aba que some sem caminho de volta é tela sem saída.
   */
  if (companyDetailTab === "conferencia") {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="lancamentos"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        /* ⚠ `trabalho`: a fila é uma tabela de oito colunas por fornecedor. Em `leitura` as colunas
           de data e valor se espremem, e o defeito de tabela apertada é invisível — largura demais
           é visível e barato (regra dos primitivos, `apps/web/CLAUDE.md`). */
        largura="trabalho"
        suspense
      >
        <ConferenciaTab
          companyId={companyId}
          competencia={circularPanel?.competencia}
          /* ⚠ `canEditCompany` é o que esta página já usa para "pode escrever nesta empresa". A
             GUARDA continua sendo o `minRole: "ACCOUNTANT"` da rota — isto só evita oferecer um
             botão que o servidor vai recusar com 403. */
          podeEscrever={canEditCompany}
          /* ⚠ O caminho de volta. Ele é o MESMO `switchTab` das abas — não um `history.back()`, que
             levaria para fora da empresa quando a pessoa chegou aqui por link direto. */
          aoVoltar={() => switchTab("lancamentos")}
        />
      </CompanyTabLayout>
    );
  }

  if (companyDetailTab === "auditoria") {
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="auditoria"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        /* ⚠ `leitura`: a Auditoria são cinco PERGUNTAS em texto, não uma tabela. Ela é o melhor
           desenho do grupo Fiscal e agora abre na mesma largura das demais telas de leitura. */
        largura="leitura"
        suspense
      >
        <AuditoriaTab companyId={companyId} competencia={circularPanel?.competencia} />
      </CompanyTabLayout>
    );
  }

  // Q41: Aba Situação Fiscal (SITFIS) — autônoma (hook próprio via wrapper)
  if (companyDetailTab === "sitfis") {
    // ⚠⚠ ESTE RAMO REMONTAVA O `CompanyTabLayout` À MÃO — a mesma `<div minHeight:100vh>`, o mesmo
    // `CompanySectionHeader`, o mesmo par `ErrorBoundary`+`Suspense` — e, por não ter o primitivo,
    // não tinha `largura`. A aba então cravava a própria (`maxWidth: 1400` dentro de
    // `renderSitfisTab`), e era literalmente o sintoma que o dono relatou em 20/08/2026: *"trocar
    // de sub-aba fazia o conteúdo saltar"* (`1100` na ficha, `900` no cofre, **`1400` no SITFIS**).
    // ⚠ `trabalho` (`--content-wide`, 90%) e não `leitura` (1200px): o relatório do SITFIS é uma
    // tabela larga, e a regra escrita do primitivo é que espremer é o defeito invisível.
    return (
      <CompanyTabLayout
        company={selectedCompany}
        activeTab="sitfis"
        onBack={onBack}
        onTabChange={switchTab}
        canEditCompany={canEditCompany}
        competencia={circularPanel?.competencia}
        onCompetenciaChange={circularPanel?.onCompetenciaChange}
        largura="trabalho"
        suspense
      >
        <SitfisTabWrapper companyId={companyId} />
      </CompanyTabLayout>
    );
  }

  // ─── Aba Circular: layout full-screen ────────────────────────────────────────

  if (companyDetailTab === "circular") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="circular"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />

        <div style={{ flex: 1 }}>
          <ErrorBoundary>
          <Suspense fallback={<TabLoadingFallback />}>
          <CircularTab
            companyId={companyId}
            companyRegime={companyRegime}
            /* Só para o cabeçalho da IMPRESSÃO: a folha sai sem o header do app, e uma tabela de
               12 meses sem o nome da empresa serve para qualquer uma. */
            companyName={selectedCompany?.razao}
            circularData={circularPanel.circularData}
            loading={circularPanel.loading}
            year={circularPanel.year}
            competencia={circularPanel.competencia}
            onCompetenciaChange={circularPanel.onCompetenciaChange}
            onYearChange={circularPanel.onYearChange}
            onLoad={circularPanel.onLoadCircular}
            accounts={accountingPanel.accounts}
            onCreateBaixa={accountingPanel.onCreateBaixa}
            savingBaixa={accountingPanel.savingBaixa}
            onLoadBaixaTemplate={accountingPanel.onLoadBaixaTemplate}
            error={circularPanel.error}
            message={circularPanel.message}
            onUpdateEntry={accountingPanel.onUpdateEntry}
            onSearchHistoricos={accountingPanel.onSearchHistoricos}
            onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
            onPreviewEstorno={circularPanel.onPreviewEstorno}
            onEstornarBaixa={circularPanel.onEstornarBaixa}
            parcelamentos={accountingPanel.parcelamentos}
            onSaveCircular={circularPanel.onSaveCircular}
            savingCircular={circularPanel.savingCircular}
          />
          </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // ─── Aba Parcelamento (grupo Contabilidade) ──────────────────────────────────
  if (companyDetailTab === "parcelamento") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="parcelamento"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              <ParcelamentoTab
                companyId={companyId}
                parcelamentos={accountingPanel.parcelamentos}
                accounts={accountingPanel.accounts}
                onSearchHistoricos={accountingPanel.onSearchHistoricos}
                onGetHistoricosByCode={accountingPanel.onGetHistoricosByCode}
                /* A guia é anexada na aba Guias (+ Subir Guia → PARCELAMENTO). O card leva até lá
                   em vez de mostrar um item desabilitado sem saída. */
                onIrParaGuias={() => switchTab("guides")}
                abrirWizardAoMontar={abrirWizardParcelamento}
                onWizardAberto={() => setAbrirWizardParcelamento(false)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // ─── Aba Obrigações (grupo Contabilidade) ───────────────────────────────────
  // É o MESMO calendário do dashboard, travado nesta empresa (`companyIdFixo`) — não uma segunda
  // tela que precisaria ser mantida em paralelo. Sem `onOpenCompany`: já se está dentro dela.
  if (companyDetailTab === "obrigacoes") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="obrigacoes"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              {/* Sem companyId ainda, o calendário buscaria a carteira INTEIRA dentro da página de
                  uma empresa — espera a empresa carregar antes de montar. */}
              {companyId ? <ObrigacoesDaEmpresa companyId={companyId} companyRegime={companyRegime} /> : <TabLoadingFallback />}
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  if (companyDetailTab === "relatorios") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column" }}>
        <CompanySectionHeader
          company={selectedCompany}
          activeTab="relatorios"
          onBack={onBack}
          onTabChange={switchTab}
          canEditCompany={canEditCompany}
          competencia={circularPanel?.competencia}
          onCompetenciaChange={circularPanel?.onCompetenciaChange}
        />
        <div style={{ flex: 1 }}>
          <ErrorBoundary>
            <Suspense fallback={<TabLoadingFallback />}>
              {companyId ? (
                <RelatoriosTab
                  companyId={companyId}
                  /* ⚠ A competência global é a ÂNCORA do intervalo, não o intervalo em si: os
                     períodos oferecidos (mês, trimestre, ano, 12 meses) terminam nela. Por isso
                     esta aba NÃO está em `TABS_COM_COMPETENCIA` — o seletor do header não aparece
                     aqui, e quem manda no período são os chips da própria tela. */
                  competenciaReferencia={circularPanel?.competencia}
                  razaoSocial={selectedCompany?.razao}
                />
              ) : <TabLoadingFallback />}
            </Suspense>
          </ErrorBoundary>
        </div>
        <Feedback message={feedback.message} error={feedback.error} />
      </div>
    );
  }

  // ─── Demais abas: layout padrão ────────────────────────────────────────────

  return (
    <AppShell>
      <PageHeader
          title={selectedCompany?.razao || "Empresa"}
          description="Dados cadastrais, guias e lançamentos contábeis."
          actions={<BackButton onClick={onBack} />}
      />

      {selectedCompany && (
        <section className="panel">
          <div className="company-card">
            <p><span className="text-muted">CNPJ:</span> {selectedCompany.cnpj}</p>
            <p><span className="text-muted">E-mail do responsável:</span> {selectedCompany.ownerEmail || selectedCompany.email || "—"}</p>
            <p><span className="text-muted">E-mail das guias:</span> {selectedCompany.guideNotificationEmail || "—"}</p>
            <p><span className="text-muted">Pró-labore:</span> {selectedCompany.hasProlabore ? "Sim" : "Não"}</p>
            <p><span className="text-muted">Folha de pagamento:</span> {selectedCompany.temFolha ? "Sim" : "Não"}</p>
            <p><span className="text-muted">Município / UF:</span> {selectedCompany.municipio || "—"} / {selectedCompany.uf || "—"}</p>
          </div>
          <div className="toolbar">
            <Button variant="secondary" type="button"
              onClick={() => switchTab("guides")}
              disabled={companyDetailTab === "guides"}>
              Guias
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("lancamentos")}>
              Lançamentos
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("circular")}>
              Circular
            </Button>
            <Button variant="secondary" type="button"
              onClick={() => switchTab("cadastro")}
              disabled={companyDetailTab === "cadastro"}>
              Cadastro
            </Button>
          </div>
        </section>
      )}

      {companyDetailTab === "guides" && (
          <Suspense fallback={<TabLoadingFallback />}>
          <CompanyGuidesTable guides={guidesPanel.guides} loadingGuides={guidesPanel.loading} onRefresh={guidesPanel.onRefresh} onResendGuide={guidesPanel.onResendGuide} onConfirmGuidePayment={guidesPanel.onConfirmGuidePayment} onRecalculateGuide={guidesPanel.onRecalculateGuide} onRecalcularInss={guidesPanel.onRecalcularInss} recalcInssBusy={guidesPanel.recalcInssBusy} onLiberarGuia={guidesPanel.onLiberarGuia} liberarGuiasBusy={guidesPanel.liberarGuiasBusy} resendingGuideId={guidesPanel.resendingGuideId} confirmingGuideId={guidesPanel.confirmingGuideId} recalculatingGuideId={guidesPanel.recalculatingGuideId} />
          </Suspense>
        )}

      <Feedback message={feedback.message} error={feedback.error} />
    </AppShell>
  );
}
