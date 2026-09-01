// OS DÉBITOS DO EXTRATO QUE AINDA NÃO VIRARAM O PAGAMENTO DE UMA NOTA.
//
// ⚠⚠ ESTE PAINEL EXISTE PARA NÃO CONTAR A DESPESA DUAS VEZES. O débito do extrato e a nota recebida
// são duas FACES da mesma despesa: casá-los faz o débito preencher o bloco de pagamento da nota e
// sumir absorvido. Sem esta tela, o contador contabiliza a nota por um lado e o débito por outro —
// e a despesa entra dobrada no razão.
//
// ⚠⚠ O SISTEMA NUNCA CASA SOZINHO, e isso é medição, não conservadorismo: as notas recebidas **não
// têm duplicata** (`<cobr><dup>` não é lido, não há coluna, e as 49 NF-e são resumos sem XML), então
// **não existe vencimento** para ancorar a janela. A evidência (valor + pista do fornecedor + janela
// larga) é boa para SUGERIR e fraca para DECIDIR. Todo botão aqui é do contador.
//
// ⚠⚠ E COM DOIS CANDIDATOS NÃO HÁ BOTÃO NENHUM. Ver `podeCasar` em `../lib/conferenciaTela.js`.

import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
import { debitosQueCasamComNota } from "../lib/contabilizacaoEmLote";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import {
  cnpjFormatado,
  dataCivil,
  dinheiro,
  leituraDoCasamento,
  ordenarCasamentos,
  podeCasar,
} from "../lib/conferenciaTela";

const casamentosApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

function Resumo({ d, sufixo }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontWeight: 600 }}>{d?.descricaoOriginal || "—"}</span>
      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        {dinheiro(d?.valorAjustado ?? d?.valor)}
        {sufixo ? ` · ${sufixo}` : ""}
        {d?.cnpjFornecedor ? ` · ${cnpjFormatado(d.cnpjFornecedor)}` : ""}
      </span>
    </div>
  );
}

