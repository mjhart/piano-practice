'use client';

import { addUser, removeUser, renameUser, selectUser, useUsers } from '../lib/users';

// Who is practising. Pieces are shared; each player has their own history.

const askName = (message: string, current = '') => window.prompt(message, current)?.trim() || null;

export function UserPicker() {
  const users = useUsers();
  if (users.state !== 'ready') return null;
  const { list, current } = users;

  const choose = async (value: string) => {
    if (value === 'add') {
      const name = askName('Name of the new player');
      if (name) await addUser(name);
    } else if (value === 'rename') {
      const name = askName(`Rename ${current.name}`, current.name);
      if (name) await renameUser(current, name);
    } else if (value === 'remove') {
      if (confirm(`Remove ${current.name} and all of their practice history? Pieces stay in the library.`)) {
        await removeUser(current.id);
      }
    } else {
      await selectUser(value);
    }
  };

  return (
    <label className="flex items-center gap-2 text-sm text-haze">
      Player
      <select
        className="rounded-block border-2 border-rule bg-night px-2 py-1 text-snow"
        value={current.id}
        onChange={(e) => void choose(e.target.value)}
      >
        {list.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
        <option disabled>──────</option>
        <option value="add">Add a player…</option>
        <option value="rename">Rename {current.name}…</option>
        {list.length > 1 && <option value="remove">Remove {current.name}…</option>}
      </select>
    </label>
  );
}
