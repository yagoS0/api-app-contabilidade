# PLANO MESTRE DE DESIGN E USABILIDADE

> ⚠ **Este documento é vivo, e o Bloco 0.1 JÁ FOI EXECUTADO.** Cinco pontos do texto original foram
> revertidos por decisão do dono DEPOIS da implementação — estão marcados abaixo com
> **[REVISADO]** e o motivo. **A decisão posterior vence o texto.** Quem "consertar" a tela de volta
> ao que o parágrafo original dizia estará desfazendo um pedido explícito. Roteiro de execução em
> `.claude/plans/projeto-app-tidy-lighthouse.md`; o Bloco 8 (Conversas) é de outro responsável.

> Versão do Plano Mestre contendo APENAS o que é design, interação e usabilidade. Regras fiscais, cálculos, integrações (SERPRO/ERP/Meta), leiautes de arquivo e arquitetura de dados ficam fora deste documento — quando um bloco depender delas, aqui consta somente COMO a interface se comporta. Ordem dos blocos = ordem de prioridade de execução.

---

# 1. Princípios de design (valem para tudo)

1. **Regra de ouro das cores:** cor forte = precisa de ação agora. Vermelho = bloqueia/vencido. Âmbar = ação rápida pendente. Verde = concluído. Cinza = estado padrão/neutro. Azul/accent = situação gerenciada ou ação primária.
2. **Estado nunca só por cor:** todo estado tem ícone + texto. Teste permanente: screenshot dessaturado continua legível.
3. **Um chip por pergunta:** cada célula/indicador responde uma pergunta com um chip. Nunca empilhar status.
4. **Ação visível:** nada acessível apenas por clique sem affordance — hover, foco e cursor sinalizam interatividade; ações destrutivas se revelam no hover e só ficam vermelhas na confirmação.
5. **Confirmação e reversibilidade como UX:** ações de consequência (enviar, emitir, baixar, excluir, fechar) sempre passam por confirm com os dados no texto ("Enviar DAS Julho · R$ X para [contato]?") e, quando possível, têm "Desfazer".
6. **Estados bons não gritam:** "em dia", "sem pendência" e similares aparecem discretos (texto + check, sem pill); o destaque é reservado ao que exige ação.
7. **Ausência nunca é resposta:** quando algo está vazio ou concluído, a tela DIZ isso (empty state explicativo, chip "✓ Concluídas", "⊘ vazio") — informação nunca é comunicada por omissão.
8. **Um controle por estado global:** competência, filtros e fechamento têm um único ponto de controle visível; nenhum estado ativo sem rastro na tela.
9. Um botão primário por tela; demais neutros. CNPJ sempre formatado. Max-width único (~1200px).

# 2. Design system (Apêndice de tokens — já implementado, referência)

- **Superfícies:** página #101018 · cards/linhas #191926 · hover/popovers #222232. Bordas: branco 8% (padrão) e 16% (forte).
- **Texto:** primário #f2f2f5 · secundário #a0a0b0 · muted #6b6b7a.
- **Semânticas:** danger, warning, success, neutral — fundo translúcido (12–14%) + texto claro da mesma família. Accent roxo #7f77dd para ação primária e situações gerenciadas.
- **Chips de estado:** pill 11–12px, ícone 13–14px + texto; interativos têm hover, foco visível (anel 2px accent) e `role="button"`.
- **Badges de configuração** (regime, certificado): pill neutro discreto; nunca nas cores semânticas.
- **Tipografia de dados:** valores monetários e códigos em mono, alinhados à direita em colunas numéricas; R$ 0,00 em muted.

---

# BLOCO 0 — Correções da interface atual

## 0.1 Listagem — indicadores em três colunas

**Princípio:** cada pergunta do contador vira uma coluna com um chip: "como está o mês?" (Apuração) · "como está com o fisco?" (Situação fiscal) · "o que falta entregar?" (Guias). Leitura esquerda→direita espelha o fluxo de trabalho.