/** ⚠ A confirmação REPETE OS DOIS LADOS — é o ato que amarra um débito a uma nota. */
function ConfirmarCasamento({ linha, ocupado, onFechar, onConfirmar }) {
  return (
    <Modal
      titulo="Casar este débito com esta nota"
      tamanho="md"
      ocupado={ocupado}
      aoFechar={onFechar}
      rodape={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Cancelar</Button>
          <Button variant="primary" onClick={onConfirmar} disabled={ocupado}>
            {ocupado ? "Casando…" : "Casar"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div style={card}>
          <div style={{ fontSize: "0.78rem", color: "var(--text-faint)", marginBottom: 6 }}>DÉBITO DO EXTRATO</div>
          <Resumo d={linha.debito} sufixo={`pago em ${dataCivil(linha.debito?.dataPagamento)}`} />
        </div>
        <div style={card}>
          <div style={{ fontSize: "0.78rem", color: "var(--text-faint)", marginBottom: 6 }}>NOTA RECEBIDA</div>
          <Resumo d={linha.sugestao?.nota} sufixo={`emitida em ${dataCivil(linha.sugestao?.nota?.dataDocumento)}`} />
        </div>
        {/* ⚠⚠ A frase mais importante do diálogo: casar NÃO contabiliza. Sem ela, o contador acha
            que o lançamento saiu e não confere a fila depois. */}
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          A nota passa a ter a data de pagamento do extrato, e o débito some da fila — ele foi absorvido
          por ela. <strong>Isto não cria lançamento contábil:</strong> a nota continua esperando a sua
          conferência.
        </div>
      </div>
    </Modal>
  );
}

export function PainelDeCasamentos({
  companyId, podeEscrever = true, aoCasar,
  /**
   * ⚠⚠ ELE REPORTA QUAIS DÉBITOS JÁ CASAM COM UMA NOTA — e a aba usa isso para BLOQUEAR o «Lançar»
   * daquelas linhas (01/09/2026).
   *
   * O motivo de o painel reportar, em vez de a aba consultar por conta própria, é que a resposta é
   * a MESMA: duas leituras do mesmo endpoint na mesma tela divergiriam no instante em que uma
   * recarregasse e a outra não — e a que a fila usasse seria a que ninguém confere.
   *
   * ⚠ Ele reporta SEMPRE que a consulta termina, inclusive com `Map` vazio (não há o que casar) e
   * inclusive quando ele mesmo não renderiza. E reporta `null` quando FALHOU: `null` é *"não sei"*,
   * e é diferente de *"nenhum casa"* — a fila trata os dois de formas opostas.
   */
  aoSaberQuaisCasam,
}) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    if (!companyId) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await casamentosApi.getConferenciaCasamentos(companyId);
      setDados(r);
      // ⚠ Reporta ANTES de qualquer render condicional deste painel: ele some quando não há nada a
      // casar, e a fila precisa da resposta mesmo assim (um `Map` vazio é uma resposta).
      aoSaberQuaisCasam?.(debitosQueCasamComNota(r));
    } catch (e) {
      setErro(e?.message || "Não foi possível carregar as sugestões.");
      setDados(null);
      // ⚠⚠ `null` = NÃO SEI. A fila bloqueia o «Lançar» dos débitos de extrato enquanto não souber —
      // é a mesma postura do lote, que RECUSA abrir sem esta resposta.
      aoSaberQuaisCasam?.(null);
    } finally {
      setCarregando(false);
    }
  }, [companyId, aoSaberQuaisCasam]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const casar = useCallback(async () => {
    if (!confirmando) return;
    setEnviando(true);
    try {
      await casamentosApi.postConferenciaFundir(companyId, {
        declaradoOfxId: confirmando.debito.id,
        declaradoNotaId: confirmando.sugestao.nota.id,
      });
      setConfirmando(null);
      await carregar();
      // ⚠ A FILA TAMBÉM MUDOU: a nota ganhou data e passou a `A_CONFERIR`. Sem recarregá-la, o
      // contador vê o débito sumir daqui e a nota continuar "sem pagamento identificado" ao lado.
      aoCasar?.();
    } catch (e) {
      // ⚠ A recusa do servidor aparece. Ela pode ser legítima: a sugestão pode ter envelhecido
      // (`CASAMENTO_NAO_CONFERE`), e quem reconfere no instante do clique é o servidor.
      setErro(e?.message || "O servidor recusou este casamento.");
    } finally {
      setEnviando(false);
    }
  }, [confirmando, companyId, carregar, aoCasar]);

  const linhas = ordenarCasamentos(dados?.linhas);

  // ⚠ Sem débito nenhum esperando, o painel NÃO aparece. Um bloco permanente dizendo "nada a casar"
  // seria ruído na maioria das empresas — as que nunca importaram extrato.
  if (!carregando && !erro && linhas.length === 0) return null;

  return (
    <div style={{ ...card, display: "grid", gap: 12, borderColor: "var(--state-warn)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Débitos do extrato sem nota vinculada</h3>
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {dados?.totalDebitos ?? 0} débito(s) · {dados?.totalNotas ?? 0} nota(s) em aberto
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={carregar} disabled={carregando}>
          {carregando ? "Carregando…" : "Atualizar os débitos"}
        </Button>
      </div>

      {/* ⚠ A frase explica POR QUE isto importa. Sem ela o painel parece uma lista técnica. */}
      <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
        Casar o débito com a nota evita lançar a mesma despesa duas vezes: o débito vira o pagamento
        dela. O sistema sugere, mas não decide — confira antes.
      </div>

      {erro ? <div style={{ color: "var(--state-danger)" }}>{erro}</div> : null}

      {linhas.map((linha) => {
        const leitura = leituraDoCasamento(linha);
        const habilitado = podeCasar(linha);
        return (
          <div
            key={linha.debito?.id}
            style={{ ...card, display: "grid", gap: 10, background: "var(--surface-2, var(--surface))" }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px" }}>
                <Resumo d={linha.debito} sufixo={`pago em ${dataCivil(linha.debito?.dataPagamento)}`} />
              </div>
              <span
                title={leitura.frase}
                style={{
                  padding: "3px 10px",
                  borderRadius: 12,
                  background: `var(${leitura.token}-surface)`,
                  color: `var(${leitura.token})`,
                  border: `1px solid var(${leitura.token})`,
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {leitura.rotulo}
              </span>
            </div>

            {linha.sugestao ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
                <div style={{ flex: "1 1 260px" }}>
                  <Resumo d={linha.sugestao.nota} sufixo={`emitida em ${dataCivil(linha.sugestao.nota?.dataDocumento)}`} />
                  {/* ⚠ A PISTA aparece. "Por que o sistema acha que é esta?" é a pergunta que o
                      contador faz, e responder com o motivo é o que torna a sugestão conferível. */}
                  <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>{linha.sugestao.frase}</span>
                  {/* ⚠⚠ O QUE DÁ PARA FAZER COM ESTA NOTA — e ela nem sempre se funde.
                      Desde o alargamento do conjunto de candidatas (dono, 27/08/2026), a sugestão
                      pode ser uma nota JÁ CONTABILIZADA: ela aparece para o débito ser RECONHECIDO
                      (senão ele vira despesa em dobro no lote), e o botão não existe. Sem esta
                      frase, o botão sumiria mudo. E na nota com data DECLARADA ela avisa que casar
                      SUBSTITUI a declaração pela prova — que é uma consequência, não um detalhe. */}
                  {linha.sugestao.fraseDaCandidata ? (
                    <div style={{
                      fontSize: "0.76rem",
                      marginTop: 4,
                      color: linha.sugestao.podeFundir === false ? "var(--state-warn)" : "var(--text-muted)",
                    }}>
                      {linha.sugestao.fraseDaCandidata}
                    </div>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!habilitado || !podeEscrever}
                  // ⚠ Botão desabilitado NUNCA é mudo — e os dois motivos pedem consertos
                  // diferentes: trocar de papel × desfazer o lançamento.
                  title={
                    !podeEscrever ? "Seu perfil não pode alterar lançamentos desta empresa."
                      : !habilitado ? linha.sugestao.fraseDaCandidata || "Esta nota não pode ser casada."
                        : undefined
                  }
                  onClick={() => setConfirmando(linha)}
                >
                  Casar
                </Button>
              </div>
            ) : (
              <div style={{ paddingLeft: 12, borderLeft: "2px solid var(--border)", display: "grid", gap: 6 }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{linha.frase}</span>
                {/* ⚠⚠ OS CANDIDATOS APARECEM, E NENHUM TEM BOTÃO. É a ambiguidade sendo mostrada em
                    vez de resolvida: o contador identifica a nota certa e informa o pagamento NELA,
                    na fila abaixo. Um "casar" ao lado de cada um converteria a recusa do sistema em
                    decisão do dedo de quem está com pressa. */}
                {linha.candidatos?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    {linha.candidatos.map((c) => (
                      <li key={c.nota?.id}>
                        {c.nota?.descricaoOriginal} · {dinheiro(c.nota?.valor)} · emitida em{" "}
                        {dataCivil(c.nota?.dataDocumento)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      {confirmando ? (
        <ConfirmarCasamento
          linha={confirmando}
          ocupado={enviando}
          onFechar={() => setConfirmando(null)}
          onConfirmar={casar}
        />
      ) : null}
    </div>
  );
}
