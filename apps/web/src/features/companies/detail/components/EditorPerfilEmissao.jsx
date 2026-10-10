import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { CAMPOS_PERFIL_EMISSAO } from "../../../../lib/nfse/perfilEmissao";
import { useEdicaoPendente } from '../../../configuracoes/ProtecaoEdicao';
import { MunicipioDoPerfil } from "./MunicipioDoPerfil";
import { completudePerfilEmissao } from './completudePerfilEmissao';
import { CampoCatalogo } from '../../../notas/components/CampoCatalogo';
import { catalogosDoPerfil } from '../../../../lib/nfse/catalogosDoPerfil';
import { itemDoCatalogo } from '../../../../lib/nfse/buscaCatalogo';

const GRUPOS = [
  ["Serviço e local", ["codigoServicoNacional", "codigoNbs", "codigoServicoMunicipal", "cLocPrestacao"]],
  ["IBS e CBS", ["ibscbsCIndOp", "ibscbsCst", "ibscbsCClassTrib"]],
  ["Tributação municipal e Simples", ["regEspTrib", "regApTribSN", "tribISSQN", "tpImunidade", "exigSuspTipo", "exigSuspProcesso", "pAliq"]],
  ["Tributação federal", ["retencaoFederalArt30", "cstPisCofins"]],
];

