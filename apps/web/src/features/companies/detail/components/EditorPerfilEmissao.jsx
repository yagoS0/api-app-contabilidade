import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { CAMPOS_PERFIL_EMISSAO } from "../../../../lib/nfse/perfilEmissao";

const GRUPOS = [
  ["Serviço e local", ["codigoServicoNacional", "codigoServicoMunicipal", "cLocPrestacao", "codigoNbs"]],
  ["Tributação municipal e Simples", ["regEspTrib", "regApTribSN", "tribISSQN", "tpImunidade", "exigSuspTipo", "exigSuspProcesso", "pAliq"]],
  ["Tributação federal", ["retencaoFederalArt30", "cstPisCofins"]],
  ["IBS e CBS", ["ibscbsCIndOp", "ibscbsCst", "ibscbsCClassTrib"]],
];
const OPCOES = {
  exigSuspTipo: { 1: "Decisão judicial", 2: "Processo administrativo" },
  regApTribSN: { 1: "Tributos federais e municipal pelo Simples", 2: "Federais pelo Simples; ISSQN fora", 3: "Federais e municipal fora do Simples" },
  tribISSQN: { 1: "Operação tributável", 2: "Imunidade", 3: "Exportação", 4: "Não incidência" },
  retencaoFederalArt30: { true: "Sim", false: "Não" },
};

export function corpoDoPerfil(form, campos) {
  const corpo = { nome: form.nome?.trim(), ativo: form.ativo !== false, padrao: form.ativo !== false && form.padrao === true };
  for (const { id } of campos) {
    const valor = form[id];
    corpo[id] = valor == null || valor === "" ? null
      : id === "retencaoFederalArt30" ? String(valor) === "true"
        : id === "pAliq" ? String(valor).replace(",", ".") : String(valor).trim();
  }
  return corpo;
}

