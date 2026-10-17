import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import "./historicoPgdas.css";
const moeda = valor => valor == null ? "Não disponível" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const situacoes = { SUCCESS: "Consulta concluída", INCOMPLETE: "Documentos incompletos", ERROR: "Consulta com erro", NOT_FOUND: "Declaração não localizada", RUNNING: "Consulta em andamento" };
const data = valor => valor && !Number.isNaN(new Date(valor).getTime()) ? new Date(valor).toLocaleString("pt-BR") : "Data não registrada";
const mensagens = {
  unauthorized: "Entre novamente para continuar.",
  forbidden: "Você não tem acesso a esta empresa.",
  insufficient_role: "Seu perfil não permite consultar a Receita. Solicite a um contador ou administrador do escritório.",
  scope_required: "Seu acesso não inclui esta operação. Peça revisão das permissões.",
  MES_FECHADO: "O mês está fechado. Reabra antes de buscar o extrato de novo.",
  pdf_not_available: "O PDF não está disponível no armazenamento.",
  competencia_invalida: "A competência informada é inválida.",
  versao_ou_tipo_invalido: "A versão ou o tipo de documento é inválido.",
};
function mensagemErro(erro, padrao) {
  const codigo = erro?.code || erro?.reason || erro?.error || erro?.message;
  const mensagem = String(erro?.message || "").trim();
  if (mensagem && !mensagens[mensagem] && mensagem !== "O arquivo não está mais no armazenamento." && !/^[A-Z_]+$/.test(mensagem)) return mensagem;
  return mensagens[codigo] || padrao;
}

