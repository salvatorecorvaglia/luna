import type { CliCommandDoc, CliCommandExample } from '@shared/types/cli-reference';

export type { CliCommandDoc, CliCommandExample };

const CLI_DOCS: Record<string, CliCommandDoc> = {
  tar: {
    name: 'tar',
    summary: 'Archiving utility to compress and extract files',
    syntax: 'tar [options] [archive-file] [file or directory...]',
    category: 'files',
    examples: [
      {
        description: 'Create gzipped archive',
        command: 'tar -czvf archive.tar.gz /path/to/directory',
      },
      {
        description: 'Extract gzipped archive to current dir',
        command: 'tar -xzvf archive.tar.gz',
      },
      { description: 'List contents of a tar archive', command: 'tar -tzvf archive.tar.gz' },
      {
        description: 'Extract to specific destination folder',
        command: 'tar -xzvf archive.tar.gz -C /target/dir',
      },
    ],
  },
  find: {
    name: 'find',
    summary: 'Search for files in a directory hierarchy',
    syntax: 'find [path...] [expression]',
    category: 'files',
    examples: [
      {
        description: 'Find files by extension recursively',
        command: "find . -type f -name '*.log'",
      },
      { description: 'Find files modified in last 7 days', command: 'find /var/log -mtime -7' },
      { description: 'Find files larger than 100MB', command: 'find / -type f -size +100M' },
      { description: 'Find and delete matching files', command: "find . -name '*.tmp' -delete" },
    ],
  },
  grep: {
    name: 'grep',
    summary: 'Print lines matching a pattern',
    syntax: 'grep [options] PATTERN [FILE...]',
    category: 'files',
    examples: [
      {
        description: 'Case-insensitive search recursively',
        command: "grep -rnI 'error' /var/log/",
      },
      { description: 'Show 3 lines before and after match', command: "grep -C 3 'panic' app.log" },
      { description: 'Count matching lines across files', command: "grep -c 'FATAL' *.log" },
      {
        description: 'Invert match (show lines NOT matching)',
        command: "grep -v 'DEBUG' server.log",
      },
    ],
  },
  rsync: {
    name: 'rsync',
    summary: 'Fast, versatile, remote file-copying tool',
    syntax: 'rsync [options] SRC... [DEST]',
    category: 'network',
    examples: [
      {
        description: 'Archive sync with progress bar',
        command: 'rsync -avP /local/dir user@remote:/remote/dir',
      },
      {
        description: 'Sync and delete extraneous files at dest',
        command: 'rsync -av --delete /src/ /dest/',
      },
      { description: 'Dry-run preview sync changes', command: 'rsync -av --dry-run /src/ /dest/' },
    ],
  },
  docker: {
    name: 'docker',
    summary: 'Manage containers, images, and containerized services',
    syntax: 'docker [command] [options]',
    category: 'devops',
    examples: [
      { description: 'List running containers', command: 'docker ps' },
      {
        description: 'Tail live logs of container',
        command: 'docker logs -f --tail 100 <container_id>',
      },
      {
        description: 'Execute interactive bash in container',
        command: 'docker exec -it <container_id> /bin/bash',
      },
      {
        description: 'Clean up unused containers and volumes',
        command: 'docker system prune -a --volumes',
      },
    ],
  },
  kubectl: {
    name: 'kubectl',
    summary: 'Kubernetes cluster CLI control tool',
    syntax: 'kubectl [command] [TYPE] [NAME] [flags]',
    category: 'devops',
    examples: [
      { description: 'Get pods in all namespaces', command: 'kubectl get pods -A' },
      {
        description: 'Stream container pod logs',
        command: 'kubectl logs -f <pod_name> -n <namespace>',
      },
      { description: 'Describe pod events and status', command: 'kubectl describe pod <pod_name>' },
      {
        description: 'Port forward local port to pod',
        command: 'kubectl port-forward pod/<pod_name> 8080:80',
      },
    ],
  },
  systemctl: {
    name: 'systemctl',
    summary: 'Control the systemd system and service manager',
    syntax: 'systemctl [command] [unit]',
    category: 'system',
    examples: [
      { description: 'Check status of a service', command: 'systemctl status nginx' },
      { description: 'Restart service immediately', command: 'sudo systemctl restart nginx' },
      { description: 'Enable service to start on boot', command: 'sudo systemctl enable nginx' },
      { description: 'List failed system units', command: 'systemctl --failed' },
    ],
  },
  chmod: {
    name: 'chmod',
    summary: 'Change file mode bits (permissions)',
    syntax: 'chmod [options] mode[,mode]... file...',
    category: 'files',
    examples: [
      { description: 'Make script executable for owner', command: 'chmod +x script.sh' },
      {
        description: 'Set read/write/execute for owner, read/execute for others',
        command: 'chmod 755 app.sh',
      },
      { description: 'Secure private key (read-only by owner)', command: 'chmod 600 id_rsa' },
    ],
  },
  ffmpeg: {
    name: 'ffmpeg',
    summary: 'Fast video and audio converter',
    syntax: 'ffmpeg [options] -i input [options] output',
    category: 'devops',
    examples: [
      {
        description: 'Convert MP4 video to WebP animation',
        command: 'ffmpeg -i input.mp4 -vf "fps=10,scale=800:-1" out.webp',
      },
      {
        description: 'Extract audio track as MP3',
        command: 'ffmpeg -i input.mp4 -vn -acodec libmp3lame out.mp3',
      },
      {
        description: 'Compress video with H.264 CRF 23',
        command: 'ffmpeg -i input.mp4 -vcodec libx264 -crf 23 out.mp4',
      },
    ],
  },
};

export class CliReferenceService {
  /**
   * Search offline CLI references by command name or keyword query.
   */
  searchDocs(query?: string): CliCommandDoc[] {
    if (!query || !query.trim()) {
      return Object.values(CLI_DOCS);
    }

    const q = query.toLowerCase().trim();
    return Object.values(CLI_DOCS).filter(
      (doc) =>
        doc.name.toLowerCase().includes(q) ||
        doc.summary.toLowerCase().includes(q) ||
        doc.examples.some(
          (ex) => ex.description.toLowerCase().includes(q) || ex.command.toLowerCase().includes(q),
        ),
    );
  }

  /**
   * Lookup reference for a specific command name.
   */
  getDoc(name: string): CliCommandDoc | null {
    return CLI_DOCS[name.toLowerCase()] || null;
  }
}

export const cliReferenceService = new CliReferenceService();