export function corpoDoPerfil(form, campos) {
  const corpo = { nome: form.nome?.trim(), ativo: form.ativo !== false, padrao: form.ativo !== false && form.padrao === true };
  if (Object.prototype.hasOwnProperty.call(form, 'categoriaObrigacaoIbscbs')) corpo.categoriaObrigacaoIbscbs = form.categoriaObrigacaoIbscbs || null;
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
  const catalogos = catalogosDoPerfil(dados, campos);
  const original = form?.id ? dados?.perfis?.find((p) => p.id === form.id) : { ...dados?.derivadoDoCadastro, nome: '', ativo: true, padrao: false };
  useEdicaoPendente(Boolean(form && (form._buscaMunicipio?.trim() || JSON.stringify(corpoDoPerfil(form, campos)) !== JSON.stringify(corpoDoPerfil(original || {}, campos)))));
  const servico = dados?.sugestoes?.porServico?.find((s) => s.codigo === form?.codigoServicoNacional);
  const mudar = (id, valor) => setForm((anterior) => ({ ...anterior, [id]: valor,
    ...(id === 'codigoServicoNacional' && valor !== anterior.codigoServicoNacional ? { _revisarServico: true } : {}) }));
  async function salvar(e) {
    e.preventDefault();
    setErro(""); setSucesso("");
    const normalizado = { ...form };
    for (const [id, itens] of Object.entries(catalogos)) {
      const valor = String(form[id] ?? '').trim();
      if (!valor) continue;
      const item = itemDoCatalogo(itens, valor);
      // Compatibilidade com respostas antigas sem o catálogo completo: preserva
      // somente o valor já salvo; buscas novas exigem uma escolha verificável.
      if (!item && valor !== String(original?.[id] ?? '')) {
        setErro(`Selecione uma sugestão para ${campos.find(c => c.id === id)?.rotulo || id}, ou limpe o campo.`);
        return;
      }
      if (item) normalizado[id] = item.codigo;
    }
    if (form._revisarServico) {
      setErro('Revise o complemento municipal, NBS, tributação e IBS/CBS após alterar o serviço e confirme a revisão.');
      return;
    }
    if (form._buscaMunicipio?.trim() && !form.cLocPrestacao) {
      setErro("Selecione o município da prestação na lista ou limpe a busca para deixar sem configuração.");
      return;
    }
    try {
      await onSalvar(form.id || null, corpoDoPerfil(normalizado, campos));
      setForm(null); setSucesso("Perfil de emissão salvo.");
    } catch (err) {
      const detalhes = err?.payload?.erros?.map((e) => e.motivo).filter(Boolean).join(" ");
      setErro(detalhes || err?.message || "Não foi possível salvar o perfil.");
    }
  }
  if (!dados || !podeEditar) return null;
  return <section className="nfse-profile-editor nfse-settings" aria-label="Editar perfis de emissão">
    <h2>Perfis de emissão</h2>
    {dados.integracaoLigada === false && <p role="status">Os perfis estão desativados neste ambiente. Salvar um perfil não altera a nota até a integração ser habilitada.</p>}
    {dados.ibscbsLigado === false && <p role="status">O envio de IBS/CBS está desativado. Operações que já exigem essas informações serão bloqueadas antes da emissão.</p>}
    {sucesso && <p role="status">{sucesso}</p>}
    {!form ? <>
      <Button type="button" onClick={() => { setErro(""); setSucesso(""); setForm({ ...dados.derivadoDoCadastro, nome: "", ativo: true, padrao: false }); }}>Novo perfil</Button>
      {!dados.perfis?.length && <p className="nfse-empty">Nenhum perfil cadastrado. Crie um perfil para organizar os parâmetros de cada serviço.</p>}
      <ul className="nfse-profile-list">{(dados.perfis || []).map((p) => <li key={p.id}>
        <div><strong>{p.nome}</strong><span>{p.codigoServicoNacional || "Serviço não configurado"} {p.padrao ? "· Padrão" : ""} {p.ativo === false ? "· Inativo" : "· Ativo"}</span>
          <small>{dados.sugestoes?.porServico?.find(s => s.codigo === p.codigoServicoNacional)?.descricao}</small><p>{completudePerfilEmissao(p)}</p></div>
        <Button type="button" variant="secondary" aria-label={`Editar ${p.nome}`} onClick={() => { setErro(""); setSucesso(""); setForm({ ...p }); }}>Editar</Button>
      </li>)}</ul>
    </> : <form onSubmit={salvar} className="nfse-profile-form" onInvalidCapture={e => { const secao = e.target.closest("details"); if (secao) secao.open = true; }}>
      <fieldset disabled={salvando} style={{ border: 0, padding: 0 }}>
        <legend>{form.id ? "Editar perfil" : "Novo perfil de emissão"}</legend>
        <p className="nfse-profile-status">{completudePerfilEmissao(form)}</p>
        {form._revisarServico && <label><input type="checkbox" checked={false} onChange={() => mudar('_revisarServico', false)} />Revisei complemento municipal, NBS, tributação e IBS/CBS para o novo serviço. Os valores anteriores foram preservados para conferência.</label>}
        {String(form.tribISSQN) === '3' && <p role="status">Este perfil está marcado como exportação. A emissão dessa operação ainda deve ser feita no Emissor Nacional; o sistema bloqueará a transmissão.</p>}
        <label className="nfse-profile-name">Nome do perfil<input autoFocus required maxLength={60} value={form.nome || ""} onChange={(e) => mudar("nome", e.target.value)} /></label>
        <div className="nfse-profile-flags"><label><input type="checkbox" checked={form.ativo !== false} onChange={(e) => mudar("ativo", e.target.checked)} />Perfil ativo</label>
        <label><input type="checkbox" disabled={form.ativo === false} checked={form.padrao === true && form.ativo !== false} onChange={(e) => mudar("padrao", e.target.checked)} />Usar como padrão</label></div>
        {GRUPOS.map(([titulo, ids], index) => <details key={titulo} className="nfse-section" open={index === 0 || undefined}><summary><span className="nfse-step">{String(index + 1).padStart(2, '0')}</span>{" "}{titulo}</summary><div className="form-grid two-col">
          {ids.map((id) => {
            const c = campos.find((v) => v.id === id);
            if (!c) return null;
            if (id === "cLocPrestacao") return <MunicipioDoPerfil compacto key={id}
              codigo={form.cLocPrestacao} busca={form._buscaMunicipio}
              onBuscar={texto => setForm(anterior => ({ ...anterior, cLocPrestacao: null, _buscaMunicipio: texto }))}
              onEscolher={codigo => setForm(anterior => ({ ...anterior, cLocPrestacao: codigo, _buscaMunicipio: null }))}
            />;
            if (id === "tpImunidade" && String(form.tribISSQN) !== "2" && !form.tpImunidade) return null;
            if (id === "exigSuspProcesso" && !form.exigSuspTipo && !form.exigSuspProcesso) return null;
            if (catalogos[id]) return <div key={id} className={id === 'ibscbsCClassTrib' ? 'full' : undefined}>
              <CampoCatalogo compacto id={`perfil-${id}`} rotulo={c.rotulo} valor={form[id]}
                itens={catalogos[id]} required={c.obrigatorio} onChange={valor => mudar(id, valor)} />
            </div>;
            return <div key={id} className={id === "codigoServicoNacional" || id === "codigoNbs" ? "full" : undefined}>
              <label htmlFor={`perfil-${id}`}>{c.rotulo}</label>
              <input id={`perfil-${id}`} required={c.obrigatorio} value={form[id] ?? ""} onChange={(e) => mudar(id, e.target.value)} />
              {id !== 'codigoServicoMunicipal' && <small>{id === "pAliq" ? "Percentual com até duas casas decimais." : c.formaDescrita}</small>}
            </div>;
          })}
          {titulo === "Serviço e local" && <details className="full nfse-field-help"><summary>Orientações e sugestões de NBS</summary>
            <p>Busque por código ou descrição, com ou sem acentos. O serviço nacional deve estar habilitado na empresa. Confirme o complemento municipal na tabela da prefeitura.</p>
            <label htmlFor="perfil-sugestao-nbs">Sugestões de NBS para o serviço</label>
            <select id="perfil-sugestao-nbs" value={servico?.nbs?.some(n => n.codigo === form.codigoNbs) ? form.codigoNbs : ""} onChange={(e) => { if (e.target.value) mudar("codigoNbs", e.target.value); }}>
              <option value="">Escolha para preencher o item NBS</option>
              {(servico?.nbs || []).map((n) => <option key={n.codigo} value={n.codigo}>{n.codigo} — {n.descricao || "Sem descrição na fonte"}</option>)}
            </select>
            {!servico?.nbs?.length && <p>Não há sugestão disponível para este serviço. Confirme o código na tabela oficial.</p>}
          </details>}
          {titulo === "IBS e CBS" && <div className="full">
            <CampoCatalogo compacto id="perfil-categoria-ibs" rotulo="Categoria da operação para o prazo de IBS/CBS"
              valor={form.categoriaObrigacaoIbscbs} itens={catalogos.categoriaObrigacaoIbscbs}
              onChange={valor => mudar('categoriaObrigacaoIbscbs', valor)} />
            <details className="nfse-field-help"><summary>Orientações e combinações de IBS/CBS</summary>
            <p>Confirme o enquadramento legal. Usar internet para prestar um serviço não caracteriza, por si só, a hipótese de plataforma digital. A competência e o regime também determinam o prazo.</p>
            <label htmlFor="perfil-sugestao-ibs">Combinações de operação e classificação</label>
            <select id="perfil-sugestao-ibs" value={servico?.combinacoes?.some(c => c.cIndOp === form.ibscbsCIndOp && c.cClassTrib === form.ibscbsCClassTrib) ? `${form.ibscbsCIndOp}:${form.ibscbsCClassTrib}` : ""} onChange={(e) => {
              const opcao = servico?.combinacoes?.find((c) => `${c.cIndOp}:${c.cClassTrib}` === e.target.value);
              if (opcao) setForm((p) => ({ ...p, ibscbsCIndOp: opcao.cIndOp, ibscbsCClassTrib: opcao.cClassTrib }));
            }}>
              <option value="">Escolha conforme a operação e o tomador</option>
              {(servico?.combinacoes || []).map((c) => <option key={`${c.cIndOp}:${c.cClassTrib}`} value={`${c.cIndOp}:${c.cClassTrib}`}>
                {c.cIndOp} / {c.cClassTrib} — {c.nomeClassTrib} · {c.localIncidencia}
              </option>)}
            </select>
            <p>O Anexo VIII é orientativo. Outras combinações das tabelas oficiais podem ser preenchidas nos campos acima. O CST e o enquadramento devem ser confirmados pelo contador.</p>
            </details>
          </div>}
        </div></details>)}
        {erro && <p role="alert">{erro}</p>}
        <div className="nfse-profile-actions">
          <Button type="button" variant="secondary" disabled={salvando} onClick={() => setForm(null)}>Cancelar edição</Button>
          <Button variant="primary" type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar perfil"}</Button>
        </div>
      </fieldset>
    </form>}
  </section>;
}
