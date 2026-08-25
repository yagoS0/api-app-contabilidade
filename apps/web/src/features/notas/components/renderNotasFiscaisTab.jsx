// Q12.C.1: aba "Notas Fiscais" da empresa — enxuta, em 2 janelas:
//   • Notas de serviço (NFS-e) — captura ADN + import XML
//   • Notas de venda/compra (NF-e) — captura SEFAZ (DFe)
// Competências/fechamento/apuração ficam na aba Apuração / página global.
//
// ⚠⚠ AS DUAS JANELAS CONTINUAM SEPARADAS, E ISSO É DECISÃO DO DONO (23/08/2026):
//
// > *"vou corrigir algo que disse: as notas de compra devem ser separadas das notas recebidas de
// > serviço"* — corrigindo, no mesmo dia, o pedido anterior de juntar as duas numa aba só.
//
// O fundamento técnico reforça a decisão: **as duas espécies não são a mesma coisa.** NF-e tem
// item, NCM, CFOP e quantidade; NFS-e tem código de serviço e ISS. A coluna comum é pouca (data,
// emitente, valor, situação), então lista única sempre mostraria o menor denominador das duas.
// ⚠ O que ele quer saber — *"o total de notas recebidas"* — é respondido pelo **`NotasResumo`**,
// que conta as duas espécies e diz que a soma é soma de espécies diferentes. Não precisa de lista
// única, e por isso ela não existe.
//
// ⚠ ESTA FRASE DIZIA `RecebidasResumo` ATÉ 24/08/2026, e o componente **não existe mais**: ele foi
// APAGADO em 23/08 quando o dono mandou absorver a faixa de recebidas para junto das outras caixas
// (*"isso aqui tá horrível, esse notas recebidas em cima tem que ser absorvido"*). Um comentário
// que manda procurar um arquivo apagado custa uma busca inteira a quem vier atrás.
//
// ⚠⚠ DOIS DEFEITOS MEDIDOS EM PRODUÇÃO (23/08/2026) FORAM CONSERTADOS AQUI, e os dois faziam a
// MESMA coisa: esconder do contador as notas de COMPRA que nós já tínhamos capturado.
//
//   1. **A janela de NF-e só aparecia com inscrição estadual** (`hasInscricaoEstadual`). Medido:
//      as três — e únicas — empresas com NF-e na base **não têm IE** (SINTROPIA 34, LENTE 11,
//      ALBATROZ 2), porque as notas delas são **compras**, e **receber** NF-e não exige inscrição
//      estadual. Quem precisa de IE é quem EMITE. A única empresa com IE (VAGALO) tem **zero**
//      NF-e. Ou seja: a janela aparecia exatamente para quem não tinha nota, e sumia exatamente
//      para quem tinha. ⚠ É o MESMO raciocínio já registrado no `apps/api/CLAUDE.md` para o worker
//      do DFe (*"NÃO filtre o worker por `inscricaoEstadual`"*) — a regra existia, esta tela é que
//      não a seguia.
//   2. **O filtro de papel começa em `EMIT`** (`useNotasFiscais.js`) e trocar de janela mexia só
//      no `type`. Como **as 47 NF-e da base são `DEST`**, a janela de NF-e, mesmo visível, listava
//      **zero linhas** — "Nenhuma nota encontrada" sobre 34 notas que existem. Consertar só o item
//      1 teria trocado uma janela invisível por uma janela vazia, que é pior: parece resposta.
//      Por isso `trocarJanela` leva o papel para `DEST` ao entrar na NF-e. ⚠ É um PADRÃO, não uma
//      trava: a captura de NF-e é o fluxo do **destinatário** (a fila do projeto se chama
//      `NfeManifestacaoQueue`, "manifestação do destinatário"), e as caixas do resumo continuam
//      trocando o papel para quem emitir NF-e um dia.

