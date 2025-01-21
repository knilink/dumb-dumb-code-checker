export const createLineNumberConverter = (fromBase: number, toBase: number) => (lineNumber: number) =>
  lineNumber - fromBase + toBase;

export namespace LineNumberBase {
  export const ddcc = 1;
  export const languageServer = 0;
  export const ripgrep = 1;
}
