import { ExitIcon } from './icons';

/** Formulario POST (no un enlace GET): un sitio ajeno no puede cerrar tu sesión con una imagen o un link. */
export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit">
        <ExitIcon />
        <span>Salir</span>
      </button>
    </form>
  );
}
