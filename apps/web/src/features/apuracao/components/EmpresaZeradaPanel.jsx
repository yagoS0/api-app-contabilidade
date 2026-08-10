// "EMPRESA ZERADA" — fechar a competência sem receita DO NOSSO LADO, sem parecer entregue.
//
// Pedido do dono: *"vamos colocar no modal um botão de 'empresa zerada', marcamos isso e podemos
// fechar"*. "Fechar" aqui tem uma leitura só, e é a de dentro do portal: a competência fica
// resolvida, sai da fila de pendências e o mês para de parecer esquecido.
//
// ⚠ O CASO COMUM É "JÁ ENTREGUEI À MÃO", NÃO "VOU FECHAR SEM ENTREGAR". Dono, 10/08/2026: *"os
// meses estão entregues sim, foram entregues à mão"* — as ~190 competências zeradas medidas em
// produção já foram declaradas no gov.br, e o que falta é o portal SABER disso. Ele não está
// impedindo entrega nenhuma: está exibindo pendência que não existe.
//
// ⚠ A FRONTEIRA, que é o motivo desta tela existir do jeito que existe: marcar como zerada NÃO
// entrega o PGDAS-D. Pelo portal a declaração zerada nem sai — a Receita recusa o formato que
// enviamos hoje (`traduzirRecusaDeclaracaoZerada`). Então são três coisas, e a tela nomeia as três
// separadamente:
//
//   · a AFIRMAÇÃO de que o mês não teve receita  → `CompanyMonthlyCircular.semFaturamento`
//   · a ENTREGA da declaração e por onde ela saiu → o painel de baixo (`entregaPgdas.js`)
//   · a PROVA de que ela existe na Receita        → o número que o extrato devolve
//
// Uma competência fechada como zerada e ainda devendo a declaração aparece em VERMELHO. Verde é
// só para o que a Receita confirma — nunca para o que nós resolvemos aqui dentro.
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { PANEL, fmtDate, fmtMoney } from "../../notas/components/notasStyles";
import { entregaPgdasDoFechamento, CORES_TOM } from "../lib/entregaPgdas";

const ZERADA = { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" };

/** O estado da ENTREGA, em destaque. É o bloco que impede "zerada" de ser lida como "entregue". */
function FaixaEntrega({ entrega }) {
  const { cor, fundo } = CORES_TOM[entrega.tom];
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 6, background: fundo, border: `1px solid ${cor}`,
      color: cor, fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: 3,
    }}>
      <strong>{entrega.provada ? "✓" : "⚠"} {entrega.rotulo}</strong>
      <span style={{ color: PANEL.muted }}>{entrega.detalhe}</span>
    </div>
  );
}

