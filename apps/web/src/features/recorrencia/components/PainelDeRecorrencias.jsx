// AS RECORRÊNCIAS — o que volta, e com que valor.
//
// > Dono, 25/08/2026: *"a Claude sempre aparece com valor de 120 a 140 reais, nesse caso colocamos
// > uma aproximação de 130 no fluxo futuro. O mesmo para receita."*
//
// ⚠⚠ ESTE PAINEL NÃO É UMA ABA, e isso é decisão. O dono cortou um nível de navegação em 24/08/2026
// (*"muitas abas"*); o plano manda a marcação morar **na linha do fluxo de caixa** e as declarações
// pendentes do cliente entrarem na **fila da Conferência**. Como o fluxo (Fase E) ainda não existe,
// hoje ele vive dentro da Conferência — a mesma fila de *"coisas para o contador confirmar"*.
// ⚠ A lib fica numa feature PRÓPRIA para a tela do fluxo importá-la depois sem depender daqui.
//
// ⚠⚠ ELE SOME SOZINHO quando não há nada a decidir. Precedente literal do `PainelDeCasamentos`: um
// bloco permanente dizendo "nada a decidir" seria ruído na maioria das empresas.
//
// ⚠⚠ E ELE NÃO DECIDE NADA. Quem observa é o detector, no servidor; quem grava é o
// `SerieRecorrenteService`. Aqui mora a LEITURA (`../lib/recorrenciaTela.js`, com teste próprio).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import {
  ACAO,
  ESTADO_DA_ACAO,
  ROTULO_DA_ACAO,
  acoesDaSerie,
  confrontoDaDeclaracao,
  evidenciaDaSerie,
  leituraDaOrigem,
  leituraNaTela,
  motivoDeBloqueio,
  ordenarSeries,
  pedemResposta,
  rotuloDaPeriodicidade,
  rotuloDoLado,
  valorComFaixa,
} from "../lib/recorrenciaTela";

const recorrenciaApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

