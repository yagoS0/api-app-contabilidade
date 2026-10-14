import { useEffect, useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import "./historicoPgdas.css";
const moeda = valor => valor == null ? "Não disponível" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const situacoes = { SUCCESS: "Consulta concluída", INCOMPLETE: "Documentos incompletos", ERROR: "Consulta com erro", NOT_FOUND: "Declaração não localizada", RUNNING: "Consulta em andamento" };
const data = valor => valor ? new Date(valor).toLocaleString("pt-BR") : "Data não registrada";

export function HistoricoPgdas({ api, companyId, competencia, onClose, onAtualizado, bloqueado = false }) {
  const [historico, setHistorico] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(true);
  const [conferindo, setConferindo] = useState(false);
  const ativo = useRef(true);
  async function carregar() {
    setLoading(true); setErro("");
    try {
      if (!api.getPgdasHistorico) throw Error("Histórico indisponível nesta conexão.");
      const result = await api.getPgdasHistorico(companyId, competencia);
      if (!result?.ok) throw Error("Não foi possível carregar o histórico.");
      if (ativo.current) setHistorico(result);
    } catch (e) { if (ativo.current) setErro(e.message || "Não foi possível carregar o histórico."); }
    finally { if (ativo.current) setLoading(false); }
  }
  useEffect(() => { ativo.current = true; carregar(); return () => { ativo.current = false; }; }, []);
  async function conferir() {
    if (conferindo || bloqueado) return;
    setConferindo(true); setErro(""); setAviso("");
    try {
      const r = await api.syncPgdasCircular(companyId, competencia, { somenteDocumentos: true, atualizar: true });
      if (!ativo.current) return;
      if (!r?.ok) throw Error(r?.message || r?.reason || "Não foi possível concluir a conferência.");
      const c = r.result?.circular;
      setAviso(c?.serproSyncStatus === "SUCCESS" && c.pgdasNumeroDeclaracao && c.pgdasDeclaracaoFileId && c.pgdasReciboFileId
        ? "Conferência concluída. Compare as versões registradas abaixo."
        : "Conferência sem documentação completa. O retorno não confirma ausência de entrega.");
      onAtualizado?.(r.result);
      await carregar();
    } catch (e) { if (ativo.current) setErro(e.message || "Conferência indisponível. Nenhuma nova tentativa foi iniciada."); }
    finally { if (ativo.current) setConferindo(false); }
  }
  async function abrir(v, tipo) {
    setErro("");
    try {
      const blob = await api.fetchPgdasPdfBlob(companyId, competencia, tipo, v.id);
      if (!ativo.current) return;
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (ativo.current) setErro(e.message || "O arquivo não está disponível no armazenamento."); }
  }
  return <Modal titulo={`Histórico PGDAS-D · ${competencia}`} aoFechar={onClose} ocupado={conferindo} tamanho="lg">
    <div className="pgdas-historico">
      <p>Histórico dos registros recuperados pelo sistema. Versões anteriores que não foram preservadas não podem ser reconstruídas aqui. As datas indicam consulta ou registro, não transmissão.</p>
      <div className="pgdas-historico-acoes">
        <Button variant="secondary" onClick={carregar} disabled={loading || conferindo}>Atualizar histórico salvo</Button>
        <Button variant="secondary" onClick={conferir} disabled={loading || conferindo || bloqueado}>{conferindo ? "Conferindo…" : "Conferir retificação na Receita"}</Button>
      </div>
      <p>A conferência faz consultas fiscais pagas, exige procuração válida e respeita o bloqueio de mês fechado. Recupera somente documentos; não transmite, recalcula ou altera lançamentos.</p>
      {loading && <p role="status">Carregando registros salvos…</p>}
      {erro && <p role="alert">{erro}</p>}
      {aviso && <p role="status">{aviso}</p>}
      {historico && <>
        {historico.entregaSemTransmissaoInterna && <p className="pgdas-historico-alerta">Apuração comprovada na Receita, sem transmissão correspondente registrada na Altan. Pode ter sido apurada por fora. O estado interno permanece {historico.estadoInterno}.</p>}
        {historico.declaracaoDiferenteDaInterna && <p className="pgdas-historico-alerta">A declaração recuperada difere da transmissão registrada na Altan ({historico.numeroDeclaracaoInterna}). Confira os recibos; a diferença não determina qual transmissão é mais recente.</p>}
        <p>Última consulta: {data(historico.ultimaConsultaEm)} · {situacoes[historico.ultimaConsultaStatus] || "Sem situação confirmada"}</p>
        {historico.mudancaDetectada && <p className="pgdas-historico-alerta">Há números de declaração diferentes nos registros. Confira os PDFs e os valores antes de ajustar a apuração interna.</p>}
        {historico.limitado && <p role="alert">O histórico exibido está limitado a 500 versões.</p>}
        {!historico.versoes.length && <p>Nenhuma declaração registrada nesta competência.</p>}
        <ol>{historico.versoes.map(v => <li key={v.id}>
          <strong>Declaração {v.numeroDeclaracao}{v.atual ? " · Registro atual" : ""}</strong>
          <span>{v.legado ? "Registro preexistente" : "Versão recuperada"} · Consulta: {data(v.consultadaEm)}</span>
          <dl><div><dt>Receita bruta</dt><dd>{moeda(v.receitaBruta)}</dd></div><div><dt>Imposto apurado</dt><dd>{moeda(v.dasTotal)}</dd></div></dl>
          <div className="pgdas-historico-acoes">
            <Button variant="secondary" disabled={!v.temDeclaracao || conferindo} onClick={() => abrir(v, "declaracao")}>Declaração {v.numeroDeclaracao} (PDF)</Button>
            <Button variant="secondary" disabled={!v.temRecibo || conferindo} onClick={() => abrir(v, "recibo")}>Recibo {v.numeroDeclaracao} (PDF)</Button>
          </div>
        </li>)}</ol>
      </>}
    </div>
  </Modal>;
}
