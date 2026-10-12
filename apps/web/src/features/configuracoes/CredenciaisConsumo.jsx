import { useEffect, useRef, useState } from 'react';
import { ConfiguracoesGeraisLayout } from './Configuracoes';
import { ProtecaoEdicao, useConfirmarSaida, useEdicaoPendente } from './ProtecaoEdicao';
import './credenciais-consumo.css';

export const SERVICOS_CONSUMO = [
  { id: 'CBS', rotulo: 'CBS — Receita Integra', url: 'https://consumo.tributos.gov.br', portal: 'Abrir portal da CBS' },
  { id: 'IBS', rotulo: 'IBS — Apuração Assistida', url: 'https://www.servicos.cgibs.gov.br/', portal: 'Abrir portal do IBS' },
];

export function CredenciaisConsumoPage({ api }) {
  return <ProtecaoEdicao><ConfiguracoesGeraisLayout atual="consumo"><SelecionarEmpresa api={api}/></ConfiguracoesGeraisLayout></ProtecaoEdicao>;
}

function SelecionarEmpresa({ api }) {
  const [empresas, setEmpresas] = useState([]);
  const [empresaId, setEmpresaId] = useState('');
  const [estado, setEstado] = useState('carregando');
  const [tentativa, setTentativa] = useState(0);
  const confirmarSaida = useConfirmarSaida();
  useEffect(() => {
    let ativo = true;
    setEstado('carregando');
    api.listCompanies().then(lista => {
      if (!ativo) return;
      setEmpresas(lista); setEstado('pronto');
    }).catch(() => { if (ativo) setEstado('erro'); });
    return () => { ativo = false; };
  }, [api, tentativa]);
  const empresa = empresas.find(e => e.companyId === empresaId);
  return <div className="consumo-credentials">
    <h2>Credenciais CBS e IBS</h2>
    <p>Cadastre os acessos de cada empresa para preparar a integração da apuração.</p>
    {estado === 'carregando' && <p role="status">Carregando empresas…</p>}
    {estado === 'erro' && <div role="alert">Não foi possível carregar as empresas. <button onClick={() => setTentativa(v => v + 1)}>Tentar novamente</button></div>}
    {estado === 'pronto' && <label>Empresa
      <select value={empresaId} onChange={e => { const id = e.target.value; confirmarSaida(() => setEmpresaId(id)); }}>
        <option value="">Selecione uma empresa</option>
        {empresas.map(e => <option key={e.companyId} value={e.companyId}>{e.razao} · {e.cnpj}</option>)}
      </select>
    </label>}
    {estado === 'pronto' && !empresas.length && <p>Nenhuma empresa disponível para este acesso.</p>}
    {empresa && <CredenciaisEmpresa key={empresaId} api={api} empresa={empresa}/>}
  </div>;
}

