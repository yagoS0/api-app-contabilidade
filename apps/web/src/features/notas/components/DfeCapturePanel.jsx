// Q12.B.5: captura manual de NF-e (SEFAZ DFe).
//
// ⚠ O BOTÃO NÃO PODE PROMETER O QUE A SEFAZ NÃO DÁ. A NT 2014.002 permite UMA consulta por CNPJ a
// cada hora na distribuição DFe; estourar devolve "Consumo Indevido" (cStat 656) e BLOQUEIA aquele
// CNPJ por 1 hora. Como a captura automática (`workers/dfeNotasWorker.js`) já consulta toda empresa
// de hora em hora, a janela costuma estar FECHADA — o primeiro clique do dia bastava para derrubar
// a empresa, e a mensagem ainda mandava procurar culpado externo.
//
// ⚠ Desabilitar e pronto deixaria o botão cinza para sempre, sem explicação. O que a tela precisa
// dizer é OUTRA coisa: *o sistema já consulta esta empresa sozinho, a última foi às HH:MM e a
// próxima sai às HH:MM*. E o botão continua VISÍVEL — botão que some esconde que a ação existe.
//
// ⚠ A forma é a da Situação Fiscal (`podeConsultar` + `proximaConsultaEm`), mas o TEXTO é outro de
// propósito: lá a janela é NOSSA (4 h, chamada paga ao SERPRO) e quem a consome é o contador; aqui
// ela é da SEFAZ e quem a consome é o NOSSO worker. Sem dizer isso, o contador acha que a culpa é
// dele — ou que o sistema está quebrado.

import { useState } from "react";
import { PANEL } from "./notasStyles";
import { Button } from "../../../components/ui/Button";

function horaCurta(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function DfeCapturePanel({ dfeState, dfeSyncing, onSync, onClearError }) {
  const [env, setEnv] = useState("prod");
  const inBackoff = dfeState?.dfeBackoffUntil && new Date(dfeState.dfeBackoffUntil) > new Date();
  const hasError = Boolean(dfeState?.dfeLastError);

  // Ausência de informação NÃO vira bloqueio: state ainda carregando (ou API antiga, sem o campo)
  // mantém o botão livre — quem recusa de verdade é o serviço, com a razão nomeada.
  const dentroDaJanela = dfeState?.podeConsultarAgora === false;
  const ultimaConsultaEm = dfeState?.ultimaConsultaEm || null;
  const proximaConsultaEm = dfeState?.proximaConsultaEm || null;

  const explicacaoJanela = dentroDaJanela
    ? `O sistema já consulta esta empresa automaticamente a cada 1 hora. Última consulta às `
      + `${horaCurta(ultimaConsultaEm)}; a próxima sai às ${horaCurta(proximaConsultaEm)}. `
      + "A SEFAZ permite 1 consulta por CNPJ por hora (NT 2014.002) — consultar antes disso "
      + "bloquearia esta empresa por 1 hora."
    : null;

  const tituloBotao = inBackoff
    ? "Em espera após erro — use \"Limpar erro\" quando o motivo estiver resolvido"
    : (explicacaoJanela || "Consulta a SEFAZ agora e grava as notas encontradas");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => onSync({ env })} disabled={dfeSyncing || inBackoff || dentroDaJanela} title={tituloBotao}>
          {dfeSyncing ? "Capturando…" : "🔄 Buscar NF-e"}
        </Button>
        <select value={env} onChange={(e) => setEnv(e.target.value)} disabled={dfeSyncing}
          style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 8px", fontSize: "0.8rem" }}>
          <option value="prod">Produção</option>
          <option value="hom">Homologação</option>
        </select>
        {(hasError || inBackoff) && onClearError && (
          <button onClick={onClearError} disabled={dfeSyncing} title="Limpa backoff e último erro"
            style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.muted, cursor: "pointer", fontSize: "0.75rem" }}>
            Limpar erro
          </button>
        )}
        {hasError && (
          <span style={{ color: "#FF4757", fontSize: "0.78rem" }} title={dfeState.dfeLastError}>
            {dfeState.dfeLastError}
          </span>
        )}
      </div>
      {dentroDaJanela && (
        <span style={{ color: PANEL.muted, fontSize: "0.75rem" }}>
          Captura automática ativa: última consulta às {horaCurta(ultimaConsultaEm)}, próxima às{" "}
          {horaCurta(proximaConsultaEm)} (a SEFAZ permite 1 consulta por CNPJ por hora).
        </span>
      )}
    </div>
  );
}
