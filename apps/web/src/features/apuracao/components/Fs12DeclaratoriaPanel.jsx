import { useEffect, useState } from 'react';
import { Aviso } from '../../../components/ui/Aviso';
import { Button } from '../../../components/ui/Button';
import { referenciasFolha, respostaFs12Valida, valorFolhaInformado } from '../lib/fs12Formulario';

const dinheiro = centavos => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mesLegivel = mes => `${mes.slice(5)}/${mes.slice(0, 4)}`;

// A key do consumidor isola todo o rascunho por empresa/PA. Nada é persistido
// ou entregue ao formulário de cálculo. A avaliação B1 só vem do servidor.
export function Fs12DeclaratoriaPanel({ api, portalClientId, competencia, temFatorR, referencia, recuperado }) {
  const [leitura, setLeitura] = useState({ carregando: true });
  const [tentativa, setTentativa] = useState(0);
  const [rascunho, setRascunho] = useState({});
  useEffect(() => {
    let vigente = true;
    setLeitura({ carregando: true });
    (async () => {
      try {
        if (!api.getFs12Fechamento) throw new Error('Consulta indisponível');
        const out = await api.getFs12Fechamento(portalClientId, competencia);
        if (!respostaFs12Valida(out, portalClientId, competencia)) throw new Error('Resposta incompatível');
        if (vigente) { setRascunho({}); setLeitura({ dados: out.fs12 }); }
      } catch {
        if (vigente) setLeitura({ erro: true });
      }
    })();
    return () => { vigente = false; };
  }, [api, portalClientId, competencia, tentativa]);
  const politica = leitura.dados?.politica;
  const meses = politica?.janela?.competencias || [];
  const informados = meses.filter(m => valorFolhaInformado(rascunho[m]) !== null).length;
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
    <Aviso compacto tom="atencao" titulo="Rascunho local — novo cálculo indisponível">
      Reúna e confira a folha dos meses indicados. A conferência fiscal mensal e sua integração ao cálculo ainda não estão disponíveis.
      Digitar não comprova a origem nem valida a folha oficialmente. Os valores são descartados ao fechar ou trocar a competência.
      {recuperado && ' O cálculo recuperado e suas ações continuam usando exclusivamente os dados anteriores, sem incorporar este rascunho.'}
    </Aviso>
      <p>{informados}/{meses.length} meses informados no rascunho · nenhum com conferência fiscal comprovada. Total FS12 comprovado: indisponível.</p>
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
              onChange={e => setRascunho(p => ({ ...p, [mes]: e.target.value }))} />
            <span id={`${id}-estado`} className="fs12-situacao">{invalido ? 'Informe valor não negativo com até 2 casas.'
              : informado === null ? 'Ausente · informe a folha do mês.'
                : informado === 0 ? 'Zero explícito · não conferido.' : 'Digitado neste rascunho · não conferido.'}</span>
            {anterior.situacao === 'DUPLICADA' && <span className="fs12-pendencia">Referências duplicadas · confira a origem.</span>}
            {anterior.situacao === 'INVALIDA' && <span className="fs12-pendencia">Referência histórica inválida · confira a origem.</span>}
            {anterior.valor !== null && <span className="fs12-situacao">{recuperado ? 'No cálculo recuperado' : 'Memória anterior'}: {dinheiro(anterior.valor)} · referência sem comprovação mensal.
              {informado !== null && informado !== anterior.valor && ' Diverge do rascunho.'}</span>}
          </div>;
        })}
      </div>
    </>}

  </section>;
}
