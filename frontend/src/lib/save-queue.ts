export interface SaveSnapshot {
  content: string;
  mtimeMs: number;
  revision: string;
}

export function createSaveQueue<T>(save: (force: boolean) => Promise<T>) {
  let active: Promise<T> | null = null;
  return async (force = false): Promise<T> => {
    while (active) await active;
    const task = save(force);
    active = task;
    try {
      return await task;
    } finally {
      if (active === task) active = null;
    }
  };
}
