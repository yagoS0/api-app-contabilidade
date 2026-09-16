// PLANEJAMENTO TRIBUTÁRIO — os dados da empresa para a simulação, e a FOTO do que foi simulado.
//
// ⚠⚠ O PLANEJAMENTO CONTINUA NÃO GRAVANDO CADASTRO NEM LANÇAMENTO. Esta frase abria o arquivo
// ("UMA rota, GET, sem efeito colateral") e ficou parcialmente falsa em 01/09/2026, quando o dono
// pediu que a simulação pudesse ser *"impressa, salva e colocada na área de documento"*. O que
// passou a existir é a gravação de uma FOTO da própria simulação — nada de cadastro, nada de
// lançamento contábil, nada de ato fiscal. A distinção é o ponto: guardar o que foi entregue ao
// cliente não é escrever no cadastro dele.
//
// ⚠ Multi-tenancy: `requireFirmCompanyAccess()` — a mesma guarda das demais rotas por empresa. O id
// vem do PATH e é conferido contra `CompanyFirmAccess`; nada aqui confia no que o navegador mandou.
// A lista que alimenta o seletor da tela é a de `GET /firm/companies`, que já é escopada pelo mesmo
// critério de `empresasVisiveis` — não há uma quarta leitura de escopo neste módulo.

import { createBaseSociosRouter } from "./baseSocios.js";
import { createClassificacaoGerencialRouter } from "./classificacaoGerencial.js";
import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { montarDadosPlanejamento } from "../../application/planejamento/DadosPlanejamentoService.js";
import {
  salvarSimulacao,
  listarSimulacoes,
  gerarDocumentoDaSimulacao,
  SimulacaoPlanejamentoError,
} from "../../application/planejamento/SimulacaoPlanejamentoService.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { obterAnaliseEmpresa } from '../../application/planejamento/AnaliseEmpresaService.js';
import { obterClientesAnalise } from '../../application/planejamento/ClientesAnaliseService.js';
import { resumirSocios } from '../../../../../packages/shared/src/analise/socios.js';
import { definirPeriodos, listaMeses, exigirFechamento } from '../../application/planejamento/analiseEmpresa.js';

