// A ABA FLUXO DE CAIXA — o que entra e sai nos próximos 12 meses, e o que NÃO se sabe.
//
// ⚠⚠ ESTA TELA NÃO CALCULA NADA. Quem monta o fluxo é `application/fluxo/`, no servidor, e o portal
// do cliente lê o MESMO payload. O que mora aqui é a LEITURA (`../lib/leituraDoFluxo.js`, com teste
// próprio): rótulo, cor, ordem, e o que a tela pode ou não afirmar. Recalcular aqui daria dois
// números para o mesmo dinheiro, e o do cliente é o que ninguém do escritório testa.
//
// ⚠⚠ E ELA NÃO SOMA FATO COM PREVISÃO. Não existe `total` no payload, e a tela não inventa um: um
// número único de doze meses é exatamente o que alguém imprime e leva ao banco.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Painel } from "../../../components/ui/Painel";
import {
  DIRECAO,
  FRASE_DA_PREVISAO,
  FRASE_SEM_TOTAL,
  PROCEDENCIA,
  confrontoDaLinha,
  dinheiro,
  evidenciaDaLinha,
  leituraDaProcedencia,
  mesTemAlgo,
  quandoDaLinha,
  ressalvasDoFluxo,
  rotuloDaFonte,
  rotuloDoMes,
  separarMeses,
  totaisParaTela,
  totalDoBloco,
} from "../lib/leituraDoFluxo";

// Mesmo padrão da Conferência, da Auditoria e do SITFIS: a aba faz a própria chamada, porque não há
// `api` no escopo do detalhe da empresa para estas rotas.
const fluxoApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

/** ⚠ O selo da procedência — cor E palavra. A cor sozinha some na impressão e no daltonismo. */
function SeloDaProcedencia({ procedencia }) {
  const r = leituraDaProcedencia(procedencia);
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.68rem",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        color: "var(" + r.token + ")",
        border: "1px solid var(" + r.token + ")",
        background: "var(" + r.token + "-surface)",
        whiteSpace: "nowrap",
      }}
    >
      {r.rotulo}
    </span>
  );
}

/**
 * ⚠⚠ OS TRÊS COMPARTIMENTOS, SEPARADOS — e não há uma quarta caixa somando os dois primeiros.
 *
 * A ausência do número único é o contrato inteiro (`docs/dre-fluxo-caixa.md`). Quem acrescentar
 * "Saldo do mês" aqui recria exatamente o número que a API se recusa a entregar.
 */
