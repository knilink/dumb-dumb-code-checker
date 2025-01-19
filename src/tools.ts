import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import * as rpc from 'vscode-languageserver-protocol/node.js';
import { ToolCall } from 'ollama';
import { languageServerConfigs, LanguageServerConfig } from './config.ts';

import {
  Location,
  LocationLink,
  InitializeRequest,
  InitializedNotification,
  DidOpenTextDocumentNotification,
  InitializeParams,
  DidChangeConfigurationNotification,
  ReferencesRequest,
  ReferenceParams,
  ImplementationRequest,
  ImplementationParams,
  DefinitionRequest,
  DefinitionParams,
  TextDocumentItem,
} from 'vscode-languageserver-protocol';

import { SearchFiles, OpenFile, CodeNavigation, ListDir, typeCheck } from './schema.ts';

const mapping: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx'],
  json: ['.json'],
  markdown: ['.md'],
  python: ['.py'],
};

const knownExtensions: Map<string, string> = new Map(
  Object.entries(mapping).flatMap(([languageId, exts]) => exts.map((ext) => [ext, languageId]))
);

function isScript(languageId: string): boolean {
  return ['typescript', 'javascript'].includes(languageId);
}

async function search(workdir: string, pattern: string): Promise<string> {
  const rg = spawn(rgPath, [workdir, '--heading', '--line-number', '-S', '-e', pattern], { cwd: workdir });

  let output = '';
  let errorOutput = '';
  rg.stdout.on('data', (data) => {
    output += data;
  });

  rg.stderr.on('data', (data) => {
    errorOutput += data;
  });

  const code = await new Promise((resolve) => rg.on('close', resolve));

  if (code === 0) {
    return output
      .split('\n')
      .map((line) => {
        if (!line) {
          return line;
        } else if (/^[0-9]+:/.test(line)) {
          return line;
        }
        return path.relative(workdir, line);
      })
      .join('\n');
  } else if (code === 1) {
    return '';
  } else {
    throw new Error(`Command failed with code ${code}: ${errorOutput}`);
  }
}

function addLineNumbers(text: string): string {
  // Split the text into lines based on newline characters
  const lines = text.split('\n');

  // Determine the total number of digits needed for padding
  const maxDigits = `${lines.length}`.length;

  // Map over the array of lines to prepend line numbers with padding
  return lines
    .map((line, index) => {
      const paddedIndex = index.toString().padStart(maxDigits, ' ');
      return `${paddedIndex}: ${line}`;
    })
    .join('\n');
}

async function findFile(workdir: string, matcher: string): Promise<string> {
  const rg1 = spawn(rgPath, [workdir, '--files'], { cwd: workdir });
  const rg2 = spawn(rgPath, [matcher, '-i']);

  rg1.stdout.pipe(rg2.stdin);

  let output = '';
  let errorOutput = '';

  rg2.stdout.on('data', (data) => {
    output += data;
  });

  rg2.stderr.on('data', (data) => {
    errorOutput += data;
  });

  const code = await new Promise((resolve) => rg2.on('close', resolve));

  if (code === 0) {
    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => path.relative(workdir, line))
      .join('\n');
  } else if (code == 1) {
    return 'Not found.';
  } else {
    throw new Error(`Command failed with code ${code}: ${errorOutput}`);
  }
}

async function listDir(workdir: string, dirPath: string): Promise<string[]> {
  const fullPath = path.join(workdir, dirPath);
  const files = await fs.promises.readdir(fullPath);
  return files.map((f) => path.relative(workdir, path.join(fullPath, f)));
}

class LanguageServerManager {
  connections = new Map<string, rpc.MessageConnection>();

  constructor(protected workdir: string) {}

  async get(languageId: string): Promise<rpc.MessageConnection | undefined> {
    let connection = this.connections.get(languageId);
    if (connection) return connection;
    const config = languageServerConfigs.find(({ languageIds }) => languageIds.includes(languageId));
    if (!config) return;
    connection = await LanguageServerManager.createConnection(this.workdir, config);
    for (const languageId of config.languageIds) {
      this.connections.set(languageId, connection);
    }
    return connection;
  }

  static async createConnection(workdir: string, config: LanguageServerConfig): Promise<rpc.MessageConnection> {
    const languageServerProcess = spawn(...config.command);
    const connection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(languageServerProcess.stdout),
      new rpc.StreamMessageWriter(languageServerProcess.stdin),
      console
    );
    connection.listen();

