import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";

export function ImportacaoNotasModal({ andamento, resultado, ocupado, aoFechar }) {
  if (!andamento) return null;
  const { progresso: p = {}, empresa, type, mock } = andamento;
  const total = p.totalLotes || 1;
  const concluidos = p.lotesConcluidos || 0;
  const percentual = Math.floor(concluidos / total * 100);
  const titulo = ocupado ? "Importando notas" : p.etapa === "interrompida" || resultado?.falhou ? "Importação precisa de atenção" : resultado?.quantidadeProblemas > 0 ? "Importação concluída com pendências" : "Importação concluída";
  const totais = p.totais || {};
  return <Modal titulo={titulo} tamanho="md" ocupado={ocupado} aoFechar={aoFechar}
    rodape={ocupado ? <span style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>Aguarde a conclusão para sair desta tela.</span> : <Button onClick={aoFechar}>Concluir</Button>}>
    <p style={{ marginTop: 0, overflowWrap: "anywhere" }}><strong>{empresa}</strong> · {type === "NFE" ? "NF-e · venda e compra" : "NFS-e · serviços"}</p>
    {mock && <p style={{ color: "var(--state-warn)" }}>Demonstração: nenhuma nota será gravada.</p>}
    <div aria-live="polite" aria-atomic="true">
      {ocupado && <p>{p.etapa === "preparando" ? "Preparando os arquivos…" : p.etapa === "concluida" ? "Atualizando a lista de notas…" : `Enviando e processando lote ${p.loteAtual || 1} de ${total}…`}</p>}
      <progress aria-label="Lotes de importação concluídos" value={concluidos} max={total} style={{ width: "100%", height: 14, accentColor: "var(--accent-purple)" }} />
      <p style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>{percentual}% · {concluidos} de {total} lotes concluídos · {p.arquivosConcluidos || 0} de {p.totalArquivos || 0} arquivos processados</p>
    </div>
    {andamento.temZip && <p style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>Cada ZIP conta como um arquivo. As notas dentro dele serão contabilizadas após o processamento.</p>}
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, margin: "20px 0" }}>
      {[["Novas", totais.novas], ["Atualizadas", totais.atualizadas], ["Duplicadas", totais.duplicadas], ["Não importadas", totais.recusadas]].map(([rotulo, valor]) => <div key={rotulo} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}><dt style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>{rotulo}</dt><dd style={{ margin: "4px 0 0", fontSize: "1.3rem", fontWeight: 700 }}>{valor || 0}</dd></div>)}
    </dl>
    {resultado && <div role={resultado.falhou || resultado.quantidadeProblemas > 0 ? "alert" : "status"}>
      <p>{resultado.mensagem}</p>
      {!!resultado.problemas?.length && <details><summary>Ver arquivos com pendências ({resultado.problemas.length})</summary><ul style={{ paddingLeft: 20, overflowWrap: "anywhere" }}>{resultado.problemas.map((problema, i) => <li key={i}><strong>{problema.arquivo || "Arquivo"}:</strong> {problema.mensagem}</li>)}</ul></details>}
      {resultado.detalhesTruncados && <p>Os totais incluem todo o lote; os detalhes mostram apenas parte dos arquivos.</p>}
    </div>}
  </Modal>;
}
