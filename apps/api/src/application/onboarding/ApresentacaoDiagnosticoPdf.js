import { formatarEnderecoAbertura, empresaIndividual } from '../../../../../packages/shared/src/onboarding/onboardingSpec.js';
import PDFDocument from 'pdfkit';
import { DADOS_ANALISE, BLOCOS_DEVOLUTIVA, CONFERENCIAS_ANALISE } from '../../../../../packages/shared/src/onboarding/roteiroAnaliseComercial.js';

const texto = value => String(value ?? 'Não informado').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[\u2010-\u2015]/g, '-');
const origens = { TRANSFERENCIA: 'Transferência de contabilidade', INATIVA: 'Empresa parada', ABERTURA: 'Abertura de empresa', PESSOA_FISICA: 'Serviço para pessoa física' };
const estados = { FEITO: 'Conferido', PENDENTE: 'A conferir', NAO_APLICAVEL: 'Não aplicável' };
const regimes = { SIMPLES: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real', MEI: 'MEI' };

// Projeção deliberada: não publicar triagem interna, logs, tokens ou catálogo privado.
export function apresentarDiagnostico({ ficha, diagnostico, fiscal = null }) {
  const d = ficha.dados || {}, cadastro = d.cadastroCnpj?.empresa || d.cadastroCnpj || {}, dados = diagnostico.dados || {};
  const campos = [
    ['Razão social', d.razaoSocial || cadastro.razaoSocial], ['CNPJ', ficha.cnpj],
    ['Nome fantasia', cadastro.nomeFantasia], ['Atividade', cadastro.atividadePrincipal || d.atividadePretendida],
    ['CNAE principal', cadastro.cnaePrincipal], ['Natureza jurídica', cadastro.naturezaJuridica],
    ['Porte', cadastro.porte], ['Abertura', cadastro.dataAbertura],
    ['Endereço', typeof cadastro.endereco === 'string' ? cadastro.endereco : [cadastro.endereco?.logradouro || cadastro.endereco?.rua, cadastro.endereco?.numero, cadastro.endereco?.complemento, cadastro.endereco?.bairro, cadastro.endereco?.cep].filter(Boolean).join(', ') || formatarEnderecoAbertura(d.enderecoAbertura) || d.enderecoPretendido],
    ['Município', cadastro.municipio || d.enderecoAbertura?.cidade || d.municipioAtendimento || d.municipioPretendido], ['UF', cadastro.uf || d.enderecoAbertura?.uf],
    ['Situação cadastral', cadastro.situacaoCadastral], ['Regime declarado', regimes[d.regimeAtual || d.regimePretendido] || d.regimeAtual || d.regimePretendido],
    ['Responsável', ficha.responsavelNome || d.responsavelNome],
    ['Capital social', (cadastro.capitalSocial ?? d.capitalSocialPretendido) == null ? null : Number(cadastro.capitalSocial ?? d.capitalSocialPretendido).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })],
    ['CNAEs secundários', cadastro.cnaesSecundarios?.map(c => [c.codigo, c.descricao].filter(Boolean).join(' - ')).join('\n')],
    [empresaIndividual(d) ? 'Titular' : 'Quadro societário', (empresaIndividual(d) ? d.titular : d.socios?.length ? d.socios : cadastro.socios)?.map(s => [s.nome, s.cpf, s.qualificacao].filter(Boolean).join(' - ')).join('\n')],
  ];
  return { diagnosticoId: diagnostico.id, criadoEm: diagnostico.createdAt, origem: origens[ficha.origem] || 'Atendimento comercial',
    cadastro: campos.filter(([, value]) => value !== undefined && value !== null && value !== ''),
    fonteCadastro: d.cadastroCnpj?.origem === 'MANUAL' || dados.conferenciaCadastro?.modo === 'MANUAL' ? 'Cadastro informado/conferido manualmente pelo escritório.' : (d.cadastroCnpj?.fonte || cadastro.fonte) ? `Cadastro: ${d.cadastroCnpj?.fonte || cadastro.fonte}.` : 'Dados registrados na ficha pelo escritório; origem pública não comprovada.',
    fiscal: fiscal?.resultado?.leitura?.relatorio || null,
    fonteFiscal: fiscal ? `Relatório fiscal salvo em ${new Date(fiscal.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Apresentação dos dados salvos; não substitui o documento oficial.` : 'Sem consulta fiscal oficial válida vinculada a este diagnóstico. Não comprova regularidade fiscal.',
    limitacao: dados.dispensaConsultaPrivada || null,
    situacaoManual: dados.fiscalAlternativa?.dados?.informacao || dados.fiscalAlternativa?.informacao || null,
    roteiro: DADOS_ANALISE.map(c => { const v = dados.roteiro?.dados?.[c.chave]; return [c.rotulo, c.tipo === 'valor' && typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : v]; }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    conferencias: CONFERENCIAS_ANALISE.filter(c => dados.roteiro?.conferencias?.[c.chave]).map(c => { const item = dados.roteiro.conferencias[c.chave]; return [c.rotulo, `${estados[item.estado] || 'A conferir'}${item.evidencia ? ': ' + item.evidencia : ''}`]; }),
    devolutiva: BLOCOS_DEVOLUTIVA.filter(c => dados.devolutiva?.[c.chave]).map(c => [c.rotulo, dados.devolutiva[c.chave]]),
    servicos: dados.servicos, regularizacao: dados.regularizacao?.justificativa || null,
    pendencias: Array.isArray(dados.roteiroPendencias) ? dados.roteiroPendencias : [],
  };
}

