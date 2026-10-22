'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { store } from '../lib/store';
import { addUser, removeUser, renameUser, selectUser, useUsers } from '../lib/users';
import type { User } from '../types';

// Adding, renaming and removing players. Everything is done with ordinary form
// controls on the page, not browser dialogs (prompt, confirm), which some
// browsers block or never show.

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function PlayersPage() {
  const users = useUsers();
  const [error, setError] = useState<string | null>(null);
  // How many runs each player has, shown so deleting one says what it loses.
  const [runCounts, setRunCounts] = useState<Map<string, number>>(new Map());

  const list = users.state === 'ready' ? users.list : null;
  useEffect(() => {
    if (!list) return;
    let cancelled = false;
    Promise.all(list.map(async (u) => [u.id, (await store.listUserRuns(u.id)).length] as const)).then(
      (counts) => !cancelled && setRunCounts(new Map(counts)),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [list]);

  if (users.state === 'error') return <p className="card border-ember text-ember">{users.message}</p>;
  if (users.state === 'loading') return <p className="text-haze">Loading…</p>;
  const { current } = users;

  /** A trimmed name, or throws when it is empty or another player has it. */
  const checkName = (name: string, except?: User) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Type a name first.');
    const taken = users.list.some((u) => u.id !== except?.id && u.name.toLowerCase() === trimmed.toLowerCase());
    if (taken) throw new Error(`There is already a player called ${trimmed}.`);
    return trimmed;
  };

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Players</p>
          <h1 className="title text-4xl sm:text-5xl">Who practises here</h1>
        </div>
        <Link href="/" className="btn">
          Back to the library
        </Link>
      </div>
      <p className="text-sm text-haze">
        Pieces and saved drill settings are shared. Each player has their own practice history. Players are kept on this
        device only.
      </p>

      {error && <p className="card border-ember text-sm text-ember">{error}</p>}

      <AddPlayer onAdd={(name, select) => run(async () => addUser(checkName(name), select))} />

      <ul className="space-y-4">
        {users.list.map((user) => (
          <PlayerRow
            // A name changed elsewhere (the header) starts the row afresh.
            key={`${user.id}:${user.name}`}
            user={user}
            isCurrent={user.id === current.id}
            canRemove={users.list.length > 1}
            runCount={runCounts.get(user.id)}
            onSelect={() => run(() => selectUser(user.id))}
            onRename={(name) => run(() => renameUser(user, checkName(name, user)))}
            onRemove={() => run(() => removeUser(user.id))}
          />
        ))}
      </ul>
    </div>
  );
}

function AddPlayer({ onAdd }: { onAdd: (name: string, select: boolean) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [select, setSelect] = useState(false);
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd(name, select)) setName('');
      }}
    >
      <h2 className="title text-2xl">Add a player</h2>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="min-w-0 flex-1 rounded-block border-2 border-rule bg-night px-3 py-2 text-snow"
          placeholder="Name"
          aria-label="Name of the new player"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Add
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={select} onChange={(e) => setSelect(e.target.checked)} />
        Switch to them now
      </label>
    </form>
  );
}

function PlayerRow({
  user,
  isCurrent,
  canRemove,
  runCount,
  onSelect,
  onRename,
  onRemove,
}: {
  user: User;
  isCurrent: boolean;
  canRemove: boolean;
  runCount: number | undefined;
  onSelect: () => Promise<boolean>;
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [name, setName] = useState(user.name);
  const [confirming, setConfirming] = useState(false);
  const edited = name.trim() !== user.name;
  const history = runCount === undefined ? 'their practice history' : `${runCount} ${runCount === 1 ? 'run' : 'runs'}`;

  return (
    <li className="card space-y-3">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (edited && !(await onRename(name))) setName(user.name);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-block border-2 border-rule bg-night px-3 py-2 text-lg text-snow"
          aria-label={`Name of ${user.name}`}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {edited && (
          <>
            <button type="submit" className="btn btn-primary">
              Save name
            </button>
            <button type="button" className="btn" onClick={() => setName(user.name)}>
              Undo
            </button>
          </>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {isCurrent ? (
          <span className="font-display tracking-wider text-gold uppercase">Playing now</span>
        ) : (
          <button type="button" className="btn" onClick={() => void onSelect()}>
            Switch to {user.name}
          </button>
        )}
        <span className="text-haze">{runCount === undefined ? '' : history}</span>
        {canRemove && !confirming && (
          <button type="button" className="btn ml-auto" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <div className="space-y-3 border-l-2 border-ember pl-3 text-sm">
          <p>
            Delete {user.name} and {history}? Pieces stay in the library. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn border-ember text-ember"
              onClick={async () => {
                if (!(await onRemove())) setConfirming(false);
              }}
            >
              Delete {user.name}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
