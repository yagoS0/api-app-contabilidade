# Contrato de tarefa e parecer

Orquestrador fornece: objetivo, domínio, base/HEAD e diff (incluindo alterações locais),
caminhos permitidos, regras aprovadas, critérios de aceite, dependências, comandos
isolados e proibições de efeitos externos. Revisor recebe acesso ao código completo
necessário, não somente o resumo do autor.

Parecer obrigatório:
- Identidade da execução/revisor e domínio; não inventar execução independente.
- Base, HEAD e descrição do diff local revisado; data e escopo.
- Resultado: aprovado tecnicamente, mudanças necessárias ou inconclusivo.
- Achados com severidade, arquivo/linha, cenário, consequência e correção sugerida.
- Testes/evidências realmente observados e limitações.
- Consumidores afetados e revisões adicionais necessárias.
- Pendências humanas e risco residual.

Sem achados não significa ausência de risco. Inconclusivo não equivale a aprovado.
Revisor sistêmico confere completude e conflitos entre pareceres; não substitui
especialista fiscal humano nem autorização para executar operações reais.
