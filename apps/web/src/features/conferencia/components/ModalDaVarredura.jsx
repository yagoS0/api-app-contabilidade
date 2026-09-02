// TRAZER AS NOTAS RECEBIDAS PARA A FILA.
//
// ⚠⚠ A DATA-PISO É OBRIGATÓRIA, E ISSO É A REGRA — não um campo que faltou preencher. São **1.897
// NFS-e recebidas** na base: sem corte, a primeira varredura produz a base inteira de uma vez, e
// isso não é fila, é muro. Um default aqui faria a TELA escolher, em silêncio, o tamanho do
// trabalho que o contador vai encontrar — e essa escolha é dele.
//
// O servidor recusa sem `desde` (400 `data_piso_obrigatoria`). Este diálogo existe para o contador
// não descobrir a regra pelo erro.
//
// ⚠ A varredura ESCREVE (cria declarados), mas **não cria lançamento nenhum**: tudo nasce em
// `AGUARDANDO_PAGAMENTO`, e quem contabiliza continua sendo o contador, linha a linha.

import { useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { dataPisoEhValida, fraseDaRecusa, leituraDaVarredura } from "../lib/conferenciaTela";

const varreduraApi = createApiClient();

export function ModalDaVarredura({ companyId, aoFechar, aoConcluir, jaAutomatica = false }) {
  // ⚠⚠ NASCE VAZIO. Sugerir "o primeiro dia do mês" pareceria prestativo e seria a tela decidindo o
  // volume de trabalho — exatamente o que a obrigatoriedade da data existe para impedir.
  const [desde, setDesde] = useState("");
  /**
   * ⚠⚠ NASCE MARCADO — e isso é a decisão do dono, não uma preferência: *"elas devem ser trazidas
   * automaticamente"*. O padrão é o que ele pediu; a caixa existe porque a varredura avulsa
   * continua sendo legítima (alcançar um período antigo uma vez só, sem mudar a regra permanente).
   *
   * ⚠ Isto NÃO é a tela escolhendo a data-piso — aquela continua vazia e obrigatória. O que a caixa
   * decide é se a data que O CONTADOR escolher vale uma vez ou daqui em diante.
   */
  const [automatica, setAutomatica] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [relatorio, setRelatorio] = useState(null);

  const valida = dataPisoEhValida(desde);

  async function varrer() {
    setEnviando(true);
    setErro(null);
    try {
      // ⚠⚠ DUAS PORTAS, UM CORPO — no servidor as duas chamam `varrerAgora`, então o relatório
      // volta com as mesmas chaves. A diferença é só se a escolha do contador fica guardada.
      const r = automatica
        ? await varreduraApi.postVarreduraAutomatica(companyId, desde)
        : await varreduraApi.postVarrerNotas(companyId, desde);
      setRelatorio(leituraDaVarredura(r));
      aoConcluir?.();
    } catch (e) {
      setErro(e?.message || "Não foi possível varrer as notas.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Trazer notas recebidas para a fila"
      tamanho="md"
      ocupado={enviando}
      aoFechar={aoFechar}
      rodape={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={aoFechar} disabled={enviando}>
            {relatorio ? "Fechar" : "Cancelar"}
          </Button>
          {relatorio ? null : (
            <Button
              variant="primary"
              onClick={varrer}
              disabled={!valida || enviando}
              // ⚠ Botão desabilitado NUNCA é mudo.
              title={valida ? undefined : "Escolha a data a partir da qual as notas devem entrar."}
            >
              {enviando ? "Varrendo…" : "Varrer"}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {relatorio ? (
          <div style={{ display: "grid", gap: 10 }}>
            {/* ⚠⚠ O RELATÓRIO SAI INTEIRO. Um "criei 12" sozinho esconderia o que NÃO entrou, e
                deixaria "não veio nada" indistinguível de "deu erro". */}
            <div style={{ display: "grid", gap: 4 }}>
              <div><strong>{relatorio.criados}</strong> nota(s) entraram na fila.</div>
              <div style={{ color: "var(--text-muted)" }}>
                {relatorio.varridas} nota(s) olhadas · {relatorio.jaExistiam} já estavam na fila ·{" "}
                {relatorio.fora} fora do período escolhido
              </div>
            </div>

            {relatorio.tudoJaExistia ? (
              // ⚠⚠ Rodar de novo e ver "0 novas" é a IDEMPOTÊNCIA funcionando, não falha. Sem esta
              // frase o contador roda três vezes achando que não funcionou.
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Nenhuma nota nova: todas as do período já estavam na fila. Varrer de novo não duplica nada.
              </div>
            ) : null}

            {relatorio.nadaVarrido ? (
              // ⚠ "Nada varrido" e "nada criado" são respostas diferentes: aqui o piso não alcançou
              // nota nenhuma, e o conserto é escolher uma data anterior.
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Nenhuma nota recebida a partir dessa data. Se você esperava ver notas, tente uma data
                anterior.
              </div>
            ) : null}

            {relatorio.recusados.length ? (
              <div style={{ display: "grid", gap: 4 }}>
                {/* ⚠ NADA SOME EM SILÊNCIO. A nota que não virou despesa aparece com o MOTIVO —
                    e nota sem valor é caso real: 62 delas na base. */}
                <div style={{ fontWeight: 600 }}>Não entraram, e por quê:</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {relatorio.recusados.map((r) => (
                    <li key={r.notaId}>{fraseDaRecusa(r.motivo)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 600 }}>Trazer notas emitidas a partir de</span>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} autoFocus />
            </label>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Escolha a data de corte. Sem ela, toda a base de notas recebidas entraria de uma vez —
              e uma fila com centenas de itens não é uma fila. Varrer de novo mais tarde <strong>não
              duplica</strong> o que já entrou.
            </div>
            {/* ⚠⚠ A DECISÃO DE TRAZER SOZINHO — dono, 01/09/2026. Marcada por padrão porque é o
                que ele pediu; a caixa existe porque a varredura avulsa continua legítima (alcançar
                um período antigo uma vez, sem mudar a regra permanente). */}
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={automatica}
                onChange={(e) => setAutomatica(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Trazer as notas sozinho daqui em diante</strong>, usando esta mesma data de corte.
                <span style={{ display: "block", color: "var(--text-muted)" }}>
                  A cada busca de notas da empresa, as recebidas desde essa data entram na fila sem você
                  precisar voltar aqui. {jaAutomatica ? "Já está ligado — confirmar troca a data." : null}
                </span>
              </span>
            </label>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              As notas entram <strong>sem lançamento contábil</strong>: elas ficam esperando o pagamento,
              e quem contabiliza é você, linha a linha.
              {automatica ? (
                <>
                  {" "}⚠ Isso vale para o que entrar sozinho também — <strong>a varredura automática
                  não lança nada</strong>.
                </>
              ) : null}
            </div>
          </>
        )}

        {erro ? <div style={{ color: "var(--state-danger)" }}>{erro}</div> : null}
      </div>
    </Modal>
  );
}
