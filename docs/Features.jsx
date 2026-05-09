function Features() {
  const items = [
    {
      icon: 'terminal',
      tint: '#10b981',
      title: 'Native Local Terminal',
      desc: 'Full-featured local shell integration (bash, zsh, powershell) for seamless local and remote workflows.',
    },
    {
      icon: 'zap',
      tint: '#3b82f6',
      title: 'High Performance',
      desc: 'Powered by xterm.js with WebGL rendering for buttery-smooth scrolling and zero-lag input.',
    },
    {
      icon: 'split',
      tint: '#8b5cf6',
      title: 'Multi-Pane Splits',
      desc: 'Tabs, horizontal and vertical splits. Organize parallel sessions however your workflow demands.',
    },
    {
      icon: 'folder',
      tint: '#38bdf8',
      title: 'Dual-Pane SFTP',
      desc: 'Drag and drop files between local and remote. Concurrent transfer queue with real-time progress.',
    },
    {
      icon: 'cloud',
      tint: '#0ea5e9',
      title: 'S3-Compatible Storage',
      desc: 'AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi — first-class providers in the same browser and queue.',
    },
    {
      icon: 'list',
      tint: '#f59e0b',
      title: 'Connection Management',
      desc: 'Organize connections with folders, tags, and drag-and-drop reordering. State persists across restarts.',
    },
    {
      icon: 'command',
      tint: '#a855f7',
      title: 'Command Palette',
      desc: 'Every action one keystroke away. Hit ⌘K (or Ctrl+K) to jump anywhere in the app.',
    },
    {
      icon: 'palette',
      tint: '#f472b6',
      title: 'Professional Themes',
      desc: 'Dracula, Nord, Tokyo Night, Gruvbox, Monokai, One Dark — UI follows your terminal.',
    },
    {
      icon: 'shield',
      tint: '#22c55e',
      title: 'Encrypted Credentials',
      desc: 'AES-256-GCM at rest. Trust-on-first-use host keys with explicit warnings on mismatch.',
    },
  ];
  return (
    <section id="features" className="lunar-section">
      <div className="lunar-section__head">
        <div className="lunar-eyebrow">Features</div>
        <h2 className="lunar-section__title">
          Built for the way you actually work on remote servers.
        </h2>
        <p className="lunar-section__sub">
          Every feature was shaped by the friction of real engineering workflows — fast input, sane
          keyboard shortcuts, no surprises.
        </p>
      </div>
      <div className="lunar-feature-grid">
        {items.map((it) => (
          <div key={it.title} className="lunar-feature">
            <div
              className="lunar-feature__icon"
              style={{ background: hexAlpha(it.tint, 0.12), color: it.tint }}
            >
              <Icon name={it.icon} size={20} />
            </div>
            <div className="lunar-feature__title">{it.title}</div>
            <div className="lunar-feature__desc">{it.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function hexAlpha(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

window.Features = Features;
