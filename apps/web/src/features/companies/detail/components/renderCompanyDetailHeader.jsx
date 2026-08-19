import { formatCompetencia, deslocarCompetencia, competenciaAtual } from "../../../../lib/competencia";
import { BackButton } from "../../../../components/ui/BackButton";
import { Tabs } from "../../../../components/ui/Tabs";
// ⚠ O `href` DAS ABAS SAI DAQUI, da MESMA fonte que a navegação por clique usa (`openCompanyTab`
// chama `companyTabPath` também). Montar "/companies/" + id + "/" + segmento aqui funcionaria hoje
// e divergiria na primeira correção — o link levaria a um lugar e o clique a outro.
import { companyTabPath } from "../lib/rotasDaEmpresa";

// ⚠ ABAS QUE VIVEM NUMA COMPETÊNCIA — e são as ÚNICAS que mostram o seletor.
//
// O plano dizia "todas as abas acompanham". "Todas" ao pé da letra não é o que se quer: Cadastro,
// Documentos, Anotações, Plano de Contas e Situação Fiscal não têm mês nenhum, e um seletor que não
// comanda nada é pior que seletor nenhum — a pessoa muda o mês, a tela não muda, e passa a duvidar
// do controle também onde ele funciona.
//
// Aba entra nesta lista quando passa a FILTRAR por competência, e cada uma teve de ceder o seu
// controle local (era o mesmo defeito repetido cinco vezes: dois seletores para um valor):
//
//   lancamentos     ← setas ◀ ▶ sobre a tabela + input no painel de filtros
//   circular        ← já usava a do painel; o ano da matriz acompanha
//   cadastroFiscal  ← `useState(competenciaAnterior())` PRÓPRIO, em dois `input type="month"`
//   guides          ← `filterCompetencia`, cujo "ver todas" só existia apagando o campo
//   notasFiscais    ← campo dentro de um form com botão "Filtrar" (discordava da tabela até o clique)
//
// Parcelamento fica de fora de propósito: lá a competência é a de ABERTURA de um parcelamento que
// se está criando — um dado sendo escrito, não um período sendo olhado. Amarrá-la ao header faria
// o seletor da tela mudar o conteúdo de um formulário.
//
// Obrigações também: o `CalendarioGrid` navega por mês com controle próprio, que já é o único
// daquela tela e serve à página principal do calendário do mesmo jeito.
// ⚠ `auditoria` entra aqui porque a auditoria É por competência — ela responde "as notas DESTE mês
// batem?". Sem o seletor, a aba mostraria sempre o mês default e não haveria como conferir outro.
const TABS_COM_COMPETENCIA = new Set(["lancamentos", "circular", "cadastroFiscal", "guides", "notasFiscais", "auditoria"]);