### Colunas
Empresa ~26% (nome 500/14px; 2ª linha 12px muted: **Regime · CNPJ** — Regime deixa de ser coluna) · Apuração ~16% · Situação fiscal ~18% · Guias ~22% · Notas ~10% · Ação ~8%. Linhas ~48px.

> **[REVISADO] A linha NÃO navega.** O texto original pedia "hover na linha inteira (clicável, mesmo
> destino de Acessar)". Só o botão **Acessar** navega. *"tire essa logica de clicar na caixa para
> acessar a empresa, so da para acessar clicando no botao acessar"* — com chips, popovers e o botão
> de enviar e-mail na mesma linha, clicar em qualquer ponto virava navegação por acidente.

> **[REVISADO] A tag `A1` FICA na linha.** O texto original pedia "Certificados (A1/SERPRO) SOMENTE
> no popover do nome — remover o badge da linha". *"voce tirou a tag de certificado, coloque de
> volta"* — certificado ausente é a única configuração que faz a empresa **parar de receber nota sem
> avisar** (`NO_COMPANY_CERT`, silencioso). Aparece só na exceção (falta/vencido) e em cinza, como
> badge de configuração, nunca semântico.

### Coluna Apuração — 4 estados, um chip
`⚠ Problema` (danger) → `○ Falta apurar` (cinza — NUNCA vermelho/âmbar; é o estado natural do início do mês) → `☑ Falta fechar` (âmbar; tooltip lista o que falta) → `🔒 Fechada` (linha com opacidade 0.6).

> **[REVISADO] "Fechada" é TEAL (`--state-closed`), não verde.** Verde significa "concluído" no
> princípio 1; fechada é **fora do fluxo de trabalho**, que é outra coisa. A distinção evita ler
> "acabou o trabalho" onde o certo é "não há mais nada a fazer aqui neste mês". Estes 4 estados são os MESMOS dos chips de filtro do topo, dos segmentos da barra de progresso e da ordenação — uma dimensão, quatro representações consistentes.

### Coluna Situação fiscal — 5 estados, um chip
`✓ Em dia` (texto verde discreto, SEM pill) · `⚠ Com pendência` (danger; popover: lista + data da consulta + "Reconsultar") · `Parcelamento X/N` (accent — em dia é gerenciado, não alarme; popover com parcelas) · `Parcela atrasada` (danger) · `Consultar (Xd)` (muted, mostra a idade do dado). Dado velho (>30 dias, configurável) rebaixa o chip para "Consultar (Xd)". Pendência + parcelamento: danger domina; o resto vai ao popover.

> **[REVISADO] Sem contagem.** O texto original pedia "`⚠ N pendências` (danger com contagem)". O
> número **não existe gravado**: sairia do parser heurístico do PDF do SITFIS, que é
> `verificadoTrial: false` e já mostrou "R$ 100,00 de débito" numa empresa sem débito (lendo o
> `100,00%` do quadro societário). Número fiscal derivado de heurística na tela principal é
> exatamente o que a regra 1 do projeto proíbe. A lista fica no popover, onde está o contexto.

> **[REVISADO] O clique CONFIRMA antes de reconsultar.** O texto original pedia "click reconsulta com
> loading no chip". A consulta SITFIS é **paga**, tem trava de 4h por empresa, e o limite AV02 do
> `/Apoiar` é **por contratante** — numa lista de 30 linhas, cliques distraídos viram fatura e podem
> travar a consulta da carteira inteira. Confirm com o custo à vista (regra 5).

### Coluna Guias — 4 estados + agregação
- Individuais: `⚠ Falta gerar` (danger) · `Enviar ✈` (âmbar) · `✓ Enviada` (verde) · `⊘ Vazio` (cinza com borda).
- **Agregação inicial (mata o muro vermelho):** todas em "falta gerar" → UM chip "⚠ N guias · falta apurar"; individualizar só quando os estados divergirem. Detalhe individual só quando o detalhe carrega informação.
- Agregação final: todas terminais → "✓ Concluídas".
- Parcela de parcelamento aparece aqui como guia enviável ("Parcela X/N · Enviar") — a Situação fiscal informa a existência; a coluna Guias carrega a ação.