export function EmpresaZeradaPanel({ api, feedback, dados, portalClientId, competencia, razao, onChanged }) {
  const [confirmando, setConfirmando] = useState(null); // null | "zerada" | "entrega" | "desmarcar"
  // ⚠ TRI-ESTADO, E `null` É O PONTO. Nenhuma das duas respostas nasce escolhida: pré-marcar "já
  // entreguei" faria um clique distraído AFIRMAR um ato fiscal que ninguém disse ter feito, e
  // pré-marcar "não entreguei" enterraria o caso comum atrás de um clique extra 190 vezes. Sem
  // resposta, o botão de confirmar fica desabilitado NOMEANDO o motivo.
  const [entregueFora, setEntregueFora] = useState(null);
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  const marcada = dados?.semFaturamento === true;
  const disponivel = dados?.semMovimentoDisponivel === true;
  const entrega = entregaPgdasDoFechamento(dados);

  // ⚠ Desabilitado NOMEIA o motivo, e a saída junto. A recusa existe no backend
  // (`SEM_FATURAMENTO_COM_RECEITA`); descobri-la clicando é o defeito que esta linha evita.
  const motivoBloqueado = disponivel
    ? ""
    : `A empresa tem ${fmtMoney(dados?.faturamento?.total)} em notas emitidas nesta competência. `
      + "Preencha os valores das atividades e apure normalmente — mês com receita não é empresa zerada.";

  async function chamar(fn, sucesso) {
    setSalvando(true);
    try {
      const out = await fn();
      if (out && out.ok === false) throw new Error(out?.message || out?.error || "Falha");
      feedback?.notifySuccess?.(sucesso);
      setConfirmando(null);
      setObservacao("");
      setEntregueFora(null);
      await onChanged?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Não foi possível registrar.");
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarZerada() {
    setSalvando(true);
    try {
      const out = await api.setSemFaturamento?.(portalClientId, competencia, true);
      if (!out || out.ok === false) {
        // A recusa vem inteira do backend (com o valor, ou a contagem de notas faltantes). Não é
        // reescrita aqui — o que a tela acrescenta é a SAÍDA, que a mensagem do serviço não dá.
        const saida = out?.error === "SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE"
          ? " Concilie as notas do ADN (aba Notas Fiscais) e reconfira antes de marcar."
          : " Classifique/preencha as receitas e apure a competência normalmente.";
        throw new Error(`${out?.message || "Não foi possível marcar como empresa zerada."}${saida}`);
      }
      // A entrega feita fora só é registrada DEPOIS da afirmação de receita zero — e só se o
      // contador tiver dito que entregou. Nunca por padrão.
      if (entregueFora === true) {
        const ent = await api.registrarEntregaPgdasExterna?.(portalClientId, competencia, {
          entregue: true, confirmCompetencia: competencia, observacao,
        });
        if (ent && ent.ok === false) {
          feedback?.notifyError?.(
            `Competência marcada como empresa zerada, mas o registro da entrega feita fora NÃO foi gravado: ${ent?.message || ent?.error}`,
          );
          setConfirmando(null);
          await onChanged?.();
          return;
        }
      }
      feedback?.notifySuccess?.(entregueFora === true
        ? `${competencia} marcada como empresa zerada, com a entrega registrada como feita fora do portal (afirmação sua, não comprovação).`
        : `${competencia} marcada como empresa zerada. ⚠ A declaração zerada desta competência continua a entregar.`);
      setConfirmando(null);
      setObservacao("");
      setEntregueFora(null);
      await onChanged?.();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Não foi possível marcar como empresa zerada.");
    } finally {
      setSalvando(false);
    }
  }

  const caixa = {
    display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 8,
    background: ZERADA.fundo, border: `1px solid ${ZERADA.cor}`,
  };
  const inputS = {
    background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 4,
    color: PANEL.text, padding: "6px 8px", fontSize: "0.8rem", width: "100%",
  };

  return (
    <div style={caixa}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.9rem", color: PANEL.text }}>Empresa zerada nesta competência</strong>
        {marcada && (
          <span style={{ fontSize: "0.78rem", color: ZERADA.cor }}>
            marcada em {fmtDate(dados?.semFaturamentoEm)}
            {dados?.semFaturamentoConferencia === "sem_conferencia" ? " · sem conferência do ADN" : ""}
          </span>
        )}
      </div>

      {!marcada && (
        <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
          Afirma que o mês não teve receita e resolve a competência <strong>aqui dentro</strong>:
          ela sai da fila de pendências e o DAS deixa de ser cobrado no painel. Na confirmação você
          diz também <strong>se a declaração zerada já foi entregue fora do portal</strong> — é o
          registro do que já foi feito à mão.
          {" "}<strong style={{ color: "var(--state-danger)" }}>Nada aqui transmite o PGDAS-D.</strong>
        </div>
      )}

      {/* O estado da ENTREGA aparece marcada ou não — é o que não pode virar nota de rodapé. */}
      <FaixaEntrega entrega={entrega} />
      {entrega.chave === "declarada_fora" && dados?.entregaPgdas?.declaradaForaObservacao && (
        <div style={{ fontSize: "0.76rem", color: PANEL.muted }}>
          Anotação do contador: “{dados.entregaPgdas.declaradaForaObservacao}”
        </div>
      )}

      {/* ── Confirmação: ATO DE CONSEQUÊNCIA REPETE OS DADOS ─────────────────────────────── */}
      {confirmando === "zerada" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6 }}>
          <div style={{ fontSize: "0.82rem" }}>
            Você afirma que <strong>{razao || "esta empresa"}</strong>
            {dados?.cnpj ? <> (<span style={{ fontFamily: "monospace" }}>{dados.cnpj}</span>)</> : null}
            {" "}não teve receita na competência <strong>{competencia}</strong>.
          </div>
          {/* ⚠ NÃO SE PERGUNTA O QUE JÁ SE SABE. Quando o extrato já trouxe o número da declaração,
              a entrega está PROVADA e com procedência da própria Receita — pedir ao contador que
              a afirme de novo trocaria uma prova por uma palavra, e ainda daria trabalho em 15
              competências que já estão respondidas no nosso banco. */}
          {entrega.provada ? (
            <div style={{ fontSize: "0.8rem", color: "var(--state-ok)" }}>
              ✓ A entrega desta competência já está comprovada — {entrega.detalhe} Nada a declarar aqui.
            </div>
          ) : (
          <>
          <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
            E a declaração zerada desta competência — o que já aconteceu com ela?
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem", cursor: "pointer" }}>
            <input type="radio" name="entrega-zerada" checked={entregueFora === true} onChange={() => setEntregueFora(true)} />
            <span>
              <strong>Já entreguei fora do portal</strong> (no gov.br). Fica registrado como
              afirmação sua — vira comprovação só quando o extrato do Simples trouxer o número da
              declaração.
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem", cursor: "pointer" }}>
            <input type="radio" name="entrega-zerada" checked={entregueFora === false} onChange={() => setEntregueFora(false)} />
            <span>
              <strong>Ainda NÃO foi entregue.</strong> A competência fica resolvida aqui e continua
              aparecendo, em vermelho, como obrigação em aberto perante a Receita.
            </span>
          </label>
          {entregueFora === true && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.76rem", color: PANEL.muted }}>
              Recibo / observação (opcional — nada é preenchido por padrão)
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)}
                placeholder="ex.: entregue no PGDAS-D em 12/07, recibo nº …" style={inputS} />
            </label>
          )}
          </>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="sm" onClick={() => setConfirmando(null)} disabled={salvando}>Cancelar</Button>
            {/* ⚠ Desabilitado NOMEIA o motivo: nenhuma das duas respostas nasce escolhida, porque
                cada default seria uma afirmação nossa sobre um ato fiscal do contador. */}
            <Button size="sm" onClick={confirmarZerada} disabled={salvando || (!entrega.provada && entregueFora === null)}
              title={!entrega.provada && entregueFora === null ? "Diga primeiro o que já aconteceu com a declaração desta competência." : ""}>
              {salvando ? "Marcando…" : "Confirmar empresa zerada"}
            </Button>
          </div>
        </div>
      )}

      {confirmando === "entrega" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6 }}>
          <div style={{ fontSize: "0.82rem" }}>
            Registrar que a declaração de <strong>{razao || "esta empresa"}</strong> referente a{" "}
            <strong>{competencia}</strong> foi entregue <strong>fora deste portal</strong>.
          </div>
          <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>
            Isto não transmite nada e não comprova a entrega — registra a sua afirmação.
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.76rem", color: PANEL.muted }}>
            Recibo / observação (opcional)
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)}
              placeholder="ex.: entregue no PGDAS-D em 12/07, recibo nº …" style={inputS} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="sm" onClick={() => setConfirmando(null)} disabled={salvando}>Cancelar</Button>
            <Button size="sm" disabled={salvando} onClick={() => chamar(
              () => api.registrarEntregaPgdasExterna?.(portalClientId, competencia, {
                entregue: true, confirmCompetencia: competencia, observacao,
              }),
              `Entrega de ${competencia} registrada como feita fora do portal (afirmação do contador).`,
            )}>
              {salvando ? "Registrando…" : "Registrar entrega feita fora"}
            </Button>
          </div>
        </div>
      )}

      {confirmando === "desmarcar" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6 }}>
          <div style={{ fontSize: "0.82rem" }}>
            Desfazer a afirmação de que <strong>{razao || "esta empresa"}</strong> não teve receita
            em <strong>{competencia}</strong>? A competência volta à fila de pendências e o DAS
            volta a ser cobrado no painel.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="sm" onClick={() => setConfirmando(null)} disabled={salvando}>Cancelar</Button>
            <Button variant="danger" size="sm" disabled={salvando} onClick={() => chamar(
              () => api.setSemFaturamento?.(portalClientId, competencia, false),
              `${competencia} deixou de ser empresa zerada.`,
            )}>
              {salvando ? "Desmarcando…" : "Desmarcar"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Ações ────────────────────────────────────────────────────────────────────────── */}
      {!confirmando && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!marcada && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmando("zerada")}
              disabled={!disponivel || salvando} title={motivoBloqueado}>
              Marcar empresa zerada
            </Button>
          )}
          {marcada && !entrega.provada && entrega.chave !== "declarada_fora" && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmando("entrega")} disabled={salvando}
              title="Registra que você entregou a declaração fora do portal. Não transmite nada.">
              Registrei a entrega fora do portal
            </Button>
          )}
          {marcada && entrega.chave === "declarada_fora" && (
            <Button variant="secondary" size="sm" disabled={salvando} onClick={() => chamar(
              () => api.registrarEntregaPgdasExterna?.(portalClientId, competencia, { entregue: false }),
              `Registro de entrega fora do portal desfeito em ${competencia}.`,
            )}>
              Desfazer registro de entrega
            </Button>
          )}
          {marcada && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmando("desmarcar")} disabled={salvando}>
              Desmarcar empresa zerada
            </Button>
          )}
          {!disponivel && !marcada && (
            <span style={{ fontSize: "0.76rem", color: "var(--state-danger)", alignSelf: "center" }}>
              {motivoBloqueado}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
