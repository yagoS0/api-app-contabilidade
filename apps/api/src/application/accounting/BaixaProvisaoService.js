import { PROVISAO_TO_BAIXA_EVENT } from '../../routes/firm/accountingEntryRules.js';
import { subtipoDaProvisao } from './subtipoDaProvisao.js';
import { computeSaldoProvisao } from './saldoProvisao.js';
import { isMonthClosed } from './fechamentoContabil.js';
import { exigirBaixaForaDaComposicao, composicaoHabilitada } from './parcelamento/ComposicaoParcelamentoService.js';
import { registrarAlteracaoTx } from './CorrecaoMesContabilService.js';
const r2 = (n) => Math.round(Number(n) * 100) / 100;
function recusar(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function deriveBaixaEventType(entry) {
  if (!entry) return null;
  if (entry.eventType && PROVISAO_TO_BAIXA_EVENT[entry.eventType]) return PROVISAO_TO_BAIXA_EVENT[entry.eventType];
  if (entry.eventType) return `BAIXA_${entry.eventType}`;
  if (entry.subtipo) return `BAIXA_${entry.subtipo}`;
  return null;
}

const SUFIXO_PAPEL = { PRINCIPAL: "", JUROS: " (juros)", MULTA: " (multa)" };
function separarLinhasPorPapel(linhas) {
  const debitos = linhas.filter((l) => String(l.tipo || "").toUpperCase() === "D");
  const credito = linhas.find((l) => String(l.tipo || "").toUpperCase() === "C");
  const contaCaixa = String(credito?.conta || "").trim();
  const grupos = [];
  for (const papel of ["PRINCIPAL", "JUROS", "MULTA"]) {
    const doGrupo = debitos.filter((l) => {
      const p = String(l.papel || "").trim().toUpperCase();
      return papel === "PRINCIPAL" ? (!p || p === "PRINCIPAL") : p === papel;
    });
    // Mesmo papel não autoriza consolidar partidas: cada débito é um lançamento 1D/1C.
    for (const debito of doGrupo) {
      const total = r2(parseFloat(String(debito.valor).replace(",", ".")) || 0);
      if (total > 0) grupos.push({ papel, debitos: [debito], total, contaCaixa });
    }
  }
  return grupos;
}



// Reutilizada pelo contador e pela confirmação autenticada. Chamador fornece transação serializável.
export async function executarBaixaProvisaoTx(tx, { portalClientId, entryId, dataPagamento, lines, historico, userId, origem = 'MANUAL', autorAuditoria = null, sourceGuideId = null, codigoTributo = null }) {
  const openEntry = await tx.accountingEntry.findFirst({where:{id:entryId,portalClientId},include:{lines:{orderBy:{ordem:'asc'}},baixas:{include:{lines:{orderBy:{ordem:'asc'}}}}}});
  if (!openEntry || openEntry.tipo !== 'PROVISAO') recusar('lancamento_nao_encontrado',404);
  if (!['ABERTO','PARCIAL'].includes(openEntry.statusPagamento)) recusar('lancamento_nao_esta_aberto');
  const data = new Date(dataPagamento);
  if (!dataPagamento || !Number.isFinite(data.getTime())) recusar('data_invalida',400);
  if (!String(historico || '').trim()) recusar('historico_required',400);
  if (!Array.isArray(lines) || !lines.length) recusar('lines_required',400);
  for (const l of lines) if (!String(l.conta || '').trim() || !['D','C'].includes(String(l.tipo).toUpperCase()) || !Number.isFinite(Number(String(l.valor).replace(',','.'))) || Number(String(l.valor).replace(',','.')) <= 0) recusar('linha_invalida',400);
  const debitos = lines.filter(l=>String(l.tipo).toUpperCase()==='D');
  const creditos = lines.filter(l=>String(l.tipo).toUpperCase()==='C');
  if (creditos.length !== 1 || !debitos.length) recusar('BAIXA_CONTRAPARTIDA_UNICA',400);
  for (const l of debitos) { const papel=String(l.papel || '').trim().toUpperCase(); if (papel ? !['PRINCIPAL','JUROS','MULTA'].includes(papel) : debitos.length>1) recusar('PAPEL_DE_BAIXA_INVALIDO',400); }
  const valor = l=>Number(String(l.valor).replace(',','.'));
  if (Math.abs(debitos.reduce((s,l)=>s+valor(l),0)-valor(creditos[0]))>0.01) recusar('BAIXA_DESBALANCEADA',400);
  const saldoAtual=computeSaldoProvisao(openEntry);
  const principalDestaBaixa=r2(debitos.filter(l=>!l.papel || l.papel.toUpperCase()==='PRINCIPAL').reduce((s,l)=>s+valor(l),0));
  if (principalDestaBaixa <= 0 || principalDestaBaixa-saldoAtual.saldo>0.01) recusar('baixa_excede_saldo',400);
  if (!['IRPJ','CSLL'].includes(String(openEntry.subtipo).toUpperCase()) && r2(saldoAtual.saldo-principalDestaBaixa)>0.01) recusar('baixa_principal_incompleto',400);
  const novoStatus=r2(saldoAtual.abatido+principalDestaBaixa)+0.01>=saldoAtual.principal?'PAGO':'PARCIAL';
  const competencia=data.toISOString().slice(0,7);
  if (await isMonthClosed(portalClientId,competencia,tx)) throw Object.assign(new Error('Mês fechado. Use Corrigir mês fechado antes de retomar a baixa.'),{code:'MES_FECHADO',status:409,competencia});
  const reservado=await tx.accountingEntry.updateMany({where:{id:entryId,portalClientId,statusPagamento:openEntry.statusPagamento,updatedAt:openEntry.updatedAt},data:{statusPagamento:novoStatus}});
  if (reservado.count!==1) recusar('BAIXA_CONCORRENTE');
        if(composicaoHabilitada())await exigirBaixaForaDaComposicao(tx,portalClientId,entryId,openEntry.sourceGuideId);
        // PRINCIPAL, JUROS e MULTA viram lançamentos INDEPENDENTES (regra do projeto), cada um
        // balanceado contra o caixa. Um lançamento único misturando os três (3D/1C) some no
        // dropdown e esconde que juros/multa são DESPESA do mês, não amortização do passivo.
        // Componente zerado não gera lançamento.
        const grupos = separarLinhasPorPapel(lines);
        const criados = [];
        for (const g of grupos) {
          const entry = await tx.accountingEntry.create({
            data: {
              portalClientId,
              data,
              competencia,
              historico: `${historico}${SUFIXO_PAPEL[g.papel] || ""}`,
              tipo: "BAIXA",
              sourceGuideId,
              codigoTributo,
              subtipo: subtipoDaProvisao(openEntry),
              // Papel e código conservam a identidade em guias consolidadas.
              tipoLinha: g.papel,
              // Q37: o eventType alimenta a memória de contas, e SÓ o lançamento do principal o
              // carrega. Isso NÃO mudou com o índice parcial — mudou só a razão de ser.
              //
              // ⚠ Antes havia DUAS razões e uma delas era o unique de competência (repetir o
              // evento nos três lançamentos do lote violava a constraint e derrubava a baixa
              // inteira). Essa razão caiu: desde
              // `20260818160000_unique_competencia_nao_morde_baixa` o índice é parcial em
              // `tipo <> 'BAIXA'` e não alcança mais nenhuma destas linhas.
              //
              // ⚠ A OUTRA RAZÃO CONTINUA DE PÉ E É A QUE MANDA: a memória D/C
              // (`AccountingHistorico`) é do par do TRIBUTO, não de juros/multa. Marcar os três
              // com o mesmo evento faria a conta de juros (501) e a de multa (506) sobrescreverem
              // a conta memorizada do tributo, e a próxima baixa viria pré-preenchida com a conta
              // errada. Não afrouxe isto "porque a constraint saiu" — é forma de lançamento, e
              // mudá-la exige pedido explícito do dono.
              eventType: g.papel === "PRINCIPAL" ? deriveBaixaEventType(openEntry) : null,
              // Todos apontam para a MESMA provisão: o cálculo de saldo soma as três (e juros/multa
              // não entram no principal abatido, por conta de CONTAS_ACRESCIMO).
              openEntryId: entryId,
              origem,
              statusPagamento: "NA",
              status: "CONFIRMADO",
            },
          });
          await tx.accountingEntryLine.createMany({
            data: [
              ...g.debitos.map((l, idx) => ({
                entryId: entry.id,
                conta: String(l.conta).trim(),
                tipo: "D",
                valor: r2(parseFloat(String(l.valor).replace(",", "."))),
                ordem: idx,
              })),
              { entryId: entry.id, conta: g.contaCaixa, tipo: "C", valor: g.total, ordem: g.debitos.length },
            ],
          });
          criados.push(entry);
        }
        // A baixa "principal" é a referência devolvida ao cliente (é a que amortiza o passivo).
        const baixa = criados[0];
        const updatedOpen = await tx.accountingEntry.update({
          where: { id: entryId },
          data: { statusPagamento: novoStatus },
          include: {
            lines: { orderBy: { ordem: "asc" } },
            baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
          },
        });
        const fullBaixa = await tx.accountingEntry.findUnique({
          where: { id: baixa.id },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
        await registrarAlteracaoTx(tx, {companyId:portalClientId,competencia,autor:autorAuditoria || {id:userId || 'automacao',origem},metadados:autorAuditoria?.confirmacaoId ? {confirmacaoId:autorAuditoria.confirmacaoId} : {},antes:openEntry,depois:{provisao:updatedOpen,baixas:criados}});
        return { entry: fullBaixa, openEntry: updatedOpen, entryIds: criados.map(e => e.id), novoStatus };
}
