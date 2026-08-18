// A BARRA QUE APARECE QUANDO HÁ EMPRESAS SELECIONADAS NA TABELA.
//
// POR QUE ELA EXISTE (pedido do dono)
//   *"podemos aderir as funções de, por exemplo, enviar email em lote, à tabela, selecionando as
//   empresas e enviando todas as guias que nessas empresas estão contidas"*
//
// As cinco operações em lote já existiam — na barra do topo, rodando sobre "todas as empresas" ou
// sobre uma lista que o contador não via. Aqui elas rodam sobre uma seleção QUE ESTÁ NA TELA, e o
// número que a barra mostra é o número de linhas marcadas.
//
// ⚠ ISTO CONTINUA SENDO UM SEGUNDO CAMINHO, não a mudança de lugar — mas a barra do topo mudou em
// 18/08/2026, por decisão do dono: `Apuração` e `Consultas` foram para a GAVETA lateral (☰) e o
// botão `Envio de e-mails em lote` (o que abria `/guides/batch-email`) SAIU. Enviar guia em lote
// continua aqui, sobre uma seleção que está na tela, e guia a guia dentro da empresa
// ("Liberar ao cliente"). O que saiu foi o BOTÃO daquela página, não a função.
//
// AS TRÊS REGRAS QUE ESTE ARQUIVO EXISTE PARA CUMPRIR
//   1. ATO IRREVERSÍVEL CONFIRMA REPETINDO OS DADOS — a confirmação repete quantas empresas,
//      quantas guias e qual competência. "Tem certeza?" não confirma nada.
//   2. PRÉVIA ANTES, CONFIRMAÇÃO DEPOIS — a prévia mostra linha a linha quem entra e quem fica de
//      fora, COM o motivo de cada exclusão.
//   3. NÚMERO NA TELA SAI DE DADO REAL — a contagem de guias do envio vem de
//      `GET /firm/guides/batch-report`, a MESMA leitura que o envio consome. Sem ela, a tela diz
//      que não sabe e o Confirmar fica bloqueado; não existe "0 guias" fabricado.

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { BatchProgressModal } from "../../../apuracao/components/BatchProgressModal";
import {
  ORDEM_ACOES, acaoDoPlano, planoDaSelecao, resumoEnvioDoRelatorio,
  fraseDeConfirmacao, formatarCompetencia,
} from "../lib/acoesDaSelecao";

const CAIXA = {
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  padding: "10px 14px", marginBottom: 12, borderRadius: 10,
  background: "var(--bg-surface)", border: "1px solid var(--accent-purple)",
};

