import { ANEXOS } from "../lib/tabelasFiscais";

const brl = n => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cell = { padding: "9px 12px", borderBottom: "1px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" };

export function TabelaAnexos({ rbt12 }) {
  return <details style={{ minWidth: 0, border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
    <summary>Tabela dos anexos do Simples Nacional</summary>
    <p>Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12. A faixa destacada usa o RBT12 do cenário; o anexo depende da atividade.</p>
    {Object.entries(ANEXOS).map(([key, anexo]) => <div key={key} style={{ overflowX: "auto", marginTop: 16 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <caption style={{ textAlign: "left", padding: "8px 0", fontWeight: 600 }}>{anexo.nome}</caption>
        <thead><tr>{["Faixa", "RBT12 de", "RBT12 até", "Alíquota nominal", "Parcela a deduzir"].map(t => <th key={t} scope="col" style={cell}>{t}</th>)}</tr></thead>
        <tbody>{anexo.faixas.map(f => <tr key={f.faixa} style={{ background: rbt12 > 0 && rbt12 >= f.de && rbt12 <= f.ate ? "var(--bg-subtle)" : undefined }}>
          <th scope="row" style={cell}>{f.faixa}ª</th><td style={cell}>{brl(f.de)}</td><td style={cell}>{brl(f.ate)}</td><td style={cell}>{(f.aliquota * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%</td><td style={cell}>{brl(f.pd)}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
    <p>CPP do Anexo IV e tributos fora do DAS exigem cálculo próprio. As tabelas não substituem a análise de elegibilidade ou dos sublimites.</p>
  </details>;
}