function Selo({ token, children, title }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: 12,
        // ⚠ O par `-surface` do token, NUNCA `${cor}22` — concatenar hex quebra em silêncio assim
        // que a cor vira `var(--…)`.
        background: `var(${token}-surface)`,
        color: `var(${token})`,
        border: `1px solid var(${token})`,
        fontSize: "0.75rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** ⚠ A confirmação REPETE OS DADOS. *"Tem certeza?"* não é confirmação — aprende-se a clicar sem ler. */
function ConfirmarMarcacao({ serie, acao, ocupado, aviso, onFechar, onConfirmar }) {
  const valor = valorComFaixa(serie);
  const evidencia = evidenciaDaSerie(serie);
  const origem = leituraDaOrigem(serie?.origem);

  return (
    <Modal
      titulo={`${ROTULO_DA_ACAO[acao]} — ${serie?.rotulo || ""}`}
      tamanho="md"
      ocupado={ocupado}
      aoFechar={onFechar}
      rodape={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Cancelar</Button>
          <Button
            // ⚠ `primary`, nunca verde: verde significa CONCLUÍDO nesta casa, e nada aqui concluiu.
            variant={acao === ACAO.CONFIRMAR ? "primary" : "secondary"}
            disabled={ocupado}
            onClick={onConfirmar}
          >
            {ocupado ? "Salvando…" : ROTULO_DA_ACAO[acao]}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {aviso ? (
          <div role="alert" style={{ ...card, borderColor: "var(--state-danger)", color: "var(--state-danger)", fontSize: "0.88rem" }}>
            {aviso}
          </div>
        ) : null}

        <div style={{ ...card, display: "grid", gap: 4, fontSize: "0.88rem" }}>
          <div><strong>{serie?.rotulo}</strong></div>
          <div style={{ color: "var(--text-muted)" }}>
            {rotuloDoLado(serie?.lado)} · {rotuloDaPeriodicidade(serie?.periodicidade)} · {origem.rotulo}
          </div>
          {/* ⚠⚠ O VALOR SAI COM A FAIXA. A mediana sozinha erraria por um terço rotineiramente. */}
          {valor ? <div style={{ color: "var(--text-muted)" }}>{valor}</div> : null}
          {/* ⚠ A evidência no TEXTO — `title` não aparece no teclado nem no toque. */}
          {evidencia ? <div style={{ color: "var(--text-faint)", fontSize: "0.8rem" }}>{evidencia}</div> : null}
        </div>

        {acao === ACAO.CONFIRMAR ? (
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            {/* ⚠⚠ A CONSEQUÊNCIA DITA: marcar é o que põe a linha no fluxo. E ela é PREVISÃO — a
                palavra está no TEXTO, não só na cor (impressão, daltonismo). */}
            Esta série passa a entrar no <strong>fluxo de caixa</strong> como valor{" "}
            <strong>previsto</strong>, com a evidência acima registrada ao lado dela.
          </div>
        ) : (
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Esta série <strong>não</strong> entra no fluxo de caixa. Você pode voltar atrás depois.
          </div>
        )}
      </div>
    </Modal>
  );
}

function LinhaDaSerie({ serie, podeEscrever, indisponivel, onAgir }) {
  const leitura = leituraNaTela(serie.leitura);
  const origem = leituraDaOrigem(serie.origem);
  const valor = valorComFaixa(serie);
  const evidencia = evidenciaDaSerie(serie);
  const confronto = confrontoDaDeclaracao(serie);
  const acoes = acoesDaSerie(serie);

  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>{serie.rotulo}</strong>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {rotuloDoLado(serie.lado)} · {rotuloDaPeriodicidade(serie.periodicidade)}
        </span>
        <span style={{ flex: 1 }} />
        <Selo token={leitura.token} title={leitura.frase}>{leitura.rotulo}</Selo>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        {/* ⚠⚠ O VALOR NUNCA SAI SOZINHO — ele vem com a faixa observada. */}
        {valor ? (
          <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>{valor}</span>
        ) : (
          // ⚠ Ausência de valor NÃO vira "R$ 0,00": zero fabricado é a armadilha que já custou um
          // "0%" na tela do cliente.
          <span style={{ color: "var(--text-faint)", fontSize: "0.85rem" }}>sem valor projetado</span>
        )}
        {/* ⚠⚠ DETECTADA e DECLARADA NÃO SE PARECEM: a declarada diz QUEM afirmou, e nunca ganha o
            peso visual de doze observações. */}
        {origem.ehObservada ? (
          evidencia ? <span style={{ fontSize: "0.8rem", color: "var(--text-faint)" }}>{evidencia}</span> : null
        ) : (
          <span style={{ fontSize: "0.8rem", color: "var(--state-warn)" }}>
            {origem.rotulo}
            {serie.declaradoEm ? ` em ${new Date(serie.declaradoEm).toISOString().slice(0, 10).split("-").reverse().join("/")}` : ""}
          </span>
        )}
      </div>

      {/* ⚠⚠ O CONFRONTO — *"você declarou X; as observações dizem Y. O observado vence."* Sem isto, o
          fluxo projeta dinheiro que não sai, e ninguém descobre. */}
      {confronto ? (
        <div role="alert" style={{ fontSize: "0.82rem", color: "var(--state-warn)" }}>{confronto.frase}</div>
      ) : null}

      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{leitura.frase}</div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {acoes.map((acao) => {
          const bloqueio = motivoDeBloqueio(acao, serie, { podeEscrever, indisponivel });
          return (
            <Button
              key={acao}
              size="sm"
              variant={acao === ACAO.CONFIRMAR ? "primary" : "secondary"}
              disabled={Boolean(bloqueio)}
              // ⚠⚠ Botão bloqueado fica VISÍVEL e com o motivo — botão que some esconde que a ação
              // existe, e botão mudo não diz qual é o conserto. ⚠ O `title` é REFORÇO: o texto sai
              // visível logo abaixo.
              title={bloqueio || undefined}
              onClick={() => onAgir(acao, serie)}
            >
              {ROTULO_DA_ACAO[acao]}
            </Button>
          );
        })}
      </div>

      {/* ⚠⚠ O MOTIVO SAI VISÍVEL. Uma linha só, e só quando há bloqueio — em regime normal ela não
          existe, então não vira ruído. */}
      {motivosVisiveis(acoes, serie, { podeEscrever, indisponivel }).map((frase) => (
        <div key={frase} style={{ fontSize: "0.75rem", color: "var(--text-faint)", textAlign: "right" }}>
          {frase}
        </div>
      ))}
    </div>
  );
}

/** ⚠ As frases DISTINTAS — dois botões bloqueados pelo mesmo motivo dariam a mesma frase duas vezes. */
function motivosVisiveis(acoes, serie, opcoes) {
  const vistas = [];
  for (const acao of acoes) {
    const frase = motivoDeBloqueio(acao, serie, opcoes);
    if (frase && !vistas.includes(frase)) vistas.push(frase);
  }
  return vistas;
}

export function PainelDeRecorrencias({ companyId, podeEscrever = true, cicloAtual = null }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState(null);
  // ⚠⚠ VER TODAS é opt-in. Numa empresa com 97 séries, 94 sem padrão nenhum, mostrar tudo por padrão
  // afogaria as 3 que pedem decisão — o mesmo defeito que a fila da Conferência resolve agrupando.
  const [verTodas, setVerTodas] = useState(false);

  const carregar = useCallback(async () => {
    if (!companyId) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await recorrenciaApi.getRecorrencias(companyId, cicloAtual);
      setDados(r);
    } catch (e) {
      // ⚠ O erro APARECE. "Não veio nada" e "deu erro" não podem ficar iguais.
      setErro(e?.message || "Não foi possível carregar as recorrências.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [companyId, cicloAtual]);

  useEffect(() => { carregar(); }, [carregar]);

  const series = useMemo(() => ordenarSeries(dados?.series), [dados]);
  const aDecidir = useMemo(() => pedemResposta(series), [series]);
  const visiveis = verTodas ? series : aDecidir;

  const agir = useCallback(async () => {
    if (!aberta) return;
    setSalvando(true);
    try {
      const { serie, acao } = aberta;
      await recorrenciaApi.postMarcarRecorrencia(companyId, {
        lado: serie.lado,
        chave: serie.chave,
        rotulo: serie.rotulo,
        periodicidade: serie.periodicidade,
        contraparteDoc: serie.contraparteDoc ?? null,
        // ⚠⚠ O ESTADO SAI DO MAPA, nunca de uma string escrita aqui — a tela não inventa estado.
        estado: ESTADO_DA_ACAO[acao],
        // ⚠⚠ A EVIDÊNCIA QUE O CONTADOR VIU viaja junto: é ela que responde "por que esta linha está
        // no fluxo?" daqui a seis meses. O servidor não a recalcula, de propósito.
        baseDaObservacao: serie.base ?? null,
      });
      setAberta(null);
      setAviso(null);
      await carregar();
    } catch (e) {
      // ⚠ A recusa do SERVIDOR chega com o texto dela — ele é quem sabe o que aconteceu.
      setAviso(e?.message || "O servidor recusou esta marcação.");
    } finally {
      setSalvando(false);
    }
  }, [aberta, companyId, carregar]);

  // ⚠⚠ O PAINEL SOME quando não há nada a decidir E ninguém pediu para ver tudo. Um bloco permanente
  // dizendo "nada a decidir" seria ruído na maioria das empresas.
  if (!carregando && !erro && aDecidir.length === 0 && !verTodas && !(dados?.foraDoAlcance?.length)) {
    return null;
  }

  return (
    <div style={{ ...card, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Recorrências</h3>
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {aDecidir.length} esperando decisão · {series.length} série(s) observada(s)
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? "Só as que pedem decisão" : "Ver todas"}
        </Button>
        <Button size="sm" variant="secondary" onClick={carregar} disabled={carregando}>
          {carregando ? "Carregando…" : "Atualizar as recorrências"}
        </Button>
      </div>

      <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        {/* ⚠⚠ O QUE ESTE PAINEL É, dito antes de qualquer número: ele SUGERE. Marcar é o que põe a
            linha no fluxo, e é decisão do contador. */}
        O sistema observa as notas e <strong>sugere</strong> o que se repete — ele não marca nada
        sozinho. Marcar é o que faz a série entrar no fluxo de caixa, como valor{" "}
        <strong>previsto</strong>.
      </div>

      {erro ? (
        <div role="alert" style={{ ...card, borderColor: "var(--state-danger)", color: "var(--state-danger)" }}>{erro}</div>
      ) : null}

      {/* ⚠⚠ A TABELA NÃO EXISTE NESTE BANCO — e isso é diferente de "esta empresa não tem
          recorrência". Sem esta frase, a segunda leitura seria uma AFIRMAÇÃO sobre a empresa. */}
      {dados?.indisponivel ? (
        <div role="alert" style={{ ...card, borderColor: "var(--state-warn)", color: "var(--state-warn)", fontSize: "0.85rem" }}>
          As recorrências ainda não podem ser marcadas neste ambiente: a tabela não existe no banco.
          A observação abaixo continua valendo — o que não funciona é gravar a decisão.
        </div>
      ) : null}

      {aviso && !aberta ? (
        <div role="alert" style={{ ...card, borderColor: "var(--state-warn)", color: "var(--state-warn)" }}>{aviso}</div>
      ) : null}

      {visiveis.map((s) => (
        <LinhaDaSerie
          key={`${s.lado}|${s.chave}`}
          serie={s}
          podeEscrever={podeEscrever}
          indisponivel={Boolean(dados?.indisponivel)}
          onAgir={(acao, serie) => { setAviso(null); setAberta({ acao, serie }); }}
        />
      ))}

      {!carregando && visiveis.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {/* ⚠ Estado vazio diz POR QUÊ, e distingue as duas causas. */}
          {series.length === 0
            ? "Nenhuma série observada nesta empresa ainda. Elas nascem das notas emitidas e recebidas."
            : "Nenhuma série esperando decisão."}
        </div>
      ) : null}

      {/* ⚠⚠ O QUE O DETECTOR NÃO ALCANÇA APARECE, CONTADO. Uma limitação declarada é diferente de
          uma ausência silenciosa — e sem isto o contador concluiria que o extrato dele não tem
          despesa recorrente nenhuma. */}
      {(dados?.foraDoAlcance || []).map((f) => (
        <div key={f.motivo} style={{ ...card, borderColor: "var(--state-warn)", fontSize: "0.82rem", color: "var(--text-muted)" }}>
          <strong>{f.quantos}</strong> despesa(s) fora desta leitura. {f.frase}
        </div>
      ))}

      {aberta ? (
        <ConfirmarMarcacao
          serie={aberta.serie}
          acao={aberta.acao}
          ocupado={salvando}
          aviso={aviso}
          onFechar={() => { setAberta(null); setAviso(null); }}
          onConfirmar={agir}
        />
      ) : null}
    </div>
  );
}