const LISTA = { margin: "6px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 3, fontSize: "0.78rem" };

function Faixa({ tom, children }) {
  const cor = tom === "perigo" ? "var(--state-danger)" : "var(--state-warn)";
  const fundo = tom === "perigo" ? "var(--state-danger-surface)" : "var(--state-warn-surface)";
  return (
    <div
      role="note"
      style={{
        padding: "8px 12px", borderRadius: 8, background: fundo, border: `1px solid ${cor}`,
        color: cor, fontSize: "0.8rem", fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A PRÉVIA + CONFIRMAÇÃO de uma ação.
 *
 * ⚠ O mesmo componente serve às cinco. Um modal por ação faria a prévia do download divergir da do
 * envio na primeira correção — e é justamente a prévia que não pode divergir.
 */
function ModalAcao({ acao, competencia, previaEnvio, onCancelar, onConfirmar, executando }) {
  const irreversivel = Boolean(acao.irreversivel);
  const alvos = acao.alvos || [];
  const fora = acao.fora || [];

  // Para o envio, quem manda na lista e no número é o relatório — não o `guideCompliance` da
  // listagem. Ver o comentário de `resumoEnvioDoRelatorio`.
  const usaRelatorio = acao.chave === "email";
  const carregandoPrevia = usaRelatorio && previaEnvio?.estado === "carregando";
  const previaFalhou = usaRelatorio && previaEnvio?.estado === "erro";
  const resumo = usaRelatorio ? previaEnvio?.resumo || null : null;

  const empresasNaAcao = usaRelatorio ? (resumo?.totalEmpresas ?? 0) : alvos.length;
  const guiasNaAcao = usaRelatorio ? (resumo?.totalGuias ?? null) : null;

  // ⚠ O Confirmar de um ato irreversível NÃO fica disponível enquanto a prévia não puder ser lida.
  // Sem a prévia não há número a repetir — e confirmação sem número é o "tem certeza?" que a regra 1
  // proíbe.
  const podeConfirmar = !executando
    && (usaRelatorio ? Boolean(resumo?.conhecido) && empresasNaAcao > 0 : alvos.length > 0);

  const linhasVisiveis = usaRelatorio
    ? (resumo?.linhas || []).map((l) => ({
      companyId: l.companyId,
      razao: l.razao,
      detalhe: `${l.guias} guia(s)${l.tributos?.length ? ` · ${l.tributos.join(", ")}` : ""}`,
    }))
    : alvos;

  /**
   * ⚠ QUEM FICA DE FORA DO ENVIO É O RELATÓRIO QUEM DIZ — não a regra local.
   *
   * As duas leituras existem e podem discordar: a local sai do `guideCompliance` da listagem (que
   * pode estar velho na tela) e a do relatório sai de `pendingGuideIds`, que é literalmente o que
   * `batch-send` vai mandar. Somar as duas listas produzia a MESMA empresa em "Entram" e em "Ficam
   * de fora" ao mesmo tempo — visto na tela: a listagem dizia "todas já enviadas" e o relatório
   * dizia "2 pendentes".
   *
   * Então: o relatório decide QUEM sai; a regra local só empresta o MOTIVO, que é mais específico
   * ("empresa zerada", "falta apurar") do que o genérico "nenhuma guia pendente".
   */
  const forasVisiveis = usaRelatorio
    ? (resumo?.fora || []).map((f) => {
      const local = fora.find((x) => x.companyId === f.companyId);
      const alvoLocal = alvos.find((x) => x.companyId === f.companyId);
      return {
        companyId: f.companyId,
        razao: f.razao || local?.razao || alvoLocal?.razao || "—",
        motivo: local?.motivo || f.motivo,
      };
    })
    : fora;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={acao.rotulo}
      style={{
        position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onCancelar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12,
          padding: 20, width: "min(94vw, 640px)", maxHeight: "88vh", overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 12, color: "var(--text)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.02rem" }}>{acao.rotulo}</h2>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>{acao.descricao}</p>

        {irreversivel && (
          <Faixa tom="perigo">
            ⚠ {acao.aviso}
          </Faixa>
        )}
        {!irreversivel && acao.aviso && <Faixa tom="aviso">{acao.aviso}</Faixa>}

        {/* ⚠ A FRASE COM OS NÚMEROS. É ela que a regra 1 exige — quem confirma lê de novo quantas
            empresas, quantas guias e qual competência. */}
        {carregandoPrevia ? (
          <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            Carregando a prévia do envio…
          </div>
        ) : previaFalhou ? (
          <>
            <Faixa tom="perigo">
              Não foi possível carregar a prévia do envio: {previaEnvio.motivo}
            </Faixa>
            {/* ⚠ Sem prévia NÃO se mostra número nenhum, nem o da listagem. Dois números diferentes
                para a mesma pergunta, numa tela de confirmação de envio, é pior que número nenhum. */}
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
              O envio fica bloqueado até a prévia carregar — sem ela não dá para dizer quantas guias
              sairiam.
            </p>
          </>
        ) : empresasNaAcao === 0 ? (
          /* ⚠ "Enviar 0 guias de 0 empresas?" é uma PERGUNTA SOBRE NADA — e ainda por cima uma que
             parece um defeito de contagem. Quando a prévia resolve para zero alvos, o certo é
             afirmar o desfecho (não há o que fazer) e apontar os motivos, que já estão listados
             logo abaixo, empresa por empresa. */
          <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
            Nada a fazer com esta seleção — nenhuma das {acao.alvos.length + acao.fora.length} empresas se aplica.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
            {fraseDeConfirmacao(acao.chave, {
              empresas: empresasNaAcao,
              guias: guiasNaAcao,
              competencia,
            })}
          </p>
        )}

        {/* O QUE VAI ACONTECER — linha a linha. */}
        {linhasVisiveis.length > 0 && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
              Entram ({linhasVisiveis.length})
            </div>
            <ul style={LISTA}>
              {linhasVisiveis.map((l) => (
                <li key={l.companyId} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                  <span>{l.razao}</span>
                  {l.detalhe && <span style={{ color: "var(--text-muted)" }}>{l.detalhe}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ⚠ QUEM FICA DE FORA APARECE COM O MOTIVO. Sumir em silêncio faria o contador achar que
            mandou para todo mundo — e é exatamente esse o defeito que a seleção existe para matar. */}
        {forasVisiveis.length > 0 && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
              Ficam de fora ({forasVisiveis.length})
            </div>
            <ul style={LISTA}>
              {forasVisiveis.map((f) => (
                <li key={f.companyId} style={{ display: "flex", gap: 8, justifyContent: "space-between", color: "var(--text-muted)" }}>
                  <span>{f.razao}</span>
                  <span>{f.motivo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <Button type="button" variant="secondary" onClick={onCancelar} disabled={executando}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={irreversivel ? "danger" : "primary"}
            onClick={onConfirmar}
            disabled={!podeConfirmar}
            title={podeConfirmar ? undefined : "Não há o que executar com esta seleção"}
          >
            {executando ? "Executando…" : irreversivel ? "Confirmar e executar" : "Executar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BarraSelecaoEmpresas({
  api,
  empresasSelecionadas = [],
  competencia,
  jobsAtivos = 0,
  onLimparSelecao,
  onConcluido,
  /** ⚠ Mensagem de "a seleção encolheu porque o filtro mudou" — ver a decisão na página. */
  avisoDeRecorte = null,
}) {
  const [aberta, setAberta] = useState(null);   // chave da ação com o modal aberto
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [batchJobId, setBatchJobId] = useState(null);
  const [previaEnvio, setPreviaEnvio] = useState(null); // { estado, resumo, motivo }

  const ids = empresasSelecionadas.map((c) => c.companyId);
  const plano = planoDaSelecao({ empresas: empresasSelecionadas, competencia, jobsAtivos });
  const acao = aberta ? acaoDoPlano(plano, aberta) : null;

  // A prévia do envio é uma LEITURA (GET) e não custa nada — mas só é buscada quando o modal do
  // envio abre. Buscá-la junto da listagem faria a carteira inteira pagar por uma tela que quase
  // nunca abre.
  const carregarPrevia = useCallback(async () => {
    if (!api?.getBatchEmailReport) {
      setPreviaEnvio({ estado: "erro", motivo: "esta versão do app não sabe pedir o relatório de envio." });
      return;
    }
    setPreviaEnvio({ estado: "carregando" });
    try {
      const report = await api.getBatchEmailReport(competencia);
      setPreviaEnvio({ estado: "ok", resumo: resumoEnvioDoRelatorio(report, ids, competencia) });
    } catch (err) {
      setPreviaEnvio({ estado: "erro", motivo: err?.message || "o servidor não respondeu." });
    }
    // `ids` muda de identidade a cada render; a dependência real é a seleção, que só muda junto
    // com `empresasSelecionadas`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, competencia, empresasSelecionadas]);

  useEffect(() => {
    if (aberta !== "email") { setPreviaEnvio(null); return; }
    carregarPrevia();
  }, [aberta, carregarPrevia]);

  if (!empresasSelecionadas.length) return null;

  async function executar() {
    if (!acao || executando) return;
    setExecutando(true);
    setResultado(null);
    const alvoIds = acao.chave === "email"
      ? (previaEnvio?.resumo?.linhas || []).map((l) => l.companyId)
      : acao.alvos.map((a) => a.companyId);
    try {
      if (acao.chave === "email") {
        // Contrato existente: um item por (empresa, competência).
        const out = await api.sendBatchEmails(alvoIds.map((portalClientId) => ({ portalClientId, competencia })));
        const enviados = Number(out?.sent || 0);
        setResultado({
          tom: enviados > 0 ? "ok" : "erro",
          texto: `${enviados} de ${alvoIds.length} e-mail(s) enviado(s).`,
        });
      } else if (acao.chave === "apurar") {
        const out = await api.criarApuracaoBatch({ portalClientIds: alvoIds, competencia });
        if (!out?.ok) throw new Error(out?.message || out?.error || "o servidor recusou o lote.");
        // ⚠ `ignoradas` é a resposta do servidor a quem não estava com a apuração fechada. A prévia
        // avisou que ele revalida; aqui o número dele aparece, não uma estimativa nossa.
        setResultado({
          tom: "ok",
          texto: `Lote criado: ${out.totalEmpresas} empresa(s)`
            + (out.ignoradas ? ` · ${out.ignoradas} ignorada(s) pelo servidor (apuração não fechada).` : "."),
        });
        if (out.jobId) setBatchJobId(out.jobId);
      } else if (acao.chave === "capturarNotas") {
        const out = await api.createNotasCaptura({ companyIds: alvoIds, alvos: ["NFSE", "NFE"] });
        // ⚠ Esta rota devolve `{ ok, job }` — não `{ ok, jobId }` como as outras duas. Ler `jobId`
        // no topo daria `undefined` em silêncio.
        const jobId = out?.job?.jobId || null;
        if (!out?.ok || !jobId) throw new Error(out?.message || "o servidor não criou o job.");
        setResultado({ tom: "ok", texto: `Captura em andamento para ${alvoIds.length} empresa(s). Acompanhe em Consultas → Consultar notas.` });
      } else if (acao.chave === "baixarNotas") {
        const out = await api.createNotasDownload({
          companyIds: alvoIds,
          competenciaDe: competencia,
          competenciaAte: competencia,
        });
        if (!out?.ok || !out.jobId) throw new Error(out?.message || "o servidor não criou o job.");
        setResultado({ tom: "ok", texto: `ZIP em preparo para ${alvoIds.length} empresa(s). Baixe em Consultas → Baixar XMLs.` });
      } else if (acao.chave === "baixarSitfis") {
        const out = await api.createSitfisDownload(alvoIds);
        if (!out?.ok || !out.jobId) throw new Error(out?.message || "o servidor não criou o job.");
        setResultado({ tom: "ok", texto: `ZIP em preparo para ${alvoIds.length} empresa(s). Baixe em Consultas → Situação Fiscal.` });
      }
      setAberta(null);
      await onConcluido?.();
    } catch (err) {
      setResultado({ tom: "erro", texto: err?.message || "A operação falhou." });
      setAberta(null);
    } finally {
      setExecutando(false);
    }
  }

  const desabilitadas = plano.acoes.filter((a) => !a.disponivel);

  return (
    <>
      <div role="region" aria-label="Ações sobre as empresas selecionadas" style={CAIXA}>
        <strong style={{ fontSize: "0.86rem" }}>
          {plano.total} empresa{plano.total === 1 ? "" : "s"} selecionada{plano.total === 1 ? "" : "s"}
        </strong>
        <span aria-hidden="true" style={{ color: "var(--text-faint)" }}>·</span>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          competência {formatarCompetencia(competencia)}
        </span>

        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
          {ORDEM_ACOES.map((chave) => {
            const a = acaoDoPlano(plano, chave);
            if (!a) return null;
            return (
              <Button
                key={chave}
                type="button"
                size="sm"
                /* ⚠ Irreversível é `danger`, nunca accent: enviar ao cliente e transmitir à Receita
                   não podem ter o mesmo peso visual de baixar um ZIP. */
                variant={a.irreversivel ? "danger" : "secondary"}
                disabled={!a.disponivel}
                onClick={() => { setResultado(null); setAberta(chave); }}
                title={a.disponivel ? a.descricao : `Indisponível: ${a.motivo}`}
              >
                {a.rotulo}
                {/* ⚠ O ENVIO NÃO GANHA CONTADOR NO BOTÃO, e isso é decisão.
                    As outras quatro contam sobre o dado que a própria listagem já traz (regime,
                    certificado, `fiscalCheckedAt`) — o número do botão e o da prévia saem da MESMA
                    leitura e não podem divergir. O envio não: quem sabe quantas guias saem é
                    `batch-report`, e ele só é consultado quando o modal abre. Um "(3)" vindo do
                    `guideCompliance` ao lado de uma prévia dizendo 2 seriam dois números para a
                    mesma pergunta — o defeito que este projeto passa o dia matando. */}
                {a.disponivel && a.chave !== "email" && a.alvos.length !== plano.total ? ` (${a.alvos.length})` : ""}
              </Button>
            );
          })}
          <Button type="button" size="sm" variant="secondary" onClick={onLimparSelecao}>
            Limpar seleção
          </Button>
        </span>

        {/* ⚠ DESABILITADO SEM EXPLICAÇÃO É PROIBIDO — e `title` não conta: ele não é descobrível,
            some ao mover o mouse e não existe no toque. O motivo vai em TEXTO, aqui. */}
        {desabilitadas.length > 0 && (
          <div style={{ flexBasis: "100%", fontSize: "0.76rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            {desabilitadas.map((a) => (
              <div key={a.chave}>
                <strong style={{ color: "var(--text)" }}>{a.rotulo}:</strong> {a.motivo}
              </div>
            ))}
          </div>
        )}

        {avisoDeRecorte && (
          <div style={{ flexBasis: "100%", fontSize: "0.76rem", color: "var(--state-warn)" }}>
            {avisoDeRecorte}
          </div>
        )}

        {resultado && (
          <div
            role="status"
            style={{
              flexBasis: "100%", fontSize: "0.8rem", fontWeight: 600,
              color: resultado.tom === "ok" ? "var(--state-ok)" : "var(--state-danger)",
            }}
          >
            {resultado.texto}
          </div>
        )}
      </div>

      {acao && (
        <ModalAcao
          acao={acao}
          competencia={competencia}
          previaEnvio={previaEnvio}
          executando={executando}
          onCancelar={() => { if (!executando) setAberta(null); }}
          onConfirmar={executar}
        />
      )}

      {/* ⚠ REUSO: o acompanhamento da fila de apuração é o MESMO modal da página Apuração — é ele
          que faz o `run-now` sob demanda quando o worker de fundo está desligado. Um segundo
          acompanhamento divergiria dele na primeira correção. */}
      {batchJobId && (
        <BatchProgressModal
          api={api}
          jobId={batchJobId}
          onClose={() => setBatchJobId(null)}
          onDone={() => { onConcluido?.(); }}
        />
      )}
    </>
  );
}
