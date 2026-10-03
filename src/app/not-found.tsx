import Link from 'next/link';
import { Brand } from '@/components/brand';
export default function NotFound() {
  return (
    <main className="passport" id="main-content">
      <Brand />
      <h1>This record is out of reach.</h1>
      <p>The link may have changed, or your account may not have access to this plant.</p>
      <Link className="button" href="/app/plants">
        Open your plants
      </Link>
    </main>
  );
}
