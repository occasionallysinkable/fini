import { AsyncLocalStorage } from "node:async_hooks";

/*
  The write context. mutate() (and only mutate()) runs its transaction inside
  inWrite(), which sets a flag in async-local storage that survives across
  every await inside the transaction. The Prisma guard reads that flag: a
  create/update/delete with the flag set is a write mutate() is making; with
  the flag unset it is a direct write, and the guard throws.
*/

const store = new AsyncLocalStorage<true>();

export function inWrite<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(true, fn);
}

export function isInWrite(): boolean {
  return store.getStore() === true;
}
