import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { baixarRelatorioMonitoramento } from "./relatorioMonitoramento";

export function AlertasMonitoramento({ items, competencia, onOpenCompany }) {
  const [erroExportacao, setErroExportacao] = useState("");
  const [categoria, setCategoria] = useState("todos");
  const alertas = items.flatMap(item => (item.alertasFiscais || []).map(alerta => ({ ...alerta, empresa: item.razao, cnpj: item.cnpj, estado: item.estado, numeroDeclaracao: item.entregaPgdas?.numeroDeclaracaoRfb, portalClientId: item.portalClientId })));
  const exibidos = alertas.filter(a => categoria === "todos" || a.categoria === categoria);
  const monitorado = items.length > 0 && items.every(item => Array.isArray(item.alertasFiscais));
  if (items.some(item => item.monitoramentoErro)) return <p role="alert" className="apuracao-alertas-erro">Não foi possível carregar os alertas do monitoramento. Atualize a lista para tentar novamente. A apuração continua disponível.</p>;
  if (!monitorado) return null;
  return <details className="apuracao-alertas">
    <summary>Alertas do monitoramento · {alertas.length}</summary>
    <p>Competência {competencia}. Registros locais; abrir ou atualizar esta lista não consulta o SERPRO. Pendência de comprovação não significa declaração atrasada.</p>
    {alertas.length > 0 ? <>
      <div className="apuracao-alertas-acoes"><label>Mostrar alertas <select value={categoria} onChange={e => setCategoria(e.target.value)}>
        <option value="todos">Todos ({alertas.length})</option>
        <option value="procuracao">Procurações ({alertas.filter(a => a.categoria === "procuracao").length})</option>
        <option value="declaracao">Declarações ({alertas.filter(a => a.categoria === "declaracao").length})</option>
        <option value="documentos">Documentos ({alertas.filter(a => a.categoria === "documentos").length})</option>
      </select></label>
      <Button variant="secondary" disabled={!exibidos.length} onClick={() => {
        setErroExportacao("");
        try { baixarRelatorioMonitoramento(exibidos, competencia); }
        catch { setErroExportacao("Não foi possível baixar o relatório. Tente novamente."); }
      }}>Baixar pendências (CSV)</Button></div>
      <p>{exibidos.length} alerta(s) em {new Set(exibidos.map(a => a.portalClientId)).size} empresa(s). O relatório respeita a busca de empresas e a categoria selecionada.</p>
      {erroExportacao && <p role="alert">{erroExportacao}</p>}
      <ul>{exibidos.map(alerta => <li key={alerta.id}>
        <button type="button" className="apuracao-lista-empresa" onClick={() => onOpenCompany?.(alerta.portalClientId)}>{alerta.empresa}</button>
        <strong>{alerta.titulo}</strong><span>{alerta.detalhe}</span>
      </li>)}</ul>
      {exibidos.length === 0 && <p>Nenhum alerta nesta categoria.</p>}
    </> : <p>Nenhum alerta nos registros exibidos. Isso não substitui a conferência fiscal.</p>}
  </details>;
}
