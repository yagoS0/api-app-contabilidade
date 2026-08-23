import { useMemo, useState } from "react";
import { api } from "../../api";
import { limparSessao, lerEmpresaSalva, salvarEmpresa } from "../../api/sessionStore";
import { AlertaErro, Carregando, Vazio } from "../../components/ui";
import { useCarregamento, useRota } from "../../lib/hooks";
import { competenciaPadrao, fmtCnpj, texto } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { oNavegadorAssumeOClique } from "../../lib/cliqueDeLink";
import { iconeDaRota, temIconePropio } from "../../components/icones";
import { SeletorEmpresa } from "./SeletorEmpresa";
import { PainelPage } from "../painel/PainelPage";
import { NotasPage } from "../notas/NotasPage";
import { EmitirNotaPage } from "../emitir/EmitirNotaPage";
import { LotePlanilhaPage } from "../lote/LotePlanilhaPage";
import { esquecerTodasAsDescricoes } from "../emitir/lib/descricoesRecentes";
import { GuiasPage } from "../guias/GuiasPage";
import { LogoAltan } from "../../components/LogoAltan";
import { SituacaoFiscalPage } from "../fiscal/SituacaoFiscalPage";

// ⚠⚠ A ABA "EMITIR" FOI REMOVIDA EM 19/08/2026 — pedido do dono: emitir virou um BOTÃO dentro de
// Notas. A remoção é INTEIRA: o item do menu (aqui), o destino de roteamento (`lib/hooks.js`) e o
// estado. Meia remoção — tirar do menu e deixar a rota de pé — é o "filtro fantasma": um link
// antigo para `#/emitir` levaria a uma tela sem nenhuma saída visível.
//
// ⚠ O QUE NÃO SE PERDEU COM ISSO. A emissão continua ALCANÇÁVEL POR QUEM NÃO PODE EMITIR: o botão
// em Notas aparece sempre, e a tela do outro lado explica qual guarda está fechada e o que fazer.
// Era essa a razão de a aba aparecer sempre, e ela vale igual para o botão — escondê-lo deixaria o
// cliente sem saber que a emissão existe e que ela depende de um clique do contador.
const ABAS = [
  { chave: "home", rotulo: "Início" },
  { chave: "notas", rotulo: "Notas" },
  { chave: "guias", rotulo: "Guias" },
  { chave: "fiscal", rotulo: "Situação fiscal" },
];