    const initParams: InitializeParams = {
      // At minimum provide these
      rootPath: workdir,
      rootUri: `file://${workdir}`,
      processId: process.pid,
      capabilities: {
        textDocument: {
          synchronization: {},
          codeLens: { dynamicRegistration: true },
          references: {},
          implementation: {},
        },
        workspace: { executeCommand: {}, codeLens: { refreshSupport: true }, didChangeConfiguration: {} },
      },
      // workspaceFolders: [
      //   {
      //     uri: `file://${this.workdir}`,
      //     name: path.basename(this.workdir),
      //   },
      // ],
    };

    await connection.sendRequest(InitializeRequest.type, initParams);
    await connection.sendNotification(InitializedNotification.type, {});
    await connection.sendNotification(DidChangeConfigurationNotification.type, {
      settings: config.settings,
    });
    return connection;
  }
}

export class Tools {
  private languageServerManager: LanguageServerManager;
  private documentCache: Map<string, TextDocumentItem> = new Map();

  static async create(workdir: string) {
    const tools = new Tools(workdir);
    return tools;
  }

  protected constructor(protected workdir: string) {
    this.languageServerManager = new LanguageServerManager(workdir);
  }

  async getConnection(languageId: string): Promise<rpc.MessageConnection> {
    const connection = await this.languageServerManager.get(languageId);
    if (!connection) throw new Error(`Language server not supported for "${languageId}"`);
    return connection;
  }

  async searchFiles(params: SearchFiles.Type): Promise<string> {
    const result =
      params.searchBy === 'filename'
        ? await findFile(this.workdir, params.pattern)
        : await search(this.workdir, params.pattern);

    if (!result) {
      return 'No file found.';
    } else {
      return `The following files were found:
\`\`\`
${result}
\`\`\`
`;
    }
  }

