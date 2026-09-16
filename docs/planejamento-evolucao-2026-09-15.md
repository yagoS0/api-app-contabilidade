# Evolução do planejamento — 15/09/2026

Atualização de 16/09: a importação manual do acompanhamento foi substituída por preenchimento automático a partir de apurações, notas e lançamentos. Ver [planejamento-automatico-2026-09-16.md](planejamento-automatico-2026-09-16.md) para prioridade das fontes, preservação de edições e conferência da folha contábil.

Autorização: “vamos corrigir esses pontos, sempre conferencido o que fez”, após a análise de mercado. Implementação local na branch `codex/perfil-nota-municipio`. Não houve publicação, envio fiscal ou alteração de cadastro de empresa neste lote.

## Plano executado

1. Corrigir comparação parcial, economia de migração e premissas do pró-labore.
2. Acrescentar acompanhamento mensal, preservando a origem e ausência dos dados.
3. Permitir bases detalhadas do Real e segregação explícita por atividade.
4. Acrescentar transição do consumo parametrizada, conclusão/revisão e persistência/relatórios.
5. Conferir fórmulas com fontes oficiais, testes, navegador, build e PDF renderizado.

## Comportamento entregue

- `coberturaComparacao`: estados estimado/parcial/indisponível. Sem dados relevantes não há selo de menor custo nem economia afirmada. Diferença para a segunda opção e economia versus regime atual são campos distintos.
- CPP: campo de remunerações sem encargos substitui a base agregada quando informado. RAT/FAP/terceiros informados separadamente, inclusive zero; avisos deixam de declarar ausentes os encargos que já entraram no total.
- Pró-labore: remuneração informada por sócio; INSS e IRRF calculados individualmente. Aumento dividido igualmente na simulação. A folha total permanece como FS12. IRRF escolhe entre deduções legais e simplificado, sem acumulá-los; redutor considera bruto.
- Acompanhamento: plano e realizado mensal; projeção combina realizado conhecido com plano restante, sem preencher ausência com zero. Distribuição anual preserva centavos. Histórico anterior permite RBT12 e FS12 móveis, Fator R, anexo/faixa e DAS estimado. Alteração de folha não afeta o próprio mês. Há alertas de receita acumulada e IRPJ/adicional do Presumido por trimestre no escopo suportado.
- API: leitura de snapshots já gravados e das séries de folha, isolada por empresa. Não consulta SERPRO, não grava cache nem transmite. DAS de simulação oficial não é importado como transmitido; procedência ambígua não vira DAS apurado. Importação é explícita e preenche somente campos vazios.
- Real: opção por custos/despesas/outras receitas e adições/exclusões independentes de IRPJ/CSLL. Campos ausentes bloqueiam a conta detalhada; prejuízo não produz imposto negativo. Margem continua disponível ao desativar o detalhe.
- Receitas por atividade: valores devem fechar a receita anual. Simples usa o RBT12 da empresa em todas as parcelas; Presumido aplica presunções por receita e um único limite de adicional, com CPP/encargos uma vez. ISS incide sobre as parcelas de serviços; memória de ISS ponderada identifica sua base.
- Reforma: cenários de consumo de 2027 a 2033, taxas futuras digitadas, créditos de IBS e CBS separados e ISS remanescente pelo cronograma. Alíquota geral de IBS de 0,1% em 2027–2028 identificada como legal. Não inventa CBS futura nem compensa crédito de um tributo no outro.
- Conclusão e revisão: texto do contador e data prevista acompanham cenário/PDF, sem criar lembrete automático.
- Interface: opções avançadas fechadas, campos carregados sob demanda; estilos consistentes. Persistência em `formularioCenario.ajustes`, com recuperação após troca/reabertura. PDF do servidor e resumo impresso incluem os novos blocos, sem depender de um accordion aberto.

## Limites preservados e próximos aprofundamentos

Este lote não transforma o simulador em um motor universal de apuração. Não anunciar como concluídos:

