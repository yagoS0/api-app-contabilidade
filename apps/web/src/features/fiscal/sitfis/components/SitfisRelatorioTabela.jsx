// Tabela do relatório SITFIS — a leitura do dia a dia. O PDF oficial fica ao lado, opcional.
//
// A tabela NUNCA some. Quando o parser não reconhece uma seção, a linha do órgão continua na tela
// com o aviso de que não foi possível ler — porque sumir passaria a impressão de "nada consta",
// que é o oposto do que sabemos. O que ela não faz é inventar valor: o parser
// (`parseSitfisRelatorio.js`) organiza o texto, não deduz números.

const COR = { texto: "#F8F8F2", suave: "#A7B0C0", borda: "#44475A", ok: "#69FF47", alerta: "#FFB347", erro: "#FF5555" };

const th = { padding: "8px 6px", textAlign: "left", color: COR.suave, fontWeight: 600 };
const td = { padding: "8px 6px", verticalAlign: "top" };

function LinhaOrgao({ orgao, assunto, situacao, cor, primeira }) {
  return (
    <tr style={{ borderTop: `1px solid ${COR.borda}` }}>
      <td style={{ ...td, color: COR.texto, fontWeight: primeira ? 600 : 400 }}>{primeira ? orgao : ""}</td>
      <td style={{ ...td, color: COR.suave }}>{assunto || "—"}</td>
      <td style={{ ...td, color: cor }}>{situacao}</td>
    </tr>
  );
}

export function SitfisRelatorioTabela({ relatorio }) {
  if (!relatorio) return null;
  const { diagnosticos = [], naoInterpretado = [] } = relatorio;

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "30%" }}>ÓRGÃO</th>
            <th style={{ ...th, width: "32%" }}>ASSUNTO</th>
            <th style={th}>SITUAÇÃO</th>
          </tr>
        </thead>
        <tbody>
          {diagnosticos.map((d) => {
            if (d.semPendencia) {
              return (
                <LinhaOrgao key={d.chave} primeira orgao={d.orgao} assunto={null}
                  situacao="Nada consta" cor={COR.ok} />
              );
            }
            if (!d.itens?.length) {
              // Seção existe no relatório, mas nenhuma linha foi reconhecida. Fica visível.
              return (
                <LinhaOrgao key={d.chave} primeira orgao={d.orgao} assunto={null}
                  situacao="Não foi possível ler esta seção — confira no PDF oficial" cor={COR.erro} />
              );
            }
            return d.itens.map((it, i) => (
              <LinhaOrgao
                key={`${d.chave}-${i}`}
                primeira={i === 0}
                orgao={d.orgao}
                assunto={it.titulo}
                situacao={it.descricao}
                cor={COR.alerta}
              />
            ));
          })}
        </tbody>
      </table>

      {naoInterpretado.length > 0 && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(255,85,85,0.10)", border: `1px solid ${COR.erro}`, color: COR.erro, fontSize: "0.8rem" }}>
          {naoInterpretado.join(" · ")} — confira no PDF oficial.
        </div>
      )}
    </>
  );
}
