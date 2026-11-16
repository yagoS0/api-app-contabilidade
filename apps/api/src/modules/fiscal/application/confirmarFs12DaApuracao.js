import { erroFs12, validarIdentidadeFs12, validarSerieManualFs12 } from '../domain/serieManualFs12.js';
export async function confirmarFs12DaApuracao(entrada, { transacionar }) {
  validarIdentidadeFs12(entrada);
  const { revisaoEsperada, chaveIdempotencia, contextoRevisao } = entrada;
  const motivo = typeof entrada.motivo === 'string' ? entrada.motivo.trim() : null;
  if (!Number.isSafeInteger(revisaoEsperada) || revisaoEsperada < 0 || revisaoEsperada >= 2147483647
    || typeof chaveIdempotencia !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(chaveIdempotencia)
    || typeof contextoRevisao !== 'string' || !/^[a-f0-9]{64}$/.test(contextoRevisao)
    || (revisaoEsperada > 0 && !motivo) || (motivo && motivo.length > 1000))
    throw erroFs12('FS12_COMANDO_INVALIDO', 'Informe revisão, chave de repetição, contexto e motivo da substituição válidos.', 400);
  return transacionar(async portas => {
    await portas.autorizar(entrada);
    const contexto = await portas.lerContexto(entrada);
    if (!contexto) throw erroFs12('EMPRESA_NAO_ENCONTRADA', 'Empresa não encontrada.', 404);
    const escopo = { portalClientId: entrada.portalClientId, companyId: contexto.empresaId, competencia: entrada.competencia };
    const anteriorComando = await portas.lerComando({ ...escopo, chaveIdempotencia });
    const serieRecebida = Array.isArray(entrada.serie) ? [...entrada.serie].sort((a, b) => String(a?.mes).localeCompare(String(b?.mes))) : entrada.serie;
    const comandoHash = portas.hash({ ...escopo, autorId: entrada.autorId, revisaoEsperada, contextoRevisao, serie: serieRecebida, motivo });
    if (anteriorComando) {
      if (anteriorComando.comandoHash !== comandoHash) throw erroFs12('FS12_IDEMPOTENCIA_CONFLITO', 'Esta chave já foi usada com outro conteúdo.', 409);
      return { confirmacao: anteriorComando, replay: true, autorizaEfeitoFiscal: false };
    }
    if (portas.hash(contexto) !== contextoRevisao) throw erroFs12('FS12_CONTEXTO_ALTERADO', 'O cadastro mudou. Recarregue o contexto antes de conferir novamente.', 409);
    const { politica, serie } = validarSerieManualFs12(contexto, entrada.serie);
    const ultima = await portas.lerUltima(escopo);
    if ((ultima?.revisao || 0) !== revisaoEsperada) throw erroFs12('FS12_REVISAO_CONFLITO', 'Outra revisão foi confirmada. Recarregue antes de confirmar.', 409);
    const confirmacao = await portas.inserir({ ...escopo, revisao: revisaoEsperada + 1,
      serie, politicaVersao: politica.versao, contexto, contextoRevisao,
      serieHash: portas.hash(serie), comandoHash, autorId: entrada.autorId, chaveIdempotencia, motivo });
    return { confirmacao, replay: false, autorizaEfeitoFiscal: false };
  }, { escrita: true });
}