export function HistoricoPgdas({ api, companyId, competencia, onClose, onAtualizado, bloqueado = false }) {
  const [historico, setHistorico] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(true);
  const [conferindo, setConferindo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [abrindoPdf, setAbrindoPdf] = useState("");
  const [leituraFalhou, setLeituraFalhou] = useState(false);
  const ativo = useRef(true);
  const operacao = useRef(false);
  const pdfEmCurso = useRef(false);
  const conferirRef = useRef(null);
  const voltarRef = useRef(null);
  useEffect(() => { if (confirmando) voltarRef.current?.focus(); }, [confirmando]);
  function voltar() { setConfirmando(false); requestAnimationFrame(() => conferirRef.current?.focus()); }
  const carregar = useCallback(async () => {
    setLoading(true); setErro("");
    try {
      if (!api.getPgdasHistorico) throw Error("Histórico indisponível nesta conexão.");
      const result = await api.getPgdasHistorico(companyId, competencia);
      if (!result?.ok) throw result || Error("Não foi possível carregar o histórico.");
      if (ativo.current) { setHistorico(result); setLeituraFalhou(false); }
    } catch (e) { if (ativo.current) { setLeituraFalhou(true); setErro(mensagemErro(e, "Não foi possível carregar o histórico.")); } }
    finally { if (ativo.current) setLoading(false); }
  }, [api, companyId, competencia]);
  useEffect(() => { ativo.current = true; carregar(); return () => { ativo.current = false; }; }, [carregar]);
  async function conferir() {
    if (operacao.current || bloqueado || !confirmando) return;
    operacao.current = true;
    setConferindo(true); setErro(""); setAviso("");
    try {
      const r = await api.syncPgdasCircular(companyId, competencia, { somenteDocumentos: true, atualizar: true });
      if (!ativo.current) return;
      if (!r?.ok) throw r || Error("Não foi possível concluir a conferência.");
      const c = r.result?.circular;
      setAviso(c?.serproSyncStatus === "SUCCESS" && c.pgdasNumeroDeclaracao && c.pgdasDeclaracaoFileId && c.pgdasReciboFileId
        ? "Conferência concluída. Compare as versões registradas abaixo."
        : "Conferência sem documentação completa. O retorno não confirma ausência de entrega.");
      onAtualizado?.(r.result);
      await carregar();
    } catch (e) { if (ativo.current) setErro(mensagemErro(e, "Conferência indisponível. Nenhuma nova tentativa foi iniciada.")); }
    finally { operacao.current = false; if (ativo.current) { setConferindo(false); voltar(); } }
  }
  async function abrir(v, tipo) {
    if (pdfEmCurso.current) return;
    pdfEmCurso.current = true;
    setAbrindoPdf(`${v.id}:${tipo}`); setErro("");
    try {
      const blob = await api.fetchPgdasPdfBlob(companyId, competencia, tipo, v.id);
      if (!ativo.current) return;
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (ativo.current) setErro(mensagemErro(e, "O arquivo não está disponível no armazenamento.")); }
    finally { pdfEmCurso.current = false; if (ativo.current) setAbrindoPdf(""); }
  }
  return <Modal titulo={confirmando ? `Confirmar consulta na Receita · ${competencia}` : `Histórico PGDAS-D · ${competencia}`}
    aoFechar={confirmando ? voltar : onClose} ocupado={conferindo} tamanho="lg" className="pgdas-historico-modal"
    rodape={confirmando ? <><Button ref={voltarRef} variant="secondary" onClick={voltar} disabled={conferindo}>Voltar</Button><Button onClick={conferir} disabled={conferindo || bloqueado} aria-busy={conferindo}>{conferindo ? "Conferindo…" : "Confirmar consulta paga"}</Button></> : <Button variant="secondary" onClick={onClose}>Fechar</Button>}>
    <div className="pgdas-historico">
      {confirmando ? <section className="pgdas-historico-confirmacao">
        <h3>Conferir documentos de {competencia}</h3>
        <p>A consulta fiscal é paga e exige procuração válida. Mês fechado impede a consulta.</p>
        <p>Recupera somente documentos desta empresa e competência. Não transmite, recalcula ou altera lançamentos.</p>
        {conferindo && <p role="status">Consultando a Receita… Aguarde o retorno.</p>}
      </section> : <>
      <div className="pgdas-historico-acoes">
        <Button variant="secondary" onClick={carregar} disabled={loading || conferindo} aria-busy={loading}>{loading && historico ? "Atualizando…" : "Atualizar histórico"}</Button>
        <Button ref={conferirRef} variant="secondary" onClick={() => setConfirmando(true)} disabled={loading || conferindo || bloqueado || !historico}>Conferir na Receita</Button>
      </div>
      <p className="pgdas-historico-nota">Atualizar lê apenas registros salvos. Conferir na Receita é uma consulta paga.</p>
      {bloqueado && <p className="pgdas-historico-alerta">Conferência indisponível durante a operação atual ou enquanto o envio exigir conferência.</p>}
      {loading && <p role="status">Carregando registros salvos…</p>}
      {erro && <p role="alert">{erro}</p>}
      {leituraFalhou && historico && <p className="pgdas-historico-alerta">Exibindo o histórico carregado anteriormente; a atualização não foi concluída.</p>}
      {aviso && <p role="status">{aviso}</p>}
      {historico && <>
        {historico.entregaSemTransmissaoInterna && <p className="pgdas-historico-alerta">Apuração comprovada na Receita, sem transmissão correspondente registrada na Altan. Pode ter sido apurada por fora. O estado interno permanece {historico.estadoInterno}.</p>}
        {historico.declaracaoDiferenteDaInterna && <p className="pgdas-historico-alerta">A declaração recuperada difere da transmissão registrada na Altan ({historico.numeroDeclaracaoInterna}). Confira os recibos; a diferença não determina qual transmissão é mais recente.</p>}
        <p className="pgdas-historico-resumo">Última consulta: {data(historico.ultimaConsultaEm)} · {situacoes[historico.ultimaConsultaStatus] || "Sem situação confirmada"}</p>
        {historico.mudancaDetectada && <p className="pgdas-historico-alerta">Há números de declaração diferentes nos registros. Confira os PDFs e os valores antes de ajustar a apuração interna.</p>}
        {historico.limitado && <p role="alert">O histórico exibido está limitado a 500 versões.</p>}
        <p className="pgdas-historico-nota">Datas de consulta, não de transmissão. Versões não preservadas não podem ser reconstruídas.</p>
        {!historico.versoes.length && <p className="pgdas-historico-vazio">Nenhuma declaração registrada nesta competência. Isso não comprova ausência de entrega na Receita.</p>}
        <ol>{historico.versoes.map((v, indice) => <li key={v.id}>
          <strong>Declaração {v.numeroDeclaracao}{v.atual ? " · Registro atual" : ""}</strong>
          <span>{v.legado ? "Registro preexistente" : "Versão recuperada"} · Consulta: {data(v.consultadaEm)}</span>
          <dl><div><dt>Receita bruta</dt><dd>{moeda(v.receitaBruta)}</dd></div><div><dt>Imposto apurado</dt><dd>{moeda(v.dasTotal)}</dd></div></dl>
          <div className="pgdas-historico-acoes">
            <Button variant="secondary" aria-label={`Declaração PDF ${v.numeroDeclaracao}, versão ${indice + 1}`} aria-busy={abrindoPdf === `${v.id}:declaracao`} disabled={!v.temDeclaracao || conferindo || !!abrindoPdf} onClick={() => abrir(v, "declaracao")}>{abrindoPdf === `${v.id}:declaracao` ? "Abrindo…" : "Declaração"}</Button>
            <Button variant="secondary" aria-label={`Recibo PDF ${v.numeroDeclaracao}, versão ${indice + 1}`} aria-busy={abrindoPdf === `${v.id}:recibo`} disabled={!v.temRecibo || conferindo || !!abrindoPdf} onClick={() => abrir(v, "recibo")}>{abrindoPdf === `${v.id}:recibo` ? "Abrindo…" : "Recibo"}</Button>
          </div>
        </li>)}</ol>
      </>}
      </>}
    </div>
  </Modal>;
}
