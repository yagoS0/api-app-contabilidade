import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

const style = { width: "100%", padding: 8, background: "var(--bg-subtle)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 5, marginBlock: 5 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const tipos = { ORIENTACAO: "Mensagem rápida", CONTRATO: "Modelo de contrato", INSTITUCIONAL: "Dados do escritório", CATALOGO: "Catálogo de honorários" };
const chavesFixas = { CATALOGO: "honorarios", INSTITUCIONAL: "escritorio" };
const valores = [
  ["aberturaCentavos", "Abertura (R$)", true], ["baixaCentavos", "Baixa (R$)", true],
  ["consultoriaCentavos", "Consultoria mensal adicional (R$)"], ["irpfCentavos", "IRPF por declaração (R$)"],
  ["regularizacaoMinimaCentavos", "Piso de regularização (R$)"]
];
const variaveis = ["nome", "cnpj", "escritorio", "procuradorCnpj", "linkAutorizacao", "linkProposta", "servico", "honorarios", "condicoes", "contratante", "endereco", "email", "cpf"];
const variaveisDaOrientacao = ["nome", "cnpj", "servico", "escritorio", "procuradorCnpj", "linkAutorizacao"];
const textoNumero = (v, moeda = false) => v == null ? "" : moeda && typeof v === "number" ? (v / 100).toFixed(2).replace(".", ",") : String(v);
const faixaVazia = () => ({ ate: "", recebidas: "", SIMPLES: "", LUCRO_PRESUMIDO: "" });

function abrirEditor(r) {
  const d = r.dados || {};
  if (r.tipo !== "CATALOGO") return { ...r, texto: r.texto || "", dados: { ...d } };
  return { ...r, texto: r.texto || "", dados: {
    ...d, moeda: d.moeda ?? "BRL",
    faixas: Array.isArray(d.faixas) ? d.faixas.map(f => ({ ...f, ate: textoNumero(f.ate), recebidas: textoNumero(f.recebidas), SIMPLES: textoNumero(f.SIMPLES, true), LUCRO_PRESUMIDO: textoNumero(f.LUCRO_PRESUMIDO, true) })) : [faixaVazia()],
    pisoPersonalizado: { ...d.pisoPersonalizado, SIMPLES: textoNumero(d.pisoPersonalizado?.SIMPLES, true), LUCRO_PRESUMIDO: textoNumero(d.pisoPersonalizado?.LUCRO_PRESUMIDO, true) },
    blocoRecebidas: { ...d.blocoRecebidas, quantidade: textoNumero(d.blocoRecebidas?.quantidade), centavos: textoNumero(d.blocoRecebidas?.centavos, true) },
    consultoriaIncluidaAPartir: textoNumero(d.consultoriaIncluidaAPartir),
    ...Object.fromEntries(valores.map(([k]) => [k, textoNumero(d[k], true)]))
  } };
}

function prepararRecurso(r) {
  const erros = [], dados = { ...r.dados };
  const titulo = r.titulo.trim(), chave = r.chave.trim(), texto = r.texto || "";
  if (!titulo) erros.push("Preencha o título.");
  if (!/^[a-z][a-z0-9_-]{1,60}$/.test(chave)) erros.push("A chave deve ter de 2 a 61 caracteres: comece com letra minúscula e use letras, números, hífen ou sublinhado, sem a barra.");
  if (chavesFixas[r.tipo] && chave !== chavesFixas[r.tipo]) erros.push(`Para uso neste fluxo, a chave deve ser ${chavesFixas[r.tipo]}.`);
  if (["ORIENTACAO", "CONTRATO"].includes(r.tipo) && !texto.trim()) erros.push("Preencha o texto.");
  const marcadores = [...texto.matchAll(/\{\{(.*?)\}\}/g)].map(m => m[1]);
  if (marcadores.some(k => !(r.tipo === "ORIENTACAO" ? variaveisDaOrientacao : variaveis).includes(k)) || /\{\{|\}\}/.test(texto.replace(/\{\{(.*?)\}\}/g, ""))) erros.push("Confira os campos substituíveis do texto: use apenas os nomes listados, entre chaves duplas e sem espaços.");
  if (texto.length > 60000 || JSON.stringify(dados).length > 60000) erros.push("O conteúdo excede o limite de 60.000 caracteres. Reduza o texto ou os dados.");
  function numero(v, rotulo, { moeda = false, opcional = false, minimo = 0 } = {}) {
    const s = String(v ?? "").trim();
    if (!s && opcional) return null;
    const formato = moeda ? /^\d+(?:[,.]\d{1,2})?$/ : /^\d+$/;
    if (!formato.test(s)) { erros.push(`${rotulo}: ${moeda ? "informe reais sem separador de milhar, com até duas casas decimais" : "informe um número inteiro"}.`); return null; }
    const [inteiros, decimais = ""] = s.split(/[,.]/);
    const n = moeda ? Number(inteiros) * 100 + Number(decimais.padEnd(2, "0")) : Number(s);
    if (!Number.isSafeInteger(n) || n < minimo) { erros.push(`${rotulo}: informe um valor ${minimo ? "maior que zero" : "não negativo"} dentro do limite permitido.`); return null; }
    return n;
  }
  if (r.tipo === "CATALOGO") {
    if (dados.moeda !== "BRL") erros.push("A moeda do catálogo deve ser BRL (reais).");
    dados.faixas = (dados.faixas || []).map((f, i) => ({ ...f,
      ate: numero(f.ate, `Faixa ${i + 1} — limite de funcionários`), recebidas: numero(f.recebidas, `Faixa ${i + 1} — notas recebidas incluídas`),
      SIMPLES: numero(f.SIMPLES, `Faixa ${i + 1} — Simples Nacional`, { moeda: true }), LUCRO_PRESUMIDO: numero(f.LUCRO_PRESUMIDO, `Faixa ${i + 1} — Lucro Presumido`, { moeda: true })
    }));
    if (!dados.faixas.length) erros.push("Cadastre pelo menos uma faixa mensal.");
    dados.faixas.forEach((f, i) => { if (i && f.ate != null && dados.faixas[i - 1].ate != null && f.ate <= dados.faixas[i - 1].ate) erros.push(`Faixa ${i + 1}: o limite de funcionários deve ser maior que o da faixa anterior.`); });
    dados.pisoPersonalizado = { ...dados.pisoPersonalizado,
      SIMPLES: numero(dados.pisoPersonalizado?.SIMPLES, "Piso personalizado — Simples Nacional", { moeda: true }),
      LUCRO_PRESUMIDO: numero(dados.pisoPersonalizado?.LUCRO_PRESUMIDO, "Piso personalizado — Lucro Presumido", { moeda: true }) };
    dados.blocoRecebidas = { ...dados.blocoRecebidas,
      quantidade: numero(dados.blocoRecebidas?.quantidade, "Quantidade de notas por bloco adicional", { minimo: 1 }),
      centavos: numero(dados.blocoRecebidas?.centavos, "Valor do bloco adicional", { moeda: true }) };
    dados.consultoriaIncluidaAPartir = numero(dados.consultoriaIncluidaAPartir, "Consultoria incluída a partir de quantos funcionários");
    for (const [k, rotulo, opcional] of valores) dados[k] = numero(dados[k], rotulo, { moeda: true, opcional });
    if (!dados.condicoes?.trim()) erros.push("Preencha as condições comerciais.");
    if (!dados.escopoAbertura?.trim()) erros.push("Descreva o escopo da abertura.");
    if (!dados.escopoMensal?.trim()) erros.push("Descreva o escopo da contabilidade mensal.");
  }
  if (r.tipo === "INSTITUCIONAL") {
    dados.procuradorCnpj = String(dados.procuradorCnpj || "").replace(/[.\-/\s]/g, "");
    if (!dados.escritorio?.trim()) erros.push("Preencha o nome do escritório.");
    if (!/^\d{14}$/.test(dados.procuradorCnpj)) erros.push("Informe o CNPJ do procurador com 14 dígitos.");
    try { if (new URL(dados.linkAutorizacao).protocol !== "https:") throw new Error(); } catch { erros.push("Informe um endereço HTTPS válido para as instruções de autorização."); }
  }
  return { erros, body: { tipo: r.tipo, chave, titulo, texto, dados } };
}

function Campo({ rotulo, valor, onChange, numero = false, ajuda }) {
  const id = useId();
  return <div><label htmlFor={id} style={{ display: "block" }}>{rotulo}</label><input id={id} style={style} inputMode={numero ? "decimal" : undefined} aria-describedby={ajuda ? `${id}-ajuda` : undefined} value={valor ?? ""} onChange={e => onChange(e.target.value)} />{ajuda && <small id={`${id}-ajuda`} style={{ display: "block" }}>{ajuda}</small>}</div>;
}

export function RecursosComerciais({ api, recursos = [], onAtualizar }) {
  const [editando, setEditando] = useState(null), [erros, setErros] = useState([]), [ocupado, setOcupado] = useState(false), [aviso, setAviso] = useState("");
  const trava = useRef(false), errosRef = useRef(null);
  useEffect(() => { if (erros.length) errosRef.current?.focus(); }, [erros]);
  async function executar(fn) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErros([]); setAviso("");
    try { await fn(); await onAtualizar?.(); } catch (e) { setErros([e.message || "Não foi possível concluir. Tente novamente."]); }
    finally { trava.current = false; setOcupado(false); }
  }
  function editar(r) { setEditando(abrirEditor(r)); setErros([]); setAviso(""); }
  const novo = () => editar({ tipo: "ORIENTACAO", chave: "", titulo: "", texto: "", dados: {} });
  const mudarDado = (k, v) => setEditando(e => ({ ...e, dados: { ...e.dados, [k]: v } }));
  const mudarGrupo = (grupo, k, v) => setEditando(e => ({ ...e, dados: { ...e.dados, [grupo]: { ...e.dados[grupo], [k]: v } } }));
  const mudarFaixa = (i, k, v) => setEditando(e => ({ ...e, dados: { ...e.dados, faixas: e.dados.faixas.map((f, j) => j === i ? { ...f, [k]: v } : f) } }));
  function salvar() {
    const { erros: invalidos, body } = prepararRecurso(editando);
    if (invalidos.length) { setErros(invalidos); return; }
    executar(async () => { await api.comercial("/recursos", body); setEditando(null); setAviso("Nova versão salva como rascunho. Revise e aprove para disponibilizar ao atendimento."); });
  }
  function aprovar(r) {
    const { erros: invalidos } = prepararRecurso(abrirEditor(r));
    if (invalidos.length) { setEditando(abrirEditor(r)); setErros(invalidos); return; }
    executar(async () => { await api.comercial(`/recursos/${encodeURIComponent(r.id)}/aprovar`, {}); setAviso("Versão aprovada para uso no atendimento."); });
  }
  return <details style={{ marginBlock: 14 }}>
    <summary>Biblioteca de mensagens, preços e modelos</summary>
    <p>Biblioteca compartilhada pelo atendimento. Salvar cria um rascunho; só as versões aprovadas ficam disponíveis para a IA e o contador. As versões anteriores são preservadas.</p>
    {erros.length > 0 && <div role="alert" tabIndex={-1} ref={errosRef}><strong>Confira antes de continuar:</strong><ul>{erros.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    {aviso && <p role="status">{aviso}</p>}
    <Button type="button" disabled={ocupado} onClick={() => executar(() => api.comercial("/recursos/iniciar", {}))}>Carregar rascunhos iniciais</Button>{" "}
    <Button type="button" variant="secondary" disabled={ocupado || !!editando} onClick={novo}>Novo recurso</Button>
    {!recursos.length && <p>A biblioteca está vazia. Cadastre os textos e as regras de honorários do escritório, sem valores preenchidos automaticamente.</p>}
    <ul>{recursos.map(r => <li key={r.id} style={{ marginBlock: 10 }}>
      <strong>{r.titulo}</strong> · {tipos[r.tipo] || r.tipo} · /{r.chave} · v{r.versao} · {r.aprovadoEm ? "Aprovado" : "Rascunho"}{" "}
      <Button type="button" variant="secondary" size="sm" disabled={ocupado || !!editando} onClick={() => editar(r)}>Revisar / nova versão</Button>{" "}
      {!r.aprovadoEm && <Button type="button" size="sm" disabled={ocupado || !!editando} onClick={() => aprovar(r)}>Aprovar</Button>}
    </li>)}</ul>
    {editando && <fieldset disabled={ocupado} style={{ border: "1px solid var(--border)", padding: 14 }}>
      <legend>{editando.id ? `Nova versão a partir da v${editando.versao}` : "Preparar recurso"}</legend>
      <label>Tipo<select style={style} value={editando.tipo} disabled={!!editando.id} onChange={e => editar({ tipo: e.target.value, chave: chavesFixas[e.target.value] || "", titulo: "", texto: "", dados: {} })}>{Object.entries(tipos).map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}</select></label>
      <label>Atalho / chave<input style={style} value={editando.chave} readOnly={!!editando.id || !!chavesFixas[editando.tipo]} onChange={e => setEditando({ ...editando, chave: e.target.value })} /></label>
      {chavesFixas[editando.tipo] && <p>{editando.tipo === "CATALOGO" ? "O cálculo das propostas usa a versão aprovada mais recente de /honorarios." : "As mensagens de autorização usam os dados aprovados de /escritorio."}</p>}
      <Campo rotulo="Título" valor={editando.titulo} onChange={v => setEditando({ ...editando, titulo: v })} />
      {editando.tipo === "CATALOGO" ? <>
        <p>Valores em reais, sem separador de milhar (ex.: 1250,50). Zero é um valor definido. Somente abertura e baixa podem ficar vazias para indicar “a confirmar”.</p>
        <label>Moeda<select style={style} value={editando.dados.moeda} onChange={e => mudarDado("moeda", e.target.value)}><option value="BRL">Real brasileiro (BRL)</option>{editando.dados.moeda !== "BRL" && <option value={editando.dados.moeda}>Moeda não aceita: {editando.dados.moeda}</option>}</select></label>
        <Campo rotulo="Referência interna do catálogo (opcional)" valor={editando.dados.fonte} onChange={v => mudarDado("fonte", v)} />
        <h4>Faixas de contabilidade mensal</h4><p>Ordene pelo limite de funcionários, sem pró-labore. A primeira faixa começa em zero; cada faixa seguinte começa após o limite anterior. Informe a quantidade de notas recebidas incluídas e os honorários mensais por regime.</p>
        {editando.dados.faixas.map((f, i) => <fieldset key={i} style={{ marginBlock: 10, border: "1px solid var(--border)" }}><legend>Faixa {i + 1}</legend><div style={grid}>
          <Campo numero rotulo="Até quantos funcionários" valor={f.ate} onChange={v => mudarFaixa(i, "ate", v)} />
          <Campo numero rotulo="Notas recebidas incluídas por mês" valor={f.recebidas} onChange={v => mudarFaixa(i, "recebidas", v)} />
          <Campo numero rotulo="Simples Nacional mensal (R$)" valor={f.SIMPLES} onChange={v => mudarFaixa(i, "SIMPLES", v)} />
          <Campo numero rotulo="Lucro Presumido mensal (R$)" valor={f.LUCRO_PRESUMIDO} onChange={v => mudarFaixa(i, "LUCRO_PRESUMIDO", v)} />
        </div><Button type="button" variant="secondary" size="sm" disabled={editando.dados.faixas.length === 1} onClick={() => mudarDado("faixas", editando.dados.faixas.filter((_, j) => i !== j))}>Remover faixa {i + 1}</Button></fieldset>)}
        <Button type="button" variant="secondary" onClick={() => mudarDado("faixas", [...editando.dados.faixas, faixaVazia()])}>Adicionar faixa</Button>
        <h4>Orçamento acima da última faixa</h4><div style={grid}>
          <Campo numero rotulo="Piso personalizado — Simples Nacional (R$)" valor={editando.dados.pisoPersonalizado.SIMPLES} onChange={v => mudarGrupo("pisoPersonalizado", "SIMPLES", v)} />
          <Campo numero rotulo="Piso personalizado — Lucro Presumido (R$)" valor={editando.dados.pisoPersonalizado.LUCRO_PRESUMIDO} onChange={v => mudarGrupo("pisoPersonalizado", "LUCRO_PRESUMIDO", v)} />
        </div>
        <h4>Notas recebidas excedentes</h4><div style={grid}>
          <Campo numero rotulo="Quantidade de notas por bloco adicional" valor={editando.dados.blocoRecebidas.quantidade} onChange={v => mudarGrupo("blocoRecebidas", "quantidade", v)} />
          <Campo numero rotulo="Valor do bloco adicional (R$)" valor={editando.dados.blocoRecebidas.centavos} onChange={v => mudarGrupo("blocoRecebidas", "centavos", v)} />
        </div>
        <h4>Serviços e consultoria</h4><div style={grid}>{valores.map(([k, rotulo, opcional]) => <Campo key={k} numero rotulo={rotulo} valor={editando.dados[k]} ajuda={opcional ? "Vazio: a confirmar. 0,00: honorário zero." : undefined} onChange={v => mudarDado(k, v)} />)}
          <Campo numero rotulo="Consultoria incluída a partir de quantos funcionários" valor={editando.dados.consultoriaIncluidaAPartir} ajuda="Abaixo deste número, o valor adicional é cobrado quando a consultoria for solicitada. Zero inclui em todas as faixas." onChange={v => mudarDado("consultoriaIncluidaAPartir", v)} />
        </div>
        {[["escopoAbertura", "Escopo da abertura"], ["escopoMensal", "Escopo da contabilidade mensal"], ["condicoes", "Condições comerciais"]].map(([k, rotulo]) => <label key={k} style={{ display: "block", marginTop: 10 }}>{rotulo}<textarea style={style} rows={4} value={editando.dados[k] ?? ""} onChange={e => mudarDado(k, e.target.value)} /></label>)}
      </> : editando.tipo === "INSTITUCIONAL" ? <div style={grid}>
        <Campo rotulo="Nome do escritório" valor={editando.dados.escritorio} onChange={v => mudarDado("escritorio", v)} />
        <Campo rotulo="CNPJ do procurador" valor={editando.dados.procuradorCnpj} onChange={v => mudarDado("procuradorCnpj", v)} />
        <Campo rotulo="Link HTTPS das instruções de autorização" valor={editando.dados.linkAutorizacao} onChange={v => mudarDado("linkAutorizacao", v)} />
      </div> : <><label>Texto<textarea style={style} rows={10} value={editando.texto} onChange={e => setEditando({ ...editando, texto: e.target.value })} /></label>
        <p>Campos substituíveis: {(editando.tipo === "ORIENTACAO" ? variaveisDaOrientacao : variaveis).map(k => `{{${k}}}`).join(", ")}. Em mensagens rápidas, nome, CNPJ e serviço vêm do atendimento; os dados do escritório vêm da configuração aprovada. Os demais campos dependem do fluxo que preencherá o modelo.</p>
      </>}
      {editando.tipo === "CONTRATO" && <div><label style={{ display: "block" }}><input type="checkbox" checked={editando.dados.recorrente === true} onChange={e => mudarDado("recorrente", e.target.checked)} /> Contabilidade recorrente</label><label style={{ display: "block" }}><input type="checkbox" checked={editando.dados.permitePreCnpj === true} onChange={e => mudarDado("permitePreCnpj", e.target.checked)} /> Modelo validado para contratação antes do CNPJ</label><p>Revise a minuta e substitua os marcadores de revisão antes de aprovar.</p></div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}><Button type="button" onClick={salvar}>Salvar nova versão em rascunho</Button><Button type="button" variant="secondary" onClick={() => { setEditando(null); setErros([]); }}>Fechar edição</Button></div>
    </fieldset>}
  </details>;
}
