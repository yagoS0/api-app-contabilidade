# Notas — revisão de uso (08/09/2026)

NF-e e NFS-e continuam separadas. Lista mantém linha acessível por teclado; nomes podem quebrar e ações de linha precisam de área legível. Auditoria abre a íntegra em `NotaDetailModal`, sem trocar empresa/competência nem gravar um veredito; fechar retorna ao mesmo conjunto de achados. Resposta de detalhe antiga é descartada.

Emissor usa `Modal` compartilhado com `ocupado={enviando}`. Durante emissão, fundo, X, Esc e Cancelar não devem ocultar o resultado; beforeunload alerta ao sair/recarregar. Não remover bloqueio após resposta de desfecho desconhecido. Formulário e prévia permanecem ligados à mesma declaração; permissões e certificado não foram flexibilizados. Dados excepcionais de obra/destinatário e retenções não devem desaparecer durante mudanças de layout.