export function gerarApresentacaoDiagnosticoPdf(p) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 72, bottom: 58, left: 46, right: 46 }, bufferPages: true,
      info: { Title: 'Apresentação da empresa - ALTAN', Author: 'ALTAN Contabilidade' } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const x = 46, width = doc.page.width - 92, bottom = doc.page.height - 58;
    function header() {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#29344C').text('ALTAN', x, 30, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor('#65708A').text('APRESENTAÇÃO DA EMPRESA', x + 180, 34, { width: width - 180, align: 'right', lineBreak: false });
      doc.moveTo(x, 56).lineTo(x + width, 56).strokeColor('#E2E5EB').lineWidth(.6).stroke(); doc.x = x; doc.y = 76;
    }
    doc.on('pageAdded', header); header();
    const room = h => { if (doc.y + h > bottom) doc.addPage(); };
    function paragraph(value, bold = false) {
      if (value === null || value === undefined || value === '') return;
      room(35); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor('#414958').text(texto(value), x, doc.y, { width, lineGap: 3 }); doc.y += 8;
    }
    function section(title) { room(65); doc.y += 9; doc.font('Helvetica-Bold').fontSize(16).fillColor('#29344C').text(title, x, doc.y, { width }); doc.y += 12; }
    // Fixed two-column table with wrapping and page breaks, including oversized cells.
    function table(rows) {
      for (const [label, value] of rows) {
        const labelWidth = 154, valueWidth = width - labelWidth - 18;
        doc.font('Helvetica').fontSize(9);
        const clean = texto(value);
        const height = Math.max(doc.heightOfString(texto(label), { width: labelWidth - 12 }), doc.heightOfString(clean, { width: valueWidth })) + 16;
        if (height > bottom - 85) { paragraph(label, true); paragraph(clean); continue; }
        room(height); const y = doc.y;
        doc.rect(x, y, width, height).fill('#F4F5F8');
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#414958').text(texto(label), x + 8, y + 8, { width: labelWidth - 12 });
        doc.font('Helvetica').fontSize(9).text(clean, x + labelWidth, y + 8, { width: valueWidth });
        doc.y = y + height + 3; doc.x = x;
      }
      doc.y += 6;
    }
    try {
      section('Sobre a empresa'); paragraph(p.origem); table(p.cadastro); paragraph(p.fonteCadastro);
      section('Situação fiscal'); paragraph(p.fonteFiscal); if (p.limitacao) paragraph(p.limitacao); if (p.situacaoManual) paragraph('Informação manual do escritório: ' + p.situacaoManual);
      for (const item of p.fiscal?.diagnosticos || []) {
        paragraph(item.orgao, true); if (item.semPendencia) paragraph('Sem pendência indicada no relatório salvo.');
        for (const block of item.blocos || []) {
          paragraph(block.titulo, true); if (block.descricao) paragraph(Array.isArray(block.descricao) ? block.descricao.join('\n') : block.descricao);
          for (const [index, record] of (block.registros || []).entries()) { paragraph(`Registro ${index + 1}`, true); table((block.colunas || []).map(c => [c, record[c]])); }
          if (block.aviso) paragraph(block.aviso);
          for (const line of [...(block.anotacoes || []), ...(block.naoInterpretado || [])]) paragraph(line);
          for (const record of block.anotacoesPorRegistro || []) table(Object.entries(record));
        }
      }
      for (const line of p.fiscal?.naoInterpretado || []) paragraph(line);
      section('Perfil e diagnóstico'); if (p.roteiro.length) table(p.roteiro); else paragraph('Volumes e informações complementares não informados.');
      for (const [label, value] of p.devolutiva) { paragraph(label, true); paragraph(value); }
      if (p.conferencias.length) { section('Conferências e limitações'); table(p.conferencias); }
      if (p.pendencias.length) paragraph('Ainda a conferir: ' + p.pendencias.join('; ') + '.');
      section('Serviços propostos'); paragraph(p.servicos); if (p.regularizacao) paragraph(p.regularizacao);
      paragraph('Os valores e condições serão apresentados na proposta comercial. Este documento não comprova contratação, pagamento ou regularidade fiscal.');
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i); const margin = doc.page.margins.bottom; doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7).fillColor('#65708A').text(`Diagnóstico ${p.diagnosticoId} · ${new Date(p.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, x, doc.page.height - 35, { width: width - 65, lineBreak: false });
        doc.text(`${i + 1} / ${pages.count}`, x + width - 60, doc.page.height - 35, { width: 60, align: 'right', lineBreak: false }); doc.page.margins.bottom = margin;
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
