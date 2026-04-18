import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadYamlWithIncludes } from './include-resolver';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

describe('loadYamlWithIncludes', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'include-resolver-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string): string {
    const abs = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return abs;
  }

  it('parses a plain YAML file with no includes', () => {
    const file = writeFile('a.yaml', 'foo: 1\nbar: hello\n');
    const result = loadYamlWithIncludes(file, tmpRoot) as Record<string, unknown>;
    expect(result).toEqual({ foo: 1, bar: 'hello' });
  });

  it('returns null for an empty file', () => {
    const file = writeFile('a.yaml', '');
    expect(loadYamlWithIncludes(file, tmpRoot)).toBeNull();
  });

  it('inlines a sibling YAML file', () => {
    writeFile('participants.yaml', '- id: agent-1\n  role: x\n');
    const main = writeFile('scenario.yaml', 'name: test\nparticipants: !include ./participants.yaml\n');
    const result = loadYamlWithIncludes(main, tmpRoot) as Record<string, unknown>;
    expect(result).toEqual({ name: 'test', participants: [{ id: 'agent-1', role: 'x' }] });
  });

  it('inlines a sibling JSON file', () => {
    writeFile('data/customers.json', '[{"id":"c1"},{"id":"c2"}]');
    const main = writeFile('scenario.yaml', 'customers: !include ./data/customers.json\n');
    const result = loadYamlWithIncludes(main, tmpRoot) as Record<string, unknown>;
    expect(result.customers).toEqual([{ id: 'c1' }, { id: 'c2' }]);
  });

  it('resolves relative paths from the file containing the include', () => {
    writeFile('packs/_shared/p.yaml', 'shared: true\n');
    writeFile(
      'packs/fraud/scenarios/s/1.0.0/templates/default.yaml',
      'overrides: !include ../../../../../_shared/p.yaml\n'
    );
    const tmplPath = path.join(tmpRoot, 'packs/fraud/scenarios/s/1.0.0/templates/default.yaml');
    const result = loadYamlWithIncludes(tmplPath, tmpRoot) as Record<string, unknown>;
    expect(result.overrides).toEqual({ shared: true });
  });

  it('supports recursive includes', () => {
    writeFile('c.yaml', 'leaf: c\n');
    writeFile('b.yaml', 'mid: !include ./c.yaml\n');
    const main = writeFile('a.yaml', 'root: !include ./b.yaml\n');
    const result = loadYamlWithIncludes(main, tmpRoot) as Record<string, unknown>;
    expect(result).toEqual({ root: { mid: { leaf: 'c' } } });
  });

  it('rejects path escape attempts', () => {
    const main = writeFile('a.yaml', 'data: !include ../../../etc/passwd\n');
    try {
      loadYamlWithIncludes(main, tmpRoot);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_PACK_DATA);
      expect((err as AppException).message).toContain('escapes PACKS_DIR');
    }
  });

  it('rejects absolute paths outside packs root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    fs.writeFileSync(path.join(outside, 'leak.yaml'), 'x: 1');
    const main = writeFile('a.yaml', `data: !include ${path.join(outside, 'leak.yaml')}\n`);
    try {
      loadYamlWithIncludes(main, tmpRoot);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_PACK_DATA);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('detects cycles', () => {
    writeFile('b.yaml', 'back: !include ./a.yaml\n');
    const main = writeFile('a.yaml', 'next: !include ./b.yaml\n');
    try {
      loadYamlWithIncludes(main, tmpRoot);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_PACK_DATA);
      expect((err as AppException).message).toContain('cycle');
    }
  });

  it('throws when the target is missing', () => {
    const main = writeFile('a.yaml', 'data: !include ./nope.yaml\n');
    try {
      loadYamlWithIncludes(main, tmpRoot);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).message).toContain('not found');
    }
  });

  it('rejects unsupported extensions', () => {
    writeFile('data.txt', 'hello');
    const main = writeFile('a.yaml', 'data: !include ./data.txt\n');
    try {
      loadYamlWithIncludes(main, tmpRoot);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).message).toContain('unsupported extension');
    }
  });

  it('throws on invalid JSON included files', () => {
    writeFile('bad.json', '{not valid');
    const main = writeFile('a.yaml', 'data: !include ./bad.json\n');
    try {
      loadYamlWithIncludes(main, tmpRoot);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).message).toContain('invalid JSON');
    }
  });

  it('allows two siblings to include the same fragment without flagging a cycle', () => {
    writeFile('shared.yaml', 'value: 42\n');
    const main = writeFile('a.yaml', 'first: !include ./shared.yaml\nsecond: !include ./shared.yaml\n');
    const result = loadYamlWithIncludes(main, tmpRoot) as Record<string, unknown>;
    expect(result).toEqual({ first: { value: 42 }, second: { value: 42 } });
  });
});