function Totais({ totais, titulo }) {
  const t = totaisParaTela(totais);
  const bloco = (rotulo, procedencia, valores) => {
    const r = leituraDaProcedencia(procedencia);
    return (
      <div style={{ minWidth: 190 }}>
        <div style={{ fontSize: "0.68rem", color: "var(" + r.token + ")", fontWeight: 600, marginBottom: 2 }}>
          {rotulo}
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          entra <strong style={{ color: "var(--text)" }}>{dinheiro(valores.entrada)}</strong>
          {" · "}
          sai <strong style={{ color: "var(--text)" }}>{dinheiro(valores.saida)}</strong>
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
      {titulo ? (
        <div style={{ minWidth: 150, fontWeight: 600, fontSize: "0.82rem" }}>{titulo}</div>
      ) : null}
      {bloco("Já existe (fato)", PROCEDENCIA.FATO, t.fato)}
      {bloco("Previsto", PROCEDENCIA.PREVISAO, t.previsao)}
      {t.desconhecido.quantas > 0 ? (
        <div style={{ minWidth: 190 }}>
          <div
            style={{
              fontSize: "0.68rem",
              color: "var(" + leituraDaProcedencia(PROCEDENCIA.DESCONHECIDO).token + ")",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Sem mês
          </div>
          {/* ⚠⚠ CONTAGEM, nunca valor: `DESCONHECIDO` não vira zero e não vira previsão. */}
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {t.desconhecido.quantas} linha(s) sem valor somável
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LinhaDoFluxo({ linha }) {
  const quando = quandoDaLinha(linha);
  const evidencia = evidenciaDaLinha(linha);
  const confronto = confrontoDaLinha(linha);
  const entra = linha?.direcao === DIRECAO.ENTRADA;
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>
        {quando.texto}
        {/* ⚠⚠ O dia ausente diz POR QUÊ — e a frase vem do SERVIDOR, não desta tela. */}
        {quando.motivo ? (
          <div style={{ fontSize: "0.68rem", color: "var(--text-faint)" }}>{quando.motivo}</div>
        ) : null}
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{linha?.rotulo || "—"}</div>
        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{rotuloDaFonte(linha?.fonte)}</div>
        {/* ⚠⚠ A EVIDÊNCIA VAI NO TEXTO, nunca num `title` — ele não aparece no teclado nem no toque. */}
        {evidencia ? (
          <div style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginTop: 2 }}>{evidencia}</div>
        ) : null}
        {/* ⚠⚠ O CONFRONTO declarado × observado: "o observado vence" (decisão do dono). */}
        {confronto ? (
          <div style={{ fontSize: "0.7rem", color: "var(--state-warn)", marginTop: 2 }}>{confronto}</div>
        ) : null}
      </td>
      <td><SeloDaProcedencia procedencia={linha?.procedencia} /></td>
      <td className="tabela__num" style={{ whiteSpace: "nowrap" }}>
        {entra ? dinheiro(linha?.valor) : ""}
      </td>
      <td className="tabela__num" style={{ whiteSpace: "nowrap" }}>
        {entra ? "" : dinheiro(linha?.valor)}
      </td>
    </tr>
  );
}

function MesAberto({ mes }) {
  return (
    <Painel titulo={rotuloDoMes(mes?.competencia)} densidade="densa">
      <Totais totais={mes?.totais} />
      {mesTemAlgo(mes) ? (
        <table className="tabela--densa" style={{ width: "100%", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 130 }}>Quando</th>
              <th>O quê</th>
              <th style={{ width: 110 }}>Procedência</th>
              <th className="tabela__num" style={{ width: 130 }}>Entra</th>
              <th className="tabela__num" style={{ width: 130 }}>Sai</th>
            </tr>
          </thead>
          <tbody>
            {mes.linhas.map((l, i) => (
              <LinhaDoFluxo key={(l?.fonte || "?") + "-" + (l?.referencia?.id || i)} linha={l} />
            ))}
          </tbody>
        </table>
      ) : (
        // ⚠ Mês vazio DIZ que está vazio. Sumir faria "não há movimento" e "não carregou" ficarem
        // iguais — e o primeiro é uma afirmação sobre o dinheiro da empresa.
        <div style={{ marginTop: 10, fontSize: "0.78rem", color: "var(--text-faint)" }}>
          Nada previsto nem lançado para este mês.
        </div>
      )}
    </Painel>
  );
}

export function FluxoDeCaixaTab({ companyId, competencia }) {
  const [estado, setEstado] = useState({ carregando: true, erro: null, fluxo: null });
  // ⚠⚠ OS MESES DISTANTES NASCEM RECOLHIDOS — meio-termo aceito na revisão externa de 25/08/2026.
  // O contrato entrega os 12; a leitura começa onde a evidência está.
  const [distantesAbertos, setDistantesAbertos] = useState(false);

  const carregar = useCallback(async () => {
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    try {
      const r = await fluxoApi.getFluxoDeCaixa(companyId, competencia);
      setEstado({ carregando: false, erro: null, fluxo: r });
    } catch (err) {
      setEstado({
        carregando: false,
        erro: err?.message || "Não foi possível carregar o fluxo de caixa.",
        fluxo: null,
      });
    }
  }, [companyId, competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  const fluxo = estado.fluxo;
  const { proximos, distantes } = useMemo(() => separarMeses(fluxo?.meses), [fluxo]);
  const doBloco = useMemo(() => totalDoBloco(distantes), [distantes]);
  const ressalvas = useMemo(() => ressalvasDoFluxo(fluxo), [fluxo]);

  if (estado.carregando) {
    return <div style={{ ...card, color: "var(--text-muted)" }}>Carregando o fluxo de caixa…</div>;
  }

  if (estado.erro) {
    return (
      <Aviso
        tom="erro"
        titulo="O fluxo de caixa não pôde ser carregado"
        acao={<Button onClick={carregar}>Tentar de novo</Button>}
      >
        {estado.erro}
      </Aviso>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600 }}>
              Próximos {fluxo?.horizonte || 12} meses, a partir de {rotuloDoMes(fluxo?.cicloAtual)}
            </div>
            {/* ⚠⚠ AS DUAS FRASES SÃO OBRIGATÓRIAS: uma diz que a previsão não aconteceu, a outra diz
                por que não existe um número único. Sem elas, a coluna "previsto" se lê como
                compromisso e a ausência do total se lê como falta. */}
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6, maxWidth: 760 }}>
              {FRASE_DA_PREVISAO}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginTop: 4, maxWidth: 760 }}>
              {FRASE_SEM_TOTAL}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={carregar}>Atualizar</Button>
        </div>
      </div>

      {/* ⚠⚠ AS RESSALVAS VÊM ANTES DOS MESES. A guia vencida é a linha mais urgente do fluxo e não
          mora em mês nenhum — embaixo das tabelas ela ficaria abaixo da dobra. */}
      {ressalvas.map((r, i) => (
        <Aviso
          key={(r.titulo || "") + "-" + i}
          tom={r.tom === "atencao" ? "atencao" : "neutro"}
          /* ⚠⚠ O TÍTULO SAI DA REGRA, nunca de um literal aqui. Escrito na tela, ele era o MESMO
             nas três caixas ("Sobre este fluxo") — três avisos âmbar empilhados e indistinguíveis,
             que é o defeito que o `titulo` obrigatório do `Aviso` existe para impedir. */
          titulo={r.titulo}
        >
          {r.texto}
        </Aviso>
      ))}

      {proximos.map((m) => <MesAberto key={m.competencia} mes={m} />)}

      {distantes.length > 0 ? (
        <Painel
          titulo={"Mais " + distantes.length + " mês(es)"}
          densidade="densa"
          acoes={(
            <Button variant="secondary" size="sm" onClick={() => setDistantesAbertos((v) => !v)}>
              {distantesAbertos ? "Recolher" : "Mostrar mês a mês"}
            </Button>
          )}
        >
          {/* ⚠⚠ O TOTAL DO BLOCO É POR PROCEDÊNCIA, nunca somado — mesma regra do mês. Sem ele os
              meses recolhidos sumiriam de vista; com uma soma única, eles virariam o número de doze
              meses que o contrato recusa. */}
          <Totais totais={doBloco} titulo="No bloco recolhido" />
          <div style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginTop: 8 }}>
            Quanto mais distante o mês, menos evidência há por trás da previsão — cada linha mostra
            em quantas observações ela se apoia.
          </div>
          {distantesAbertos ? (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {distantes.map((m) => <MesAberto key={m.competencia} mes={m} />)}
            </div>
          ) : null}
        </Painel>
      ) : null}
    </div>
  );
}
