import { HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

const SUPPORTED_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

interface ResolveContext {
  packsRoot: string;
  visited: Set<string>;
  parentFile: string;
}

function fail(message: string, parentFile: string): never {
  throw new AppException(
    ErrorCode.INVALID_PACK_DATA,
    `${message} (in ${parentFile})`,
    HttpStatus.INTERNAL_SERVER_ERROR
  );
}

function resolveIncludePath(includeArg: string, ctx: ResolveContext): string {
  if (typeof includeArg !== 'string' || includeArg.length === 0) {
    fail(`!include requires a non-empty string path`, ctx.parentFile);
  }

  const parentDir = path.dirname(ctx.parentFile);
  const resolved = path.resolve(parentDir, includeArg);

  const packsRootResolved = path.resolve(ctx.packsRoot);
  const boundary = packsRootResolved.endsWith(path.sep) ? packsRootResolved : packsRootResolved + path.sep;
  if (resolved !== packsRootResolved && !resolved.startsWith(boundary)) {
    fail(`!include path escapes PACKS_DIR: ${includeArg}`, ctx.parentFile);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    fail(`!include unsupported extension "${ext}" for ${includeArg}`, ctx.parentFile);
  }

  if (!fs.existsSync(resolved)) {
    fail(`!include target not found: ${includeArg}`, ctx.parentFile);
  }

  if (ctx.visited.has(resolved)) {
    fail(`!include cycle detected at ${includeArg}`, ctx.parentFile);
  }

  return resolved;
}

function loadFile(filePath: string, packsRoot: string, visited: Set<string>): unknown {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf-8');

  if (ext === '.json') {
    if (content.trim().length === 0) return null;
    try {
      return JSON.parse(content);
    } catch (err) {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `invalid JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  return parseYamlContent(content, filePath, packsRoot, visited);
}

function buildSchema(filePath: string, packsRoot: string, visited: Set<string>): yaml.Schema {
  const includeType = new yaml.Type('!include', {
    kind: 'scalar',
    construct: (data: unknown) => {
      const ctx: ResolveContext = { packsRoot, visited, parentFile: filePath };
      const resolved = resolveIncludePath(data as string, ctx);
      const nextVisited = new Set(visited);
      nextVisited.add(resolved);
      return loadFile(resolved, packsRoot, nextVisited);
    }
  });

  return yaml.JSON_SCHEMA.extend([includeType]);
}

function parseYamlContent(content: string, filePath: string, packsRoot: string, visited: Set<string>): unknown {
  if (content.trim().length === 0) return null;
  const schema = buildSchema(filePath, packsRoot, visited);
  try {
    return yaml.load(content, { schema });
  } catch (err) {
    if (err instanceof AppException) throw err;
    throw new AppException(
      ErrorCode.INVALID_PACK_DATA,
      `invalid YAML in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

export function loadYamlWithIncludes(filePath: string, packsRoot: string): unknown {
  const absoluteFile = path.resolve(filePath);
  const visited = new Set<string>([absoluteFile]);
  const content = fs.readFileSync(absoluteFile, 'utf-8');
  return parseYamlContent(content, absoluteFile, packsRoot, visited);
}
