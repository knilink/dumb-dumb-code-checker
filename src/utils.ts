import { ChatResponse } from 'ollama';

export const createLineNumberConverter = (fromBase: number, toBase: number) => (lineNumber: number) =>
  lineNumber - fromBase + toBase;

export namespace LineNumberBase {
  export const ddcc = 1;
  export const languageServer = 0;
  export const ripgrep = 1;
}

export function separator(
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

export async function streamResponse(response: AsyncIterable<ChatResponse>): Promise<string> {
  const res: string[] = [];
  for await (const part of response) {
    res.push(part.message.content);
    process.stdout.write(part.message.content);
  }
  console.log('\n');
  return res.join('').trim();
}
