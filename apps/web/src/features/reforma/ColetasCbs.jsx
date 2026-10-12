import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import './reforma.css';

const ESTADOS = {
  RESERVADA: 'Solicitação reservada', INCERTA: 'Resultado incerto', PENDENTE: 'Aguardando processamento',
  EM_PROCESSAMENTO: 'Em processamento', DISPONIVEL: 'Arquivo disponível para coleta',
  ARQUIVADA: 'Arquivo armazenado localmente', ERRO: 'Falha na solicitação', EXPIRADA: 'Arquivo expirado',
};
const EM_ABERTO = ['RESERVADA', 'INCERTA', 'PENDENTE', 'EM_PROCESSAMENTO', 'DISPONIVEL'];
const podeConsultar = c => c?.ticket && !c.operacaoEmCurso && !['ARQUIVADA', 'ERRO', 'EXPIRADA'].includes(c.estado);
const podeBaixar = c => c?.estado === 'DISPONIVEL' && !c.operacaoEmCurso;
const RECURSOS = { DEBITOS: 'Débitos', CREDITOS: 'Créditos' };
function dataHora(valor) {
  if (!valor || !Number.isFinite(new Date(valor).getTime())) return 'Não informado';
  return new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function ColetasCbs(props) { return <PainelColetas key={`${props.companyId}:${props.ambiente}`} {...props} />; }
function PainelColetas({ api, companyId, ambiente }) {
  const [aberto, setAberto] = useState(false);
  return <details className="reforma-coletas" onToggle={e => setAberto(e.currentTarget.open)}>
    <summary>Coleta CBS · {ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação'}</summary>
    {aberto && <Acompanhamento api={api} companyId={companyId} ambiente={ambiente} />}
  </details>;
}
function Acompanhamento({ api, companyId, ambiente }) {
  const [inspecoes, setInspecoes] = useState({});
  const [dados, setDados] = useState(null), [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState(''), [erroAcao, setErroAcao] = useState(''), [aviso, setAviso] = useState('');
  const [recurso, setRecurso] = useState('DEBITOS'), [ocupado, setOcupado] = useState(false);
  const vivo = useRef(false), sequencia = useRef(0), executando = useRef(false), intencoes = useRef(new Map());
  const leituraAtual = useRef(null);
  const apiAtual = useRef(api); apiAtual.current = api;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; sequencia.current++; }; }, []);
  const carregar = useCallback(async () => {
    const vez = ++sequencia.current;
    const vigente = () => vivo.current && apiAtual.current === api && sequencia.current === vez;
    leituraAtual.current = null; setCarregando(true); setErroLeitura('');
    try {
      if (!api?.getColetasCbs) throw new Error('O acompanhamento CBS ainda não está disponível neste ambiente.');
      const r = await api.getColetasCbs(companyId, { ambiente });
      if (!vigente()) return;
      if (!r?.ok || r.ambiente !== ambiente || !Array.isArray(r.coletas) || r.coletas.some(c => c.ambiente !== ambiente)) throw new Error('Resposta de acompanhamento inválida para o ambiente selecionado.');
      leituraAtual.current = r; setDados({ api, valor: r }); return true;
    } catch (e) { if (vigente()) setErroLeitura(e.message || 'Não foi possível ler o acompanhamento local.'); }
    finally { if (vigente()) setCarregando(false); }
  }, [api, companyId, ambiente]);
  useEffect(() => { carregar(); return () => { sequencia.current++; }; }, [carregar]);
  const atual = dados?.api === api ? dados.valor : null;
  const lista = atual?.coletas || [];
  const pronta = Boolean(atual && !carregando && !erroLeitura && !atual.demonstracao);
  const capacidade = nome => pronta && leituraAtual.current === atual && atual.capacidades?.[nome] === true;
  const incertaSemTicket = lista.some(c => c.recurso === recurso && c.estado === 'INCERTA' && !c.ticket);
  const recursoEmAberto = lista.some(c => c.recurso === recurso && EM_ABERTO.includes(c.estado));
  async function executar(operacao, coleta) {
    if (!vivo.current || executando.current || apiAtual.current !== api || !capacidade(operacao)) return;
    if (operacao === 'abrir' && recursoEmAberto) return;
    if (operacao === 'consultar' && !podeConsultar(coleta)) return;
    if (operacao === 'baixar' && !podeBaixar(coleta)) return;
    executando.current = true; setOcupado(true); setErroAcao(''); setAviso('');
    const chave = `${operacao}:${coleta?.id || recurso}`;
    if (!intencoes.current.has(chave)) intencoes.current.set(chave, crypto.randomUUID());
    const payload = { id: intencoes.current.get(chave), ambiente };
    try {
      const r = operacao === 'abrir'
        ? await api.abrirColetaCbs(companyId, { ...payload, recurso })
        : operacao === 'consultar'
          ? await api.consultarColetaCbs(companyId, coleta.id, payload)
          : await api.baixarArquivoColetaCbs(companyId, coleta.id, payload);
      if (!vivo.current || apiAtual.current !== api) return;
      if (!r?.ok || !r.coleta?.id || r.coleta.ambiente !== ambiente) throw new Error('A ação não teve confirmação. Atualize o acompanhamento local antes de repetir.');
      setAviso(r.coleta.estado === 'INCERTA' ? 'O resultado da operação é incerto. Confira a situação antes de uma nova solicitação.' : 'Registro recebido. Confira a situação no acompanhamento abaixo.');
      if (await carregar()) intencoes.current.delete(chave);
    } catch (e) { if (vivo.current && apiAtual.current === api) setErroAcao(e.message || 'Não foi possível confirmar a operação. Confira o acompanhamento local.'); }
    finally { executando.current = false; if (vivo.current) setOcupado(false); }
  }
  async function inspecionar(coleta) {
    if (!vivo.current || executando.current || apiAtual.current !== api || !capacidade('reprocessar') || coleta.estado !== 'ARQUIVADA' || !coleta.arquivos?.length) return;
    executando.current = true; setOcupado(true); setErroAcao('');
    try {
      const r = await api.reprocessarArquivoColetaCbs(companyId, coleta.id, { ambiente });
      if (!vivo.current || apiAtual.current !== api) return;
      if (!r?.ok || !r.inspecao || !Array.isArray(r.inspecao.periodos)) throw new Error('Não foi possível confirmar a inspeção do arquivo local.');
      setInspecoes(anterior => ({ ...anterior, [coleta.id]: { api, valor: r.inspecao } }));
    } catch (e) { if (vivo.current && apiAtual.current === api) setErroAcao(e.message || 'Falha na inspeção local.'); }
    finally { executando.current = false; if (vivo.current) setOcupado(false); }
  }
  return <section aria-label="Acompanhamento das coletas CBS">
    <p>As solicitações trazem atualizações de débitos ou créditos do contribuinte e podem incluir várias competências. O mês da preparação não filtra esta coleta.</p>
    <details><summary>Como funciona a cobertura</summary><p>A documentação prevê uma janela máxima de retorno de oito dias, com tratamento próprio para a primeira consulta. As datas vêm do serviço oficial; esta tela não escolhe uma janela nem comprova cobertura completa.</p></details>
    {atual?.demonstracao && <p>Demonstração local: nenhuma consulta ou arquivo oficial.</p>}
    {erroLeitura && <p role="alert">{erroLeitura}{atual ? ' Exibindo a última leitura local; as ações ficam bloqueadas até atualizar.' : ''}</p>}
    {erroAcao && <p role="alert">{erroAcao}</p>}{aviso && <p role="status">{aviso}</p>}
    {carregando && <p role="status">Lendo acompanhamento local…</p>}
    {atual && <>
      {!atual.capacidades?.abrir && <p className="reforma-alert">A coleta oficial está desativada neste ambiente. A habilitação depende da homologação do contrato e do acesso oficial.</p>}
      {!!atual.bloqueios?.length && <ul>{atual.bloqueios.map((b, i) => <li key={`${b.codigo}:${i}`}>{b.mensagem || 'Existe um impedimento para consultar o serviço oficial.'}</li>)}</ul>}
      <div className="reforma-grid"><label>Dados a solicitar<select value={recurso} disabled={ocupado} onChange={e => { setRecurso(e.target.value); setErroAcao(''); setAviso(''); }}><option value="DEBITOS">Débitos CBS</option><option value="CREDITOS">Créditos CBS</option></select></label></div>
      {incertaSemTicket && <p className="reforma-alert">Há uma solicitação de {RECURSOS[recurso].toLowerCase()} com resultado incerto e sem tíquete. Confira o registro antes de uma nova abertura.</p>}
      {recursoEmAberto && !incertaSemTicket && <p>Já existe uma solicitação de {RECURSOS[recurso].toLowerCase()} em aberto. Acompanhe seu processamento antes de solicitar novamente.</p>}
      <Button disabled={ocupado || !capacidade('abrir') || recursoEmAberto} onClick={() => executar('abrir')}>Solicitar coleta de {RECURSOS[recurso].toLowerCase()}</Button>
      <p><small>Solicitar, consultar situação e buscar arquivo são ações externas distintas. Atualizar o acompanhamento abaixo lê somente o histórico local.</small></p>
      {atual.truncada && <p className="reforma-alert">Exibindo somente as {atual.limite || 100} solicitações mais recentes. O histórico anterior permanece armazenado.</p>}
      {lista.map(coleta => <article className="reforma-finding" key={coleta.id} aria-label={`Coleta ${RECURSOS[coleta.recurso] || 'a conferir'} ${coleta.id}`}>
        <h4>{RECURSOS[coleta.recurso] || 'Recurso não reconhecido'} · {ESTADOS[coleta.estado] || 'Situação não reconhecida'}</h4>
        <p>Solicitada em {dataHora(coleta.createdAt)} · Atualizada em {dataHora(coleta.updatedAt)}</p>
        {coleta.ticket && <p className="reforma-evidence">Tíquete: {coleta.ticket}</p>}
        {coleta.etaSegundos != null && <p>Estimativa informada pelo serviço: {coleta.etaSegundos} segundos.</p>}
        {coleta.arquivoExpiraEm && <p>Disponibilidade do arquivo até {dataHora(coleta.arquivoExpiraEm)}.</p>}
        {coleta.estado === 'INCERTA' && <p className="reforma-alert">O retorno não confirmou o resultado da operação. {coleta.ticket ? 'Consulte a situação antes de repetir a coleta.' : 'Sem tíquete retornado: é necessária conferência operacional.'}</p>}
        {coleta.estado === 'EXPIRADA' && <p className="reforma-alert">O prazo para buscar o arquivo terminou. Isso não confirma ausência de débitos ou créditos.</p>}
        {coleta.operacaoEmCurso && <p className="reforma-alert">Há uma operação em curso ou aguardando recuperação. Atualize o acompanhamento local antes de outra ação.</p>}
        {coleta.erroCodigo && <p>Código de falha: {coleta.erroCodigo}</p>}
        {!!coleta.arquivos?.length && <>
          <p>{coleta.arquivos.length} arquivo(s) armazenado(s). O armazenamento não equivale à conferência da apuração.</p>
          <details><summary>Arquivos armazenados</summary><ul>{coleta.arquivos.map(a => <li key={a.id} className="reforma-evidence">{dataHora(a.createdAt)}{a.tamanhoBytes != null ? ` · ${a.tamanhoBytes} bytes` : ''}{a.contentType ? ` · ${a.contentType}` : ''}{a.sha256 ? <><br />SHA-256: {a.sha256}</> : null}</li>)}</ul></details>
        </>}
        {!!coleta.tentativas?.length && <details><summary>Histórico de tentativas ({coleta.tentativas.length})</summary><ul>{coleta.tentativas.map(t => <li key={t.id}>{t.operacao} · {t.estado} · {dataHora(t.iniciadaEm)}{t.erroCodigo ? ` · ${t.erroCodigo}` : ''}</li>)}</ul></details>}
        {coleta.estado === 'ARQUIVADA' && !!coleta.arquivos?.length && <>
          <Button variant="secondary" disabled={ocupado || !capacidade('reprocessar')} onClick={() => inspecionar(coleta)}>Inspecionar arquivo local</Button>
          {inspecoes[coleta.id]?.api === api && <InspecaoArquivo resultado={inspecoes[coleta.id].valor} />}
        </>}
        <div className="reforma-actions">
          <Button variant="secondary" disabled={ocupado || !capacidade('consultar') || !podeConsultar(coleta)} onClick={() => executar('consultar', coleta)}>Consultar situação na Receita</Button>
          <Button variant="secondary" disabled={ocupado || !capacidade('baixar') || !podeBaixar(coleta)} onClick={() => executar('baixar', coleta)}>Armazenar arquivo retornado</Button>
        </div>
      </article>)}
      {!lista.length && !erroLeitura && <p>Nenhuma solicitação CBS registrada neste ambiente. Isso não comprova ausência de movimento.</p>}
      <p>Este acompanhamento não informa saldo apurado, conferência, guia ou pagamento.</p>
    </>}
    <div className="reforma-actions"><Button variant="secondary" disabled={carregando || ocupado} onClick={carregar}>Atualizar acompanhamento local</Button></div>
  </section>;
}

function InspecaoArquivo({ resultado: r }) {
  return <section aria-label="Inspeção local do arquivo"><p><strong>Inspeção local · sem nova consulta externa</strong></p>
    <p>{r.quantidadeItens} itens identificados · {r.valoresInvalidos} valores inválidos. Esta leitura não soma deltas, não valida a identidade dos itens e não comprova cobertura ou total oficial.</p>
    <ul>{r.periodos.map((p, i) => <li key={i}>{p.competencia} · {p.quantidade} itens</li>)}</ul>
    {r.truncada && <p>A amostra da inspeção foi limitada.</p>}{r.aviso && <p>{r.aviso}</p>}
    <details><summary>Referência da inspeção</summary><p className="reforma-evidence">Parser: {r.versaoParser}<br />SHA-256: {r.sha256}</p></details>
  </section>;
}
