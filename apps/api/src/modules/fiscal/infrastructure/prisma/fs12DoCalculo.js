import { prisma } from '../../../../infrastructure/db/prisma.js';
import { criarPersistenciaFs12 } from './fs12DaApuracao.js';
import { erroFs12 } from '../../domain/serieManualFs12.js';

// B3.3 has no evidence adapter/dispatch wired here. All fiscal facts fail closed by default.
export function criarPersistenciaFs12DoCalculo({ db = prisma, tx, validarSnapshot, lerEvidenciaFiscal = async () => null } = {}) {
  const executar = (cliente, fn, escrita) => criarPersistenciaFs12({
    // Reuse canonical B31 authorization/context ports on exactly this transaction.
    $transaction: async callback => {
      try { return await callback(cliente); }
      catch (e) {
        // Do not retry B31's callback inside an already aborted caller transaction.
        if (['P2034', 'P2002'].includes(e?.code)) throw erroFs12('FS12_CALCULO_CONFLITO', 'Gravação concorrente. Recarregue a apuração.', 409);
        throw e;
      }
    },
  }).transacionar(base => fn({ ...base,
    lerCalculoConfirmado: async entrada => {
      if (escrita) await cliente.$queryRaw`SELECT id FROM apuracao_snapshots WHERE "portalClientId" = ${entrada.portalClientId} AND competencia = ${entrada.competencia} FOR UPDATE`;
      const snapshot = await cliente.apuracaoSnapshot.findUnique({ where: {
        portalClientId_competencia: { portalClientId: entrada.portalClientId, competencia: entrada.competencia },
      } });
      if (!snapshot || !['calculada', 'fechada'].includes(snapshot.estado)) throw erroFs12('FS12_CALCULO_CONFLITO', 'Cálculo vigente não disponível.', 409);
      if (typeof validarSnapshot !== 'function') throw erroFs12('FS12_CALCULO_CONFLITO', 'Validação do cálculo indisponível.', 409);
      return validarSnapshot(snapshot, entrada);
    },
    lerVinculo: entrada => cliente.apuracaoFs12Calculo.findFirst({ where: {
      portalClientId: entrada.portalClientId, competencia: entrada.competencia, calculoId: entrada.calculoId,
      ...(entrada.companyId ? { companyId: entrada.companyId } : {}),
    } }),
    inserirVinculo: data => cliente.apuracaoFs12Calculo.create({ data }),
    lerTentativa: entrada => cliente.apuracaoFs12CalculoFato.findFirst({ where: { ...entrada, tipo: 'TENTATIVA_INICIADA' } }),
    lerFato: entrada => cliente.apuracaoFs12CalculoFato.findUnique({ where: {
      vinculoId_chaveIdempotencia: { vinculoId: entrada.vinculoId, chaveIdempotencia: entrada.chaveIdempotencia },
    } }),
    inserirFato: data => cliente.apuracaoFs12CalculoFato.create({ data }),
    lerEvidenciaFiscal: entrada => lerEvidenciaFiscal(entrada, cliente),
  }), { escrita });
  return { transacionar: async (fn, { escrita }) => {
    if (tx) {
      // Joining the coordinator's transaction must not weaken the B31/B32 write contract.
      // Check before authorization, locks, reads or inserts; never start a nested transaction.
      if (escrita) {
        const [isolation] = await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS nivel`;
        if (isolation?.nivel !== 'serializable') throw erroFs12('FS12_TRANSACAO_INVALIDA', 'A gravação exige uma transação Serializable.', 409);
      }
      return executar(tx, fn, escrita);
    }
    try {
      return await db.$transaction(cliente => executar(cliente, fn, escrita), { isolationLevel: escrita ? 'Serializable' : 'RepeatableRead' });
    } catch (e) {
      if (['P2034', 'P2002'].includes(e?.code)) throw erroFs12('FS12_CALCULO_CONFLITO', 'Gravação concorrente. Recarregue a apuração.', 409);
      throw e;
    }
  } };
}