export function AppShell({ user }) {
  const { rota, navegar } = useRota();
  const [empresaEscolhida, setEmpresaEscolhida] = useState(() => lerEmpresaSalva());
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  // ⚠ O MODELO DE EMISSÃO ATRAVESSA DUAS TELAS, e é por isso que ele mora aqui: quem escolhe a nota
  // é a lista (`NotasPage`), quem preenche o formulário é a emissão (`EmitirNotaPage`), e entre as
  // duas só existe a navegação por hash — que não carrega objeto. Guardá-lo dentro de qualquer uma
  // delas o perderia na troca de rota, porque a casca só monta a tela ativa.
  const [modeloEmissao, setModeloEmissao] = useState(null);
  // ⚠ A EMISSÃO É UM MODO DA TELA DE NOTAS, não mais uma rota. Este booleano é o que substituiu
  // `rota === "emitir"`. Ele mora aqui, e não dentro da `NotasPage`, pelo mesmo motivo do modelo:
  // a casca é quem monta a tela ativa, e é ela que precisa decidir entre a lista e o formulário.
  const [emissaoAberta, setEmissaoAberta] = useState(false);
  // ⚠⚠ A COMPETÊNCIA É UMA SÓ, E ELA MORA AQUI.
  //
  // Eram DUAS: `HomePage` e `NotasPage` tinham, cada uma, o seu `useState(competenciaPadrao)`.
  // Trocar o mês no Início e ir para Notas voltava ao padrão — sem nada dizendo que voltou —, e o
  // cliente lia dois meses diferentes em duas abas do mesmo portal, sobre a mesma empresa.
  //
  // É literalmente o defeito que o portal do escritório já pagou e consertou: o cabeçalho de
  // `apps/web/.../renderCompanyDetailHeader.jsx` registra "o mesmo defeito repetido cinco vezes:
  // dois seletores para um valor", e a cura foi um controle único na casca. Aqui a casca já é o
  // lugar natural — é onde `modeloEmissao` e `emissaoAberta` moram, pela mesma razão (atravessam
  // telas, e a casca é quem monta a tela ativa).
  //
  // ⚠ OS DOIS CONTROLES CONTINUAM ONDE ESTAVAM, e isso é decisão: em Notas ele é um FILTRO, dentro
  // do card de filtros, com a opção "Todas"; no Início ele é o RECORTE do resumo, no cabeçalho da
  // página. Juntá-los num controle só na barra do topo obrigaria o Início a oferecer um "Todas"
  // que ele não sabe honrar — e um controle que não comanda o que promete é pior que dois.
  // O que passou a ser único é o VALOR.
  //
  // ⚠ O DEFAULT NÃO MUDOU: `competenciaPadrao` é o mês CORRENTE, decisão do dono de 18/08/2026 que
  // inverte o padrão do escritório (mês anterior). O porquê está em `lib/format.js`.
  const [competencia, setCompetencia] = useState(competenciaPadrao);
  // ⚠ O LOTE POR PLANILHA É O SEGUNDO MODO DA MESMA ROTA, pelo mesmo motivo da emissão: o
  // roteamento é por hash com três destinos fixos, e a casca é quem monta a tela ativa. ⚠ Ele NÃO
  // emite nada — prepara e confere a planilha. A emissão em lote é fase seguinte.
  const [loteAberto, setLoteAberto] = useState(false);

  const empresasQuery = useCarregamento(() => api.getCompanies(), []);
  const empresas = empresasQuery.dados || [];

  // Empresa ativa: a escolhida, se ainda for válida; senão a `defaultClientId`
  // do login; senão a primeira. ⚠ A validação contra a lista importa: um id
  // salvo de um acesso anterior (ou de outro usuário na mesma máquina) não pode
  // sobreviver à troca de conta.
  const empresaAtiva = useMemo(() => {
    if (!empresas.length) return null;
    return (
      empresas.find((e) => e.companyId === empresaEscolhida) ||
      empresas.find((e) => e.companyId === user?.defaultClientId) ||
      empresas[0]
    );
  }, [empresas, empresaEscolhida, user?.defaultClientId]);

  function escolherEmpresa(companyId) {
    setEmpresaEscolhida(companyId);
    salvarEmpresa(companyId);
    setSeletorAberto(false);
    // ⚠ E FECHA O LOTE: a planilha conferida é de OUTRA empresa. A própria tela também descarta o
    // estado dela ao ver o `companyId` mudar — guarda de um lado só não é guarda.
    setLoteAberto(false);
    // ⚠⚠ TROCAR DE EMPRESA DESCARTA O MODELO. Ele foi tirado da nota de OUTRA empresa; aplicá-lo
    // aqui emitiria no CNPJ errado. É a mesma razão pela qual a `EmitirNotaPage` zera o formulário
    // inteiro na troca — e ela ainda confere o `companyId` do modelo antes de aplicar, porque uma
    // guarda só do lado de quem envia não é guarda.
    setModeloEmissao(null);
  }

  /**
   * ⚠ SAIR DE NOTAS FECHA A EMISSÃO — e isso REPRODUZ o comportamento de antes, não muda nada.
   * Enquanto "emitir" era rota, trocar de aba DESMONTAVA a `EmitirNotaPage` e o formulário meio
   * preenchido já se perdia. Mantê-lo aberto por trás de outra aba seria um comportamento NOVO,
   * que ninguém pediu — e faria o clique em "Notas" cair num formulário, e não na lista que o
   * rótulo promete.
   */
  function irPara(destino) {
    setEmissaoAberta(false);
    setLoteAberto(false);
    navegar(destino);
  }

  /** Abre a emissão em branco — o botão "Emitir nota" da lista. */
  function abrirEmissao() {
    setModeloEmissao(null);
    setLoteAberto(false);
    setEmissaoAberta(true);
  }

  /**
   * Abre o lote por planilha — o botão "Emissão em Lote" da lista (rótulo do dono, 21/08/2026;
   * era "Preparar lote por planilha", de quando a tela ainda não emitia).
   *
   * ⚠ Os dois modos são EXCLUSIVOS: a emissão avulsa e o lote são duas conversas diferentes sobre
   * a mesma empresa, e sobrepô-las deixaria um formulário meio preenchido atrás de uma tabela.
   */
  function abrirLote() {
    setEmissaoAberta(false);
    setLoteAberto(true);
  }

  /**
   * A nota escolhida na lista vira o ponto de partida da emissão.
   *
   * ⚠ ISTO NÃO NAVEGA MAIS. Antes era `navegar("emitir")`; hoje a lista e o formulário são a MESMA
   * rota, e o que muda é o modo. O modelo continua vivendo na casca porque continua atravessando
   * duas telas — só que agora as duas telas são dois estados de uma rota só.
   */
  function reaproveitarNota(modelo) {
    if (!modelo) return;
    setModeloEmissao(modelo);
    setEmissaoAberta(true);
  }

  /** Volta da emissão para a lista, sem sair da rota. */
  function fecharEmissao() {
    setEmissaoAberta(false);
    setModeloEmissao(null);
  }

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      await api.logout();
    } finally {
      // A sessão local some mesmo se o servidor não responder: "Sair" que não
      // sai é pior que erro visível, sobretudo em computador compartilhado.
      salvarEmpresa(null);
      // ⚠ E o histórico de descrições vai junto: ele guarda nome e CNPJ de tomadores. Pelo mesmo
      // motivo do resto desta linha — computador compartilhado. Ver `emitir/lib/descricoesRecentes.js`.
      esquecerTodasAsDescricoes();
      limparSessao();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        {/* ⚠ A MARCA AQUI É SÓ O SOL, E ELA VOLTA AO INÍCIO — pedido do dono, 23/08/2026:
            *"tire a 'Altan contabilidade' e deixe apenas o Sol no canto superior, e ao clicar volta
            ao início"*. O letreiro continua inteiro na tela de LOGIN, que é onde a marca se
            apresenta; aqui dentro ela já foi apresentada e o que resta é a âncora.

            ⚠⚠ É `<a href="#/home">`, com o MESMO tratamento de clique das abas — não um `<button>`
            e não um `<div onClick>`. Daí saem de graça Ctrl/Cmd+clique em nova guia, clique do
            meio, "abrir em nova aba", a URL no hover e "copiar endereço do link". O clique normal
            continua SPA (`preventDefault` + `irPara`), senão o `emissaoAberta` se perde — ele é
            estado da casca e o hash não o carrega.

            ⚠ O `aria-label` diz as DUAS coisas (que marca é, e para onde vai). Sem ele, o nome
            acessível viria do `<title>` do SVG e seria só "Altan Contabilidade": quem usa leitor de
            tela ouviria uma marca e não saberia que ali há um caminho de volta. E ele NÃO repete o
            rótulo "Início" da aba ao lado — dois links com o mesmo nome, um deles imagem, é o que
            faz a navegação por lista de links virar adivinhação. */}
        <a
          className="brand"
          href="#/home"
          title="Início"
          onClick={(event) => {
            if (oNavegadorAssumeOClique(event)) return;
            event.preventDefault();
            irPara("home");
          }}
          aria-label="Altan Contabilidade — ir para o início"
        >
          <LogoAltan variante="marca" altura={26} />
        </a>

        <div className="empresa">
          {empresaAtiva ? (
            <>
              <div className="empresa-nome" title={texto(empresaAtiva.razao)}>
                {texto(empresaAtiva.razao)}
              </div>
              <div className="empresa-cnpj">
                {fmtCnpj(empresaAtiva.cnpj)}
                {empresaAtiva.myRole ? ` · ${roleLabel(empresaAtiva.myRole)}` : ""}
              </div>
            </>
          ) : (
            <div className="empresa-cnpj">{empresasQuery.carregando ? "Carregando empresas…" : ""}</div>
          )}
        </div>

        <div className="topbar-actions">
          {empresas.length > 1 ? (
            <button type="button" className="btn" onClick={() => setSeletorAberto(true)}>
              Trocar empresa
            </button>
          ) : null}
          <button type="button" className="btn" onClick={sair} disabled={saindo}>
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>

      {/* ⚠ AS ABAS SÃO `<a href>` DE VERDADE (20/08/2026), e a tecla NÃO é interceptada.
          O roteamento já é por hash (`lib/hooks.js`), então `href="#/notas"` existe de graça — e
          com ele vêm, sem uma linha de código: Ctrl/Cmd+clique abrindo em nova guia, clique do
          MEIO, "abrir em nova aba" do botão direito, a URL ao passar o mouse e "copiar endereço
          do link". Um `onClick` que olhasse `event.ctrlKey` resolveria o primeiro caso e quebraria
          os outros quatro. É o mesmo movimento que o portal do escritório fez em 19/08 nas abas da
          empresa, pela mesma razão.

          ⚠ Precisão sobre o `event.button !== 0` abaixo: o clique do MEIO e o BOTÃO DIREITO já não
          chegam aqui — navegador moderno dispara `auxclick` (e `contextmenu`), não `click`. Quem
          faz os dois funcionarem é o `href`, não esta cláusula; ela cobre o caso residual e o
          navegador antigo. Registrado porque a frase acima credita a ela algo que ela não faz.

          ⚠⚠ O CLIQUE NORMAL CONTINUA SPA — `preventDefault()` + `irPara`, exatamente como o
          `Tabs` do escritório. Sem isso, quem navega é o `href` sozinho, e duas coisas se perdem:
          o `emissaoAberta`, que é estado da casca e o hash não carrega (voltar para Notas cairia
          num formulário meio preenchido em vez da lista), e o controle do `useRota`. Modificado
          (Ctrl/Cmd/Shift/Alt) ou botão ≠ esquerdo passam SEM `preventDefault`: aí é o navegador
          que assume, e é dele que vêm as cinco coisas de graça.
          ⚠ E num Ctrl+clique a guia atual fica onde está — por isso o `irPara` (que fecha a
          emissão) também não roda: jogaria fora o formulário de quem só queria abrir Notas do lado.

          ⚠ O botão "Emitir nota" da lista continua `<button>`: ele abre um MODO, não uma rota —
          não tem URL, e inventar uma abriria guia quebrada. */}
      {/* ⚠ A BARRA É SÓ ÍCONE (decisão do dono), e o rótulo vive em `.sr-only` + `title`.
          O `.sr-only` faz três coisas de uma vez: dá o NOME ACESSÍVEL do link (é ele que
          `getByRole("link", { name })` acha), mantém o `textContent` do `<a>` — que é como as
          suítes de casca enumeram as abas — e garante que quem usa leitor de tela ouça o destino,
          não "link, imagem".
          ⚠ `title` NÃO é tooltip de verdade: não aparece no teclado nem no toque. É o que existe
          sem trazer dependência (`CLAUDE.md`: nada entra sem discutir), e o limite fica registrado
          aqui, não escondido.
          ⚠ `aria-label="Seções"` NÃO pode ser renomeado: as suítes de casca selecionam por ele. */}
      <nav className="nav" aria-label="Seções">
        {ABAS.map((aba) => {
          const Icone = iconeDaRota(aba.chave);
          // ⚠ Rota sem desenho não vira link vazio (destino invisível numa barra de ícones): ela
          // cai na reserva E mostra o rótulo em tela. A ausência aparece em vez de se esconder.
          const semDesenhoProprio = !temIconePropio(aba.chave);
          return (
            <a
              key={aba.chave}
              href={`#/${aba.chave}`}
              title={aba.rotulo}
              aria-current={rota === aba.chave ? "page" : undefined}
              onClick={(event) => {
                if (oNavegadorAssumeOClique(event)) return;
                event.preventDefault();
                irPara(aba.chave);
              }}
            >
              <Icone />
              <span className={semDesenhoProprio ? "nav-rotulo" : "sr-only"}>{aba.rotulo}</span>
            </a>
          );
        })}
      </nav>

      <main className="page">
        {empresasQuery.carregando ? (
          <Carregando>Carregando suas empresas…</Carregando>
        ) : empresasQuery.erro ? (
          <AlertaErro
            erro={empresasQuery.erro}
            padrao="Não foi possível carregar suas empresas."
            aoTentarNovamente={empresasQuery.recarregar}
          />
        ) : !empresaAtiva ? (
          <Vazio>
            Nenhuma empresa está vinculada ao seu acesso. Fale com o seu contador para liberar.
          </Vazio>
        ) : rota === "notas" ? (
          // ⚠ UMA ROTA, DOIS MODOS. `emissaoAberta` é o que sobrou de `rota === "emitir"`.
          emissaoAberta ? (
            <EmitirNotaPage
              empresa={empresaAtiva}
              // ⚠ O PROP MUDOU DE NOME PORQUE MUDOU DE NATUREZA. Era `aoNavegar`, e a única coisa
              // que a emissão jamais fez com ele foi `aoNavegar("notas")` — ou seja, voltar. Hoje
              // isso não é navegação, é fechar um modo; um nome que dissesse "navegar" mentiria.
              aoVoltarParaNotas={fecharEmissao}
              modelo={modeloEmissao}
              aoDescartarModelo={() => setModeloEmissao(null)}
              // ⚠ Recarregar as EMPRESAS, não a tela: o estado do portão (`emissaoNfseLiberada`)
              // vem de `GET /client/companies`, então quem está no ramo "não recebemos o estado" só
              // sai dele refazendo essa chamada.
              aoRecarregarEmpresas={empresasQuery.recarregar}
            />
          ) : loteAberto ? (
            <LotePlanilhaPage empresa={empresaAtiva} aoVoltar={() => setLoteAberto(false)} />
          ) : (
            <NotasPage
              empresa={empresaAtiva}
              competencia={competencia}
              aoTrocarCompetencia={setCompetencia}
              aoReaproveitar={reaproveitarNota}
              aoEmitir={abrirEmissao}
              aoPrepararLote={abrirLote}
            />
          )
        ) : rota === "guias" ? (
          <GuiasPage
            empresa={empresaAtiva}
            competencia={competencia}
            aoTrocarCompetencia={setCompetencia}
          />
        ) : rota === "fiscal" ? (
          /* ⚠ SEM `competencia`, e isso é decisão: a situação fiscal é uma FOTO do dia em que o
             contador consultou, não um recorte de mês. Passar o seletor daqui prometeria um filtro
             que o dado não tem — o "filtro fantasma", agora dentro da tela. A data da apuração
             aparece na própria página. */
          <SituacaoFiscalPage empresa={empresaAtiva} />
        ) : (
          <PainelPage
            empresa={empresaAtiva}
            competencia={competencia}
            aoTrocarCompetencia={setCompetencia}
            aoNavegar={irPara}
          />
        )}
      </main>

      {seletorAberto ? (
        <SeletorEmpresa
          empresas={empresas}
          ativaId={empresaAtiva?.companyId || null}
          aoEscolher={escolherEmpresa}
          aoFechar={() => setSeletorAberto(false)}
        />
      ) : null}
    </div>
  );
}
