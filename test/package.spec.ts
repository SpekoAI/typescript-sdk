import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;
const files = manifest['files'] as string[];

describe('published tarball contents', () => {
  it('covers every path its export map points at', () => {
    // 0.5.1 exposed `"@spekoai/source": "./src/index.ts"` while `files` shipped
    // `dist` only, so that condition resolved to a path absent from the tarball
    // and every dist/*.d.ts.map pointed into the same missing tree.
    //
    // `files` coverage is what this asserts. On-disk existence is only checked
    // for paths the build does not produce, so the suite does not depend on
    // whether `build` has run first.
    const root = (manifest['exports'] as Record<string, Record<string, string> | string>)[
      '.'
    ] as Record<string, string>;

    for (const target of Object.values(root)) {
      const relative = target.replace(/^\.\//, '');
      const topLevel = relative.split('/')[0] as string;
      expect(files, `${target} is not covered by "files"`).toContain(topLevel);
      if (topLevel === 'dist') continue;
      expect(existsSync(join(packageRoot, relative)), `${target} is missing`).toBe(true);
    }
  });

  it('ships the LICENSE the manifest claims', () => {
    expect(manifest['license']).toBe('MIT');
    expect(files).toContain('LICENSE');
    expect(readFileSync(join(packageRoot, 'LICENSE'), 'utf8')).toMatch(/^MIT License/);
  });
});
