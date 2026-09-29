# Antecipação de atividades recorrentes para dias úteis

Implementação de desenvolvimento em 29/09/2026, branch `codex/calendar-business-days`.

O formulário oferece **Em dias não úteis → Antecipar para o dia útil anterior** nas recorrências. O padrão continua **Manter a data**. Horários e âncora nominal são preservados; uma tarefa mensal no dia 3 que cair em sábado aparece na sexta-feira 2, das mesmas 9h às 10h, e o próximo mês continua ancorado no dia 3.

Finais de semana e feriados já cadastrados são considerados; municipais somente para a empresa correspondente. Nenhum feriado é inferido ou cadastrado por esta mudança. Não modifica regras de consultas fiscais ou envios automáticos.

## Integridade

- Chaves de recorrência usam datas nominais. Antecipar para mês/ano anterior não esconde a atividade.
- Conclusões, exclusões e edições individuais conservam identidade e histórico.
- Janelas com horário ajustam cada dia separadamente; datas originais distintas podem convergir no mesmo dia útil, sem serem descartadas.
- Obrigações empresariais preservam vencimento fiscal e competência nominal. Metadados por dia consideram feriados municipais e entram na chave de agrupamento entre empresas.
- O prazo interno das tarefas empresariais configuradas permanece nominal para respeitar a restrição única existente. Prazo exibido e atraso usam o fim operacional da janela; movimentações preservam a âncora interna. Não exige migração.
- O mock usa o mesmo motor e seus feriados de demonstração existentes.

## Validação

Suítes do calendário, obrigações, rotas, formulário e mock cobrem ativação/desativação, feriados, virada de mês/ano, versões, movimentações, conclusão e colisões entre dias antecipados. Compilação da interface aprovada (avisos preexistentes de tamanho de pacote/importações dinâmicas). No navegador local, criação mensal em 03/10/2026 (sábado), 09h–10h, apareceu em 02/10/2026 (sexta-feira).

Prévia local: `http://127.0.0.1:5235/companies`, somente dados fictícios. Evidência: `calendario-dias-uteis-preview.png`. Testes não acessaram banco ou provedores de produção. Publicação ainda não realizada; integração deve seguir os gates habituais do projeto.