import { useEffect, useState } from "react";
import { PANEL } from "./notasStyles";
import { DfeCapturePanel } from "./DfeCapturePanel";
import { AdnCapturePanel } from "./AdnCapturePanel";
import { NotasList } from "./NotasList";
import { NotasResumo } from "./NotasResumo";
import { EmitirNfseWizard } from "./EmitirNfseWizard";
import { NotaDetailModal } from "./NotaDetailModal";
import { createApiClient } from "../../../api/client";
import { Tabs } from "../../../components/ui/Tabs";
import { Button } from "../../../components/ui/Button";
// A MESMA regra de clique das abas — ver `cliqueDeLink.js`. A engrenagem é um link de verdade.
import { oNavegadorAssumeOClique } from "../../../components/ui/cliqueDeLink";
import { modeloDeEmissaoDaNota } from "../lib/reaproveitarNota";

// Cliente próprio, mesmo padrão auto-contido do SITFIS e do Apuração v2 — a aba já recebe tudo
// por props e não tem `api` em escopo.
const nfseApi = createApiClient();

export function NotasFiscaisTab({
  notasPanel,
  competencia: competenciaGlobal,
  regime,
  codigoMunicipioIbge = null,
  // O cadastro que `buildMissingFields` confere, vindo inteiro de `legacyCompany`.
  cadastroEmissao = null,
  // ── A ENGRENAGEM DE CONFIGURAÇÃO (dono, 19/08/2026) ────────────────────────────────────────
  //
  // > *"a aba nova que criei no fiscal de emissão de NFS-e deve ser uma engrenagem de configuração
  // > na aba Notas Fiscais."*
  //
  // ⚠ MUDOU A ENTRADA, NÃO O DESTINO. A tela de configuração continua sendo a MESMA, na MESMA URL
  // (`/companies/:id/emissao-nfse`): o que saiu foi a aba irmã no grupo Fiscal. Transformá-la em
  // modal perderia justamente o que o dono pediu na mensagem anterior — Ctrl+clique abrindo em
  // nova guia —, além do link copiável e do voltar do navegador.
  //
  // ⚠ Por isso ela é um `<a href>` e não um `<button>`: mesma razão das abas, mesmas cinco coisas
  // de graça (clique do meio, botão direito, Cmd no Mac, URL no hover, copiar endereço).
  // Prop ausente = "esta tela não recebeu a URL" e a engrenagem não aparece — nada de link morto.
  hrefConfiguracaoEmissao = null,
  onAbrirConfiguracaoEmissao = null,
}) {
  const {
    loading, error, reload,
    dfeState, dfeSyncing, syncDfe, clearDfeError,
    adnState, adnSyncing, syncAdn, clearAdnError,
    companyId,
    notas, notasTotal, notasFilters, setNotasFilters, notasSummary, notasRecebidas,
    loadingNotas, loadNotas,
    importing, importNotas, marcarNotaStatus,
    notaAbertaId, notaAberta, notaLoading, notaError, abrirNota, fecharNota,
  } = notasPanel;

  // NFS-e é a janela padrão (é onde está o faturamento). A de NF-e existe SEMPRE — ver o cabeçalho
  // deste arquivo: condicioná-la à inscrição estadual escondia as notas de compra justamente de
  // quem as tem.
  const [janela, setJanela] = useState("NFSE");
  // ⚠ `null` = assistente fechado. `{ modelo: null }` = nota do zero. `{ modelo: {...} }` = nota
  // NOVA a partir de uma já emitida. Um booleano não conseguiria carregar o modelo, e uma segunda
  // variável ao lado dele poderia ficar preenchida com o assistente fechado — e a próxima emissão
  // do zero abriria com os dados da nota anterior.
  const [emissao, setEmissao] = useState(null);
  const janelaAtiva = janela;
  const notasDaJanela = notas.filter((n) => n.type === janelaAtiva);

  // Trocar de janela é trocar o `type` — e, ao ENTRAR na de NF-e, também o papel.
  //
  // ⚠ O papel nasce em `EMIT` (é o faturamento, o que o contador quer ver ao abrir a aba) e a
  // troca de janela mexia só no `type`. Com as 47 NF-e da base em `DEST`, isso entregava uma
  // janela de NF-e permanentemente vazia. Ver o cabeçalho deste arquivo, defeito 2.
  //
  // ⚠ Os dois campos vão no MESMO `setNotasFilters` de propósito: em duas chamadas, o effect de
  // `type` logo abaixo dispararia uma carga intermediária (NF-e + EMIT) — exatamente a consulta
  // vazia que este conserto existe para não fazer.
  //
  // `papelForcado` é o caminho das caixas de "Notas recebidas": clicar em "Compra (NF-e): 34" tem
  // de abrir a janela JÁ em Recebidas, senão o número clicado e a lista aberta discordariam — que
  // é o defeito que aquele bloco existe para não ter.
  function irParaJanela(nova, papelForcado = null) {
    setJanela(nova);
    setNotasFilters({
      ...notasFilters,
      type: nova,
      // Sem `papelForcado`, o padrão só vale ao ENTRAR na NF-e. Voltando para NFS-e o papel fica
      // como estava — quem escolheu "Recebidas" na janela de serviço não perde a escolha ao
      // passear pela de compra.
      papel: papelForcado || (nova === "NFE" ? "DEST" : notasFilters.papel),
      offset: 0,
    });
  }

  const trocarJanela = (nova) => irParaJanela(nova);

  // O filtro `type` acompanha a janela ativa: assim o RESUMO (que é agregado no servidor)
  // fala da mesma janela que a tabela — e a paginação passa a ser por janela, não dividida
  // entre NF-e e NFS-e. Só dispara quando muda de fato (evita loop com o effect do hook).
  useEffect(() => {
    if (notasFilters.type !== janelaAtiva) {
      setNotasFilters({ ...notasFilters, type: janelaAtiva, offset: 0 });
    }
  }, [janelaAtiva, notasFilters, setNotasFilters]);

  // A competência da EMPRESA (seletor do header) manda no filtro. Mesmo padrão do effect acima:
  // só escreve quando muda de fato, senão vira laço com o effect de carga do hook.
  useEffect(() => {
    if (competenciaGlobal && notasFilters.competencia !== competenciaGlobal) {
      setNotasFilters({ ...notasFilters, competencia: competenciaGlobal, offset: 0 });
    }
  }, [competenciaGlobal, notasFilters, setNotasFilters]);

  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // permite reimportar o mesmo arquivo
    if (files.length && importNotas) importNotas(files);
  }

  return (
    /* Largura de trabalho (~90%), decidida aqui porque esta aba ainda não passa pelo
       `CompanyTabLayout`. A tabela de notas tem número, chave, tomador, valor, data, status e
       ações — era a que mais truncava em 1400px. */
    <div style={{ padding: "24px 0", color: PANEL.text, width: "var(--content-wide)", margin: "0 auto" }}>
      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: "var(--radius-sm)", color: "var(--state-danger)" }}>
          {error}
          {/* ⚠ Este NÃO é um botão destrutivo — ele só recarrega. O `#FF4757` era a cor da CAIXA DE
              ERRO em volta, emprestada pelo botão: exatamente o defeito que esta padronização
              corrige, só que com vermelho em vez de âmbar. `danger` aqui mentiria sobre a ação (e,
              sobre um fundo que já é `--state-danger` a 10%, o `.btn-danger` de superfície ficaria
              quase invisível). O vermelho continua na caixa, onde ele é informação. */}
          <Button variant="secondary" size="sm" onClick={reload} style={{ marginLeft: 12 }}>
            Tentar de novo
          </Button>
        </div>
      )}

      {/* ⚠ AS DUAS JANELAS APARECEM SEMPRE. O `hasInscricaoEstadual` que envolvia este bloco era o
          defeito 1 do cabeçalho: ele escondia a NF-e de 3 de 3 empresas que TÊM nota de compra.
          ⚠ O rótulo diz "compra" porque é o que a base tem — 47 de 47 NF-e são `DEST`, e a janela
          filtra `papel` livremente para o dia em que alguma empresa emitir NF-e. */}
      <Tabs
        mode="view"
        ariaLabel="Janela de notas"
        align="start"
        style={{ marginBottom: 16 }}
        items={[
          { key: "NFSE", label: "Notas de serviço (NFS-e)" },
          { key: "NFE", label: "Notas de compra (NF-e)" },
        ]}
        active={janelaAtiva}
        onChange={trocarJanela}
      />

      {/* ⚠ EMITIR é o PRIMÁRIO da janela de NFS-e; buscar e importar viram secundários.
          A aba nasceu só para CAPTURAR nota que já existe, e emitir — que é o que a empresa faz
          para faturar — não tinha porta nenhuma na tela, embora o backend (`POST /nfse/issue`)
          esteja de pé há tempos. Só na janela de NFS-e: NF-e de venda não se emite por aqui. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {janelaAtiva === "NFSE" ? (
          <>
            {/* ⚠ Era ciano (`--accent-cyan`). Ciano é a cor de CATEGORIA do Simples Nacional
                (`tokens.css`) — usá-la como CTA colocava a mesma cor em "esta empresa é do Simples"
                e em "clique aqui". Ação primária é o accent do botão. */}
            <Button
              type="button"
              onClick={() => setEmissao({ modelo: null })}
            >
              + Emitir nota
            </Button>
            <AdnCapturePanel adnState={adnState} adnSyncing={adnSyncing} onSync={syncAdn} onClearError={clearAdnError} />
            {/* ⚠ ERA O QUARTO ESTILO DE BOTÃO DESTA MESMA BARRA. A linha tinha, lado a lado: o
                `Button` primário (Emitir), o botão do `AdnCapturePanel`, um `<select>` nativo,
                texto solto e ESTE `<label>` — com `#2E86DE` cravado, um azul que não é token
                nenhum e que competia com o azul da ação primária ao lado. Continua sendo um
                `<label>` (é ele que abre o seletor de arquivo sem `ref`), mas veste as classes do
                botão único: `.btn .btn-secondary .btn-md`. Nenhum estilo novo entra. */}
            <label
              className="btn btn-secondary btn-md"
              style={{ cursor: importing ? "default" : "pointer", opacity: importing ? 0.7 : 1 }}
            >
              {importing ? "Importando…" : "⬆️ Importar XML"}
              <input type="file" accept=".xml,text/xml,application/xml" multiple disabled={importing} onChange={onPickFiles} style={{ display: "none" }} />
            </label>
            {hrefConfiguracaoEmissao && (
              /* ⚠ ÍCONE SOZINHO NÃO SE EXPLICA, e o rótulo acessível é o canal certo (o dono está
                 cortando texto de tela): `aria-label` diz o que é para quem usa leitor de tela e o
                 `title` diz para quem passa o mouse. Sem os dois, isto é um desenho clicável.
                 ⚠ CINZA, de propósito: verde é CONCLUÍDO neste app e âmbar é PENDÊNCIA.
                 Configuração não é nem uma coisa nem outra — ela não pede ação hoje. */
              <a
                href={hrefConfiguracaoEmissao}
                aria-label="Configurar a emissão de NFS-e desta empresa"
                title="Configurar a emissão de NFS-e (códigos de serviço, série da DPS, carga tributária e liberação ao cliente)"
                data-testid="engrenagem-emissao-nfse"
                onClick={(event) => {
                  // Ctrl/Cmd/Shift/Alt e botão do meio: o navegador assume e abre em outra guia.
                  if (oNavegadorAssumeOClique(event)) return;
                  event.preventDefault();
                  onAbrirConfiguracaoEmissao?.();
                }}
                style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 11px", borderRadius: 6, border: "1px solid var(--border)",
                  background: "transparent", color: "var(--text-faint)", textDecoration: "none",
                  fontSize: "0.85rem", fontWeight: 600, lineHeight: 1,
                }}
              >
                {/* ⚠ SÓ A ENGRENAGEM em tela — foi o que o dono pediu, e ele está cortando texto.
                    O ícone é `aria-hidden`: quem lê tela recebe o `aria-label` do link, não o
                    nome do caractere. Sem isso, o leitor anunciaria "engrenagem, link". */}
                <span aria-hidden="true" style={{ fontSize: "1.05rem" }}>⚙</span>
              </a>
            )}
          </>
        ) : (
          <DfeCapturePanel dfeState={dfeState} dfeSyncing={dfeSyncing} onSync={syncDfe} onClearError={clearDfeError} />
        )}
      </div>

      {/* ⚠ FAIXA ÚNICA desde 23/08/2026 — ela absorveu o bloco "Notas recebidas" que ficava acima
          do toggle. Ver o cabeçalho de `NotasResumo` para o porquê de `resumoRecebidas` e `summary`
          serem DUAS chamadas diferentes que não podem ser trocadas uma pela outra. */}
      <NotasResumo
        summary={notasSummary}
        resumoRecebidas={notasRecebidas}
        onVerRecebidas={(tipo) => irParaJanela(tipo, "DEST")}
        janela={janelaAtiva}
        competencia={notasFilters.competencia}
        loading={loadingNotas}
        papel={notasFilters.papel}
        // Clicar na caixa filtra a tabela por papel. Clicar na já ativa NÃO desliga: a tabela
        // sempre mostra um dos dois lados (emitidas por padrão) — sem estado "misturado".
        onSelectPapel={(p) => {
          if (notasFilters.papel === p) return;
          setNotasFilters({ ...notasFilters, papel: p, offset: 0 });
        }}
        verCanceladas={notasFilters.incluirCanceladas === "1"}
        // Alterna entre esconder (default, só faturamento) e mostrar as canceladas na tabela.
        onToggleCanceladas={() => setNotasFilters({
          ...notasFilters,
          incluirCanceladas: notasFilters.incluirCanceladas === "1" ? "" : "1",
          offset: 0,
        })}
      />

      <NotasList
        notas={notasDaJanela}
        /* ⚠ O TOTAL É O DO SERVIDOR, não `notasDaJanela.length`.
           `notasDaJanela` é uma PÁGINA (100 por vez) já filtrada de novo no cliente — usá-la como
           total fazia a tela escrever "100 nota(s)" num mês de 2.717 e não havia nada distinguindo
           isso de um mês que teve 100 notas mesmo. `notasTotal` já vinha certo da rota (`total`) e
           não era lido por ninguém. */
        total={notasTotal}
        filters={notasFilters}
        onFiltersChange={setNotasFilters}
        onApply={(f) => loadNotas(f)}
        loading={loadingNotas}
        /* ⚠⚠ NOTA RECEBIDA NÃO SE CANCELA — e esta janela é a que mais recebe.
           > Dono: *"as notas recebidas não devem ter opção de emitir elas, nem cancelar. Nota
           > recebida foi emitida PARA NÓS — não temos controle sobre esse tipo de nota."*
           Sem `onMarcarStatus` o `NotasList` não renderiza a coluna de ação (ele já condiciona a
           `<th>` e a `<td>` à prop) — nada fica desabilitado sem explicação nem meio oferecido.
           ⚠ Isto NÃO é o cancelamento fiscal: o botão chama `PATCH .../notas/:id/status`, que só
           escreve na NOSSA linha. Mas era a porta que a regra do dono fecha, e ela estava aberta
           em "Recebidas" desde antes — a janela de NF-e (agora visível) só a tornaria óbvia, com
           47 notas de compra. Emitidas seguem com o botão, que é onde ele faz sentido. */
        onMarcarStatus={notasFilters.papel === "DEST" ? undefined : marcarNotaStatus}
        onAbrirNota={abrirNota}
      />

      {loading && notas.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted }}>Carregando…</div>
      )}

      {/* A ÍNTEGRA DA NOTA. Abre pelo id — o esqueleto do modal aparece na hora e o conteúdo chega
          depois; abrir só quando a resposta volta faria o clique parecer sem efeito. */}
      {notaAbertaId && (
        <NotaDetailModal
          nota={notaAberta}
          loading={notaLoading}
          error={notaError}
          onClose={fecharNota}
          /* Do detalhe se chega na nota do OUTRO lado da substituição — é a pergunta seguinte do
             contador ("então qual é a nota que vale?"). `abrirNota` troca o conteúdo do modal
             aberto: o esqueleto aparece na hora e o conteúdo chega depois, igual ao clique na
             linha da tabela. */
          onAbrirNota={abrirNota}
          /* ⚠ REAPROVEITAR PASSA PELO ASSISTENTE, NUNCA EM VOLTA DELE. O detalhe não emite: ele
             fecha e abre o `EmitirNfseWizard` com os campos preenchidos, e lá continuam valendo o
             bloqueio de cadastro incompleto, o pré-voo do regime, a conferência e a confirmação.
             Um atalho que emitisse daqui desfaria tudo isso. */
          onReaproveitar={(notaModelo) => {
            const modelo = modeloDeEmissaoDaNota(notaModelo);
            if (!modelo) return;
            fecharNota();
            setEmissao({ modelo });
          }}
          /* O DANFSe: PDF gerado sob demanda pelo backend. ⚠ Vem por `fetch` com Bearer (Blob) —
             um `<a href>` não leva o token. A recusa nomeada (503 `danfse_sem_qrcode`) sobe com
             `code`/`motivo` e é o modal que a explica. Ausente na API = o botão diz que esta tela
             não baixa, em vez de falhar no clique. */
          onBaixarDanfse={
            nfseApi.fetchDanfseBlob
              ? (notaId) => nfseApi.fetchDanfseBlob(companyId, notaId)
              : undefined
          }
        />
      )}

      {emissao && (
        <EmitirNfseWizard
          companyId={companyId}
          /* O REGIME É MOSTRADO, não escolhido: o backend declara o mesmo `opSimpNac` para toda
             empresa, e o assistente confronta isso com o cadastro para o contador ver antes de
             emitir. Vem de `legacyCompany.regimeTributario` (nunca do topo do payload). */
          regime={regime}
          /* O município emissor (`cLocEmi`) vive em `legacyCompany.codigoMunicipioIbge`. Vazio, a
             empresa não emite — e o assistente diz isso no primeiro passo, não na recusa. */
          codigoMunicipioIbge={codigoMunicipioIbge}
          /* ⚠ A recusa `company_missing_fields` do servidor não tinha leitor nenhum na interface:
             a rota devolvia a lista `missing` e ela morria ali. Agora o assistente a espelha ANTES
             do clique, com o nome do campo e onde preenchê-lo. */
          cadastroEmissao={cadastroEmissao}
          /* ⚠ SUGESTÃO DE TOMADOR, E NADA MAIS. São as notas que ESTA ABA já carregou — nenhuma
             chamada nova, nenhum modelo de "cliente" (não existe um neste projeto). É uma PÁGINA
             filtrada por competência e por papel, e o assistente diz isso no rótulo: quem não
             aparece na sugestão pode existir mesmo assim. Só a janela de NFS-e alimenta a lista —
             tomador de NF-e é outra coisa.
             ⚠ E SÓ COM `papel: "EMIT"`. Em "Recebidas" (`DEST`) o tomador de toda linha é a PRÓPRIA
             empresa — sugerir dali ofereceria a empresa como tomadora dela mesma. */
          notasDaEmpresa={notasFilters.papel === "EMIT" ? notasDaJanela : null}
          /* ⚠ O estado INICIAL do formulário quando a emissão nasceu de uma nota já emitida — e
             SÓ isso. Nenhum identificador viaja aqui (ver `lib/reaproveitarNota.js`): o número da
             nota nova é reservado pelo backend. `null` = emissão do zero, o caminho de sempre. */
          valoresIniciais={emissao.modelo}
          onEmitir={(payload) => nfseApi.emitirNfse(payload)}
          onClose={() => setEmissao(null)}
          /* ⚠ ISTO NÃO FAZ A NOTA APARECER NA LISTA, e não é para fazer.
             A lista vem de `PortalInvoice` (captura do ADN); a nota emitida aqui é gravada em
             `ServiceInvoice`. Recarregar só atualiza o estado da captura e o resumo — quem traz a
             nota é o ADN, na próxima busca. O assistente diz isso em texto na tela de resultado;
             antes ele prometia que ela apareceria "assim que houver resposta", e não aparecia. */
          onEmitida={() => { reload?.(); loadNotas?.(notasFilters); }}
        />
      )}
    </div>
  );
}
