'use client';

import Link from 'next/link';
import { selectUser, useUsers } from '../lib/users';

// Who is practising. Pieces are shared; each player has their own history.
// Players are added, renamed and removed on the players page.

export function UserPicker() {
  const users = useUsers();
  if (users.state !== 'ready') return null;
  const { list, current } = users;

  return (
    <div className="flex items-center gap-2 text-sm text-haze">
      <label className="flex items-center gap-2">
        Player
        <select
          className="rounded-block border-2 border-rule bg-night px-2 py-1 text-snow"
          value={current.id}
          onChange={(e) => void selectUser(e.target.value)}
        >
          {list.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>
      <Link href="/players" className="underline decoration-rule underline-offset-4 hover:text-gold">
        Manage
      </Link>
    </div>
  );
}
