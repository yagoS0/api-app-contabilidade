import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { useConfirmacao } from '../../../components/ui/useConfirmacao';

const campos = [
  ['razaoSocial', 'Razão social'], ['nomeFantasia', 'Nome fantasia'], ['situacaoCadastral', 'Situação cadastral'],
  ['naturezaJuridica', 'Natureza jurídica'], ['porte', 'Porte'], ['dataAbertura', 'Data de abertura'],
  ['cnaePrincipal', 'CNAE principal'], ['capitalSocial', 'Capital social'], ['email', 'E-mail'], ['telefone', 'Telefone'],
];
const enderecoCampos = [['cep', 'CEP'], ['logradouro', 'Logradouro'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'], ['municipio', 'Município'], ['uf', 'UF']];
function normalizar(e = {}) {
  const estruturado = typeof e.endereco === 'object' && e.endereco ? e.endereco : {};
  return { ...e, endereco: Object.fromEntries(enderecoCampos.map(([k]) => [k, estruturado[k] ?? (k === 'logradouro' ? estruturado.rua : undefined) ?? e[k] ?? (k === 'logradouro' && typeof e.endereco === 'string' ? e.endereco : '')])) };
}
function cadastrado(o) { return normalizar({ ...o.dados?.cadastroCnpj?.empresa, razaoSocial: o.dados?.razaoSocial || o.dados?.cadastroCnpj?.empresa?.razaoSocial || '' }); }
function capitalNumerico(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor;
  const texto = String(valor).trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(texto)) throw new Error('Informe o capital social com até duas casas decimais, sem separador de milhar.');
  return Number(texto.replace(',', '.'));
}
function compararRascunho(original, local, remoto) {
  const mesclado = { ...remoto, endereco: { ...remoto.endereco } }, conflitos = [];
  for (const chave of new Set([...Object.keys(original), ...Object.keys(local)])) {
    if (chave === 'endereco') continue;
    if (JSON.stringify(original[chave] ?? '') === JSON.stringify(local[chave] ?? '')) continue;
    mesclado[chave] = local[chave];
    if (JSON.stringify(original[chave] ?? '') !== JSON.stringify(remoto[chave] ?? '') && JSON.stringify(local[chave] ?? '') !== JSON.stringify(remoto[chave] ?? '')) conflitos.push({ nome: campos.find(([k]) => k === chave)?.[1] || chave, local: local[chave], remoto: remoto[chave] });
  }
  for (const [chave, nome] of enderecoCampos) {
    const anterior = original.endereco?.[chave] ?? '', valor = local.endereco?.[chave] ?? '', atual = remoto.endereco?.[chave] ?? '';
    if (anterior === valor) continue;
    mesclado.endereco[chave] = valor;
    if (anterior !== atual && atual !== valor) conflitos.push({ nome, local: valor, remoto: atual });
  }
  return { mesclado, conflitos };
}

export function CadastroComercialSimples({ api, onboarding, ocupado, onAtualizar, acao }) {
  const { pedir: confirmar, dialogo } = useConfirmacao();
  const [cnpj, setCnpj] = useState(onboarding.cnpj || ''), [empresa, setEmpresa] = useState(() => cadastrado(onboarding));
  const [editando, setEditando] = useState(false), [erro, setErro] = useState(''), [consultando, setConsultando] = useState(false);
  const [novo, setNovo] = useState(false), [origem, setOrigem] = useState(onboarding.dados?.cadastroCnpj?.origem === 'CONSULTA' ? 'CONSULTA' : 'MANUAL'), [analiseId, setAnaliseId] = useState(null);
  const baseObrigatoria = ['razaoSocial', 'naturezaJuridica', 'porte', 'cnaePrincipal'].every(k => String(empresa[k] || '').trim()) && ['logradouro', 'municipio', 'uf'].every(k => String(empresa.endereco?.[k] || '').trim());
  const [base, setBase] = useState(onboarding.versao), [alterado, setAlterado] = useState(false);
  const [precisaConferir, setPrecisaConferir] = useState(false), [reconciliacao, setReconciliacao] = useState(null);
  const original = useRef({ empresa: cadastrado(onboarding), cnpj: onboarding.cnpj });
  const identidade = useRef(0), trava = useRef(false);
  useEffect(() => () => { identidade.current++; }, []);
  useEffect(() => { if (!alterado && !consultando && onboarding.versao >= base) { const e = cadastrado(onboarding); setEmpresa(e); setBase(onboarding.versao); setCnpj(onboarding.cnpj || ''); original.current = { empresa: e, cnpj: onboarding.cnpj }; } }, [onboarding, alterado, consultando, base]);
  const conflitoVersao = precisaConferir || alterado && onboarding.versao > base;
  async function conferirAtual() {
    if (trava.current) return;
    const pedido = ++identidade.current; trava.current = true; setConsultando(true); setErro('');
    try {
      const r = await api.comercial(`/onboardings/${onboarding.id}`);
      if (pedido !== identidade.current) return;
      if (r?.onboarding?.id !== onboarding.id || !Number.isInteger(r.onboarding.versao) || r.onboarding.versao < base) throw new Error('Não foi possível obter uma versão atual da ficha. Seu rascunho foi preservado.');
      const remoto = cadastrado(r.onboarding);
      setReconciliacao({ ficha: r.onboarding, remoto, ...compararRascunho(original.current.empresa, empresa, remoto), identidadeMudou: r.onboarding.cnpj !== original.current.cnpj });
    } catch (e) { if (pedido === identidade.current) setErro(e.message); }
    finally { trava.current = false; if (pedido === identidade.current) setConsultando(false); }
  }
  function reconciliar(manter) {
    const { ficha, remoto, mesclado } = reconciliacao;
    setEmpresa(manter ? mesclado : remoto); setCnpj(manter ? cnpj : ficha.cnpj || '');
    setBase(ficha.versao); original.current = { empresa: remoto, cnpj: ficha.cnpj };
    setAlterado(true); setOrigem('MANUAL'); setNovo(false); setPrecisaConferir(false); setReconciliacao(null); setErro('');
  }
  const mudar = (k, valor, endereco = false) => {
    setAlterado(true); setOrigem('MANUAL'); setNovo(false);
    setEmpresa(v => endereco ? { ...v, endereco: { ...v.endereco, [k]: valor } } : { ...v, [k]: valor });
  };
  async function consultar() {
    if (trava.current || conflitoVersao) return;
    if (alterado && origem === 'MANUAL' && empresa.razaoSocial && !await confirmar({ titulo: 'Atualizar dados pela consulta', texto: 'Os dados retornados substituirão este rascunho cadastral. As alterações ainda não salvas serão perdidas.', acao: 'Consultar e substituir' })) return;
    const pedido = ++identidade.current;
    trava.current = true; setConsultando(true); setErro('');
    try {
      const r = await api.comercial(`/onboardings/${onboarding.id}/cadastro/consulta`, { versao: base, cnpj });
      if (pedido !== identidade.current) return;
      if (!r?.ok || !r.cadastroCnpj?.empresa) throw new Error(r?.mensagem || 'Consulta indisponível. Preencha os dados manualmente.');
      const recebida = normalizar(r.cadastroCnpj.empresa); setEmpresa(recebida); original.current = { empresa: recebida, cnpj };
      setAnaliseId(null); setOrigem('CONSULTA'); setNovo(true); setAlterado(true); setEditando(false); setBase(r.versao);
      await onAtualizar?.();
    } catch (e) { if (pedido === identidade.current) { setErro(e.message); if (e.status === 409) setPrecisaConferir(true); } }
    finally { trava.current = false; if (pedido === identidade.current) setConsultando(false); }
  }
  return <section className="lead-company-card" aria-label="Cadastro da empresa">{dialogo}
    <div className="lead-cnpj-search"><label>CNPJ<input value={cnpj} disabled={ocupado || consultando || Boolean(reconciliacao)} maxLength={18} onChange={e => { setCnpj(e.target.value.replace(/\W/g, '').toUpperCase()); setAlterado(true); setNovo(false); setAnaliseId(null); setOrigem('MANUAL'); setEmpresa({ endereco: {} }); }} /></label><Button disabled={ocupado || consultando || conflitoVersao || cnpj.length !== 14} onClick={consultar}>{consultando ? 'Consultando…' : 'Consultar'}</Button></div>
    {erro && <p role="alert">{erro}</p>}
    <article className="lead-company-data" data-new={novo || undefined}>
      <header><h4>Dados do atendimento</h4><Button variant="secondary" disabled={ocupado || consultando} onClick={() => setEditando(v => !v)}>{editando ? 'Concluir edição' : 'Editar'}</Button></header>
      {novo && <p role="status">Dados novos da consulta · confira antes de prosseguir</p>}
      {editando ? <><div className="lead-company-fields">{campos.map(([k, label]) => <label key={k}>{label}<input value={empresa[k] ?? ''} disabled={ocupado || consultando || Boolean(reconciliacao)} onChange={e => mudar(k, e.target.value)} /></label>)}{enderecoCampos.map(([k, label]) => <label key={k}>{label}<input value={empresa.endereco?.[k] ?? ''} disabled={ocupado || consultando || Boolean(reconciliacao)} onChange={e => mudar(k, e.target.value, true)} /></label>)}</div><ListaCadastro titulo="CNAEs secundários" itens={empresa.cnaesSecundarios || []} campos={[["codigo", "Código"], ["descricao", "Descrição"]]} disabled={ocupado || consultando || Boolean(reconciliacao)} onChange={v => mudar('cnaesSecundarios', v)} /><ListaCadastro titulo="Sócios" itens={empresa.socios || []} campos={[["nome", "Nome"], ["qualificacao", "Qualificação"], ["entrada", "Data de entrada"]]} disabled={ocupado || consultando || Boolean(reconciliacao)} onChange={v => mudar('socios', v)} /></> : <dl className="lead-company-fields">{campos.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{empresa[k] == null || empresa[k] === '' ? 'Não informado' : String(empresa[k])}</dd></div>)}<div><dt>Endereço</dt><dd>{Object.values(empresa.endereco || {}).filter(Boolean).join(', ') || 'Não informado'}</dd></div></dl>}
    </article>
    {conflitoVersao && <><p role="alert">A ficha mudou ou o salvamento não foi confirmado. Seu rascunho está preservado.</p><Button variant="secondary" disabled={ocupado || consultando} onClick={conferirAtual}>Conferir versão atual</Button></>}
    {reconciliacao && <section aria-label="Reconciliar cadastro"><h4>Versão {reconciliacao.ficha.versao} salva</h4><p>CNPJ: {reconciliacao.ficha.cnpj} · Razão social: {reconciliacao.remoto.razaoSocial || 'Não informada'}</p>{reconciliacao.conflitos.map(c => <div key={c.nome}><strong>{c.nome}</strong><p>Seu rascunho: {typeof c.local === 'object' ? JSON.stringify(c.local) : String(c.local ?? '')}</p><p>Salvo: {typeof c.remoto === 'object' ? JSON.stringify(c.remoto) : String(c.remoto ?? '')}</p></div>)}{reconciliacao.identidadeMudou && <p role="alert">O CNPJ da ficha mudou. Não é possível aplicar o rascunho anterior a outra empresa.</p>}<div className="lead-form-actions"><Button disabled={ocupado || reconciliacao.identidadeMudou} onClick={() => reconciliar(true)}>Manter minhas alterações e usar versão atual</Button><Button variant="secondary" disabled={ocupado} onClick={() => reconciliar(false)}>Usar cadastro salvo e descartar rascunho</Button></div></section>}
    <Button disabled={ocupado || consultando || cnpj.length !== 14 || !baseObrigatoria || conflitoVersao || Boolean(reconciliacao)} onClick={async () => {
      try {
        setErro('');
        const cadastro = origem === 'MANUAL' ? { ...empresa, capitalSocial: capitalNumerico(empresa.capitalSocial) } : undefined;
        const salvo = await acao('/cadastro', { versao: base, cnpj, ...(cadastro ? { empresa: cadastro } : {}), origem, ...(analiseId ? { analiseId } : {}) });
        if (salvo) setAlterado(false); else setPrecisaConferir(true);
      } catch (e) { setErro(e.message); if (e.status === 409) setPrecisaConferir(true); }
    }}>Prosseguir</Button>
  </section>;
}

function ListaCadastro({ titulo, itens, campos: descritores, disabled, onChange }) {
  return <section><h4>{titulo}</h4>{itens.map((item, i) => <div className="lead-company-fields" key={i}>{descritores.map(([k, nome]) => <label key={k}>{nome}<input disabled={disabled} value={item[k] || ''} onChange={e => onChange(itens.map((v, j) => j === i ? { ...v, [k]: e.target.value } : v))} /></label>)}<Button variant="secondary" disabled={disabled} onClick={() => onChange(itens.filter((_, j) => j !== i))}>Remover {titulo === 'Sócios' ? 'sócio' : 'CNAE'}</Button></div>)}<Button variant="secondary" disabled={disabled} onClick={() => onChange([...itens, {}])}>Adicionar {titulo === 'Sócios' ? 'sócio' : 'CNAE'}</Button></section>;
}
