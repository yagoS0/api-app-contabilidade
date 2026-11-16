import { useEffect, useRef, useState } from 'react';
import { Aviso } from '../../../components/ui/Aviso';
import { Button } from '../../../components/ui/Button';
import { referenciasFolha, respostaFs12Valida, valorFolhaInformado, serieDoRascunhoFs12, confirmacaoFs12Valida, rascunhoDaConfirmacaoFs12, formatarCentavosFs12 } from '../lib/fs12Formulario';

const dinheiro = centavos => formatarCentavosFs12(centavos) ?? 'Indisponível';
const mesLegivel = mes => `${mes.slice(5)}/${mes.slice(0, 4)}`;

// A confirmação manual é isolada por empresa/PA e não alimenta o cálculo. A avaliação B1 só vem do servidor.
export function Fs12DeclaratoriaPanel(props) {
  return <PainelFs12 key={`${props.portalClientId}:${props.competencia}`} {...props} />;
}
function PainelFs12({ api, portalClientId, competencia, temFatorR, referencia, recuperado, razao }) {
  const [leitura, setLeitura] = useState({ carregando: true });
  const [tentativa, setTentativa] = useState(0);
  const [rascunho, setRascunho] = useState({});
  const [confirmando, setConfirmando] = useState(false);
  const [conferido, setConferido] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  const [motivo, setMotivo] = useState('');
  const ativa = useRef(true);
  const salvando = useRef(false);
  const comando = useRef(null);
  const focoConfirmacao = useRef(null);
  const focoAcao = useRef(null);
  const botaoConfirmar = useRef(null);
  const retornarAosValores = useRef(false);
  useEffect(() => { ativa.current = true; return () => { ativa.current = false; }; }, []);
  useEffect(() => {
    if (confirmando) focoConfirmacao.current?.focus();
    else if (retornarAosValores.current) {
      retornarAosValores.current = false;
      botaoConfirmar.current?.focus();
    }
  }, [confirmando]);
  useEffect(() => {
    let vigente = true;
    setLeitura({ carregando: true });
    (async () => {
      try {
        if (!api.getFs12Confirmacoes && !api.getFs12Fechamento) throw new Error('Consulta indisponível');
        const out = await (api.getFs12Confirmacoes || api.getFs12Fechamento)(portalClientId, competencia);
        if (!respostaFs12Valida(out, portalClientId, competencia)) throw new Error('Resposta incompatível');
        if (api.getFs12Confirmacoes) {
          const f = out.fs12;
          if (!/^[a-f0-9]{64}$/.test(f.contextoRevisao) || !Array.isArray(f.historico)
            || f.historico.some(r => !confirmacaoFs12Valida(r, portalClientId, competencia) || r.companyId !== f.politica.empresaId)
            || (f.confirmacao && (!confirmacaoFs12Valida(f.confirmacao, portalClientId, competencia) || f.confirmacao.companyId !== f.politica.empresaId))
            || f.revisaoVigente !== (f.confirmacao?.revisao || 0)) throw new Error('Histórico incompatível');
        }
        if (vigente) {
          const c = out.fs12.confirmacao;
          setRascunho(c ? rascunhoDaConfirmacaoFs12(c) : {});
          setLeitura({ dados: out.fs12 }); setErro(''); setConfirmando(false); comando.current = null;
        }
      } catch {
        if (vigente) setLeitura({ erro: true });
      }
    })();
    return () => { vigente = false; };
  }, [api, portalClientId, competencia, tentativa]);
  const politica = leitura.dados?.politica;
  const meses = politica?.janela?.competencias || [];
  const { serie, informados, completa, totalCentavos } = serieDoRascunhoFs12(meses, rascunho);
  const confirmacao = leitura.dados?.confirmacao;
  const inalterada = confirmacao && confirmacao.contextoRevisao === leitura.dados.contextoRevisao
    && JSON.stringify(serie) === JSON.stringify(confirmacao.serie);
  const estado = inalterada ? 'Confirmada' : confirmacao ? 'Alterada' : completa ? 'Pronta para confirmar'
    : Object.values(rascunho).some(v => v.trim() !== '') ? 'Em preenchimento' : 'Não informada';
  const podeConfirmar = completa && !inalterada && !!leitura.dados?.contextoRevisao && !!api.confirmarFs12Fechamento;
  async function salvar() {
    if (!podeConfirmar || !conferido || salvando.current || (confirmacao && !motivo.trim())) return;
    salvando.current = true; setGravando(true); setErro('');
    try {
      const payload = { serie, revisaoEsperada: leitura.dados.revisaoVigente,
        contextoRevisao: leitura.dados.contextoRevisao, motivo: confirmacao ? motivo.trim() : null };
      const assinatura = JSON.stringify(payload);
      if (comando.current?.assinatura !== assinatura) comando.current = { assinatura, chave: crypto.randomUUID() };
      const out = await api.confirmarFs12Fechamento(portalClientId, competencia,
        { ...payload, chaveIdempotencia: comando.current.chave });
      if (!ativa.current) return;
      if (out?.ok !== true || out.autorizaEfeitoFiscal !== false
        || !confirmacaoFs12Valida(out.confirmacao, portalClientId, competencia)
        || out.confirmacao.companyId !== politica.empresaId
        || out.confirmacao.revisao !== payload.revisaoEsperada + 1
        || out.confirmacao.contextoRevisao !== payload.contextoRevisao
        || JSON.stringify(out.confirmacao.serie) !== JSON.stringify(serie))
        throw new Error(out?.message || 'Confirmação indisponível. Confira o histórico antes de tentar novamente.');
      setLeitura(p => ({ dados: { ...p.dados, confirmacao: out.confirmacao,
        revisaoVigente: out.confirmacao.revisao, historico: [out.confirmacao, ...(p.dados.historico || [])] } }));
      setConfirmando(false); setConferido(false); setMotivo(''); comando.current = null;
      focoAcao.current?.focus();
    } catch {
      if (ativa.current) setErro('Confirmação indisponível ou em conflito. O rascunho foi preservado. Recarregue o histórico para conferir a revisão antes de tentar novamente.');
    } finally {
      salvando.current = false;
      if (ativa.current) setGravando(false);
    }
  }
  const futuro = competencia >= '2027-01';
  return <section className="fechamento-secao fs12-declaratoria" aria-label="FS12 declaratória">
    <h3>FS12 declaratória</h3>
    <p>{futuro ? 'A política técnica de 2027 depende de homologação específica.'
      : 'Nos PAs 11/2026 e 12/2026, o PGDAS-D exige a folha para todas as atividades do Simples Nacional, inclusive sem receita.'}</p>
    <p><strong>Fator R:</strong> {temFatorR ? 'há atividade sujeita nas atividades selecionadas.' : 'nenhuma atividade selecionada está marcada como sujeita.'} Informar FS12 não muda o enquadramento.</p>
    {leitura.carregando && <p role="status">Consultando competências da folha…</p>}
    {leitura.erro && <Aviso tom="atencao" titulo="FS12 indisponível">
      <p role="alert">Não foi possível conferir o contexto. Nenhum valor foi considerado zero. Tente novamente.</p>
      <Button variant="secondary" onClick={() => setTentativa(t => t + 1)}>Tentar novamente</Button>
    </Aviso>}
    {politica && !meses.length && <Aviso compacto tom="atencao" titulo="Competências a verificar">
      {futuro ? 'Aguarde a homologação da política de 2027; não reutilize a janela de 2026.'
        : politica.situacao === 'FORA_DO_ESCOPO' ? 'O regime comprovado do período está fora do PGDAS-D. Confira o contexto da apuração.'
          : 'Confira a abertura e o histórico do regime no cadastro. Sem vigência mensal inequívoca, não é possível determinar os meses da folha.'}
    </Aviso>}
    {meses.length > 0 && <>
    <Aviso compacto tom="atencao" titulo="Declaração manual — novo cálculo indisponível">
      Informe e confira a folha dos meses indicados. A confirmação registra a declaração manual do contador, sem validação da Receita Federal ou do Departamento Pessoal.
      Somente valores confirmados são gravados. O rascunho é descartado ao fechar ou trocar a competência. Confirmar não calcula nem transmite.
      {recuperado && ' O cálculo recuperado e suas ações continuam usando exclusivamente os dados anteriores, sem incorporar este rascunho.'}
    </Aviso>
      <p role="status" tabIndex={-1} ref={focoAcao}><strong>{estado}</strong> · {informados} de {meses.length} meses preenchidos</p>
      {completa && <p><strong>{inalterada ? 'Total confirmado' : 'Total informado — ainda não confirmado'}:</strong> {dinheiro(totalCentavos)}</p>}
      {!completa && informados === meses.length && <p role="alert">O total ultrapassa o limite permitido. Revise os valores antes de confirmar.</p>}
      {confirmacao && <p>Última confirmação: revisão {confirmacao.revisao} · autor {confirmacao.autorNome || confirmacao.autorId} · {new Date(confirmacao.confirmadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília).</p>}
      <div className="fs12-grade">
        {meses.map(mes => {
          const valor = rascunho[mes] ?? '';
          const informado = valorFolhaInformado(valor);
          const invalido = valor.trim() !== '' && informado === null;
          const anterior = referenciasFolha(referencia, mes);
          const id = `fs12-${mes}`;
          return <div className="fs12-mes" key={mes}>
            <label htmlFor={id}>Folha {mesLegivel(mes)}</label>
            <input id={id} type="text" inputMode="decimal" value={valor} placeholder="Não informado"
              aria-invalid={invalido} aria-describedby={`${id}-estado`}
              disabled={gravando || confirmando} onChange={e => { setRascunho(p => ({ ...p, [mes]: e.target.value })); setConferido(false); }} />
            <span id={`${id}-estado`} className="fs12-situacao">{invalido ? 'Informe valor não negativo com até 2 casas.'
              : informado === null ? 'Ausente · informe a folha do mês.'
                : inalterada ? 'Valor confirmado pelo contador.' : informado === 0 ? 'Zero explícito · não conferido.' : 'Digitado neste rascunho · não conferido.'}</span>
            {anterior.situacao === 'DUPLICADA' && <span className="fs12-pendencia">Referências duplicadas · confira a origem.</span>}
            {anterior.situacao === 'INVALIDA' && <span className="fs12-pendencia">Referência histórica inválida · confira a origem.</span>}
            {anterior.valor !== null && <span className="fs12-situacao">{recuperado ? 'No cálculo recuperado' : 'Memória anterior'}: {dinheiro(anterior.valor)} · referência sem comprovação mensal.
              {informado !== null && informado !== anterior.valor && ' Diverge do rascunho.'}</span>}
          </div>;
        })}
      </div>
      {erro && <Aviso tom="atencao" titulo="Confirmação indisponível">
        <p role="alert">{erro}</p>
        <Button type="button" variant="secondary" disabled={gravando} onClick={() => setTentativa(t => t + 1)}>Recarregar histórico e descartar rascunho</Button>
      </Aviso>}
      {api.confirmarFs12Fechamento && !confirmando && <Button type="button" ref={botaoConfirmar} disabled={!podeConfirmar || gravando}
        onClick={() => { setConferido(false); setConfirmando(true); }}>Confirmar valores da folha</Button>}
      {confirmando && <div className="fs12-confirmacao" aria-busy={gravando}>
        <h4 tabIndex={-1} ref={focoConfirmacao}>Conferir folha de {razao || portalClientId} · {mesLegivel(competencia)}</h4>
        <p>{meses.length} meses · {dinheiro(totalCentavos)}. Declaração manual; não libera cálculo nem transmissão.</p>
        {confirmacao && <label>Motivo da substituição
          <textarea maxLength={1000} value={motivo} disabled={gravando} onChange={e => setMotivo(e.target.value)} />
        </label>}
        <label className="fs12-conferencia"><input type="checkbox" checked={conferido} disabled={gravando} onChange={e => setConferido(e.target.checked)} /> Conferi os meses e valores desta apuração.</label>
        <div className="fs12-acoes">
          <Button type="button" variant="secondary" disabled={gravando} onClick={() => { retornarAosValores.current = true; setConfirmando(false); setConferido(false); }}>Voltar aos valores</Button>
          <Button type="button" disabled={gravando || !conferido || (confirmacao && !motivo.trim())} onClick={salvar}>{gravando ? 'Gravando confirmação…' : 'Confirmar declaração manual'}</Button>
        </div>
      </div>}
    </>}
    {!!leitura.dados?.historico?.length && <details className="fs12-historico">
      <summary>Histórico de confirmações ({leitura.dados.historico.length})</summary>
      {leitura.dados.historico.map((r, i) => <details key={r.id}>
        <summary>{i ? 'Revisão anterior' : 'Última revisão confirmada'} · {r.revisao}</summary>
        <p>Autor {r.autorNome || r.autorId} · {new Date(r.confirmadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília) · declaração manual.</p>
        {!!r.motivo && <p>Motivo: {r.motivo}</p>}
        {i > 0 && <p>Substituída pela revisão {leitura.dados.historico[i - 1].revisao}.</p>}
        <ul>{r.serie.map(m => <li key={m.mes}>{mesLegivel(m.mes)}: {dinheiro(m.valorCentavos)}</li>)}</ul>
        <p>Total confirmado: {dinheiro(r.totalCentavos)}</p>
      </details>)}
    </details>}

  </section>;
}