export function CredenciaisEmpresa({ api, empresa }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let ativo = true;
    setDados(null); setErro(false);
    api.listCompanyCredentials(empresa.companyId).then(r => { if (ativo) setDados(r); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, [api, empresa.companyId, tentativa]);
  if (erro) return <div role="alert">Não foi possível consultar as credenciais. Confira sua permissão para esta empresa. <button onClick={() => setTentativa(v => v + 1)}>Tentar novamente</button></div>;
  if (!dados) return <p role="status">Consultando credenciais…</p>;
  return <>
    <p><strong>{empresa.razao}</strong> · {empresa.cnpj}</p>
    <p>Para CBS, utilize as credenciais do CNPJ da matriz. O cadastro não altera o regime tributário da empresa.</p>
    <p>O Client Secret fica criptografado no servidor e não é exibido nesta tela. Salvar não consulta os órgãos nem habilita a integração.</p>
    <div className="consumo-credentials-grid">{SERVICOS_CONSUMO.map(servico => <CredencialServico
      key={`${empresa.companyId}-${servico.id}`} api={api} companyId={empresa.companyId} servico={servico}
      registros={(dados.credenciais || []).filter(c => c.rotulo === servico.rotulo)}
    />)}</div>
    <details><summary>Como obter os acessos</summary>
      <p>CBS: entre com gov.br como representante ou procurador, selecione a matriz e procure “Gerar Credencial de Acesso para API”.</p>
      <p>IBS: selecione o contribuinte autorizado e acesse “Credenciais de Acesso → Gerar Credenciais”. Um novo par invalida o anterior. A habilitação exige o endereço de retorno da integração, que precisa estar validado antes do cadastro no órgão.</p>
      <p>Permissões, habilitação no órgão e recebimento dos arquivos precisam ser conferidos antes da ativação. As credenciais do SERPRO e de emissão de notas têm cadastros separados.</p>
      <a href={`/companies/${encodeURIComponent(empresa.companyId)}/credenciais`}>Consultar outros acessos da empresa</a>
    </details>
  </>;
}

function CredencialServico({ api, companyId, servico, registros }) {
  const [lista, setLista] = useState(registros);
  const [selecionado, setSelecionado] = useState(registros.length === 1 ? registros[0].id : '');
  const registro = lista.find(c => c.id === selecionado);
  const [clientId, setClientId] = useState(registros.length === 1 ? registros[0].login || '' : '');
  const [secret, setSecret] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState(false);
  const vivo = useRef(true);
  const bloqueio = useRef(false);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const alterado = Boolean(secret || clientId !== (registro?.login || ''));
  useEdicaoPendente(alterado);
  const trocar = id => {
    setSelecionado(id); setClientId(lista.find(c => c.id === id)?.login || ''); setSecret(''); setMensagem('');
  };
  async function salvar(e) {
    e.preventDefault();
    if (bloqueio.current || !alterado) return;
    if (!clientId.trim() || (secret && !secret.trim()) || ((!registro?.temSenha || clientId.trim() !== registro.login) && !secret.trim())) {
      setErro(true); setMensagem('Informe o Client ID e o Client Secret do mesmo par de credenciais.'); return;
    }
    bloqueio.current = true; setSalvando(true); setMensagem('');
    const payload = { rotulo: servico.rotulo, login: clientId.trim(), ...(secret ? { senha: secret } : {}) };
    try {
      const resposta = registro
        ? await api.updateCompanyCredential(companyId, registro.id, payload)
        : await api.createCompanyCredential(companyId, payload);
      if (!vivo.current) return;
      const salvo = resposta?.credencial;
      if (!salvo?.id) throw new Error('Resposta inválida');
      setLista(atual => [...atual.filter(c => c.id !== salvo.id), salvo]);
      setSelecionado(salvo.id); setClientId(salvo.login || ''); setSecret(''); setErro(false);
      setMensagem('Credenciais salvas. A validação da integração é uma etapa separada.');
    } catch {
      if (vivo.current) { setErro(true); setMensagem('Não foi possível confirmar o salvamento. Confira os acessos salvos antes de tentar novamente.'); }
    } finally {
      bloqueio.current = false;
      if (vivo.current) setSalvando(false);
    }
  }
  return <section aria-label={`Credenciais ${servico.id}`}>
    <h3>{servico.id}</h3>
    <p>{registro?.temSenha ? 'Credenciais cadastradas' : 'Cadastro pendente'} · Validação no órgão não verificada nesta tela</p>
    <a href={servico.url} target="_blank" rel="noreferrer">{servico.portal} ↗</a>
    {lista.length > 1 && <label>Cadastro para editar
      <select value={selecionado} disabled={salvando || alterado} onChange={e => trocar(e.target.value)}>
        <option value="">Selecione um cadastro</option>
        {lista.map((c, i) => <option key={c.id} value={c.id}>{c.login || `Cadastro ${i + 1}`} · {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('pt-BR') : 'Data indisponível'}</option>)}
      </select>
    </label>}
    <form onSubmit={salvar} autoComplete="off">
      <fieldset disabled={salvando || (lista.length > 1 && !registro)}>
        <label>Client ID<input name={`${servico.id}-client-id`} value={clientId} onChange={e => setClientId(e.target.value)} autoComplete="off" maxLength={2048} required/></label>
        <label>Client Secret<input type="password" name={`${servico.id}-client-secret`} value={secret} onChange={e => setSecret(e.target.value)} autoComplete="new-password" maxLength={8192} required={!registro?.temSenha}/></label>
        {registro?.temSenha && <p>Deixe o Secret vazio para manter o atual. Ao trocar o Client ID, informe também o novo Secret.</p>}
        <button type="submit" disabled={!alterado}>{salvando ? 'Salvando…' : `Salvar credenciais ${servico.id}`}</button>
        {alterado && <button type="button" onClick={() => { setClientId(registro?.login || ''); setSecret(''); setMensagem(''); }}>Descartar edição {servico.id}</button>}
      </fieldset>
    </form>
    {mensagem && <p role={erro ? 'alert' : 'status'}>{mensagem}</p>}
  </section>;
}
