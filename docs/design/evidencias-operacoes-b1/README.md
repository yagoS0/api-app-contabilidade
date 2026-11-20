# Evidências B1

Base `313904fc19214269437c90dfdde0377ca0332862`. `before-*` e `candidate-*` usam a mesma [fixture sintética](fixtures.txt), React e CSS reais. A bancada `apps/web/src/dev/revisao.jsx` recebe somente doubles de API; nenhuma regra ou componente de Operações é substituído. A versão anterior de OperationsPage e operacoes.css foi lida diretamente do Git. Demais componentes são idênticos.

Vite em loopback, Chrome isolado via Playwright, rede externa bloqueada e service workers desabilitados. Não houve autenticação produtiva, dados de clientes, cálculo, transmissão ou mensagens. Os scripts e logs locais de reprodução permanecem em `.altan-governance/b1-visual/` da worktree.

- 1440×1000, 390×844 e 360×740: capturas da composição inteira.
- `reflow-200`: viewport 720×500/dpr2, ensaio de reflow; não confundir com zoom nativo.
- `native-zoom200.png` e `native-zoom.json`: zoom nativo 200% configurado somente em perfil exclusivo de testes; zoom=2, largura CSS712/conteúdo704, sem overflow.
- `fullpage-*`: bancada sintética completa, incluindo controles de teste; não é o shell autenticado da aplicação.
- `before-results.json` e `candidate-results.json`: 11 métricas, geometria, axe, teclado/foco, troca de competência, exceções e rede.
- `a11y-label-investigation.json`: seis ocorrências preexistentes em ambos os lados. O texto concatenado e/ou desconhecidos não correspondem integralmente ao nome acessível legado. Não foi alterado o contrato de nomes acessíveis nesta composição.

Zero overflow, exceções JS ou chamadas externas. Enter/Escape e retorno de foco: 8/8. Os estados vazio, erro e carregamento também foram capturados localmente nas quatro dimensões; suas PNGs permanecem na worktree. Não houve NVDA ou aparelho físico.

Testes unitários versionados cobrem separadamente os contratos completos, inclusive atrasos entre competências e ausência de comandos. Evidência visual não comprova autorização, persistência ou prontidão produtiva.
