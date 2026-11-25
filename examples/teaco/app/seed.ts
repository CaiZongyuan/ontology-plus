import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSeed } from '../domain/index.js';
import type { TeacoRepository } from './db.js';

/** Imports the public bb-seed0 fixture through the trusted seed path (no shipping side effects, DQ-11). */
export async function seedIfEmpty(repository: TeacoRepository, seedDir: string, at: string): Promise<boolean> {
  if (!(await repository.isEmpty())) return false;
  const read = (f: string) => readFileSync(join(seedDir, f), 'utf8');
  await repository.importSeed(normalizeSeed({ customersCsv: read('customers.csv'), productsCsv: read('products.csv'), orderLinesCsv: read('order_lines.csv') }), at);
  return true;
}
