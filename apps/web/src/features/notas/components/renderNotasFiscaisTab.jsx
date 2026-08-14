// Q12.C.1: aba "Notas Fiscais" da empresa — enxuta, em 2 janelas:
//   • Notas de serviço (NFS-e) — captura ADN + import XML
//   • Notas de venda (NF-e)    — captura SEFAZ; SÓ aparece se a empresa tem inscrição estadual.
// Competências/fechamento/apuração ficam na aba Apuração / página global.

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

// Cliente próprio, mesmo padrão auto-contido do SITFIS e do Apuração v2 — a aba já recebe tudo
// por props e não tem `api` em escopo.
const nfseApi = createApiClient();

export function NotasFiscaisTab({
  notasPanel,
  hasInscricaoEstadual = false,
  competencia: competenciaGlobal,
  regime,
  codigoMunicipioIbge = null,
  // O cadastro que `buildMissingFields` confere, vindo inteiro de `legacyCompany`.
  cadastroEmissao = null,
}) {
  const {
    loading, error, reload,
    dfeState, dfeSyncing, syncDfe, clearDfeError,
    adnState, adnSyncing, syncAdn, clearAdnError,
    companyId,
    notas, notasTotal, notasFilters, setNotasFilters, notasSummary,
    loadingNotas, loadNotas,
    importing, importNotas, marcarNotaStatus,
    notaAbertaId, notaAberta, notaLoading, notaError, abrirNota, fecharNota,
  } = notasPanel;

  // NFS-e é a janela padrão; NF-e só existe com inscrição estadual.
  const [janela, setJanela] = useState("NFSE");
  const [emitindo, setEmitindo] = useState(false);
  const janelaAtiva = (janela === "NFE" && !hasInscricaoEstadual) ? "NFSE" : janela;
  const notasDaJanela = notas.filter((n) => n.type === janelaAtiva);

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
    /* Largura de trabalho (~90%). A tabela de notas tem número, chave, tomador, valor, data,
       status e ações — era a que mais truncava em 1400px. */
    <div style={{ padding: "24px 0", color: PANEL.text, width: "var(--content-wide)", margin: "0 auto" }}>
      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 6, color: "#FF4757" }}>
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

      {/* Toggle das duas janelas — NF-e só aparece com inscrição estadual. */}
      {hasInscricaoEstadual && (
        <Tabs
          mode="view"
          ariaLabel="Janela de notas"
          align="start"
          style={{ marginBottom: 16 }}
          items={[
            { key: "NFSE", label: "Notas de serviço (NFS-e)" },
            { key: "NFE", label: "Notas de venda (NF-e)" },
          ]}
          active={janelaAtiva}
          onChange={setJanela}
        />
      )}

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
              onClick={() => setEmitindo(true)}
            >
              + Emitir nota
            </Button>
            <AdnCapturePanel adnState={adnState} adnSyncing={adnSyncing} onSync={syncAdn} onClearError={clearAdnError} />
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 6,
              border: "none", background: importing ? "#555" : "#2E86DE", color: "white",
              cursor: importing ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: importing ? 0.7 : 1,
            }}>
              {importing ? "Importando…" : "⬆️ Importar XML"}
              <input type="file" accept=".xml,text/xml,application/xml" multiple disabled={importing} onChange={onPickFiles} style={{ display: "none" }} />
            </label>
          </>
        ) : (
          <DfeCapturePanel dfeState={dfeState} dfeSyncing={dfeSyncing} onSync={syncDfe} onClearError={clearDfeError} />
        )}
      </div>

      <NotasResumo
        summary={notasSummary}
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
        onMarcarStatus={marcarNotaStatus}
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
        />
      )}

      {emitindo && (
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
          onEmitir={(payload) => nfseApi.emitirNfse(payload)}
          onClose={() => setEmitindo(false)}
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