### Filtros
- Botão "Filtros · N" com contador de ativos.
- **Chip removível na barra para cada filtro ativo** ("Documentos: com pendências ✕") + "Limpar tudo". Critério inegociável: NENHUM filtro ativo sem rastro visível com o painel fechado (elimina o "filtro fantasma").
- Painel: popover ancorado à direita (cobre no máximo a coluna Ação, nunca dados), selects nos tokens, grade de 2 colunas, rodapé "Limpar filtros" + "Aplicar".
- Remover "Fechamento" do painel (duplica os chips do topo); renomear "Enviados" → "Envio de guias".

### Pontuais
- Remover o segundo seletor de competência — fica só "Empresas · ‹ Julho 2026 ›" no título.
- Barra de progresso: "Falta apurar" pinta CINZA — a barra evolui cinza → âmbar → verde ao longo do mês, contando a história real do trabalho em vez de virar paredão de alarme.
- Ordenação por urgência: pior estado entre as três colunas (danger > warning > neutral); Fechadas por último, agrupadas sob divisor colapsável.

## 0.2 Abas de Contabilidade

### Circular
- **Affordance das células:** célula com valor ganha hover (surface elevada + cursor) e click abre POPOVER ancorado; células "—" não são interativas. Teclado: Tab foca, Enter abre, Esc fecha.
- **Popover da célula:** cabeçalho "DAS · Junho/2026" + chip de status (Paga / A vencer / Vencida); linhas nomeadas: Valor original · Juros/multa (com data do recálculo) · **Valor atualizado** em destaque · Vencimento · Enviada ao cliente (✓ data + canal); rodapé com 3 botões: Consultar pagamento · Editar · Dar baixa.
- **Vencida ≠ a vencer:** paga = verde; em aberto DENTRO do prazo = âmbar ("A vencer · dd/mm"); após o vencimento = vermelho ("Vencida · N dias"). "Total em aberto" separa visualmente a vencer (âmbar) × vencido (vermelho).
- Micro-anotações dentro das células migram para as linhas do popover; na célula, no máximo 1 ícone com tooltip. Checks em formato de checkbox viram ✓ simples — checkbox sugere interação que não existe.
- **Dar baixa (UX):** confirm com data do pagamento pré-preenchida (hoje); reversível ("Desfazer baixa"); "Consultar pagamento" com resultado positivo OFERECE a baixa pré-preenchida, nunca executa sozinho.
- Botão "Exportar PDF" (extrato anual timbrado).

### Lançamentos
- Remover a competência local (JULHO/2026 + setas) — usar a global do header.
- Régua de checkboxes do fechar mês → painel de checklist (ver Bloco 1).
- Toolbar nos tokens: um primário ("+ Adicionar lançamento"), resto neutro (SERPRO deixa de ser âmbar).
- **Ações de linha:** cinza muted, reveladas no hover da linha; vermelho SÓ no diálogo de confirmação da exclusão (com histórico + valor no texto).
- Nomes de conta truncados: tooltip com código + nome completo.
- Resumo "Baixa / Folha / Provisão" vira metric chips clicáveis (rolam até a seção).
- PRESERVAR: agrupamento por seções com totais; rodapé "D R$ X · C R$ X ✓ ok" — quando divergir, exibir "✗ diferença R$ Y" em danger.

### Obrigações (calendário da empresa)
- **Empty state explicativo:** "Esta empresa não tem obrigações configuradas — configurar na página principal" OU "Sem eventos em agosto — ver setembro". Vazio mudo nunca.
- Padrão no nível da empresa: visão **Agenda** (lista cronológica) — grade mensal com 3–6 eventos é 90% espaço vazio; Mês/Semana/Dia continuam como opções. Na página principal (30 empresas), grade mensal segue padrão.
- **Cor = estado; categoria = ícone/forma:** guia = ícone boleto, obrigação = documento, marco = losango; a COR do evento segue os tokens (vermelho falta gerar/vencida · âmbar falta enviar/a vencer · verde resolvida · cinza futura). O dia herda a pior cor entre seus eventos. Legenda atualizada: forma = categoria, cor = estado.

