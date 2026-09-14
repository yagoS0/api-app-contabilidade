import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CnpjDaConversa } from "../../whatsapp/components/ConversaVisual";
import { SitfisRelatorioTabela } from "../../fiscal/sitfis/components/SitfisRelatorioTabela";

export function AnaliseDoLead({ api, onboarding, onAtualizar, conversaId }) {
  const [cnpj, setCnpj] = useState(onboarding.cnpj || ""), [analises, setAnalises] = useState([]), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const trava = useRef(false), vivo = useRef(true), versaoConsulta = useRef(0);
  const id = onboarding.id;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => { setCnpj(onboarding.cnpj || ""); }, [onboarding.cnpj]);
  useEffect(() => {
    let atual = true;
    const versao = ++versaoConsulta.current;
    api.getOnboardingComercial?.(id).then(r => { if (atual && versao === versaoConsulta.current) setAnalises(r.analises || []); }).catch(e => { if (atual && versao === versaoConsulta.current) setErro(e.message); });
    return () => { atual = false; };
  }, [api, id, onboarding]);
  async function executar(fn) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try { await fn(); } catch (e) { if (vivo.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  const atuais = analises.filter(a => a.cnpj === onboarding.cnpj);
  return <section aria-label="Análise do lead">
    <h4>1. Entender a empresa</h4>
    {onboarding.origem === "ABERTURA" ? <p>Na abertura, colete atividade, município, endereço e previsão de movimento. O novo CNPJ ainda não existe; não é necessário para iniciar a proposta.</p> : <>
      <label>CNPJ para consulta pública<input inputMode="numeric" maxLength={14} value={cnpj} onChange={e => { setCnpj(e.target.value.replace(/\D/g, "")); setErro(""); }} /></label>{" "}
      <Button disabled={ocupado || cnpj.length !== 14} onClick={() => executar(async () => {
        const consultado = cnpj;
        versaoConsulta.current += 1;
        if (consultado !== onboarding.cnpj) await api.comercial(`/onboardings/${id}/campos`, { versao: onboarding.versao, operacoes: [{ campo: "cnpj", acao: "set", valor: consultado }] });
        const r = await api.criarAnaliseOnboarding(id, { tipo: "PUBLICA" });
        if (vivo.current) { setAnalises(a => [r.analise, ...a.filter(x => x.id !== r.analise.id)]); await onAtualizar?.(); if (r.analise.status !== "CONCLUIDA") setErro(r.analise.resultado?.mensagem || "Consulta não concluída."); }
      })}>{ocupado ? "Consultando…" : "Consultar CNPJ publicamente"}</Button>
      <p>Razão social, atividade, endereço e situação cadastral. Dados públicos não comprovam regularidade fiscal.</p>
    </>}
    {erro && <p role="alert">{erro}</p>}
    {atuais.map(a => <article key={a.id} className="wa-analysis-result"><strong>{a.tipo === "PUBLICA" ? "Consulta pública" : "Situação fiscal"} · {a.status}</strong><p><CnpjDaConversa cnpj={a.cnpj} /> · {new Date(a.createdAt).toLocaleString("pt-BR")}</p>
      <p>{a.resultado?.mensagem}</p>
      {a.tipo === "PUBLICA" && <dl>{[["razaoSocial", "Razão social"], ["nomeFantasia", "Nome fantasia"], ["situacaoCadastral", "Situação cadastral"], ["cnaePrincipal", "CNAE principal"], ["atividadePrincipal", "Atividade"], ["endereco", "Endereço"], ["municipio", "Município"], ["uf", "UF"], ["fonte", "Fonte"]].map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{a.resultado?.[k] ?? "Não informado pela fonte"}</dd></div>)}</dl>}
      {a.tipo === "PUBLICA" && a.status === "CONCLUIDA" && a.resultado?.razaoSocial && api.comercial && <Button variant="secondary" disabled={ocupado} onClick={() => executar(async () => {
        await api.comercial(`/onboardings/${id}/campos`, { versao: onboarding.versao, operacoes: [{ campo: "razaoSocial", acao: "set", valor: a.resultado.razaoSocial }] });
        await onAtualizar?.();
      })}>Usar razão social na ficha e proposta</Button>}
      {a.resultado?.leitura?.relatorio && <SitfisRelatorioTabela relatorio={a.resultado.leitura.relatorio} />}
      {a.resultado?.leitura?.aviso && <p role="status">{a.resultado.leitura.aviso}</p>}
      {a.resultado?.relatorioDisponivel && <><Button disabled={ocupado} variant="secondary" onClick={() => executar(async () => {
        const url = URL.createObjectURL(await api.baixarAnaliseOnboarding(id, a.id)); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60000);
      })}>Abrir relatório fiscal PDF</Button>{conversaId && api.enviarAnexoWhatsapp && <Button disabled={ocupado} onClick={() => executar(async () => {
        const blob = await api.baixarAnaliseOnboarding(id, a.id);
        await api.enviarAnexoWhatsapp(conversaId, new File([blob], "situacao-fiscal.pdf", { type: "application/pdf" }), `Situação fiscal · CNPJ ${a.cnpj}`);
        await onAtualizar?.();
      })}>Enviar relatório conferido no WhatsApp</Button>}</>}
    </article>)}
    <p>Próxima etapa: enviar a orientação de autorização em Mensagens rápidas, conferir a representação e verificar a procuração antes da consulta fiscal.</p>
  </section>;
}
