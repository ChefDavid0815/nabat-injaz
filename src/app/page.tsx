import { Marketing } from '@/components/marketing';
export default function HomePage() {
  return (
    <Marketing
      demoAvailable={
        process.env.ENABLE_DEMO === 'true' ||
        (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production')
      }
    />
  );
}