---

# BLOCO 1 — Telas internas da empresa

- **Competência global:** "‹ Julho 2026 ›" no header da empresa, ao lado do nome/CNPJ; todas as abas acompanham; seletores locais removidos. Exceção única e documentada: a sub-aba Relatórios tem seletor de intervalo próprio.
- **Checklist de fechamento como painel:** card destacado; cada item em linha própria (checkbox, label, estado); "Fechar mês" desabilitado-com-motivo ("Faltam: Despesas, Receitas"); o texto vermelho solto some. Itens auto-verificados aparecem com check + origem ("confirmado pela folha de julho") e o click navega à origem. Pós-fechamento: selo "✓ Mês fechado em DD/MM por [usuário]" + "Reabrir" com confirmação.
- **Botões:** tokens em todas as telas; um primário por tela; dropdowns neutros.
- **Miudezas:** CNPJ formatado em todo lugar; max-width único; empty states com CTA no padrão bom de Anotações ("Nenhuma nota encontrada" → botão "Buscar NFS-e").

---

# BLOCO 2 — Integração contábil (o que é UX)

- **Autocomplete de contas:** ao digitar o código reduzido, mostrar "352 — Receita de serviços"; nome completo em tooltip nas colunas Débito/Crédito.
- **Erro no ato, não na importação:** conta inexistente/inativa/sintética acusa NA HORA do lançamento, com mensagem clara — nunca deixar o erro estourar depois, longe do contexto.
- **Validação do lote como tela:** antes de exportar, painel listando erros (bloqueiam, em danger) e alertas (exigem confirmação, em warning), cada item clicável levando à linha de origem. Resultado vira o item "Lote validado ✓" no checklist de fechamento.
- **Exportação com feedback:** resumo visível (nº de linhas, totais D/C, data/usuário); tentar reexportar a mesma competência exibe aviso e exige reabertura explícita.

---

# BLOCO 3 — Apuração Lucro Presumido (o que é UX)

- Fiscal → Apuração detecta o regime e adapta a tela; o usuário não escolhe "modo".
- **Dois ritmos visíveis:** tributos mensais com chips no padrão de 4 estados; no último mês de cada trimestre, um bloco adicional de IRPJ/CSLL mostrando os três meses somados — o trimestre é apresentado como agregação, nunca como tela separada que o usuário precisa descobrir.
- **Memória de cálculo legível:** relatório em cascata nomeada (receita → exclusões → base → alíquota → bruto → retenções → a recolher), com "ver premissas" expansível listando as simplificações em linguagem clara. Exportar PDF timbrado; enviar ao cliente.
- **Transmissões (MIT) como fluxo confirmado:** toda transmissão passa por confirm exibindo o que será declarado e o custo; sucesso devolve recibo e DARF visíveis e enviáveis; erros SEMPRE traduzidos para linguagem do usuário — nunca o erro cru de API.
- **Sem movimento:** competência marcada `vazio` oferece a declaração sem movimento correspondente no mesmo gesto, com confirm.

---

# BLOCO 4 — Obrigações anuais (o que é UX)