// Navegação da empresa em 2 níveis: grupos grandes (Anotações, Contabilidade, Fiscal, Empresa)
// e, abaixo, as sub-abas do grupo ativo. A aba ativa continua vindo do segmento da URL (activeTab);
// clicar num grupo navega pro seu 1º sub-tab. Nada de roteamento novo — só reagrupa o header.
const GROUPS = [
  {
    // ANOTAÇÕES VEM PRIMEIRO, e no primeiro nível — não é sub-aba de Cadastro.
    // O raciocínio do dono: se a empresa tem alguma particularidade, isso precisa ser sabido antes
    // de mexer em qualquer número. Enterrada dentro de "Empresa" ela só era vista por quem fosse
    // procurar; e quem vai procurar já sabe o que tem lá. Por isso é também a aba de entrada.
    key: "anotacoes",
    label: "Anotações",
    tabs: [{ key: "anotacoes", label: "Anotações" }],
  },
  {
    key: "contabilidade",
    label: "Contabilidade",
    // Plano de Contas NÃO é sub-aba: abre por dentro de Lançamentos (menu Configurações).
    // A rota /plano-contas segue válida — só não tem botão próprio aqui.
    tabs: [
      { key: "lancamentos", label: "Lançamentos" },
      { key: "circular", label: "Circular" },
      { key: "parcelamento", label: "Parcelamento" },
      // Obrigações fica em Contabilidade e NÃO em Fiscal de propósito: obrigação é o serviço que o
      // escritório entrega até uma data, não tributo a pagar. O cabeçalho do CalendarioFiscalService
      // argumenta isso — guia é do cliente, obrigação é do contador.
      { key: "obrigacoes", label: "Obrigações" },
      // Relatórios fica em Contabilidade porque relata o que foi LANÇADO. É a única aba com
      // intervalo próprio — ver o comentário em TABS_COM_COMPETENCIA logo acima.
      { key: "relatorios", label: "Relatórios" },
    ],
  },
  {
    key: "fiscal",
    label: "Fiscal",
    // Cadastro absorve Sugestão e Pendências (viram sub-abas INTERNAS do painel Cadastro).
    // Q63: ordem = Notas Fiscais → Apuração → Guias → Situação Fiscal (a 1ª também é o destino
    // ao clicar no grupo "Fiscal").
    tabs: [
      { key: "notasFiscais", label: "Notas Fiscais" },
      // ⚠ AUDITORIA VEM ANTES DE APURAÇÃO, e a ordem é o argumento: o dono pediu uma auditoria
      // *pré-apuração* ("entender se a nota está correta ou não, baseado na atividade e baseado na
      // data de emissão"). Ela lê as notas que a apuração vai somar; posta depois, seria conferência
      // do que já foi fechado. ⚠ E ela NÃO é `soApuraSimples`: as cinco perguntas são sobre a NOTA
      // (código de serviço, data, ISS, numeração da DPS), não sobre o regime — esconder a aba do
      // Lucro Presumido tiraria a conferência de quem também emite NFS-e.
      { key: "auditoria", label: "Auditoria" },
      // Só apuramos Simples hoje — no Lucro Presumido esta aba é escondida (ver soApuraSimples).
      { key: "cadastroFiscal", label: "Apuração", soApuraSimples: true },
      { key: "guides", label: "Guias" },
      { key: "sitfis", label: "Situação Fiscal" },
      // ⚠⚠ `emissaoNfse` NÃO ENTRA AQUI — e a ausência é decisão, não esquecimento (dono,
      // 19/08/2026, no mesmo dia em que a aba nasceu):
      //
      //   > *"a aba nova que criei no fiscal de emissão de NFS-e deve ser uma engrenagem de
      //   > configuração na aba Notas Fiscais."*
      //
      // A TELA continua existindo, na MESMA rota (`/companies/:id/emissao-nfse`): o que mudou foi
      // a ENTRADA — hoje é a engrenagem no topo da aba Notas Fiscais
      // (`features/notas/components/renderNotasFiscaisTab.jsx`), que é onde o contador está quando
      // pensa em configurar emissão. Por isso o par em `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` e o bloco
      // `if` da página FICARAM: sem eles a URL cairia em Anotações em silêncio e todo link já
      // guardado morreria. ⚠ Devolver a entrada para cá é criar DUAS portas para a mesma tela.
    ],
  },
  {
    // Abre a FICHA (read-only). Editar é um botão dentro dela, que leva à aba `edit`.
    key: "cadastro",
    // Grupo = "Empresa" (ficha, documentos, anotações). Antes chamava "Cadastro", mesmo nome da
    // sub-aba fiscal e da tela de ficha — a palavra apontava para três lugares diferentes.
    label: "Empresa",
    // Documentos (contrato social, cartão CNPJ, inscrições) mora aqui: é cadastral, não fiscal.
    // Anotações SAIU daqui — virou grupo próprio, primeiro de todos.
    tabs: [
      { key: "cadastro", label: "Cadastro" },
      { key: "documentos", label: "Documentos" },
      // Cofre de senhas + "outras informações". Fica em Empresa, ao lado de Documentos, porque é
      // dado CADASTRAL (onde o escritório entra em nome do cliente), não trabalho do mês — e é
      // onde o contador já procura dado de empresa. NÃO tem competência: fora de
      // TABS_COM_COMPETENCIA de propósito.
      { key: "credenciais", label: "Senhas e acessos" },
    ],
  },
];


// Abas que não são sub-aba de ninguém, mas pertencem a um grupo (o grupo fica destacado).
// `edit` abre pela ficha (botão Editar) e `planoContas` por Lançamentos → Configurações.
// ⚠ `emissaoNfse` entra AQUI, e não em `GROUPS`: ela é uma tela do grupo Fiscal que se abre pela
// ENGRENAGEM da aba Notas Fiscais (dono, 19/08/2026), como `edit` se abre pelo botão Editar da
// ficha e `planoContas` por Lançamentos → Configurações. Sem esta linha o header cairia no primeiro
// grupo (Anotações) enquanto a tela de configuração estivesse aberta — o menu apontando para um
// lugar e a tela mostrando outro.
const TAB_TO_GROUP = { edit: "cadastro", planoContas: "contabilidade", emissaoNfse: "fiscal" };

// Q63: a aba "Apuração" só existe pro Simples — ainda não apuramos Lucro Presumido/Real no app.
// O regime vem do cadastro legado (mesma fonte da tag do card) ou do próprio company.
function isSimplesCompany(company) {
  const regime = company?.regimeTributario
    || company?.tipoTributario
    || company?.legacyCompany?.regimeTributario
    || company?.legacyCompany?.tipoTributario;
  // Sem regime cadastrado não escondemos nada (não sabemos o suficiente pra tirar a aba).
  if (!regime) return true;
  return String(regime).trim().toUpperCase() === "SIMPLES";
}

