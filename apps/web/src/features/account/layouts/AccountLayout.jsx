import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/features/auth/AuthProvider';

/** Shared account pages (any role): rendered in the frame of the session's active role. */
export default function AccountLayout() {
  const { session } = useAuth();
  return <AppShell role={session.activeRole.toLowerCase()} />;
}
