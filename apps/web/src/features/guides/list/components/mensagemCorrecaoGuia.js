export function mensagemCorrecaoGuia(erro, alternativa) {
 const mensagens = { insufficient_role: 'A correção de guias exige perfil de contador ou administrador do escritório.', forbidden: 'Você não tem acesso a esta empresa. Verifique sua carteira com o administrador.', unauthorized: 'Entre novamente para continuar.', scope_required: 'Seu acesso não permite esta operação. Verifique as permissões com o administrador.' };
 if (erro?.message && !mensagens[erro.message]) return erro.message;
 return mensagens[erro?.reason || erro?.error || erro?.message] || erro?.message || alternativa;
}