// O seletor de competência da empresa. Um só controle, no header, para as abas que têm mês.
function CompetenciaSwitcher({ competencia, onChange }) {
  // ⚠ Não se navega para além do mês corrente: não há o que apurar num mês que não terminou, e
  // uma tela vazia de outubro/2027 se parece com erro de carga. O limite é do CONTROLE, não do
  // dado — competência que já veio à frente (vinda de link ou de estado antigo) continua exibida.
  const teto = competenciaAtual();
  const proxima = deslocarCompetencia(competencia, 1);
  const noTeto = competencia >= teto;

  return (
    <div className="company-topbar__competencia" role="group" aria-label="Competência">
      <button
        type="button"
        className="company-topbar__competencia-nav"
        onClick={() => onChange(deslocarCompetencia(competencia, -1))}
        aria-label="Competência anterior"
        title="Competência anterior"
      >
        ‹
      </button>
      <span className="company-topbar__competencia-valor" aria-live="polite">
        {formatCompetencia(competencia)}
      </span>
      <button
        type="button"
        className="company-topbar__competencia-nav"
        onClick={noTeto ? undefined : () => onChange(proxima)}
        disabled={noTeto}
        aria-label="Próxima competência"
        /* Opção desabilitada sempre diz por quê (princípio 7: ausência nunca é resposta). */
        title={noTeto ? "Este é o mês corrente — não há competência posterior para trabalhar" : "Próxima competência"}
      >
        ›
      </button>
    </div>
  );
}

export function CompanySectionHeader({
  company, activeTab, onBack, onTabChange, canEditCompany = false,
  competencia, onCompetenciaChange,
}) {
  const simples = isSimplesCompany(company);
  // O id da empresa é o mesmo que está na URL (`selectedCompany` é achado por `companyId`), então
  // o `href` de cada aba é literalmente a URL para onde o clique navega.
  const companyId = company?.companyId;
  const mostraCompetencia = Boolean(competencia && onCompetenciaChange && TABS_COM_COMPETENCIA.has(activeTab));
  const groups = GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => !t.soApuraSimples || simples),
  }));
  const activeGroup =
    groups.find((g) => g.tabs.some((t) => t.key === activeTab))
    || groups.find((g) => g.key === TAB_TO_GROUP[activeTab])
    || groups[0];
  const subTabs = activeGroup.tabs;

  return (
    <header className="company-section-header">
      {/* Voltar fica FORA da barra (pílula), à esquerda — a posição não mudou.
          ⚠ O que mudou: era só a seta, num quadrado de 40×40 com raio 12. O resto do app usava
          "← Voltar" numa pílula de 33px com raio 14, e a seta sozinha aqui obrigava a reaprender
          onde é a saída ao entrar na empresa. Agora é o mesmo `BackButton` das outras 12 telas. */}
      <BackButton onClick={onBack} title="Voltar" />

      {/* Barra em pílula: nome da empresa + os 3 grupos juntos. */}
      <div className="company-topbar">
        <div className="company-topbar__brand">
          <strong className="company-topbar__name">{company?.razao || "Empresa"}</strong>
          <span className="company-topbar__cnpj">{company?.cnpj || "CNPJ não informado"}</span>
        </div>
        {/* Nível 1 — grupos. `pill={false}`: já está dentro da pílula do topbar; uma segunda
            faixa arredondada aqui viraria pílula dentro de pílula. */}
        <Tabs
          className="company-topbar__nav"
          items={groups.map((group) => ({
            key: group.key,
            label: group.label,
            disabled: Boolean(group.requiresEdit && !canEditCompany),
            title: group.requiresEdit && !canEditCompany ? "Apenas admin ou contador pode editar." : undefined,
            /* ⚠ O `href` do GRUPO é o da sua 1ª sub-aba — exatamente o destino do `onChange` logo
               abaixo (`grupo.tabs[0].key`). Se os dois saíssem de lugares diferentes, o Ctrl+clique
               num grupo abriria uma aba e o clique normal outra. */
            href: companyTabPath(companyId, group.tabs[0]?.key),
          }))}
          active={activeGroup.key}
          onChange={(key) => {
            const grupo = groups.find((g) => g.key === key);
            if (grupo) onTabChange(grupo.tabs[0].key);
          }}
          ariaLabel="Grupos da empresa"
          pill={false}
          size="lg"
        />

        {/* ⚠ TERCEIRA coluna do grid, não ao lado do nome (o plano dizia "ao lado do nome/CNPJ").
            O `.company-topbar` é `1fr auto 1fr` justamente para o menu ficar centrado de verdade
            sem ser empurrado pelo nome da empresa; um quarto filho entre marca e menu jogaria o
            menu para a coluna da folga e descentralizaria o header em TODAS as abas. A folga da
            direita já existia vazia, e o controle global fica no mesmo nível hierárquico do menu. */}
        {mostraCompetencia && (
          <CompetenciaSwitcher competencia={competencia} onChange={onCompetenciaChange} />
        )}
      </div>

      {/* Nível 2 — sub-abas do grupo ativo, em formato de aba (Chrome). Oculto quando o grupo
          tem só 1 (ex.: Cadastro → abre direto a ficha). */}
      {subTabs.length > 1 && (
        <div className="company-section-header__subtabs">
          <Tabs
            /* Cada sub-aba leva a URL da SUA rota — é o que faz o Ctrl+clique abrir aquela aba
               numa guia nova em vez de reabrir a empresa na aba de entrada. */
            items={subTabs.map((tab) => ({ ...tab, href: companyTabPath(companyId, tab.key) }))}
            active={activeTab}
            onChange={onTabChange}
            ariaLabel={`Seções de ${activeGroup.label}`}
          />
        </div>
      )}
    </header>
  );
}
