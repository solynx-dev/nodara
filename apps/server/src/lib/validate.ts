import type { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    throw badRequest(first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request', issues);
  }
  return r.data;
}