- **Ciclo visual da obrigação anual:** `Aguardando janela` (cinza) → `Janela aberta` (âmbar, com dias restantes visíveis) → `Urgente` (vermelho, ≤30 dias do prazo) → `Transmitida` (verde + recibo anexado).
- Durante a janela, o chip anual (ex.: DEFIS) aparece na listagem principal ao lado das guias mensais — em março, "quais empresas ainda não entregaram?" precisa ter resposta de relance, igual ao fechamento.
- No calendário, o dia do prazo herda a pior cor entre as empresas.
- **Espelho DEFIS (wizard):** passos NA MESMA ORDEM das telas do portal oficial (o ganho é a transcrição rápida), campos pré-preenchidos com origem visível, ajuda contextual nos manuais, e tela final de conferência lado a lado (campo do portal → valor do app) + PDF de conferência. Conclusão: "Marcar como transmitida" + upload do recibo.
- Cada obrigação é porta de entrada do trabalho: click abre a ação correspondente (gerar guia, abrir o espelho, anexar arquivo), nunca é só um lembrete.

---

# BLOCO 5 — Planejamento tributário (o que é UX)

- **Dois modos, mesma tela de resultado:** modo carteira (tudo pré-preenchido dos dados reais, editável como cenário) e modo simulação livre (form em branco, acessível da página principal sem entrar em empresa — cenário de reunião com prospect; atividade escolhida em lista amigável, não por código).
- **Resultado:** cards comparativos por regime — carga anual em R$, alíquota efetiva %, vencedor destacado em verde com selo "MELHOR", breakdown por tributo expansível.
- **Gauge do Fator R:** barra com o limite de 28% marcado, valor atual, e a margem traduzida em consequência ("margem de R$ 3.400/ano na folha — se cair, vai ao Anexo V: +R$ 32.160"). Números viram decisão, não só medição.
- **Ponto de equilíbrio explícito:** frases-resposta ("Presumido passa a compensar acima de R$ X") + gráfico carga × faturamento com as curvas dos regimes.
- **Alerta contínuo na listagem:** empresa a <2 p.p. do limite do Fator R ganha alerta com sugestão acionável.
- "Ver premissas" expansível em toda saída; PDF timbrado exportável nos dois modos.
- Simulação salva de empresa nova vira projeção; quando o realizado descolar, o app avisa e reapresenta a recomendação — acompanhamento, não palpite único.

---

# BLOCO 6 — Relatórios (o que é UX)

- Sub-aba de Contabilidade. Seletor de tipo + seletor de INTERVALO próprio (atalhos: mês, trimestre, ano, 12 meses; comparativo com período anterior) — exceção documentada à competência global.
- Resultado: tabela + gráfico de evolução nos tokens do app; exportar **PDF timbrado** do escritório; botão "Enviar ao cliente" pelos canais existentes.
- Gancho no fechamento: oferta "gerar e enviar pacote do mês" em uma ação.
- Tipos indisponíveis (Balanço/Balancete na v1) simplesmente NÃO aparecem como opção — nunca opção desabilitada sem explicação.

---

# BLOCO 7 — Departamento Pessoal

- Aba de 1º nível entre Fiscal e Empresa; sub-abas **Funcionários · Folha · Eventos · Obrigações**, todas na competência global.
- **Funcionários:** tabela padrão (nome + cargo em 2ª linha; salário mono à direita; status: Ativo verde / Afastado âmbar / Desligado cinza + linha esmaecida); desligados agrupados no fim, colapsáveis.
- **Folha:** metric cards (Proventos, Descontos, Líquido, Encargos) + lista de rubricas; estado da folha como chip de ciclo: "Falta processar" (vermelho) → "Processada — enviar recibos" (âmbar) → "Concluída" (verde).
- **Auto-check visível:** folha concluída marca sozinha o item do checklist de fechamento, com a origem escrita; reabrir a folha desfaz o check na frente do usuário.
- **Eventos:** timeline com prazos; "Falta enviar ao eSocial" em vermelho com a data-limite e destaque extra quando faltar ≤2 dias; "Enviado" verde com protocolo no popover; futuros agendados em cinza.
- **Privacidade como regra de UI:** nenhum salário ou dado de funcionário renderiza fora da aba DP — nem na listagem, nem em tooltips, nem em relatórios de outra aba.

---

# BLOCO 8 — Conversas (chat com o cliente)

