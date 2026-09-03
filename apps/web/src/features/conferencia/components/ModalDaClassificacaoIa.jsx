// «SUGERIR CONTAS COM IA» — o diálogo do botão (02/09/2026).
//
// > Dono: *"a IA é um botão em cima de tudo, ao clicar ela passa por todos os lançamentos colocando
// > os códigos que ela decide (…) apenas naqueles que não entraram a regra."*
//
// ⚠⚠ O QUE O CLIQUE FAZ, DITO ANTES DO CLIQUE: manda ao modelo as linhas SEM regra e SEM histórico,
// e grava PROPOSTAS — nada é lançado. A confirmação repete o número de linhas e diz que a chamada
// tem custo, porque *"tem certeza?"* não é confirmação.
//
// ⚠ O RELATÓRIO SAI INTEIRO (molde de `ModalDaVarredura`): propostas, o que a IA respondeu e foi
// RECUSADO com o motivo, o que a GUARDA recusou (teto/chave) e o que o modelo não conseguiu. Um
// "3 propostas" sozinho deixaria "nada a sugerir", "o teto chegou" e "deu erro" indistinguíveis.
//
// ⚠ A regra de quem vai é do SERVIDOR. A contagem mostrada aqui é o espelho (`podeSugerirComIa`),
// para a pessoa saber o que vai acontecer — não para decidir no lugar dele.

import { useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { fraseDaGuarda, fraseDaRecusaIa, leituraDaClassificacaoIa } from "../lib/conferenciaTela";

const iaApi = createApiClient();

function centavosEmDolar(c) {
  const n = Number(c) || 0;
  return `US$ ${(n / 100).toFixed(2)}`;
}

export function ModalDaClassificacaoIa({ companyId, competencia, candidatas = 0, aoFechar, aoConcluir }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [relatorio, setRelatorio] = useState(null);

  async function sugerir() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await iaApi.postClassificarIa(companyId, { competencia });
      setRelatorio(leituraDaClassificacaoIa(r));
      aoConcluir?.();
    } catch (e) {
      // ⚠ O 503 nomeado (flag OFF no servidor) chega aqui — a tela não deveria ter oferecido o
      // botão, mas se ofereceu, o motivo sai por escrito em vez de "não foi possível".
      setErro(e?.message || "Não foi possível pedir as sugestões à IA.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Sugerir contas com IA"
      tamanho="md"
      ocupado={enviando}
      aoFechar={aoFechar}
      rodape={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={aoFechar} disabled={enviando}>
            {relatorio ? "Fechar" : "Cancelar"}
          </Button>
          {relatorio ? null : (
            <Button variant="primary" onClick={sugerir} disabled={enviando || !candidatas}
              title={candidatas ? undefined : "Não há linha sem regra nem histórico."}>
              {enviando ? "Perguntando ao modelo…" : "Sugerir"}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }} data-testid="modal-classificacao-ia">
        {erro ? <div style={{ color: "var(--state-danger)", fontSize: "0.85rem" }}>{erro}</div> : null}

        {relatorio ? (
          <div style={{ display: "grid", gap: 10 }}>
            {relatorio.semLinhas ? (
              <div>Nenhuma linha sem regra nem histórico — não havia o que sugerir. Nada foi enviado ao modelo.</div>
            ) : relatorio.guardaRecusouTudo ? (
              // ⚠ A guarda recusou ANTES do primeiro lote: nada foi enviado, e o motivo é dela.
              <div>
                <strong>Nada foi enviado ao modelo.</strong>{" "}
                {fraseDaGuarda(relatorio.guarda?.motivo)}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                <div>
                  <strong>{relatorio.gravadas}</strong> linha(s) receberam uma proposta da IA.{" "}
                  <span style={{ color: "var(--text-muted)" }}>Confira e lance — nada foi lançado.</span>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  {relatorio.linhasEnviadas} linha(s) enviadas em {relatorio.lotes} lote(s) · {relatorio.linhasOlhadas} olhadas na fila
                  {relatorio.modelo ? ` · ${relatorio.modelo}` : ""} · custo estimado {centavosEmDolar(relatorio.custoEstimadoCentavos)}
                </div>
                {relatorio.naoGravadas ? (
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    {relatorio.naoGravadas} proposta(s) não foram gravadas: a linha mudou de estado enquanto o modelo respondia.
                  </div>
                ) : null}
              </div>
            )}

            {relatorio.guardaParouNoMeio ? (
              <div style={{ fontSize: "0.85rem", color: "var(--state-warn)" }}>
                A guarda de custo parou a partir do lote {relatorio.guarda?.apartirDoLote}: {fraseDaGuarda(relatorio.guarda?.motivo)}{" "}
                O que entrou até ali vale.
              </div>
            ) : null}

            {relatorio.recusadas.length ? (
              <div style={{ display: "grid", gap: 4 }}>
                {/* ⚠ NADA SOME EM SILÊNCIO: a proposta que o servidor recusou aparece com o MOTIVO —
                    é assim que se descobre que o modelo inventou conta, ou apontou uma sintética. */}
                <div style={{ fontWeight: 600 }}>{relatorio.recusadas.length} proposta(s) recusadas pelo sistema, e por quê:</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {relatorio.recusadas.map((r, i) => (
                    <li key={`${r.id || "?"}-${i}`}>{fraseDaRecusaIa(r.motivo)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {relatorio.erros.length ? (
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 600 }}>O modelo não respondeu em {relatorio.erros.length} lote(s):</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {relatorio.erros.map((e, i) => (
                    <li key={`${e.lote}-${i}`}>lote {e.lote}: {e.mensagem || e.codigo}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div>
              <strong>{candidatas}</strong> linha(s) da fila não têm conta por regra nem por histórico. A IA vai
              propor <strong>débito e crédito</strong> para cada uma, com uma justificativa, a partir do plano de
              contas desta empresa e do que você já lançou.
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              As linhas que já têm conta por regra ou histórico <strong>não são enviadas</strong> — a regra vence a
              IA. Nada é lançado: a proposta aparece na linha, marcada como da IA, e você confirma uma a uma.
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              A chamada ao modelo tem custo, contado contra o teto mensal do escritório.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
