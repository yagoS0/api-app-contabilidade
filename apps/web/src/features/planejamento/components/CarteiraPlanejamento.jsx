import { useEffect, useState } from "react";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
import { carregarCarteira, resumirCenario, nomeCenario, dataCenario, moedaCenario } from "../lib/cenariosSalvos";

function PainelCarteira({ api, empresas, onAbrirEmpresa }) {
  const [rodada, setRodada] = useState(0);
  const [estado, setEstado] = useState({ itens: [], total: 0, carregando: true });
  const [filtro, setFiltro] = useState("todos");
  const escopo = JSON.stringify(empresas.map(e => [e.companyId || e.id, e.razao]));
  useEffect(() => {
    let cancelado = false;
    setEstado({ itens: [], total: new Set(empresas.map(e => e.companyId || e.id).filter(Boolean)).size, carregando: true });
    carregarCarteira({ empresas, api, cancelado: () => cancelado,
      progresso: (itens, total) => { if (!cancelado) setEstado({ itens, total, carregando: true }); },
    }).then(itens => { if (!cancelado) setEstado({ itens, total: itens.length, carregando: false }); });
    return () => { cancelado = true; };
  }, [api, escopo, rodada]);
  const itens = estado.itens.map(item => ({ ...item, resumo: item.erro ? { estado: "erro", rotulo: "Não foi possível consultar" } : resumirCenario(item.cenario) }))
    .sort((a, b) => (a.empresa.razao || "").localeCompare(b.empresa.razao || "", "pt-BR"));
  const visiveis = itens.filter(i => filtro === "todos" || i.resumo.estado === filtro);
  return <div className="planejamento-cenarios">
    <p>Último cenário salvo de cada empresa da carteira disponível nesta sessão. Valores históricos, sujeitos à conferência do contador; não consultam APIs fiscais.</p>
    <div className="planejamento-carteira-controles">
      <label>Mostrar <select value={filtro} onChange={e => setFiltro(e.target.value)}>
        <option value="todos">Todas as empresas</option><option value="oportunidade">Potencial de redução</option><option value="parcial">Revisar cobertura</option>
        <option value="revisar">Revisão pendente</option><option value="sem_base">Sem regime atual</option><option value="sem_reducao">Sem redução estimada</option>
        <option value="sem_cenario">Sem cenário</option><option value="erro">Falha na consulta</option>
      </select></label>
      <button className="btn" type="button" disabled={estado.carregando} onClick={() => setRodada(v => v + 1)}>Atualizar carteira</button>
      <span role="status">{estado.carregando ? `Consultando ${estado.itens.length} de ${estado.total} empresas…` : `${estado.total} empresas consultadas · ${itens.filter(i => i.resumo.estado === "oportunidade").length} com potencial no cenário salvo · ${itens.filter(i => i.erro).length} falhas`}</span>
    </div>
    {!visiveis.length && !estado.carregando && <p>Nenhuma empresa neste filtro.</p>}
    {!!visiveis.length && <div className="planejamento-tabela-scroll"><table>
      <caption>Planejamento da carteira</caption><thead><tr><th>Empresa</th><th>Cenário / referência</th><th>Situação</th><th>Diferença anual estimada</th><th>Abrir</th></tr></thead>
      <tbody>{visiveis.map(item => <tr key={item.id}>
        <th scope="row">{item.empresa.razao || "Empresa"}</th>
        <td>{item.cenario ? <>{nomeCenario(item.cenario)}<small>{dataCenario(item.cenario)} · {item.cenario.competencia || "Sem competência"}</small><small>Ano-base: {item.cenario.resultado?.anoBase || "Não informado"}</small></> : "—"}</td>
        <td>{item.resumo.rotulo}{item.resumo.revisao && <small>Revisão: {item.resumo.revisao}</small>}</td>
        <td>{item.resumo.economia == null ? "Não indicada" : <>{moedaCenario(item.resumo.economia)}<small>{item.resumo.atual} → {item.resumo.menor}</small></>}</td>
        <td>{onAbrirEmpresa && <button type="button" className="btn" onClick={() => onAbrirEmpresa(item.id)}>Planejamento de {item.empresa.razao || "empresa"}</button>}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
export function CarteiraPlanejamento(props) {
  if (!props.api?.listarSimulacoesPlanejamento || !props.empresas?.length) return null;
  return <SecaoPlanejamento titulo="Visão da carteira"><PainelCarteira {...props} /></SecaoPlanejamento>;
}