- Aba de 1º nível entre Anotações e Contabilidade. **Separação visual e funcional absoluta** entre Anotações (interno) e Conversas (cliente); único atalho: "Salvar como anotação", unidirecional.
- **Layout:** coluna de contatos (~220px: nome, papel, canal, última mensagem, badge de não lidas; ativo com borda accent) + conversa (balões: cliente à esquerda em surface, escritório à direita em accent-bg; horário e status ✓ enviado / ✓✓ entregue / lido). Abaixo de 900px, contatos viram drawer.
- **Janela de resposta sempre visível** no cabeçalho ("Janela de resposta: 22h restantes"); expirada → campo de texto livre desabilitado com explicação na própria tela ("envie um template para reabrir") e só os botões de template ativos. Falha de envio mostra motivo em linguagem clara.
- **Anexar guia como objeto:** seletor das guias da competência; a guia vai como card estruturado no chat (tipo, competência, valor, vencimento) — não como anexo mudo. Envio confirmado; o chip da guia na listagem muda para "Enviada" com o canal no histórico.
- **Respostas rápidas** como botões acima do campo: Segue a guia · Solicitar documentos · Lembrete de vencimento · Sem movimento este mês (comunicar o "nada" ativamente é atendimento).
- O confirm de envio de guia na listagem ganha a escolha de canal (E-mail / WhatsApp), com padrão por empresa.

---

# BLOCO 9 — Emissor de NFS-e

- Fiscal → Notas Fiscais; o primário da sub-aba vira "+ Emitir nota" (Buscar vira secundário).
- **Wizard em passos:** Tomador (busca no cadastro + "novo" inline) → Serviço (campos pré-preenchidos do cadastro; retenções visíveis) → Valores → **Preview obrigatório** (espelho completo da nota) → Emitir com confirm explícito ("Emitir nota de R$ X para [tomador]?"). Não existe caminho de emissão que pule o preview.
- **Ciclo visual da nota:** Rascunho (cinza, editável) → Processando (cinza animado) → Autorizada (verde) → Rejeitada (vermelho, com o MOTIVO em linguagem clara e botão "corrigir e reenviar") → Cancelada/Substituída (cinza riscado; dupla confirmação; prazo-limite de cancelamento exibido quando conhecido).
- **Recorrentes:** configuradas uma vez; a cada ciclo aparecem como "aguardando aprovação" para aprovar em um clique (individual ou lote); emissão sem aprovação só se explicitamente habilitada, sempre com notificação do resultado.

---

# BLOCO 10 — EFD-Contribuições (o que é UX)

- Fluxo de 3 passos visível: "Gerar arquivo" → aviso claro de que a validação/assinatura/transmissão acontecem no programa oficial (com o passo a passo resumido na tela) → "Anexar recibo" conclui o chip da obrigação.
- Empresa fora do perfil suportado: aviso claro do porquê + caminho alternativo (upload do arquivo gerado externamente + recibo) — a obrigação continua rastreável, nunca some.

---

# O QUE NÃO FAZER (design e usabilidade)

- Vermelho para estados que não bloqueiam; âmbar para vazio confirmado ou parcelamento em dia; cor como categoria (cor é estado).
- Mais de um chip por célula; status empilhados; informação por omissão.
- Filtro ativo sem chip visível; dois seletores de competência; dois controles para o mesmo estado.
- Ação escondida atrás de clique sem affordance; ícone destrutivo vermelho permanentemente visível.
- Ação de consequência sem confirm com dados no texto; exclusão/baixa/fechamento sem caminho de desfazer ou reabrir.
- Empty state mudo; erro de sistema exibido cru para o usuário.
- Opção desabilitada sem explicação; funcionalidade indisponível listada como se existisse.
- Estados bons gritando (pill verde berrante para "em dia"); estados de trabalho normal alarmando (paredão âmbar/vermelho no início do mês).
- Salários ou dados pessoais renderizados fora da aba DP; conteúdo interno (Anotações) visível em áreas do cliente.