  async _openDocument(fullPath: string): Promise<TextDocumentItem> {
    let textDocument = this.documentCache.get(fullPath);
    const extname = path.extname(fullPath);
    const languageId = knownExtensions.get(extname) ?? 'unknown';
    const content = await fs.promises.readFile(fullPath, 'utf8');
    const uri = `file://${fullPath}`;
    textDocument = TextDocumentItem.create(uri, languageId, 1, content);
    const connection = await this.languageServerManager.get(languageId);
    await connection?.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument,
    });
    this.documentCache.set(fullPath, textDocument);
    return textDocument;
  }

  async openFile(params: OpenFile.Type): Promise<string> {
    const fullPath = path.join(this.workdir, params.filePath);
    const textDocument = await this._openDocument(fullPath);
    const prependedContent = addLineNumbers(textDocument.text);
    const promptSegment = `\`\`\`${textDocument.languageId}
// file://${params.filePath}
// line numbers prepend for each line starts from line number 0
${prependedContent}
\`\`\``;
    return promptSegment;
  }

  async codeNavigation(params: CodeNavigation.Type): Promise<string> {
    const fullPath = path.join(this.workdir, params.filePath);
    const document = await this._openDocument(fullPath);
    const uri = `file://${fullPath}`;
    const line = params.line;
    const identifier = params.identifier;
    const languageId = document.languageId;
    const content = document.text;
    const lineContent = content?.split('\n')[line];
    if (!lineContent) {
      throw new Error(`No line ${line} in \`${uri}\``);
    }
    const regex = new RegExp(`\\b${identifier}\\b`, 'g');
    const matches = [...lineContent.matchAll(regex)];
    let characters: number = matches[0].index;
    if (matches.length === 0) {
    } else if (matches.length > 1) {
      if (params.nthId === undefined) {
        throw new Error(`Multiple matches for \`${identifier}\` in line ${line} of \`${uri}\``);
      }
      characters = matches[params.nthId].index;
      if (characters == undefined) {
        throw new Error(`No match for \`${identifier}\` in line ${line} of \`${uri}\``);
      }
    }

    if (params.type === 'definition') {
      return await this.goToSourceDefinition(uri, languageId, line, characters);
    } else if (params.type === 'references') {
      return await this.listReferences(uri, languageId, line, characters);
    } else if (params.type === 'implementations') {
      return await this.listImplementation(uri, languageId, line, characters);
    }
    return `Error: unknown type ${params.type}`;
  }

  async goToSourceDefinition(uri: string, languageId: string, line: number, character: number): Promise<string> {
    const params: DefinitionParams = {
      textDocument: { uri },
      position: { line, character },
    };
    const connection = await this.getConnection(languageId);
    const result = await connection.sendRequest(DefinitionRequest.type, params);
    let location: LocationLink | Location | null = null;
    if (Array.isArray(result)) {
      location = result[0];
    } else {
      location = result;
    }
    if (!location) {
      return 'No definition found.';
    }
    const targetUri = 'uri' in location ? location.uri : location.targetUri;
    const lineNumber = 'uri' in location ? location.range.start.line : location.targetRange.start.line;
    const fullPath = targetUri.slice('file://'.length);
    const relativePath = path.relative(this.workdir, fullPath);
    const document = await this._openDocument(fullPath);
    if (!isScript(document.languageId)) {
      return `The content of \`${relativePath}\` is as below:
\`\`\`
${document.text}
\`\`\``;
    }
    const textWithLines = addLineNumbers(document.text);
    const promptSection = `\`\`\`${document.languageId}
// file://${relativePath}
// line numbers prepend for each line starts from line number 0
// definition starts from line ${lineNumber}
${textWithLines}
\`\`\``;
    return promptSection;
  }

  async listReferences(uri: string, languageId: string, line: number, character: number): Promise<string> {
    const params: ReferenceParams = {
      textDocument: {
        uri,
      },
      position: { line, character },
      context: { includeDeclaration: true },
    };
    const connection = await this.getConnection(languageId);
    const references = await connection.sendRequest(ReferencesRequest.type, params);
    const promptSection = `The references with prepend line number are:
\`\`\`
${await this._formatLocations(references)}
\`\`\``;
    return promptSection;
  }

  async listImplementation(uri: string, languageId: string, line: number, character: number): Promise<string> {
    const params: ImplementationParams = {
      textDocument: {
        uri,
      },
      position: { line, character },
    };
    const connection = await this.getConnection(languageId);
    const res = await connection.sendRequest(ImplementationRequest.type, params);
    if (Array.isArray(res)) {
      const locations: Location[] = res.map((loc) => {
        if ('targetRange' in loc) {
          return { uri: loc.targetUri, range: loc.targetRange };
        } else {
          return loc;
        }
      });
      return `The implementation locations with prepend line number are:
\`\`\`
${await this._formatLocations(locations)}
\`\`\`
`;
    } else if (res) {
      return `The implementation location with prepend line number is:
\`\`\`
${await this._formatLocations([res])}
\`\`\``;
    }

    return 'No implementation found.';
  }

  async _formatLocations(locations: Location[] | null) {
    if (!locations) {
      return 'Not found';
    }
    const grouped: { [key: string]: string[] } = {};
    const maxDigits =
      locations
        .map((loc) => loc.range.end.line)
        .reduce((s, i) => (s > i ? s : i), -1)
        .toString().length + 1;

    for (const location of locations) {
      const fullPath = location.uri.slice('file://'.length);
      if (!grouped[location.uri]) {
        grouped[location.uri] = [path.relative(this.workdir, fullPath)];
      }
      const content = (await this._openDocument(fullPath)).text;

      const lineContent = content?.split('\n')[location.range.start.line];
      const lineNumber = location.range.start.line;
      if (!lineContent) {
        throw new Error(`No line ${location.range.start.line} in \`${fullPath}\``);
      }
      const paddedLineNumber = lineNumber.toString().padStart(maxDigits, ' ');
      grouped[location.uri].push(`${paddedLineNumber}: ${lineContent}`);
    }

    return Object.values(grouped).flat().join('\n');
  }

  async call(toolCall: ToolCall): Promise<string> {
    const { name, arguments: args } = toolCall.function;
    if (name === SearchFiles.tool.function.name) {
      const params = typeCheck(SearchFiles.schema, args);
      return this.searchFiles(params);
    }
    if (name === OpenFile.tool.function.name) {
      const params = typeCheck(OpenFile.schema, args);
      return this.openFile(params);
    }
    if (name === CodeNavigation.tool.function.name) {
      const params = typeCheck(CodeNavigation.schema, args);
      return this.codeNavigation(params);
    }
    if (name === ListDir.tool.function.name) {
      const params = typeCheck(ListDir.schema, args);
      try {
        const files = await listDir(this.workdir, params.dirPath || '.');
        return `\`\`\`
${files.join('\n')}
\`\`\``;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return `Error: No such file or directory at '${params.dirPath || '.'}'`;
        }
        // Optionally handle other error cases
        return `Error: ${(error as any).message}`;
      }
    }
    throw new Error(`Unknown function name ${toolCall.function.name}`);
  }
}
// npx pyright-langserver --stdio
