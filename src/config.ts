import { Options } from 'ollama';

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
  summerizing: OllamaConfig;
};

export const config: Config = {
  host: 'http://localhost:11434',
  thinking: {
    model: 'qwq:32b-preview-q4_K_M',
    keep_alive: -1,
    options: {
      num_ctx: 8192 * 2,
      temperature: 1.2,
      num_predict: 8192,
    },
  },
  tool_calling: {
    model: 'qwen2.5:32b-instruct-q4_K_M',
    keep_alive: -1,
    options: {
      num_ctx: 8192 * 2,
      temperature: 0,
    },
  },
  summerizing: {
    model: 'mistral-large:123b-instruct-2407-q2_K',
    keep_alive: -1,
    options: {
      num_ctx: 8192 * 2,
      // a too low temperature may result in self repeating or copying the entire file
      temperature: 0.9,
    },
  },
};
