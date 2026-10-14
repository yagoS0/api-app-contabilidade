import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";

const ESTADOS_PAGAMENTO = {
  paid: "Pagamento confirmado via SERPRO", open: "Pagamento não localizado",
  NAO_LOCALIZADO: "Pagamento não localizado", DIVERGENTE: "Pagamento divergente — conferir",
  already_paid: "Confirmação já registrada — sem nova consulta",
  sem_numero_documento: "Sem número do documento — consulta não realizada",
  sem_vencimento_confirmado: "Sem vencimento confirmado — consulta não realizada",
  ainda_nao_vencida: "Ainda não vencida — consulta não realizada",
  conferencia_manual: "Aguardando conferência manual",
};
const MOTIVOS = {
  lock_active: "Outra execução já está em andamento. Nenhuma nova execução foi iniciada.",
  serpro_disabled: "Integração SERPRO desativada. A consulta não foi realizada.",
  integration_disabled: "Integração desativada. A consulta não foi realizada.",
  SERPRO_PAGTOWEB_CONSULTA_NAO_CONCLUIDA: "Consulta sem conclusão. Este registro antigo não guardou o motivo detalhado; não significa que a guia não foi paga.",
};
const texto = valor => MOTIVOS[valor] || ESTADOS_PAGAMENTO[valor] || (typeof valor === "string" ? valor : "");
function dataExecucao(run) {
  const data = new Date(run.finishedAt || run.startedAt || "");
  return Number.isNaN(data.getTime()) ? "Data não informada" : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function ItemResultado({ item, indice }) {
  const motivo = item.diagnostico?.mensagem || item.mensagem || item.message || texto(item.reason) || texto(item.error) || texto(item.status) || texto(item.skipped) || (item.ok === false ? "Não concluído" : "Retorno disponível");
  return <section className="rotinas-resultado-item">
    <h4>{item.razao || item.companyName || item.companyId || item.guideId || item.parcelaId || `Consulta ${indice + 1}`}</h4>
    {(item.competencia || item.tipo) && <p className="text-muted">{[item.tipo, item.competencia].filter(Boolean).join(" · ")}</p>}
    <p>{motivo}</p>
    {item.diagnostico && (item.diagnostico.httpStatus || item.diagnostico.codigoSerpro) && <p className="text-muted">{[item.diagnostico.httpStatus && `HTTP ${item.diagnostico.httpStatus}`, item.diagnostico.codigoSerpro].filter(Boolean).join(" · ")}</p>}
    {item.aviso && <p>{item.aviso.status === "ENVIADO" ? "Aviso enviado ao cliente." : item.aviso.status === "JA_ENVIADO" ? "Cliente já avisado; sem novo envio." : item.aviso.status === "IGNORADO" ? "Aviso não enviado: pagamento ou confirmação precisa ser conferido." : "Aviso pendente para o contador; nenhuma nova consulta à Receita será feita automaticamente."}</p>}
    {item.aviso?.mensagem && <p>{item.aviso.mensagem}</p>}
    {(item.aviso?.resultados || []).filter(r => r.mensagem && !["ENVIADO", "JA_ENVIADO"].includes(r.status)).map((r, j) => <p key={j}>{r.mensagem}</p>)}
    {(Array.isArray(item.parcelas) ? item.parcelas : []).map((parcela, j) => <p key={j}>Parcela {parcela.anoMes || parcela.anoMesParcela || parcela.numeroParcela || "consultada"}: {texto(parcela.reason) || texto(parcela.error) || texto(parcela.status)}</p>)}
  </section>;
}
function GrupoResultado({ resultado, titulo }) {
  if (!resultado || typeof resultado !== "object") return null;
  const dados = resultado.summary && typeof resultado.summary === "object" ? { ...resultado, ...resultado.summary } : resultado;
  const itens = [...(Array.isArray(dados.results) ? dados.results : []), ...(Array.isArray(dados.extratoResults) ? dados.extratoResults : []), ...(Array.isArray(dados.parcelaResults) ? dados.parcelaResults : [])];
  const parcelas = dados.parcelas && !Array.isArray(dados.parcelas) ? dados.parcelas : null;
  const metricas = [["totalCompanies", "Empresas"], ["captured", "Capturas"], ["failed", "Falhas"], ["total", "Total"], ["paid", "Pagamentos confirmados"], ["open", "Pagamentos não localizados"], ["errors", "Erros"]].filter(([chave]) => typeof dados[chave] === "number");
  const mensagem = dados.mensagem || dados.message || texto(dados.error) || texto(dados.reason);
  return <section className="rotinas-resultado-grupo">
    {titulo && <h3>{titulo}</h3>}
    {dados.ok === false && <p>Execução com falha.</p>}
    {mensagem && <p>{mensagem}</p>}
    {dados.firstError && dados.firstError !== dados.error && dados.firstError !== mensagem && <p>{texto(dados.firstError) || dados.firstError?.message || dados.firstError?.mensagem}</p>}
    {dados.skipped && !mensagem && <p>Execução não realizada. {texto(dados.skipped)}</p>}
    {dados.serproSkipped && <p>{texto(dados.serproSkipped)}</p>}
    {metricas.length > 0 && <dl className="rotinas-resultados-resumo">{metricas.map(([chave, label]) => <div key={chave}><dt>{label}</dt><dd>{dados[chave]}</dd></div>)}</dl>}
    {dados.divergentes > 0 && <p>{dados.divergentes} empresa(s) com divergência fiscal para conferir.</p>}
    {dados.avisosEnviados > 0 && <p>{dados.avisosEnviados} aviso(s) de pagamento enviado(s).</p>}
    {dados.avisosPendentes > 0 && <p>{dados.avisosPendentes} aviso(s) aguardam ação do contador. Confira o canal e o destinatário.</p>}
    {itens.map((item, i) => <ItemResultado key={`${item.companyId || item.guideId || "item"}-${i}`} item={item} indice={i} />)}
    {parcelas && <GrupoResultado resultado={parcelas} titulo="Parcelas" />}
    {Array.isArray(dados.parcelas) && dados.parcelas.map((item, i) => <ItemResultado key={`parcela-${i}`} item={item} indice={i} />)}
  </section>;
}
export function ResultadoRotinaModal({ row, titulo, onClose }) {
  if (!row?.lastRun) return null;
  const run = row.lastRun;
  const resultado = run.result || {};
  const captura = row.manual && (resultado.pgdasd || resultado.dctfweb);
  return <Modal titulo={`Resultado — ${titulo}`} tamanho="lg" className="rotinas-resultado-modal" aoFechar={onClose} fecharAoClicarFundo={false} rodape={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
    <p className="text-muted">{row.manual ? "Execução manual" : "Execução programada"} · {dataExecucao(run)}</p>
    <p>{row.interrupted ? "Execução interrompida" : run.status === "SUCCEEDED" ? "Concluída" : run.status === "FAILED" ? "Execução com pendências" : run.status === "RUNNING" ? "Em execução" : "Retorno recebido"}</p>
    {run.error && <p>{texto(run.error)}</p>}
    {captura ? <><GrupoResultado resultado={resultado.pgdasd} titulo="DAS e extratos" /><GrupoResultado resultado={resultado.dctfweb} titulo="INSS" /></> : <GrupoResultado resultado={resultado} />}
    {!Object.keys(resultado).length && <p>Esta execução não disponibilizou detalhes do resultado.</p>}
    <p className="text-muted">Sem nova tentativa automática. Resultado incerto exige conferência antes de repetir e pode ter gerado custo.</p>
    <details><summary>Detalhes técnicos</summary><pre className="rotinas-dados-tecnicos">{JSON.stringify({ error: run.error, result: resultado }, null, 2)}</pre></details>
  </Modal>;
}
