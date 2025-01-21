import { type spawn } from 'node:child_process';
import { Options } from 'ollama';
import { LSPAny } from 'vscode-languageserver-protocol';

type OllamaConfig = {
  model: string;
  keep_alive: number;
  options?: Partial<Options>;
};

type ProviderConfig = OllamaConfig;

type Config = {
  host: string;
  thinking: OllamaConfig;
  tool_calling: OllamaConfig;
  summarizing: OllamaConfig;
};

export const config: Config = {
  host: process.env.OLLAMA_HOST || 'http://localhost:11434',
  thinking: {
    // model: 'deepseek-r1:32b-qwen-distill-q4_K_M',
    model: 'qwq:32b-preview-q4_K_M',
    keep_alive: -1,
    options: {
      num_ctx: 8192 * 2,
      temperature: 0.7,
      // temperature: 2,
      num_predict: 8192 / 2,
      repeat_penalty: 1.2,
    },
  },
  tool_calling: {
    model: 'qwen2.5:32b-instruct-q4_K_M',
    // model: 'mistral-large:123b-instruct-2407-q2_K',
    keep_alive: -1,
    options: {
      num_ctx: 8192 * 2,
      temperature: 0,
      num_predict: 500,
    },
  },
  summarizing: {
    model: 'qwen2.5:32b-instruct-q4_K_M',
    keep_alive: -1,
    options: {
      num_ctx: 8192 * 2,
      // a too low temperature may result in self repeating or copying the entire file
      temperature: 0.8,
    },
  },
};

export type LanguageServerConfig = {
  languageIds: string[];
  command: Parameters<typeof spawn>;
  settings: LSPAny;
};

export const languageServerConfigs: LanguageServerConfig[] = [
  {
    languageIds: ['typescript', 'javascript'],
    command: ['npx', ['deno', 'lsp'], { stdio: 'pipe' }],
    settings: {
      deno: {
        enable: true,
        codeLens: {
          implementations: true,
          references: true,
          test: true,
        },
      },
    },
  },
  {
    languageIds: ['python'],
    command: ['npx', ['pyright-langserver', '--stdio'], { stdio: 'pipe' }],
    settings: {
      python: {
        analysis: {
          autoSearchPaths: true,
          useLibraryCodeForTypes: true,
          diagnosticMode: 'workspace', // Options: "openFilesOnly", "workspace"
          // typeCheckingMode: 'basic', // Options: "off", "basic", "strict"
        },
      },
    },
  },
];
