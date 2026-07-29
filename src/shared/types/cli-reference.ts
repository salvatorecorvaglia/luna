export interface CliCommandExample {
  description: string;
  command: string;
}

export interface CliCommandDoc {
  name: string;
  summary: string;
  syntax: string;
  category: 'system' | 'devops' | 'network' | 'files' | 'process';
  examples: CliCommandExample[];
}
