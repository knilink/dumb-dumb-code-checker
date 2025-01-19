import path from 'node:path';
import { Ollama, Message, ChatResponse } from 'ollama';
import { Command } from 'commander';
import { SearchFiles, OpenFile, CodeNavigation, Reporting, typeCheck, ListDir } from './schema.ts';
import { Tools } from './tools.ts';
import { config } from './config.ts';

type Iteration = {
  notes: string;
  thinking: string;
  toolRequest: unknown;
  toolResult: string;
};

const ollama = new Ollama({ host: config.host });

function getContext(
  query: string,
  instruction: string,
  cycle: Iteration,
  thought: string = '',
  init: string = ''
): string {
  const ctx: string[] = [
    `# Context
## User's original query regarding to current code base
\`\`\`
${query}
\`\`\``,
  ];

  if (init) {
    ctx.push(`\n${init}\n`);
  }

  if (!!cycle.toolRequest)
    ctx.push(`## Your predecessor's action
\`\`\`json
${JSON.stringify(cycle.toolRequest)}
\`\`\``);
  if (cycle.toolResult)
    ctx.push(`## Your predecessor's action result
\`\`\`
${cycle.toolResult}
\`\`\``);
  if (cycle.notes)
    ctx.push(`## Note from your predecessor
Follow with cares as your predecessor did not have access to its action result thus it did not have as much as information as you do when it came to analyzing and decision making
\`\`\`txt
${cycle.notes}
\`\`\``);
  if (thought) ctx.push(`## Your current thought:\n${thought}`);
  if (instruction) ctx.push(`\n# Your Instruction:\n${instruction}`);
  return ctx.join('\n\n');
}

const iter0: Iteration = {
  notes: '',
  thinking: '',
  toolRequest: null,
  toolResult: '',
};

const syspmt = `You are a professional static code analyst. Your task it to resolve user's query by following user's instruction.`;

const thinkingInstruction = `Now is thinking stage.
You should think step by step and think critically to analyze the situation in plain text base on what you currently have and decide whether user's query can be resolved or the investigation needs to be continue.
You are not allow to make any assumptions which is not directly related current context.
Your predecessor's action result is the ground truth, while it may or may not be useful depending on the context.
Your predecessor's note is derived from truth which mean it may or may not be distorted thus you should adopt with thinking critically.
In this stage, you MUST ALWAYS think in nature language script and structured data are forbidden.
At the end describe your next direct action in one sentence and your action target must be this code base unless you are reporting to user.

To help your planning, below are actions you can perform during action stage which I'll specify later:
- searchFiles: Search file by file name or by content.
- openFile: Open a file by path to view its content.
- codeNavigation: Go to definition, list references or implementations of a symbol.
- listDir: List the files and directories in a given directory.
`;

async function streamResponse(response: AsyncIterable<ChatResponse>): Promise<string> {
  const res: string[] = [];
  for await (const part of response) {
    res.push(part.message.content);
    process.stdout.write(part.message.content);
  }
  console.log('');
  return res.join('').trim();
}

const temperature = 0.8;

function notingInsturction(req: any): string {
  const inst = `Your next action request is:
\`\`\`json
${JSON.stringify(req)}
\`\`\`
Your request is being process but before there is a result, you will be dead.
There will be a successor to handle the result and continue your work.
Your successor will have no knowledge about what you are doing and what have been done except user's original query and your action about to be form.
Make sure you take note of everything necessary so that your successor wouldn't have to repeat what have been done.
It's suggested to include and not limited to:
- Statement of facts written to help clarifying user's query which is highly recommended. Examples: "foo is a file", "bar is a function".
- Describe your general goal, plans and state at your current stage in one sentence.
- Code blocks with its original line numbers and file path
Your entire response will be the content of your notes and must being using nature language unless referring code.
Write with your own words! Do not copy paste contents from the context!
Be aware that there will be a compressing stage later on your note which means the longer your note is the more likely the key informations will be lost by compressing. Please be concise and focus on key points to ensure your message is clear and effective without unrelated commentary.
`;
  return inst;
}

function separator(
  label: string,
  options: {
    char?: string;
    length?: number;
    endNewline?: boolean;
  } = {}
): string {
  const { char = '-', length = 80, endNewline = true } = options;

  if (char.length !== 1) {
    throw new Error('Padding character must be exactly one character long');
  }

  // Account for label and spacing
  const labelWithSpaces = ` ${label} `;
  const remainingLength = length - labelWithSpaces.length;

  if (remainingLength < 2) {
    throw new Error('Separator length must be greater than label length plus spacing');
  }

  // Calculate padding lengths
  const leftPadding = Math.floor(remainingLength / 2);
  const rightPadding = remainingLength - leftPadding;

  // Build separator
  const result = char.repeat(leftPadding) + labelWithSpaces + char.repeat(rightPadding);

  return endNewline ? result + '\n' : result;
}

