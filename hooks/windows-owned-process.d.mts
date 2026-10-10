import type { ChildProcessWithoutNullStreams } from 'node:child_process';
export function spawnWindowsOwned(command: string, args: string[], options: {
  cwd: string; env: Record<string,string>; shell?: boolean; jobName?: string;
  terminateDescendantsOnRootExit?: boolean;
}): ChildProcessWithoutNullStreams;
export function stopWindowsOwned(proc: import('node:child_process').ChildProcess): void;
export function quoteWindowsArgument(value: string): string;
export function repairJobName(root: string): string;
