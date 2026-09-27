import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="login-main" id="contenido">
      <h1>No encontramos esa página</h1>
      <p className="muted">Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <Link className="btn btn-primary" href="/inicio">
        Ir al inicio
      </Link>
    </main>
  );
}