interface CLIOptions {
  workspace: string;
  query: string;
  maxIterations: number;
}

async function run(options: CLIOptions) {
  const query = options.query;
  const tools = await Tools.create(path.resolve(options.workspace));
  console.log(`Querry: ${query}`);
  const iterations: Iteration[] = [iter0];
  let initContext = `## The project root folder contains following files:
${await tools.listDir({})}
`;
  if (initContext.includes('\nREADME.md\n')) {
    initContext += `\n## Porject readme
${await tools.openFile({ filePath: 'README.md' })}
`;
  }
  for (let i = 0; i < options.maxIterations; i++) {
    console.log(separator(`ITERATION ${i}`, { char: '=', length: 80, endNewline: true }));
    console.log(separator(`THINKING`, { char: '-', length: 80, endNewline: true }));
    const nextIteration: Iteration = {
      ...iter0,
    };
    const context = getContext(
      query,
      '',
      iterations[iterations.length - 1],
      '', //cycle2.thinking
      i === 0 ? initContext : ''
    );
    const messages: Message[] = [
      { role: 'system', content: syspmt },
      {
        role: 'user',
        content: context,
      },
      {
        role: 'user',
        content: thinkingInstruction,
      },
    ];
    let streamRes = await ollama.chat({
      ...config.thinking,
      messages,
      stream: true,
    });
    nextIteration.thinking = await streamResponse(streamRes);

    messages.push({ role: 'assistant', content: nextIteration.thinking });

    const reportQuery: Message = {
      role: 'user',
      content:
        "Base on your analysis above, answer whether user's original query been resolved in one sentense. If resolved, quote the facts and evidences from predecessor's action result or notes or project's readme to support your verdict.",
    };

    console.log(separator(`VERDICT`, { char: '-', length: 80, endNewline: true }));
    streamRes = await ollama.chat({
      ...config.summarizing,
      messages: [...messages, reportQuery],
      stream: true,
    });
    const reportMessage = { role: 'assistant', content: await streamResponse(streamRes) };

    let toolRes = await ollama.chat({
      ...config.tool_calling,
      messages: [
        ...messages,
        reportQuery,
        reportMessage,
        {
          role: 'user',
          content: "Base on your verdict about whether user's query has been resolved, invoke report tool provided.",
        },
      ],
      tools: [Reporting.tool],
    });

    if (!toolRes.message.tool_calls) {
      console.log(toolRes.message);
    }
    const args = typeCheck(Reporting.schema, toolRes.message.tool_calls![0].function.arguments);
    if (args.reason !== 'continue') {
      console.log(args);
      console.log(separator(`RESOLVED`, { char: '-', length: 80, endNewline: true }));
      streamRes = await ollama.chat({
        ...config.summarizing,
        messages: [
          ...messages,
          reportQuery,
          reportMessage,
          {
            role: 'user',
            content: "Now generate a report to resolve user's query.",
          },
        ],
        stream: true,
      });
      await streamResponse(streamRes);
      console.log(separator(`END`, { char: '-', length: 80, endNewline: true }));
      return;
    } else {
      console.log(separator(`TOOL CALLING`, { char: '-', length: 80, endNewline: true }));
      toolRes = await ollama.chat({
        ...config.tool_calling,
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Base on your latest thought, execute your action with tools provided.',
          },
        ],
        tools: [SearchFiles.tool, OpenFile.tool, CodeNavigation.tool, ListDir.tool],
      });
      if (toolRes.message.tool_calls?.[0]) {
        nextIteration.toolRequest = toolRes.message.tool_calls[0].function;
        console.log('[tool_call]', nextIteration.toolRequest);
        nextIteration.toolResult = await tools.call(toolRes.message.tool_calls[0]);
        console.log('[tool_call]', nextIteration.toolResult);
      } else {
        console.log(toolRes.message.content);
        throw new Error('Tool not called.');
      }

      console.log(separator(`SUMMARIZING`, { char: '-', length: 80, endNewline: true }));
      streamRes = await ollama.chat({
        ...config.summarizing,
        messages: [
          ...messages,
          {
            role: 'user',
            content: notingInsturction(nextIteration.toolRequest),
          },
        ],
        stream: true,
      });

      nextIteration.notes = await streamResponse(streamRes);
      iterations.push(nextIteration);
    }
  }
}

const program = new Command();

program
  .name('dumb-dumb-code-checker')
  .description(' LLM Static Code Analysis Agent Equipped with Code Navigation Tools ')
  .requiredOption('-w, --workspace <path>', 'Path to the workspace folder')
  .requiredOption('-q, --query <string>', 'Query string to process')
  .option('-m, --max-iterations <number>', 'Maximum number of iterations', parseInt, 10);

program.parse(process.argv);
run(program.opts());
