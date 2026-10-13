import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/db/prisma.js';
import { encaminharContingenciaComercial } from './ContingenciaComercialService.js';

export const ESPERA_RESPOSTA_COMERCIAL_MS = 5 * 60 * 1000;

// Observe a entrada persistida, não só o job legado: a coleta atual chama GPT
// dentro do processamento do inbox. Este observador não depende daquele ciclo.
export function consultaContingenciasComerciais({ agora, limite = 50 }) {
  const atraso = new Date(agora.getTime() - ESPERA_RESPOSTA_COMERCIAL_MS);
  const estabilizacao = new Date(agora.getTime() - 30000);
  const inicioJanela = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  return Prisma.sql`
    SELECT c.id AS "conversaId", m.id AS "mensagemId",
      CASE WHEN saida."statusEnvio" IN ('falhou','indeterminado','enviando') THEN 'FALHA_ENVIO'
        WHEN t.status = 'indeterminado' OR (t.status = 'falhou' AND t.tentativas >= 5) THEN 'TURNO_ESGOTADO'
        ELSE 'RESPOSTA_ATRASADA' END AS motivo
    FROM conversas_whatsapp c
    JOIN canais_whatsapp canal ON canal.id = c."canalId" AND canal.ativo AND canal.finalidade = 'COMERCIAL'
    JOIN vinculos_numero_interlocutor v ON v.id = c."vinculoNumeroId" AND v."encerrouEm" IS NULL
    JOIN interlocutores_comunicacao p ON p.id = v."interlocutorId" AND p.estado = 'ATIVO'
    JOIN LATERAL (
      SELECT entrada.* FROM mensagens_whatsapp entrada
      WHERE entrada."conversaId" = c.id AND entrada.direcao = 'in' AND entrada.tipo <> 'reaction'
      ORDER BY entrada."registradaEm" DESC, entrada.id DESC LIMIT 1
    ) m ON true
    LEFT JOIN turnos_ia_whatsapp t ON t."mensagemId" = m.id AND t.perfil = 'LEAD'
    LEFT JOIN LATERAL (
      SELECT s."statusEnvio" FROM mensagens_whatsapp s
      WHERE s."conversaId" = c.id AND s.direcao = 'out' AND s."registradaEm" >= m."registradaEm"
      ORDER BY s."registradaEm" DESC, s.id DESC LIMIT 1
    ) saida ON true
    WHERE c."excluidaEm" IS NULL AND c."atendidaPor" IS NULL AND p."atendidaPor" IS NULL
      AND ((c."atendidaDesde" IS NULL AND p."atendidaDesde" IS NULL)
        OR EXISTS (SELECT 1 FROM atendimentos_lead a WHERE a."conversaId" = c.id AND a."encerradoEm" IS NULL
          AND a.triagem->'preatendimento'->>'estado' = 'ENCAMINHADO'
          AND (saida."statusEnvio" IN ('falhou','indeterminado','enviando')
            OR (saida."statusEnvio" IS NULL AND m."registradaEm" <= ${atraso.toISOString()}::timestamp
              AND a.triagem->'preatendimento'->>'encaminhadoEm' >= to_char(m."registradaEm", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))))
      AND (c."automacaoInvalidadaEm" IS NULL OR m."registradaEm" > c."automacaoInvalidadaEm")
      AND m."registradaEm" <= ${estabilizacao.toISOString()}::timestamp
      AND m."registradaEm" > ${inicioJanela.toISOString()}::timestamp
      AND NOT EXISTS (SELECT 1 FROM atendimentos_lead a WHERE a."conversaId" = c.id AND a."encerradoEm" IS NULL
        AND a.triagem->'contingenciaIa'->>'estado' = 'PENDENTE')
      AND (m."registradaEm" <= ${atraso.toISOString()}::timestamp OR saida."statusEnvio" IN ('falhou','indeterminado')
        OR t.status = 'indeterminado' OR (t.status = 'falhou' AND t.tentativas >= 5))
      AND NOT EXISTS (SELECT 1 FROM mensagens_whatsapp resposta
        WHERE resposta."conversaId" = c.id AND resposta.direcao = 'out'
          AND resposta."registradaEm" >= m."registradaEm"
          AND resposta."statusEnvio" IN ('enviado','entregue','lido'))
      AND NOT EXISTS (SELECT 1 FROM atendimentos_lead a JOIN onboardings o ON o.id = a."onboardingId"
        WHERE a."conversaId" = c.id AND a."encerradoEm" IS NULL
          AND o.status IN ('CONVERTIDO','DESISTIU','CONCLUIDO_AVULSO'))
    ORDER BY m."registradaEm" ASC LIMIT ${Math.max(1, Math.min(100, limite))}`;
}

export async function processarContingenciasComerciaisUmaVez({ client = prisma, agora = new Date(), limite = 50,
  encaminhar = encaminharContingenciaComercial, log = console } = {}) {
  const candidatos = await client.$queryRaw(consultaContingenciasComerciais({ agora, limite }));
  const resumo = { encontrados: candidatos.length, encaminhados: 0, falhas: 0 };
  for (const candidato of candidatos) {
    try {
      // O helper confere novamente identidade, humano e resposta sob lock.
      // Nunca reenviamos uma saída: timeout de transporte pode ter sido entregue.
      const r = await encaminhar({ ...candidato, client, agora, exigirSemResposta: true });
      if (r?.encaminhado) resumo.encaminhados += 1;
    } catch (e) {
      resumo.falhas += 1;
      log.error?.({ conversaId: candidato.conversaId, codigo: e?.code || 'CONTINGENCIA_FALHOU' }, 'Comercial: contingência será tentada no próximo ciclo');
    }
  }
  return resumo;
}

