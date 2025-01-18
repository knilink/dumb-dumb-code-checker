import { Type, Static, TSchema } from '@sinclair/typebox';
import { Tool } from 'ollama';
import { TypeCompiler, ValueError, ValueErrorIterator } from '@sinclair/typebox/compiler';

const Optional = <T extends TSchema>(schema: T) => Type.Optional(Type.Union([Type.Null(), schema]));

export namespace SearchFiles {
  export const tool: Tool = {
    type: 'function',
    function: {
      name: 'searchFiles',
      description: 'Non-semantic case insensitive files search.',
      parameters: {
        type: 'object',
        properties: {
          searchBy: {
            type: 'string',
            description: 'The search criteria, choose to search by `filename` of by `content`',
            enum: ['filename', 'content'],
          },
          pattern: { type: 'string', description: 'The matching pattern for the search.' },
        },
        required: ['searchBy', 'query'],
      },
    },
  };
  export const schema = Type.Object({
    searchBy: Type.String({
      enum: ['filename', 'content'],
    }),
    pattern: Type.String(),
  });
  export type Type = Static<typeof schema>;
}

export namespace OpenFile {
  export const tool: Tool = {
    type: 'function',
    function: {
      name: 'openFile',
      description: 'Opens a file and returns its content.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The path to the file to be opened.',
          },
        },
        required: ['filePath'],
      },
    },
  };

  export const schema = Type.Object({
    filePath: Type.String({ description: 'The path to the file to be opened.' }),
  });

  export type Type = Static<typeof schema>;
}

export namespace CodeNavigation {
  export const tool: Tool = {
    type: 'function',
    function: {
      name: 'codeNavigation',
      description: 'Navigate to definitions, find references, or find implementations of a symbol in the code.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'The type of navigation: "definition", "references", or "implementations".',
            enum: ['definition', 'references', 'implementations'],
          },
          filePath: { type: 'string', description: 'The relative of the file containing the symbol.' },
          line: { type: 'number', description: 'The line number where the symbol is located.' },
          identifier: {
            type: 'string',
            description: 'The referred programming languages identifier in the specific line to be applied.',
          },
          nthId: {
            type: 'number',
            description:
              'The index of the identifier if there are multiple identifiers with the same name on the same line.',
          },
        },
        required: ['type', 'uri', 'line', 'identifier'],
      },
    },
  };

  export const schema = Type.Object({
    type: Type.String({
      enum: ['definition', 'references', 'implementations'],
    }),
    filePath: Type.String(),
    line: Type.Number(),
    identifier: Type.String(),
    nthId: Optional(Type.Number()),
  });

  export type Type = Static<typeof schema>;
}

export namespace Reporting {
  export const tool: Tool = {
    type: 'function',
    function: {
      name: 'report',
      description: `Report your current status, choose one of the reasons below:
- resolved: User's query has been resolved and you are ready to report your conclusion.
- review: You have collected decent amount of information and the rest of your doubts are unrelated to current code base. You need user to review your finding to decide the investigation should be continue.
- continue: User's query has not been resolved and further investigation is needed for collecting more information.`,
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '',
            enum: ['resolved', 'review', 'continue'],
          },
        },
        required: ['reason'],
      },
    },
  };

  export const schema = Type.Object({
    reason: Type.String({ enum: ['resolved', 'continue'] }),
  });

  export type Type = Static<typeof schema>;
}

export namespace ListDir {
  export const tool: Tool = {
    type: 'function',
    function: {
      name: 'listDir',
      description: "List the files and directories in a given directory. The path is relative to the project's root.",
      parameters: {
        type: 'object',
        properties: {
          dirPath: {
            type: 'string',
            description: 'The path of the directory to list, default to project root if not provided.',
          },
        },
        required: [],
      },
    },
  };

  export const schema = Type.Object({
    dirPath: Optional(Type.String()),
  });

  export type Type = Static<typeof schema>;
}

function formatErrorMessage(errors: ValueErrorIterator): string {
  const message = Array.from(errors)
    .map((e) => `- ${e.path}: ${e.message}`)
    .join('\n');

  return `Validation errors:\n${message}`;
}

export function typeCheck<T extends TSchema>(schema: T, args: unknown): Static<T> {
  const check = TypeCompiler.Compile(schema);
  if (!check.Check(args)) {
    const message = formatErrorMessage(check.Errors(args));
    throw new Error(message);
  }
  return args;
}
