import { useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { dinheiro, dataCivil } from "../lib/conferenciaTela";

export function ModalLancarSelecionados({ linhas, aoEnviar, aoFechar }) {
  const [ocupado, setOcupado] = useState(false);
  const [resultados, setResultados] = useState({});
  const iniciou = useRef(false);
  const total = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  async function enviar() {
    if (iniciou.current) return;
    iniciou.current = true;
    setOcupado(true);
    for (const linha of linhas) {
      let timer;
      try {
        await Promise.race([
          aoEnviar(linha.id, linha.corpo),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("A resposta não chegou. Atualize a fila antes de tentar novamente.")), 45000); }),
        ]);
        setResultados(r => ({ ...r, [linha.id]: "Lançado" }));
      } catch (e) {
        setResultados(r => ({ ...r, [linha.id]: e?.message || "Não foi possível confirmar. Atualize a fila antes de tentar novamente." }));
      } finally { clearTimeout(timer); }
    }
    setOcupado(false);
  }
  return <Modal titulo="Lançar selecionados" tamanho="lg" ocupado={ocupado}
    aoFechar={() => aoFechar(iniciou.current)} rodape={<>
      <Button variant="secondary" disabled={ocupado} onClick={() => aoFechar(iniciou.current)}>{iniciou.current ? "Fechar e atualizar" : "Voltar à conferência"}</Button>
      {!iniciou.current && <Button onClick={enviar} disabled={ocupado}>Confirmar {linhas.length} lançamento(s)</Button>}
    </>}>
    <p>{linhas.length} lançamento(s) · <strong>{dinheiro(total)}</strong>. Confira as contas e datas antes de confirmar.</p>
    {linhas.some(l => l.corpo.dataPagamento) && <p>As datas informadas pelo contador são declarações de pagamento, não comprovantes.</p>}
    <div style={{ overflowX: "auto" }}><table className="tabela--densa"><thead><tr><th>Despesa</th><th>Pagamento</th><th>Débito</th><th>Crédito</th><th>Valor</th><th>Resultado</th></tr></thead>
      <tbody>{linhas.map(l => <tr key={l.id}><td>{l.descricao}</td><td>{dataCivil(l.data)}</td><td>{l.debito}</td><td>{l.credito || "Caixa padrão"}</td><td>{dinheiro(l.valor)}</td><td role="status">{resultados[l.id] || (ocupado ? "Aguardando" : "Pronto")}</td></tr>)}</tbody>
    </table></div>
  </Modal>;
}
