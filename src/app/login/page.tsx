import { AuthForm } from '@/components/auth-form';
export const metadata = { title: 'Sign in' };
export default function LoginPage() {
  return (
    <AuthForm
      demoAvailable={
        process.env.ENABLE_DEMO === 'true' ||
        (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production')
      }
    />
  );
}
