import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session/session';

export default async function Home() {
  redirect((await getSession({ touch: false })) ? '/inicio' : '/entrar');
}
