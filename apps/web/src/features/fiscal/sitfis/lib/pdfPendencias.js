import { subtotalDocumental } from '@contabilidade/shared/pendencias-fiscais';

const moeda = n => n == null ? '-' : (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const texto = v => String(v ?? '-').replace(/[\u2010-\u2015]/g, '-').replace(/\u00a0/g, ' ');
const COBERTURA = { NAO_CONSULTADO: 'Sem consulta automática', SEM_REGISTROS: 'Sem pendências no relatório', PARCIAL: 'Leitura parcial - conferir documento', INCONCLUSIVO: 'Leitura inconclusiva', COM_REGISTROS: '' };

// Recebe snapshot das linhas que o usuário escolheu exportar. Não consulta provedores.
export async function gerarPdfPendencias({ empresa, fontes, emitidoEm, escopo = 'Todas as pendências', agora = new Date() }, Construtor = null) {
  const PDFDocument = Construtor || (await import('pdfkit/js/pdfkit.standalone.js')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: 'Pendências fiscais', Author: 'Altan' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('error', reject);
    doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    const margem = 36, largura = doc.page.width - 72, limite = doc.page.height - 48;
    const colunas = [['Imposto',110], ['Competência',65], ['Vencimento',70], ['Valor',85], ['Situação',100], ['Origem',70], ['Descrição',largura-500]];
    let y = 36;
    function escrever(t, x, topo, tamanho = 9, bold = false, width = largura, align = 'left') {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamanho).fillColor('#263247').text(texto(t), x, topo, { width, align, lineBreak: false });
    }
    function cabecalho() {
      escrever('ALTAN  /  PENDÊNCIAS FISCAIS', margem, 28, 9, true);
      escrever(empresa.demonstracao ? 'DEMONSTRAÇÃO - DADOS FICTÍCIOS' : 'Relatório para conferência', margem, 28, 8, false, largura, 'right');
      doc.moveTo(margem, 46).lineTo(margem+largura, 46).strokeColor('#CBD5E1').stroke();
      y = 58;
    }
    function novaPagina() { doc.addPage(); cabecalho(); }
    function linhas(t, larguraColuna, fontSize = 8) {
      doc.font('Helvetica').fontSize(fontSize);
      const saida = [], palavras = texto(t).split(/\s+/); let atual = '';
      for (let palavra of palavras) {
        if (atual && doc.widthOfString(`${atual} ${palavra}`) > larguraColuna) { saida.push(atual); atual = ''; }
        while (doc.widthOfString(palavra) > larguraColuna) {
          let corte = palavra.length - 1;
          while (corte > 1 && doc.widthOfString(palavra.slice(0,corte)) > larguraColuna) corte--;
          saida.push(palavra.slice(0,corte)); palavra = palavra.slice(corte);
        }
        atual = atual ? `${atual} ${palavra}` : palavra;
      }
      if (atual || !saida.length) saida.push(atual || '-');
      return saida;
    }
    function paragrafo(t, tamanho = 9) {
      for (const linha of linhas(t, largura, tamanho)) {
        if (y + 14 > limite) novaPagina();
        escrever(linha, margem, y, tamanho); y += 13;
      }
      y += 6;
    }
    function tituloFonte(fonte, continua = false) {
      if (y + 76 > limite) novaPagina();
      escrever(`${fonte.nome}${continua ? ' (continuação)' : ''}`, margem, y, 11, true); y += 20;
      if (!continua && COBERTURA[fonte.cobertura]) { escrever(COBERTURA[fonte.cobertura], margem, y, 8); y += 16; }
      doc.rect(margem,y,largura,25).fill('#EDF0F5'); let x = margem;
      for (const [nome,w] of colunas) { escrever(nome,x+6,y+8,8,true,w-12,nome==='Valor'?'right':'left'); x += w; }
      y += 25;
    }
    cabecalho();
    paragrafo(empresa.razao || empresa.nome || 'Empresa não informada', 14);
    paragrafo(`CNPJ: ${empresa.cnpj || 'Não informado'}  |  Emitido em ${agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 9);
    paragrafo(`${escopo}${emitidoEm ? `  |  Relatório fiscal de ${emitidoEm}` : ''}`, 8);
    for (const fonte of fontes) {
      if (!fonte.linhas.length) {
        if (y + 46 > limite) novaPagina();
        escrever(fonte.nome,margem,y,11,true); y += 20;
        paragrafo(`${COBERTURA[fonte.cobertura] || 'Nenhum registro neste recorte.'}`,8); y += 8;
        continue;
      }
      tituloFonte(fonte);
      for (const [indice,l] of fonte.linhas.entries()) {
        const descricao = (l.origem === 'CONTABILIDADE' ? l.evidencia?.registro?.Descrição : '') || l.manual?.dados.observacoes || l.inscricao || l.titulo || '-';
        const valores = [l.tributo || l.evidencia?.registro?.Declaração || l.titulo, l.competencia, l.vencimento, moeda(l.total), l.situacao, l.origem === 'CONTABILIDADE' ? 'Contabilidade' : l.manual ? 'Manual' : 'SITFIS', descricao];
        const celulas = valores.map((v,i) => linhas(v,colunas[i][1]-12));
        let offset = 0, restante = Math.max(...celulas.map(c => c.length));
        while (restante > 0) {
          if (y+26 > limite) { novaPagina(); tituloFonte(fonte,true); }
          const cabem = Math.max(1,Math.floor((limite-y-12)/11));
          const qtd = Math.min(restante,cabem), altura = qtd*11+12;
          if (indice%2 === 0) doc.rect(margem,y,largura,altura).fill('#F8FAFC');
          let x = margem;
          for (let i=0;i<celulas.length;i++) {
            const parte = i===0 && offset>=celulas[i].length ? [celulas[0][0], '(continuação)'].slice(0,qtd) : celulas[i].slice(offset,offset+qtd);
            parte.forEach((v,j) => escrever(v,x+6,y+6+j*11,8,false,colunas[i][1]-12,i===3?'right':'left'));
            x += colunas[i][1];
          }
          y += altura;
          doc.moveTo(margem,y).lineTo(margem+largura,y).strokeColor('#E2E8F0').stroke();
          restante -= qtd; offset += qtd;
        }
      }
      y += 10;
      for (const origem of ["relatório", "manual", "contabilidade"]) {
        const subtotal = subtotalDocumental(fonte.linhas.filter(l => (l.origem === "CONTABILIDADE" ? "contabilidade" : l.manual ? "manual" : "relatório") === origem && !['PAGO','PARCELADO'].includes(l.estado)));
        if (subtotal.quantidade) paragrafo(`Subtotal ${origem === 'relatório' ? 'do relatório' : origem}: ${moeda(subtotal.centavos)}${subtotal.semValor ? ` | ${subtotal.semValor} débito(s) sem valor informado` : ''}`,9);
      }
      if (fonte.avisos?.length) paragrafo('Há informações com leitura incompleta nesta fonte. Conferir o relatório original.',8);
      y += 12;
    }
    paragrafo('Valores de referência, sujeitos a atualização. Registros da contabilidade, manuais e SITFIS podem representar o mesmo débito e têm subtotais separados. Acordos não são somados aos débitos. Este documento não é certidão nem guia de pagamento.',8);
    const range = doc.bufferedPageRange();
    for(let i=0;i<range.count;i++) { doc.switchToPage(i); doc.page.margins.bottom=0; escrever(`Altan | Pendências fiscais | ${i+1}/${range.count}`,margem,doc.page.height-26,8); }
    doc.end();
  });
}
