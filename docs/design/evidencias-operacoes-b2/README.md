# B2 — comparação visual

Base: `1bfe21340db796ff668773c1a015ad07da2cce92`. `base-*` mostra os modais anteriores; `candidate-*` mostra a região contextual. Dados inteiramente sintéticos, iguais nas duas versões, sem chamadas externas ou perfil de navegador do usuário.

| Comparação | Antes | Depois |
| --- | --- | --- |
| Resumo desktop | [Base](base-summary-1440.png) | [B2](candidate-summary-1440.png) |
| Resumo celular | [Base](base-summary-390.png) | [B2](candidate-summary-390.png) |
| Calculado desktop | [Base](base-calculado-1440.png) | [B2](candidate-calculado-1440.png) |
| Calculado 390 | [Base](base-calculado-390.png) | [B2](candidate-calculado-390.png) |
| Calculado 360 | [Base](base-calculado-360.png) | [B2](candidate-calculado-360.png) |
| Confirmado | [Base](base-confirmado-1440.png) | [B2](candidate-confirmado-1440.png) |
| Transmitido | [Base](base-transmitido-1440.png) | [B2](candidate-transmitido-1440.png) |
| Guias disponíveis | [Base](base-disponivel-390.png) | [B2](candidate-disponivel-390.png) |
| Contabilização | [Base](base-contabilizacao-390.png) | [B2](candidate-contabilizacao-390.png) |
| Detalhes | [Base](base-detail-390.png) | [B2](candidate-detail-390.png) |
| Zoom nativo 200% | [Base](base-native-zoom200-fullpage.png) | [B2](candidate-native-zoom200-fullpage.png) |

## Método e resultados

Componentes reais, base exportada do Git, Vite local com carregamento de `.env` desativado, API simulada e rede externa bloqueada. Quinze estados por versão: cinco indicadores em 1440, 390 e 360 pixels. Zero overflow horizontal global, erros JavaScript ou solicitações externas. As tabelas podem ter rolagem horizontal interna, com região focável.

Na candidata, abrir os indicadores leva foco ao título contextual (15/15). Os detalhes preservam um único diálogo, foco no título e retorno ao botão (3/3 dimensões em cada versão). Zoom nativo comprovado em ambas: fator 2, largura CSS 711 e conteúdo 703.

Os resultados completos estão em [base-results.json](base-results.json), [candidate-results.json](candidate-results.json), [zoom base](final-base-zoom.json) e [zoom candidato](final-candidate-zoom.json). Axe encontrou uma ocorrência `label-content-name-mismatch` na ação do rodapé de Transmitido, idêntica à base; nenhuma nas demais regiões exercitadas. Isso não equivale a certificação integral WCAG.

## Limitações

Sem NVDA, telefone físico ou sessão produtiva. A fixture documental também cobre indisponibilidade, sem representar todos os sucessos de recuperação. Empresas sem papel de escrita mantêm ações desabilitadas. Testes React/HTTP separados validam comandos, autorização, seleção de 31 empresas, recarga e respostas tardias. Capturas não autorizam atos fiscais, merge ou deploy e não representam B3.