- ICMS/ST/DIFAL, IPI, monofásicos, benefícios e segregações de mercado/tratamento por documento. Operações de mercadorias/combustíveis/transporte ficam parciais.
- Simples misto com Anexo IV e segregação própria da CPP; início de atividade misto; majoração/sublimites mistos acima de R$ 3,75 milhões. São recusas explícitas.
- Projeção mensal completa de todos os tributos/regimes. A grade estima DAS e mostra IRPJ trimestral do Presumido separadamente; não altera os totais anuais silenciosamente. Real anual ainda pressupõe lucro uniforme nos trimestres, sem compensar prejuízos anteriores.
- Reforma por operação, importação de créditos por fornecedor e regime especial. O bloco novo calcula subtotal de consumo para serviços no regime regular, não DAS/carga total.
- Consolidação em escala por endpoint agregado, exportação de vários cenários em um único relatório e operações especiais continuam como aprofundamentos. A primeira comparação de cenários e visão da carteira foi entregue na continuação abaixo.

## Conferência

- Testes de regressão de todo o planejamento web: 435 aprovados na rodada final (27 suítes).
- API planejamento: 85 testes aprovados, incluindo procedência do histórico e preservação de zero declarado.
- Casos novos: exemplo oficial de IRRF de R$ 6.000 com dedução de R$ 649,60 = R$ 382,88; dois sócios; cobertura incompleta; CPP própria; Fator R atravessando 28% apenas no mês seguinte; sazonalidade do adicional; segregação de bases; Real com prejuízo; transição sem inventar alíquotas.
- Navegador em mock: comparação parcial e completa; importação de oito meses; projeção/desvio; segregação de serviços/comércio. Não usar o nome da empresa mock como evidência de dados reais da Lente.
- Build web final executado com sucesso. Parser JSX e `no-undef` sem erros em 35 arquivos. PDF fictício gerado a partir dos motores e renderizado; corrigidos rótulos, unidade das alíquotas, seta incompatível com fonte e quebra de seção.
- Configuração Jest de estilos corrigida: o mapeamento anterior apontava para um módulo inexistente. Usa substituto local para CSS, sem instalar dependência.
- Nenhuma nova dependência ou migração de banco.

Fontes e regras conferidas em `docs/fontes-fiscais.md`, complemento de 15/09/2026. Artefatos fictícios de conferência ficam fora do repositório, em `../planejamento-conferencia.pdf` e imagens de suas páginas.

## Continuação — cenários salvos e carteira

- Nome opcional persistido em `entradas.formularioCenario.ajustes.nomeCenario`, sem migração. Salvar atualiza a lista local também quando a geração de documento é solicitada.
- Abrir cenário apresenta seleção de dois a três registros para comparação. A tabela lê resultados imutáveis, com data, competência, ano-base, premissas, totais, cobertura, memória por tributo, conclusão e revisão. Não recalcula os registros nem chama o motor atual; o botão Abrir mantém o comportamento explícito de retomar premissas e recalcular.
- Planejamento geral conserva a simulação livre e ganha seção recolhida Visão da carteira. Só consulta ao abrir; usa as empresas disponíveis na sessão e as rotas existentes protegidas por `requireFirmCompanyAccess`. No máximo três consultas simultâneas, com progresso e falhas por empresa. Não consulta APIs fiscais.
- Carteira usa apenas a foto mais recente de cada empresa. Comparação sem cobertura registrada, parcial ou sem regime atual não produz oportunidade. Ano-base diferente do atual e revisão prevista para hoje/passada pedem revisão. Diferença positiva é potencial no cenário salvo, nunca economia realizada. A diferença é conferida pelos totais salvos; não usa cegamente `economiaVsAtual`.
- Filtros distinguem potencial, cobertura, revisão, ausência de regime/cenário e erro. Botão abre o planejamento da empresa correta. Respostas antigas são descartadas ao mudar carteira ou fechar a seção.
- Limite desta versão: as rotas existentes retornam até 50 cenários por empresa; a carteira seleciona o mais recente. A carteira é a lista autorizada carregada pela aplicação, não uma varredura de empresas fora da sessão. Não soma oportunidades de anos ou bases diferentes e não agenda notificações.
- Conferência: 448 testes web de planejamento aprovados (29 suítes), incluindo 13 novos casos; build aprovado; parser JSX/no-undef aprovado em oito arquivos JS/JSX alterados. Navegador mock: dois cenários com receitas distintas, seleção sem alterar formulário, carteira com seis empresas, cobertura parcial, ausência de cenário e atalho para a empresa correta. Números fictícios, sem ação em produção.
- Nenhuma fórmula fiscal, dependência, migração, permissão ou rota de escrita foi alterada nesta continuação. Publicação permanece pendente.