export function EditorPerfilEmissao({ dados, onSalvar, podeEditar, salvando }) {
  const [form, setForm] = useState(null);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const campos = dados?.campos || CAMPOS_PERFIL_EMISSAO;
  const servico = dados?.sugestoes?.porServico?.find((s) => s.codigo === form?.codigoServicoNacional);
  const mudar = (id, valor) => setForm((anterior) => ({ ...anterior, [id]: valor }));
  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSucesso("");
    try {
      await onSalvar(form.id || null, corpoDoPerfil(form, campos));
      setForm(null); setSucesso("Perfil de emissão salvo.");
    } catch (err) {
      const detalhes = err?.payload?.erros?.map((e) => e.motivo).filter(Boolean).join(" ");
      setErro(detalhes || err?.message || "Não foi possível salvar o perfil.");
    }
  }
  if (!dados || !podeEditar) return null;
  return <section className="company-form-page__panel" aria-label="Editar perfis de emissão">
    <h2>Perfis por serviço</h2>
    <p>Cadastre a tributação recorrente de cada serviço. Valores da nota, tomador e retenção do ISS são conferidos em cada emissão. A alíquota efetiva do Simples continua vinculada à competência.</p>
    {sucesso && <p role="status">{sucesso}</p>}
    {!form ? <>
      <Button type="button" onClick={() => { setErro(""); setSucesso(""); setForm({ ...dados.derivadoDoCadastro, nome: "", ativo: true, padrao: false }); }}>Novo perfil</Button>
      <ul>{(dados.perfis || []).map((p) => <li key={p.id}>
        {p.nome} {p.padrao ? "· Padrão" : ""} {p.ativo === false ? "· Inativo" : ""}{" "}
        <Button type="button" onClick={() => { setErro(""); setSucesso(""); setForm({ ...p }); }}>Editar {p.nome}</Button>
      </li>)}</ul>
    </> : <form onSubmit={salvar}>
      <fieldset disabled={salvando} style={{ border: 0, padding: 0 }}>
        <legend>{form.id ? "Editar perfil" : "Novo perfil de emissão"}</legend>
        <label>Nome do perfil<input required maxLength={60} value={form.nome || ""} onChange={(e) => mudar("nome", e.target.value)} /></label>
        <label><input type="checkbox" checked={form.ativo !== false} onChange={(e) => mudar("ativo", e.target.checked)} />Perfil ativo</label>
        <label><input type="checkbox" disabled={form.ativo === false} checked={form.padrao === true && form.ativo !== false} onChange={(e) => mudar("padrao", e.target.checked)} />Usar como padrão</label>
        {GRUPOS.map(([titulo, ids]) => <fieldset key={titulo} className="form-grid two-col" style={{ marginTop: 16 }}>
          <legend>{titulo}</legend>
          {ids.map((id) => {
            const c = campos.find((v) => v.id === id);
            if (!c) return null;
            return <div key={id}>
              <label htmlFor={`perfil-${id}`}>{c.rotulo}</label>
              {id === "codigoServicoNacional" && dados.sugestoes?.porServico?.length ?
                <select id={`perfil-${id}`} required value={form[id] ?? ""} onChange={(e) => mudar(id, e.target.value)}>
                  <option value="">Selecione o serviço</option>
                  {dados.sugestoes.porServico.map((s) => <option key={s.codigo} value={s.codigo}>{s.codigo} — {s.descricao || "Serviço habilitado na empresa"}</option>)}
                </select> : c.valores ?
                <select id={`perfil-${id}`} value={String(form[id] ?? "")} onChange={(e) => mudar(id, e.target.value)}>
                  <option value="">Não configurado</option>
                  {c.valores.map((v) => <option key={v} value={v}>{OPCOES[id]?.[v] || v}</option>)}
                </select> : <input id={`perfil-${id}`} required={c.obrigatorio} value={form[id] ?? ""} onChange={(e) => mudar(id, e.target.value)} />}
              <small style={{ display: "block" }}>{c.formaDescrita}</small>
              {id === "codigoServicoMunicipal" && <small>Confirme o complemento na tabela do município; ele não é inferido do código nacional.</small>}
            </div>;
          })}
          {titulo === "Serviço e local" && <div className="full">
            <label htmlFor="perfil-sugestao-nbs">Sugestões de NBS para o serviço</label>
            <select id="perfil-sugestao-nbs" value="" onChange={(e) => { if (e.target.value) mudar("codigoNbs", e.target.value); }}>
              <option value="">Escolha para preencher o item NBS</option>
              {(servico?.nbs || []).map((n) => <option key={n.codigo} value={n.codigo}>{n.codigo} — {n.descricao || "Sem descrição na fonte"}</option>)}
            </select>
            {!servico?.nbs?.length && <p>Não há sugestão disponível para este serviço. Confirme o código na tabela oficial.</p>}
          </div>}
          {titulo === "IBS e CBS" && <div className="full">
            <label htmlFor="perfil-sugestao-ibs">Combinações de operação e classificação</label>
            <select id="perfil-sugestao-ibs" value="" onChange={(e) => {
              const opcao = servico?.combinacoes?.find((c) => `${c.cIndOp}:${c.cClassTrib}` === e.target.value);
              if (opcao) setForm((p) => ({ ...p, ibscbsCIndOp: opcao.cIndOp, ibscbsCClassTrib: opcao.cClassTrib }));
            }}>
              <option value="">Escolha conforme a operação e o tomador</option>
              {(servico?.combinacoes || []).map((c) => <option key={`${c.cIndOp}:${c.cClassTrib}`} value={`${c.cIndOp}:${c.cClassTrib}`}>
                {c.cIndOp} / {c.cClassTrib} — {c.nomeClassTrib} · {c.localIncidencia}
              </option>)}
            </select>
            <p>O CST deve ser confirmado pelo contador. A seleção acima preenche somente o indicador e a classificação.</p>
          </div>}
        </fieldset>)}
        {dados.sugestoes && <p>Fonte das sugestões: <a href={dados.sugestoes.url} target="_blank" rel="noreferrer">{dados.sugestoes.fonte}</a>. Selecione apenas opções aplicáveis à empresa.</p>}
        {erro && <p role="alert">{erro}</p>}
        <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar perfil"}</Button>{" "}
        <Button type="button" onClick={() => setForm(null)}>Cancelar edição</Button>
      </fieldset>
    </form>}
  </section>;
}
