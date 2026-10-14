import { validarDadosOnboarding, reconciliarDados } from "@contabilidade/shared/onboarding-dados";
import { useEffect, useRef, useState } from "react";
import { CampoOnboarding } from "../components/CampoOnboarding";
import { FichaDeclarada, formatarValor } from "../components/PassoRevisao";
import { camposDoPasso, passosVisiveis, podarInvisiveis, descritorDe } from "../lib/onboardingSpec";
import { ConsultaCnpjOnboarding } from "../components/ConsultaCnpjOnboarding";
import { useConsultaCnpjOnboarding } from "../hooks/useConsultaCnpjOnboarding";
import { Button } from "../../../components/ui/Button";

const AJUDAS_CLIENTE = {
  razaoSocial: "Informe o nome que você gostaria de usar na nova empresa.",
  tipoEmpresa: "Se ainda não souber, deixe em branco. O contador ajudará na escolha.",
  atividadePretendida: "Descreva os produtos ou serviços que sua empresa vai oferecer.",
  capitalSocialPretendido: "Se souber, informe o valor que pretende investir para iniciar a empresa.",
};
const descritorDoCliente = (d, origem) => origem === "ABERTURA" && AJUDAS_CLIENTE[d.campo]
  ? { ...d, ajuda: AJUDAS_CLIENTE[d.campo] } : d;
const complementares = new Set(["socios", "capitalSocialPretendido", "consultoriaMensal", "responsavelCargo", "responsavelCpf"]);

