import { Ollama } from 'ollama';
import { config } from './config.ts';
import { Tools } from './tools.ts';
import { streamResponse } from './utils.ts';
import { Reporting, SubmitReleaventFiles, typeCheck } from './schema.ts';

async function fetchReadme(
  ollama: Ollama,
  query: string,
  tools: Tools
): Promise<{ context: string; resolved: boolean }> {
  let context = `## The project root folder contains following files:
${await tools.listDir({})}
`;
  if (context.includes('\nREADME.md\n')) {
    context += `\n## Porject readme
${await tools.openFile({ filePath: 'README.md' })}
`;
  }
  return { context, resolved: false };
}

async function fetchRelevantFiles(
  ollama: Ollama,
  query: string,
  tools: Tools
): Promise<{ context: string; resolved: boolean }> {
  const files = await tools.searchFiles({ searchBy: 'filename', pattern: '' });
  const message = {
    role: 'user',
    content: `You are a professional code analyst. Listing all files within the given project result in:
${files}

Select a list of files exists in list above that are likely to contain information required to resovle the following query.
\`\`\`
${query}
\`\`\`
The list is sorted by relevance.
You should select files with their dependencies in mind.
All path are relative to project root.
`,
  };

  let streamRes = await ollama.chat({
    ...config.summarizing,
    messages: [message],
    stream: true,
  });

  const fileListText = await streamResponse(streamRes);
  let toolRes = await ollama.chat({
    ...config.tool_calling,
    messages: [
      {
        role: 'user',
        content: `Submit the file paths in following content using given tool:
\`\`\`
${fileListText}
\`\`\``,
      },
    ],
    tools: [SubmitReleaventFiles.tool],
  });

  const params = typeCheck(SubmitReleaventFiles.schema, toolRes.message.tool_calls![0].function.arguments);
  const contents = await Promise.all(params.filePaths.map((path) => tools.openFile({ filePath: path })));

  const sumMessage = {
    role: 'user',
    content: `Here is a list of files in the repository that may help you answer the query:
${contents.join('\n\n')}

# INSTRUCTION
You are an expert software engineer. Answer the following user query using provided context retrieved from the given repository. At the end, summarize your analysis above, and conclude whether user's query has been resolved or further investigation is required in one sentense.

# USER QUERY
\`\`\`
${query}
\`\`\`
`,
  };

  streamRes = await ollama.chat({
    ...config.summarizing,
    messages: [sumMessage],
    stream: true,
  });

  const sumResult = await streamResponse(streamRes);

  toolRes = await ollama.chat({
    ...config.tool_calling,
    messages: [
      sumMessage,
      { role: 'assistant', content: sumResult },
      { role: 'user', content: 'Now use provided tool to report your state.' },
    ],
    tools: [Reporting.tool],
  });

  const verdict = typeCheck(Reporting.schema, toolRes.message.tool_calls![0].function.arguments);
  const resolved = verdict.reason !== 'continue';

  streamRes = await ollama.chat({
    ...config.summarizing,
    options: { ...config.summarizing.options, temperature: 0 },
    messages: [
      sumMessage,
      { role: 'assistant', content: sumResult },
      {
        role: 'user',
        content: resolved
          ? "Now generate a report to resolve user's query."
          : "Now wrap up all useful information help resolving user's query, include file path and original line number when refering code blocks.",
      },
    ],
    stream: true,
  });
  return { context: await streamResponse(streamRes), resolved };
}

async function fetchRelevantFiles2(
  ollama: Ollama,
  query: string,
  tools: Tools
): Promise<{ context: string; resolved: boolean }> {
  const files = await tools.searchFiles({ searchBy: 'filename', pattern: '' });
  const message = {
    role: 'user',
    content: `You are a professional code analyst. Listing all files within the given project result in:
${files}

Select a list of files exists in list above that are likely to contain information required to resovle the following query.
\`\`\`
${query}
\`\`\`
The list is sorted by relevance.
You should select files with their dependencies in mind.
All path are relative to project root.
`,
  };

  let streamRes = await ollama.chat({
    ...config.summarizing,
    messages: [message],
    stream: true,
  });

  const fileListText = await streamResponse(streamRes);
  let toolRes = await ollama.chat({
    ...config.tool_calling,
    messages: [
      {
        role: 'user',
        content: `Submit the file paths in following content using given tool:
\`\`\`
${fileListText}
\`\`\``,
      },
    ],
    tools: [SubmitReleaventFiles.tool],
  });

  const params = typeCheck(SubmitReleaventFiles.schema, toolRes.message.tool_calls![0].function.arguments);
  const contents = await Promise.all(params.filePaths.map((path) => tools.openFile({ filePath: path })));

  const sumMessage = {
    role: 'user',
    content: `Here is a list of files in the repository that may help you answer the query:
${contents.join('\n\n')}

# INSTRUCTION
You are an expert software engineer. Extract all useful information provided above which could help answering the following user query. Includes file path and original line numbers when referering code blocks.

# USER QUERY
\`\`\`
${query}
\`\`\`
`,
  };

  streamRes = await ollama.chat({
    ...config.summarizing,
    messages: [sumMessage],
    stream: true,
  });

  const sumResult = await streamResponse(streamRes);

  return { context: sumResult, resolved: false };
}

export async function initializeContext(
  type: string,
  ollama: Ollama,
  query: string,
  tools: Tools
): Promise<{ context: string; resolved: boolean }> {
  switch (type) {
    case 'none':
      return { context: '', resolved: false };
    case 'readme':
      return fetchReadme(ollama, query, tools);
    case 'relevant-files':
      return fetchRelevantFiles2(ollama, query, tools);
    default:
      throw new Error(`Invalid context type: ${type}`);
  }
}
