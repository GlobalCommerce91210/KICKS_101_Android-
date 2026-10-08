import { AccountPermissions } from '../components/AccountPermissions';
import { useSession } from '../components/SessionProvider';

export default function Permissions() {
  const { user } = useSession();
  return <AccountPermissions key={user?.subjectId ?? 'signed-out'} />;
}

