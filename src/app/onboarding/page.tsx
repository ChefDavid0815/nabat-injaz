import { requireActor } from '@/server/session';
import { Onboarding } from '@/components/onboarding';
export const metadata = { title: 'A place for your plants' };
export default async function OnboardingPage() {
  await requireActor();
  return <Onboarding />;
}
