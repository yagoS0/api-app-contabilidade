# Revisão da aba Fiscal — 14/09/2026

Estado: implementado e validado localmente na branch `codex/fiscal-notas-planejamento`. O plano abaixo foi registrado antes das alterações. Publicação em produção não faz parte desta execução.

## Pedido e decisões

- Auditoria passa a ser aberta por botão em Notas, com indicação de pendências da empresa/competência. Preservar acesso às notas e retorno ao conjunto de achados.
- O defeito de Buscar NFS-e é visual, confirmado pelo usuário: o texto abaixo desloca o botão. Ações ficam alinhadas; status da captura tem linha própria.
- Detalhe da nota separa ações e informações. Preservar XML, itens, ciclo fiscal, vínculos, reutilização e recusas reais.
- Seleção de notas permite baixar XML e PDF, em emitidas e recebidas. XML ausente não vira arquivo vazio, nem PDF incompleto. Resultados parciais identificam as notas e motivos.
- Empresa exclusivamente de serviços e sem IE mantém NF-e recebidas; a opção de NF-e emitidas deixa de aparecer. Ausência de IE sozinha não pode esconder compras recebidas.
- Planejamento serve para análise e simulação. Campos têm rótulo acima, ajuda extensa sai da grade principal. Sugestão por CNAE fica discreta. Anexo pode ser alterado como cenário, inclusive para comparação quando há Fator R; a escolha precisa afetar o resultado e ser preservada ao salvar/reabrir. Cadastro fiscal não é modificado.
- ISS inicial de 5% é premissa editável do planejamento, solicitada pelo usuário; não é nova alíquota fiscal geral nem sobrescreve valor cadastrado/cenário salvo.
- Apuração apresenta faturamento, faixa/anexo, notas consideradas e resultado/relatório, preservando simulação, transmissão, retificação e distinção entre valores locais, simulados e transmitidos.
- Relatório não deve tratar a ausência de cálculo local como ausência de apuração oficial. Diagnóstico histórico não pode afirmar falta de cadastro atual. Faturamento permanece disponível independentemente do cálculo tributário.
- Extrato salvo deve ser lido ao abrir a competência e após apurar. Abrir/ver/baixar documento salvo não faz chamada paga. Atualização na Receita permanece uma ação explícita.

## Estruturas existentes a reaproveitar

- Navegação: `renderCompanyDetailHeader`, `renderCompanyDetailPage`, `rotasDaEmpresa`.
- Notas: `renderNotasFiscaisTab`, `NotasList`, `NotaDetailModal`, `AdnCapturePanel`, `useNotasFiscais`.
- Auditoria: `AuditoriaTab`, `auditoriaTela`, serviço de auditoria e pendências pós-fechamento; achados são perguntas, não vereditos automáticos.
- Downloads: job de XML por empresas/período (`NotasDownloadService`) e gerador individual/lote de DANFSe. O DANFE de NF-e não é gerado atualmente; precisa de implementação e validação próprias, sem reutilizar layout de NFS-e.
- Planejamento: `PlanejamentoPage`, prefill por empresa, motor local, cenários persistidos e PDF com procedência.
- Apuração: `ApuracaoV2Tab`, `FechamentoModal`, `TabelaAnexoReferencia`, `RelatorioFaturamentoPanel`, `RelatorioFaturamentoService`, snapshots e PDFs PGDAS da circular.

## Sequência de execução

1. Navegação, barra de ações e detalhe da nota.
2. Seleção, exportação e disponibilidade por tipo/direção.
3. Planejamento e persistência das premissas editadas.
4. Apuração, relatório e leitura de extrato salvo.
5. Regressões, build e conferência visual; atualizar contextos específicos com comportamento implementado e limitações verificadas.

## Validação necessária

- Trocar empresa/competência/filtro não reaproveita seleção, resposta ou pendência de outro contexto.
- Download respeita tenant, seleção exata, canceladas e falhas parciais; distingue DANFE de DANFSe.
- Alterar anexo/ISS modifica o cenário e persiste ao reabrir, sem gravar cadastro.
- Apuração oficial existente não é apagada por falha do motor local. Simulado não se apresenta como transmitido.
- Extrato existente: zero chamadas de captura na abertura/visualização; atualização apenas por ação explícita.
- Layout de desktop e tela estreita, ações acessíveis por teclado.

## Implementação e validação concluídas

- Notas: auditoria na barra com pendências; status ADN separado dos botões; detalhe em Modal compartilhado, com ações em região própria. Seleção por página e ZIP de XML/DANFE/DANFSe para emitidas/recebidas, com relatório de falhas parciais e limite de 100 notas/50 MB. Sem captura automática ou gravação fiscal.
- Empresas de serviços sem IE: NF-e fica em Recebidas quando todas as atividades são conhecidas e de serviços. Casos ambíguos permanecem conservadores.
- Planejamento: formulário compacto, CNAE sugerido, anexo manual inclusive com Fator R, ISS inicial de 5% apenas na falta de cadastro, e persistência exata das premissas.
- Apuração: faixa e resumo visíveis, tabelas/notas detalhadas expansíveis; relatório após simular; extrato salvo carregado ao abrir. Retorno oficial no snapshot ou declaração no extrato recolhe diagnóstico local, preservando os números da foto. Cadastro da ficha é reconhecido sem criar registro duplicado.
- Frontend: 68 suítes, **1.150 testes aprovados** (Notas, Planejamento, Apuração, Apuração V2 e detalhe da empresa).
- Backend: 13 suítes de Apuração V2, **167 testes aprovados**, mais **6 testes de download selecionado**. Cobrem isolamento por empresa, seleção exata, falha parcial, recusa sem XML, geração real de DANFE, cancelamento e cadastro derivado.
- Parser JSX/no-undef: **34 arquivos sem erros**. Build Vite de produção aprovado; permanecem avisos de tamanho de chunk e mistura de imports existentes. Prisma client gerado; nenhuma migration necessária.
- Navegador mock: duas emitidas em XML/PDF; 12 recebidas em PDF; seleção limpa ao mudar filtro; NF-e apenas recebidas em serviço sem IE; auditoria e retorno; detalhe da nota; anexo IV e ISS 4% salvos/reabertos; simulação, relatório e extrato preservado ao reabrir. Layout conferido em desktop e largura 390, sem transbordamento da página de planejamento.
- DANFE: `nfe-danfe-pdf` 1.0.3 (MIT), XML modelo 55 autorizado. PDFs sintéticos de uma e duas páginas (65 produtos) renderizados e inspecionados: campos, paginação, código de barras e marcas de homologação/cancelamento legíveis. Não é declaração de homologação fiscal universal; XML incompatível ou ausente retorna falha explícita no lote. O mock fornece documentos demonstrativos, não documentos fiscais reais.

Referência oficial consultada para DANFE: [Portal Nacional da NF-e — MOC 7.0, Anexo II](https://www.nfe.fazenda.gov.br/PORTal/exibirArquivo.aspx?conteudo=f+NhsSn3%2F5M%3D). Implementação do gerador: [nfe-danfe-pdf](https://github.com/flaviosoliver/nfe-danfe-pdf).

Contextos atualizados: `features/notas/CLAUDE.md`, `features/planejamento/CLAUDE.md`, `features/apuracao-v2/CLAUDE.md` e `application/notas/CLAUDE.md`.
