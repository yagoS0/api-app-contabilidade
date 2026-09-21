import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { BotaoCopiar } from "../../../components/ui/BotaoCopiar";

import { prepararConversao, payloadConversao } from "../lib/conversaoEmpresa";

function prepararFicha(onboarding) {
  const perfil = payloadConversao(prepararConversao(onboarding), { senhaExigida: false }).company;
  return { ...perfil, socios: perfil.socios.map(s => ({ ...s, name: s.name || s.nome || "", documento: s.documento || s.cpf || "" })) };
}
const campos = [["cnpj", "CNPJ"], ["razaoSocial", "Razão social"], ["nomeFantasia", "Nome fantasia"], ["cnaePrincipal", "CNAE principal"], ["capitalSocial", "Capital social (R$)"], ["dataAbertura", "Data de abertura"]];
const enderecoCampos = [["rua", "Logradouro"], ["numero", "Número"], ["complemento", "Complemento"], ["bairro", "Bairro"], ["cidade", "Cidade"], ["uf", "UF"], ["cep", "CEP"]];

export function FichaAvulsa({ api, onboarding, onSalvo, somenteLeitura = false }) {
  const [ficha, setFicha] = useState(null), [dados, setDados] = useState(null), [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false), [conferido, setConferido] = useState(false), [sujo, setSujo] = useState(false);
  const versao = useRef(onboarding.versao), trava = useRef(false);
  useEffect(() => {
    let vivo = true;
    api.comercial(`/onboardings/${encodeURIComponent(onboarding.id)}/ficha-avulsa`).then(r => {
      if (!vivo) return;
      setFicha(r.fichaAvulsa || null);
      setDados(r.fichaAvulsa?.dados || prepararFicha(onboarding));
      versao.current = onboarding.versao;
    }).catch(e => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [api, onboarding.id]);
  useEffect(() => { if (!sujo) versao.current = onboarding.versao; }, [onboarding.versao, sujo]);
  function mudar(campo, valor) { setDados(d => ({ ...d, [campo]: valor })); setConferido(false); setSujo(true); }
  async function salvar() {
    if (trava.current || !conferido || somenteLeitura) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api.salvarFichaAvulsa(onboarding.id, { versao: versao.current, dados });
      setFicha(r.fichaAvulsa); setDados(r.fichaAvulsa.dados); setConferido(false); setSujo(false); await onSalvo?.();
    } catch (e) { setErro(e.message || "Não foi possível salvar a ficha."); }
    finally { trava.current = false; setOcupado(false); }
  }
  async function baixar(doc) {
    setErro("");
    try { const blob = await api.baixarDocumentoFichaAvulsa(onboarding.id, doc.id); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = doc.nome; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setErro(e.message || "Não foi possível abrir o documento."); }
  }
  return <section className="lead-avulsa" aria-label="Ficha da empresa do serviço avulso"><h4>Ficha e documentos da empresa</h4><p>Cadastro do serviço avulso. Salvar esta ficha não ativa contabilidade mensal, acesso ao portal nem emissões automáticas.</p>
    {erro && <p role="alert">{erro}</p>}
    {!dados ? <p role="status">{erro ? "A ficha não pôde ser carregada." : "Carregando ficha…"}</p> : <fieldset disabled={ocupado || somenteLeitura} className="lead-step-fields"><legend>Dados conferidos da empresa</legend>
      {campos.map(([k,t]) => <label key={k}>{t}<input value={dados[k] ?? ""} type={k === "dataAbertura" ? "date" : "text"} inputMode={["cnpj", "cnaePrincipal"].includes(k) ? "numeric" : undefined} onChange={e => mudar(k, ["cnpj", "cnaePrincipal"].includes(k) ? e.target.value.replace(/\D/g, "") : e.target.value)} /></label>)}
      <label>Regime tributário<select value={dados.regimeTributario || ""} onChange={e => mudar("regimeTributario", e.target.value)}><option value="">Conferir regime</option><option value="SIMPLES">Simples Nacional</option><option value="LUCRO_PRESUMIDO">Lucro Presumido</option><option value="LUCRO_REAL">Lucro Real</option></select></label>
      <label>CNAEs secundários (separados por vírgula)<input value={(dados.cnaesSecundarios || []).join(", ")} onChange={e => mudar("cnaesSecundarios", e.target.value.split(",").map(v => v.trim()).filter(Boolean))} /></label>
      {enderecoCampos.map(([k,t]) => <label key={k}>{t}<input value={dados.endereco?.[k] || ""} onChange={e => mudar("endereco", { ...dados.endereco, [k]: k === "uf" ? e.target.value.toUpperCase() : k === "cep" ? e.target.value.replace(/\D/g, "") : e.target.value })} /></label>)}
      <details><summary>Sócios ({dados.socios?.length || 0})</summary>{(dados.socios || []).map((s,i) => <fieldset key={i}><legend>Sócio {i+1}</legend>{[["name", "Nome"], ["documento", "CPF/CNPJ"], ["participacao", "Participação (%)"]].map(([k,t]) => <label key={k}>{t}<input value={s[k] ?? ""} onChange={e => mudar("socios", dados.socios.map((x,n) => n === i ? { ...x, [k]: e.target.value } : x))} /></label>)}</fieldset>)}<Button variant="secondary" onClick={() => mudar("socios", [...(dados.socios || []), { name: "", documento: "", participacao: "" }])}>Adicionar sócio</Button></details>
      {!somenteLeitura && <><label><input type="checkbox" checked={conferido} onChange={e => setConferido(e.target.checked)} /> Conferi dados, endereço, regime, capital e sócios com os documentos.</label>{versao.current !== onboarding.versao && <p role="status">A ficha do atendimento mudou. O servidor conferirá a versão antes de gravar; seus dados digitados permanecem preservados.</p>}<Button disabled={!conferido || typeof api.salvarFichaAvulsa !== "function"} onClick={salvar}>Salvar ficha da empresa avulsa</Button></>}
    </fieldset>}
    {ficha && <div><p role="status">Ficha avulsa salva · CNPJ <BotaoCopiar valor={String(ficha.cnpj || "").replace(/\D/g, "")} rotulo="Copiar CNPJ da empresa avulsa">{String(ficha.cnpj || "").replace(/\D/g, "")}</BotaoCopiar> · versão {ficha.versao}</p><h4>Documentos preservados</h4>{ficha.documentos?.length ? ficha.documentos.map(doc => <p key={doc.id}><Button variant="secondary" onClick={() => baixar(doc)}>{doc.nome}</Button></p>) : <p>Nenhum documento disponível nesta ficha.</p>}</div>}
  </section>;
}

export function ApresentacaoManual({ onSalvar, versao, diagnosticoId, disabled, aberto = false }) {
  const [meio, setMeio] = useState(""), [evidencia, setEvidencia] = useState("");
  const Conteiner = aberto ? "section" : "details";
  return <Conteiner>{!aberto && <summary>Já apresentei por reunião ou outro meio</summary>}<fieldset disabled={disabled}><legend>Registrar a apresentação ao lead</legend><label>Meio e data<input value={meio} maxLength={2000} onChange={e => setMeio(e.target.value)} placeholder="Ex.: reunião em 21/09/2026" /></label><label>Evidência e observações<textarea value={evidencia} maxLength={2000} onChange={e => setEvidencia(e.target.value)} /></label><p>Registra a apresentação deste diagnóstico. Não cria recibo de envio pelo WhatsApp.</p><Button disabled={!diagnosticoId || meio.trim().length < 3 || evidencia.trim().length < 3} onClick={() => onSalvar({ versao, diagnosticoId, meio, evidencia })}>Conferi: registrar apresentação</Button></fieldset></Conteiner>;
}