function RespostaEmConflito({ descritor, valor }) {
  if (valor && typeof valor === "object" && descritor?.tipo !== "lista") {
    return <dl>{Object.entries(valor).map(([chave, item]) => <div key={chave}><dt>{chave.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd><RespostaEmConflito valor={item} /></dd></div>)}</dl>;
  }
  return <>{formatarValor(descritor || { tipo: typeof valor === "boolean" ? "booleano" : "texto" }, valor) || "Não informado"}</>;
}

// Token fica só na memória da página e no fragmento do link; nunca localStorage/query string.
export function FormularioPublico({ api }) {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [registro, setRegistro] = useState(null), [dados, setDados] = useState({}), [passo, setPasso] = useState("identificacao");
  const [erro, setErro] = useState(""), [aviso, setAviso] = useState(""), [ocupado, setOcupado] = useState(false), [concluido, setConcluido] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [complementaresAbertos, setComplementaresAbertos] = useState({});
  const [errosCampos, setErrosCampos] = useState({}), [conflitos, setConflitos] = useState([]), [verificar, setVerificar] = useState(false);
  const baseSalva = useRef({}), trava = useRef(false);
  function concluir() { setConcluido(true); setVerificar(false); window.history.replaceState(null, "", window.location.pathname); }

  const [dadosSalvos, setDadosSalvos] = useState("");
  const [releitura, setReleitura] = useState(0);
  const tituloEtapa = useRef(null);
  const etapaAnterior = useRef(null);
  function alterarCampo(campo, valor) { setDados(d => ({ ...d, [campo]: valor })); setAviso("Alterações ainda não salvas."); setConfirmado(false); setErrosCampos(e => ({ ...e, [campo]: undefined })); }
  const cnpj = useConsultaCnpjOnboarding({ contexto: token, origem: registro?.origem, dados, alterarCampo, habilitado: Boolean(registro && !concluido), tokenPublico: token });
  const dadosAtuais = registro ? JSON.stringify(podarInvisiveis(registro.origem, dados)) : "";
  const alterado = Boolean(registro && !concluido && dadosAtuais !== dadosSalvos);
  useEffect(() => {
    if (!alterado) return;
    const antesDeSair = (evento) => { evento.preventDefault(); evento.returnValue = ""; };
    window.addEventListener("beforeunload", antesDeSair);
    return () => window.removeEventListener("beforeunload", antesDeSair);
  }, [alterado]);
  useEffect(() => {
    let vivo = true;
    if (!token) { setErro("Link incompleto. Peça um novo link ao escritório."); return; }
    api.consultarFormularioOnboarding(token).then((r) => {
      if (!vivo) return; if (r.enviado) { concluir(); return; } baseSalva.current = r.onboarding.dados || {}; setRegistro(r.onboarding); setDados(r.onboarding.dados || {}); setPasso(r.onboarding.ultimoPasso || "identificacao"); setDadosSalvos(JSON.stringify(podarInvisiveis(r.onboarding.origem, r.onboarding.dados || {})));
    }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [api, token, releitura]);
  const passos = registro ? passosVisiveis(registro.origem).filter((p) => p.chave !== "origem") : [];
  const indice = Math.max(0, passos.findIndex((p) => p.chave === passo));
  const atual = passos[indice]?.chave;
  useEffect(() => {
    if (registro && camposDoPasso(registro.origem, atual, dados).some(d => complementares.has(d.campo) && errosCampos[d.campo])) {
      setComplementaresAbertos(abertos => abertos[atual] ? abertos : { ...abertos, [atual]: true });
    }
  }, [registro, atual, dados, errosCampos]);
  useEffect(() => {
    if (etapaAnterior.current && atual && etapaAnterior.current !== atual) {
      tituloEtapa.current?.focus({ preventScroll: true });
      tituloEtapa.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
    }
    etapaAnterior.current = atual;
  }, [atual]);
  async function verificarSalvamento() {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api.consultarFormularioOnboarding(token);
      if (r.enviado) { concluir(); return; }
      if (r.onboarding.origem !== registro.origem) { setErro("A equipe alterou o tipo de atendimento. Suas respostas continuam nesta tela; peça à equipe para conferir antes de continuar."); return; }
      const remoto = r.onboarding.dados || {};
      const normalizar = d => validarDadosOnboarding(registro.origem, d).dados;
      const conciliacao = reconciliarDados(normalizar(baseSalva.current), normalizar(dados), normalizar(remoto));
      baseSalva.current = remoto;
      setRegistro(r.onboarding); setDados(conciliacao.dados); setConflitos(conciliacao.conflitos);
      setDadosSalvos(JSON.stringify(podarInvisiveis(registro.origem, remoto)));
      setConfirmado(false); setVerificar(false);
      setAviso(conciliacao.conflitos.length ? "A equipe ou a IA atualizou alguns campos. Escolha qual resposta manter antes de salvar." : "Salvamento conferido. As respostas da equipe e as suas foram preservadas. Confira e continue.");
    } catch (e) { setErro(e.message); } finally { trava.current = false; setOcupado(false); }
  }
  async function salvar(destino = atual, finalizar = false) {
    if (trava.current || !registro || conflitos.length || verificar || (finalizar && !confirmado)) return;
    const validacao = validarDadosOnboarding(registro.origem, dados);
    if (!validacao.ok) {
      setErrosCampos(validacao.erros); setErro("Confira os campos indicados. Suas respostas continuam nesta tela.");
      const campo = Object.keys(validacao.erros)[0];
      setPasso(descritorDe(registro.origem, campo)?.passo || atual);
      return;
    }
    trava.current = true; setOcupado(true); setErro(""); setAviso(""); setErrosCampos({});
    try {
      const r = await api.salvarFormularioOnboarding(token, { dados: validacao.dados, ultimoPasso: destino, finalizar, versao: registro.versao });
      if (finalizar || r.enviado) { concluir(); return; }
      const salvos = r.onboarding.dados || validacao.dados;
      baseSalva.current = salvos; setDados(salvos);
      setDadosSalvos(JSON.stringify(podarInvisiveis(registro.origem, salvos)));
      setRegistro(r.onboarding); setPasso(destino); setAviso("Dados salvos. Você pode continuar depois usando o mesmo link.");
    } catch (e) {
      setErro(e.message); setErrosCampos(e.payload?.erros || {});
      if (e.status !== 400) setVerificar(true);
    } finally { trava.current = false; setOcupado(false); }
  }
  function campoPublico(descritor) {
    return <CampoOnboarding key={descritor.campo} descritor={descritorDoCliente(descritor, registro.origem)} dados={dados} valor={dados[descritor.campo]} erro={errosCampos[descritor.campo]} onChange={v => cnpj.editar(descritor.campo, v)} acaoExtra={descritor.consultaReceita ? <Button type="button" variant="secondary" disabled={!cnpj.permitido || cnpj.carregando} onClick={cnpj.consultar}>Consultar novamente</Button> : null} origemPreenchimento="CLIENTE" />;
  }
  return <main className="onboarding-workspace onboarding-public">
    <header className="onboarding-public__header"><span className="onboarding-eyebrow">ALTAN · ENTRADA DE CLIENTES</span>
    <h1>{registro?.origem === "ABERTURA" ? "Vamos preparar a abertura da sua empresa" : "Seu cadastro no escritório"}</h1>
    <p>Preencha o que souber. Os dados serão conferidos pelo contador. Não informe senhas ou certificados neste formulário.</p>
    {registro?.origem === "ABERTURA" && <p>Você ainda não precisa ter CNPJ. Conte sobre a empresa que pretende abrir.</p>}</header>
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {!registro && erro && token && !concluido && <Button onClick={() => { setErro(""); setReleitura(n => n + 1); }}>Tentar carregar novamente</Button>}
    {verificar && !concluido && <Button disabled={ocupado} onClick={verificarSalvamento}>Verificar salvamento e recuperar respostas</Button>}
    {conflitos.length > 0 && <section aria-label="Respostas para conferir">{conflitos.map(c => {
      const descritor = descritorDe(registro.origem, c.campo);
      return <section className="onboarding-conflict" key={c.campo} aria-label={descritor?.rotulo || c.campo}>
        <h3>{descritor?.rotulo || c.campo}</h3>
        <div className="onboarding-conflict__comparison">
          <div><h4>Minha resposta</h4><div className="onboarding-conflict__value"><RespostaEmConflito descritor={descritor} valor={c.local} /></div></div>
          <div><h4>Resposta atualizada</h4><div className="onboarding-conflict__value"><RespostaEmConflito descritor={descritor} valor={c.remoto} /></div></div>
        </div>
        <div className="onboarding-conflict__actions">
          <Button variant="secondary" onClick={() => setConflitos(lista => lista.filter(x => x.campo !== c.campo))}>Manter minha resposta</Button>
          <Button variant="secondary" onClick={() => { alterarCampo(c.campo, c.remoto ?? ""); setConflitos(lista => lista.filter(x => x.campo !== c.campo)); }}>Usar resposta atualizada</Button>
        </div>
      </section>;
    })}</section>}
    {concluido ? <h2>Cadastro enviado. O escritório dará continuidade ao atendimento.</h2> : !registro ? <p>{erro ? "Seu preenchimento não foi alterado." : "Carregando formulário…"}</p> : <>
      <div className="onboarding-public__progress"><h2 ref={tituloEtapa} tabIndex={-1} style={{ scrollMarginTop: 24 }}>Etapa {indice + 1} de {passos.length}: {passos[indice]?.titulo}</h2><progress aria-label="Progresso do formulário" value={indice + 1} max={passos.length} /></div>
      <fieldset disabled={ocupado || verificar || conflitos.length > 0} className="onboarding-public__fields">
        <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>{passos[indice]?.titulo}</legend>
        {atual === "identificacao" && <ConsultaCnpjOnboarding consulta={cnpj.consulta} carregando={cnpj.carregando} cadastro={dados.cadastroCnpj} />}
        {atual === "revisao" ? <><FichaDeclarada origem={registro.origem} dados={dados} origemPreenchimento="CLIENTE" /><label className="onboarding-public__consent"><input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} /><span>Conferi os dados e autorizo seu uso pelo escritório para este atendimento.</span></label></> : <>{camposDoPasso(registro.origem, atual, dados).filter(d => !complementares.has(d.campo)).map(campoPublico)}
          {camposDoPasso(registro.origem, atual, dados).some(d => complementares.has(d.campo)) && <details open={Boolean(complementaresAbertos[atual])} onToggle={e => { const aberto = e.currentTarget.open; setComplementaresAbertos(v => v[atual] === aberto ? v : { ...v, [atual]: aberto }); }}><summary>Dados complementares — preencha se já souber</summary><p>Podem ser completados com a equipe na contratação ou implantação.</p>{camposDoPasso(registro.origem, atual, dados).filter(d => complementares.has(d.campo)).map(campoPublico)}</details>}</>}

        <div className="onboarding-public__actions">
          {indice > 0 && <Button variant="secondary" onClick={() => salvar(passos[indice - 1].chave)}>Salvar e voltar</Button>}
          <Button variant="secondary" onClick={() => salvar()}>Salvar para continuar depois</Button>
          {indice < passos.length - 1 ? <Button onClick={() => salvar(passos[indice + 1].chave)}>Salvar e continuar</Button> : <Button disabled={!confirmado} onClick={() => salvar(atual, true)}>Enviar cadastro ao escritório</Button>}
        </div>
      </fieldset>
    </>}
  </main>;
}
