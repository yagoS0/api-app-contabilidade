# Situação Fiscal — recálculo de guias (18/09/2026)

`RecalcularGuiasSitfis` é uma área recolhível abaixo do relatório salvo. Usa as guias cadastradas da empresa recebidas em `guidesPanel`, já carregadas pelo workspace. O filtro inicial mostra vencidas conforme o DTO do servidor; há opção de incluir não vencidas. Guias pagas são excluídas e modalidades sem recálculo ficam visíveis com motivo. Parcelamentos não são enviados ao recálculo do DAS mensal.

O relatório SITFIS continua documental e não tem `guideId`: nunca vincular seus débitos a uma guia apenas por valor, competência ou rótulo. Não alterar suas colunas nem afirmar que recalcular quitou/atualizou o diagnóstico salvo.

Confirmação reutiliza `Modal`, o aviso do servidor e os handlers existentes: INSS por competência; DAS/DARF por ID. A confirmação de DAS/DARF informa o possível envio por e-mail existente no backend. Lock local e estados de carregamento impedem repetição. A Promise dos handlers pode resolver mesmo com erro tratado, então o componente não cria mensagem de sucesso: exibe o feedback real em área separada dos erros do relatório.

Testes: `components/__tests__/recalcularGuiasSitfis.test.jsx` cobre filtro, origens distintas, indisponibilidade, confirmação, duplicidade, roteamento por espécie, pagamento alterado durante confirmação e ausência de consulta fiscal automática. Junto dos testes de leitura/colunas, 21 testes passaram. Implementação em desenvolvimento, sem chamada fiscal real ou publicação autorizada por esta mudança.

Revisão fiscal: atalho secundário no topo abre/foca a área existente de recálculo. Ao vencer proximaConsultaEm, o hook relê getStoredSitfis uma vez para atualizar o botão; nunca dispara getSitfis automaticamente. Respostas atrasadas de empresa anterior são descartadas. Teste sitfisPrazoContexto cobre prazo e troca de empresa.
