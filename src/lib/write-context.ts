import { AsyncLocalStorage } from "node:async_hooks";

/*
  The write context. mutate() (and only mutate()) runs its transaction inside
  inWrite(), which sets a flag in async-local storage that survives across
  every await inside the transaction. The Prisma guard reads that flag: a
  create/update/delete with the flag set is a write mutate() is making; with
  the flag unset it is a direct write, and the guard throws.

  The store MUST be a single instance process-wide. Next bundles a server
  action into a different chunk from the server components and the Prisma
  client, and a module-level `new AsyncLocalStorage()` is then evaluated once
  per chunk — inWrite() would set one store while the guard reads another, and
  every write through a server action would be wrongly blocked. Pinning the one
  store on globalThis (the same trick prisma.ts uses for its client) makes every
  copy of this module share it. This is not a dev-only concern: the action/RSC
  split happens in production builds too, so the pin is unconditional.
*/

const globalForWrite = globalThis as unknown as {
  writeStore?: AsyncLocalStorage<true>;
};

const store = globalForWrite.writeStore ?? new AsyncLocalStorage<true>();
globalForWrite.writeStore = store;

export function inWrite<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(true, fn);
}

export function isInWrite(): boolean {
  return store.getStore() === true;
}
