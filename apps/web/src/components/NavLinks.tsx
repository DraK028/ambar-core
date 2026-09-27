'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChatIcon, HomeIcon, TransferIcon } from './icons';

const LINKS = [
  { href: '/inicio', label: 'Inicio', icon: HomeIcon, match: (p: string) => p === '/inicio' || p.startsWith('/cuentas') },
  { href: '/transferir', label: 'Transferir', icon: TransferIcon, match: (p: string) => p.startsWith('/transferir') },
  { href: '/asistente', label: 'Asistente', icon: ChatIcon, match: (p: string) => p.startsWith('/asistente') },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, icon: Icon, match }) => (
        <Link key={href} href={href} aria-current={match(pathname) ? 'page' : undefined}>
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </>
  );
}