export function createPlanejamentoRouter({ log } = {}) {
  const router = Router({ mergeParams: true });
  router.use(createClassificacaoGerencialRouter());
  router.use(createBaseSociosRouter());

  router.get('/planejamento/analise/fechamentos',requireFirmCompanyAccess(),async(req,res)=>{
    try {const rows=await prisma.companyMonthlyCircular.findMany({where:{portalClientId:String(req.params.companyId),fechadoContabilEm:{not:null}},select:{competencia:true},orderBy:{competencia:'desc'}});return res.json({ok:true,competenciasFechadas:rows.map(r=>r.competencia)});}
    catch {return res.status(500).json({ok:false,message:'Não foi possível conferir os fechamentos contábeis.'});}
  });
  router.get('/planejamento/analise/relatorio',requireFirmCompanyAccess(),async(req,res)=>{
    try {
      const filtros={portalClientId:String(req.params.companyId),de:req.query.de,ate:req.query.ate,comparar:req.query.comparar};
      definirPeriodos(filtros);
      const foto=await prisma.$transaction(async client=>{
        const [dados,clientes,classificacao,empresa,basesSocios]=await Promise.all([obterAnaliseEmpresa({...filtros,client}),obterClientesAnalise({...filtros,client}),client.classificacaoGerencial.findUnique({where:{companyId:filtros.portalClientId}}),client.portalClient.findUnique({where:{id:filtros.portalClientId},select:{id:true,razao:true,cnpj:true}}),client.baseSociosGerencial.findMany({where:{companyId:filtros.portalClientId,competencia:{gte:filtros.de,lte:filtros.ate}},orderBy:[{competencia:'desc'},{id:'desc'}],distinct:['competencia']})]);
        return {dados,clientes,empresa,socios:resumirSocios(basesSocios,listaMeses(filtros.de,filtros.ate),dados.atual.indicadores.resultado),basesSocios,classificacao:classificacao?.contasJson||{},revisao:classificacao?.revisao||0};
      },{isolationLevel:'RepeatableRead',timeout:20000});
      return res.json({ok:true,...foto});
    }catch(e){if(e.code==='CONTABILIDADE_ABERTA')return res.status(409).json({ok:false,error:e.code,message:e.message,mesesSemFechamento:e.mesesSemFechamento});return res.status(e.message==='PERIODO_INVALIDO'?400:e.message==='HISTORICO_EXTENSO'?422:500).json({ok:false,message:e.message==='HISTORICO_EXTENSO'?'Histórico excede 20 mil notas. Relatório não foi gerado parcialmente.':'Não foi possível preparar a fotografia do relatório.'});}
  });
  router.get('/planejamento/analise/base-tributaria', requireFirmCompanyAccess(), async(req,res)=>{
    const referencia=String(req.query.referencia||'');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(referencia))return res.status(400).json({ok:false,message:'Referência inválida.'});
    try { const dados=await montarDadosPlanejamento({portalClientId:String(req.params.companyId),agora:new Date(referencia+'-15T12:00:00Z')});if(!dados)return res.status(404).json({ok:false,message:'Empresa não encontrada.'});return res.json({ok:true,...dados}); }
    catch { return res.status(500).json({ok:false,message:'Não foi possível consultar a base tributária existente.'}); }
  });
  router.get('/planejamento/analise/clientes', requireFirmCompanyAccess(), async (req,res)=>{
    try { return res.json(await obterClientesAnalise({portalClientId:String(req.params.companyId),de:req.query.de,ate:req.query.ate,comparar:req.query.comparar})); }
    catch(err){
      if(err.code==='CONTABILIDADE_ABERTA')return res.status(409).json({ok:false,error:err.code,message:err.message,mesesSemFechamento:err.mesesSemFechamento});
      if(err.message==='PERIODO_INVALIDO')return res.status(400).json({ok:false,message:'Escolha um período válido de até 24 meses.'});
      if(err.message==='HISTORICO_EXTENSO')return res.status(422).json({ok:false,message:'Histórico acima de 20 mil notas. A análise precisa de processamento ampliado; nenhum total parcial foi apresentado.'});
      log?.error?.({err},'analise_clientes_falhou');return res.status(500).json({ok:false,message:'Não foi possível carregar a análise dos clientes.'});
    }
  });

  router.get('/planejamento/analise', requireFirmCompanyAccess(), async (req, res) => {
    try {
      return res.json(await obterAnaliseEmpresa({ portalClientId: String(req.params.companyId), de: req.query.de, ate: req.query.ate, comparar: req.query.comparar }));
    } catch (err) {
      if(err.code==='CONTABILIDADE_ABERTA')return res.status(409).json({ok:false,error:err.code,message:err.message,mesesSemFechamento:err.mesesSemFechamento});
      if (err.message === 'PERIODO_INVALIDO') return res.status(400).json({ ok: false, message: 'Escolha um período válido de até 24 meses.' });
      log?.error?.({ err }, 'analise_planejamento_falhou');
      return res.status(500).json({ ok: false, message: 'Não foi possível carregar a análise da empresa.' });
    }
  });
  router.get('/planejamento/analise/lancamentos', requireFirmCompanyAccess(), async (req, res) => {
    try {
      definirPeriodos({ de: req.query.de, ate: req.query.ate });
      const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
      if (!req.query.conta || String(req.query.conta).length > 40 || pagina > 10000) return res.status(400).json({ ok: false, message: 'Conta ou página inválida.' });
      const linhas=await prisma.$transaction(async client=>{
      const circulares=await client.companyMonthlyCircular.findMany({where:{portalClientId:String(req.params.companyId),competencia:{gte:req.query.de,lte:req.query.ate}},select:{competencia:true,fechadoContabilEm:true}});
      exigirFechamento(req.query.de,req.query.ate,circulares);
      const rows = await client.accountingEntry.findMany({ where: { portalClientId: String(req.params.companyId), competencia: { gte: req.query.de, lte: req.query.ate }, lines: { some: { conta: String(req.query.conta) } } }, select: { id: true, competencia: true, historico: true, sourceGuideId: true, status: true, lines: { where: { conta: String(req.query.conta) }, select: { tipo: true, valor: true, conta: true } } }, orderBy: [{ data: 'desc' }, { id: 'asc' }], take: 51, skip: (pagina - 1) * 50 });
      return { ok: true, linhas: rows.slice(0,50), temMais: rows.length > 50 };
      },{isolationLevel:'RepeatableRead',timeout:20000});
      return res.json(linhas);
    } catch (err) {
      if(err.code==='CONTABILIDADE_ABERTA')return res.status(409).json({ok:false,error:err.code,message:err.message,mesesSemFechamento:err.mesesSemFechamento});
      return res.status(err.message === 'PERIODO_INVALIDO' ? 400 : 500).json({ ok: false, message: 'Não foi possível ler os lançamentos deste período.' });
    }
  });

  router.get("/planejamento", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const dados = await montarDadosPlanejamento({ portalClientId });
      if (!dados) return res.status(404).json({ ok: false, error: "company_not_found" });
      return res.json({ ok: true, ...dados });
    } catch (err) {
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao montar dados de planejamento");
      return res.status(500).json({ ok: false, error: "planejamento_fetch_failed" });
    }
  });

  // ─── A FOTO DA SIMULAÇÃO ────────────────────────────────────────────────────────────────────
  //
  // ⚠ `minRole: "ACCOUNTANT"` nas duas escritas, no molde da `emissao-nfse`: o planejamento é
  // documento que vai ao cliente, e quem o assina é o contador.

  router.get("/planejamento/simulacoes", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const simulacoes = await listarSimulacoes({ portalClientId });
      return res.json({ ok: true, simulacoes });
    } catch (err) {
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao listar simulações");
      return res.status(500).json({ ok: false, error: "simulacoes_fetch_failed" });
    }
  });

  router.post("/planejamento/simulacoes", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      // ⚠⚠ O `portalClientId` VEM DO PATH e é escrito DEPOIS do spread — um `portalClientId` no
      // corpo apontaria a foto para OUTRA empresa depois de a permissão ter sido conferida nesta.
      // É literalmente o furo de multi-tenancy que a F1 do WhatsApp já pagou.
      const simulacao = await salvarSimulacao({
        ...req.body,
        portalClientId,
        geradoPor: req.user?.id || null,
      });
      return res.status(201).json({ ok: true, simulacao });
    } catch (err) {
      if (err instanceof SimulacaoPlanejamentoError) {
        return res.status(err.status).json({ ok: false, error: err.codigo, message: err.message });
      }
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao salvar simulação");
      return res.status(500).json({ ok: false, error: "simulacao_save_failed" });
    }
  });

  router.post(
    "/planejamento/simulacoes/:simulacaoId/documento",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        // ⚠ A razão social vai para o cabeçalho do PDF, que circula sozinho. Lida aqui, do banco —
        // nunca do corpo do pedido: um nome vindo do navegador poria no papel a empresa que quem
        // chamou quisesse.
        const empresa = await prisma.portalClient.findUnique({
          where: { id: portalClientId },
          select: { razao: true, cnpj: true },
        });
        const out = await gerarDocumentoDaSimulacao({
          portalClientId,
          id: String(req.params.simulacaoId),
          empresa,
          uploadedById: req.user?.id || null,
        });
        return res.status(201).json({ ok: true, ...out });
      } catch (err) {
        if (err instanceof SimulacaoPlanejamentoError) {
          return res.status(err.status).json({ ok: false, error: err.codigo, message: err.message });
        }
        // ⚠⚠ FALHA DE STORAGE CHEGA NOMEADA. Sem o Volume no Railway (`/app/storage` +
        // `GUIDE_LOCAL_STORAGE_DIR` absoluto) a gravação falha, e um 500 genérico faria o contador
        // procurar o defeito na simulação em vez de na infraestrutura.
        log?.warn?.({ err: err?.message, portalClientId }, "Falha ao gerar documento da simulação");
        return res.status(500).json({
          ok: false,
          error: "documento_nao_gerado",
          message: "A simulação foi salva, mas o PDF não pôde ser guardado. Verifique o armazenamento de arquivos.",
        });
      }
    },
  );

  return router;
}
