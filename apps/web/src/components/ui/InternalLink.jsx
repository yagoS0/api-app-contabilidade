import { Link, useInRouterContext } from 'react-router-dom';

// Mantém a sessão e o histórico no app; href continua disponível para abrir em outra aba.
export function InternalLink({ href, children, ...props }) {
  const inRouter = useInRouterContext();
  return inRouter ? <Link to={href} {...props}>{children}</Link>
    : <a href={href} {...props}>{children}</a>;
}
