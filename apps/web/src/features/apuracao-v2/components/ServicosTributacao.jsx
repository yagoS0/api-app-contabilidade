import { useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
import { EditorPerfilEmissao } from "../../companies/detail/components/EditorPerfilEmissao";
import { Button } from "../../../components/ui/Button";

const apiPadrao = createApiClient();

export function ServicosTributacao({ companyId, podeEditar = false, api = apiPadrao }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [revisao, setRevisao] = useState(0);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    let ativo = true;
    setDados(null); setErro("");
    if (companyId) api.getPerfisEmissao(companyId).then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e?.message || "Não foi possível ler os perfis de serviço."); });
    return () => { ativo = false; };
  }, [api, companyId, revisao]);
  async function salvar(id, corpo) {
    setSalvando(true);
    try {
      if (id) await api.salvarPerfilEmissao(companyId, id, corpo);
      else await api.criarPerfilEmissao(companyId, corpo);
      setRevisao((v) => v + 1);
    } finally { setSalvando(false); }
  }
  if (!companyId) return null;
  return <section aria-label="Serviços e tributação da emissão">
    <h2>Serviços e tributação da emissão</h2>
    <p>Os mesmos perfis usados na configuração de emissão. Cada serviço pode ter tributação própria; salvar aqui atualiza esse cadastro único.</p>
    {erro ? <p role="alert">{erro} <Button onClick={() => setRevisao((v) => v + 1)}>Tentar novamente</Button></p>
      : !dados ? <p role="status">Carregando perfis…</p> : <>
        <p>{dados.integracaoLigada === true ? "Perfis integrados à emissão. Confira o perfil escolhido na prévia de cada nota." : "Perfis sem integração ativa na emissão: cadastrar aqui ainda não altera o XML da nota."}</p>
        {!dados.perfis?.length && <p>Nenhum perfil por serviço cadastrado.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
          {(dados.perfis || []).map((p) => <article key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>{p.nome}</h3>
            <p>{p.ativo === false ? "Inativo" : "Ativo"}{p.padrao ? " · Padrão" : ""}</p>
            <dl><dt>Tributação nacional (cTribNac)</dt><dd>{p.codigoServicoNacional || "Não informado"}</dd>
              <dt>Complemento municipal (cTribMun)</dt><dd>{p.codigoServicoMunicipal || "Não informado"}</dd>
              <dt>NBS</dt><dd>{p.codigoNbs || "Não informado"}</dd>
              <dt>Município da prestação</dt><dd>{p.cLocPrestacao || "Definido na operação"}</dd></dl>
          </article>)}
        </div>
        <EditorPerfilEmissao key={companyId} dados={dados} podeEditar={podeEditar} salvando={salvando} onSalvar={salvar} />
      </>}
  </section>;
}
