function ThemeShowcase() {
  const themes = [
    {
      name: 'Dracula',
      bg: '#282a36',
      fg: '#f8f8f2',
      accent: '#bd93f9',
      colors: ['#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd'],
    },
    {
      name: 'Tokyo Night',
      bg: '#1a1b26',
      fg: '#a9b1d6',
      accent: '#7aa2f7',
      colors: ['#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff'],
    },
    {
      name: 'Nord',
      bg: '#2e3440',
      fg: '#d8dee9',
      accent: '#88c0d0',
      colors: ['#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0'],
    },
    {
      name: 'Gruvbox',
      bg: '#282828',
      fg: '#ebdbb2',
      accent: '#fabd2f',
      colors: ['#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a'],
    },
    {
      name: 'Monokai',
      bg: '#272822',
      fg: '#f8f8f2',
      accent: '#a6e22e',
      colors: ['#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4'],
    },
    {
      name: 'One Dark',
      bg: '#282c34',
      fg: '#abb2bf',
      accent: '#61afef',
      colors: ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2'],
    },
  ];
  const [active, setActive] = React.useState(1);
  const t = themes[active];

  return (
    <section id="themes" className="lunar-section">
      <div className="lunar-section__head">
        <div className="lunar-eyebrow">Themes</div>
        <h2 className="lunar-section__title">
          Bring your favorite editor palette into the terminal.
        </h2>
        <p className="lunar-section__sub">
          UI chrome adapts to whichever terminal theme you pick. Switch with one keystroke from the
          command palette.
        </p>
      </div>

      <div className="lunar-theme-tabs">
        {themes.map((th, i) => (
          <button
            key={th.name}
            onClick={() => setActive(i)}
            className={`lunar-theme-tab ${active === i ? 'is-active' : ''}`}
          >
            <span className="lunar-theme-tab__chip" style={{ background: th.accent }} />
            {th.name}
          </button>
        ))}
      </div>

      <div
        className="lunar-theme-preview"
        style={{ background: t.bg, borderColor: t.accent + '33' }}
      >
        <div className="lunar-theme-preview__bar">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
          <span className="lunar-theme-preview__name" style={{ color: t.fg, opacity: 0.7 }}>
            {t.name}
          </span>
        </div>
        <pre className="lunar-theme-preview__code" style={{ color: t.fg }}>
          <span style={{ color: t.colors[1] }}>const</span>{' '}
          <span style={{ color: t.colors[3] }}>connect</span> ={' '}
          <span style={{ color: t.colors[1] }}>async</span> ({'{ host, port = '}
          <span style={{ color: t.colors[3] }}>22</span>
          {' }'}) {'=>'} {'{'}
          {'\n'}
          {'  '}
          <span style={{ color: t.colors[1] }}>const</span> client ={' '}
          <span style={{ color: t.colors[1] }}>new</span>{' '}
          <span style={{ color: t.colors[3] }}>SSHClient</span>();{'\n'}
          {'  '}
          <span style={{ color: t.colors[1] }}>await</span> client.
          <span style={{ color: t.colors[3] }}>connect</span>({'{ '}host, port, identity:{' '}
          <span style={{ color: t.colors[2] }}>"~/.ssh/id_ed25519"</span>
          {' }'});{'\n'}
          {'  '}
          <span style={{ color: t.colors[1] }}>return</span> client.
          <span style={{ color: t.colors[3] }}>shell</span>();{'\n'}
          {'}'};{'\n'}
          {'\n'}
          <span style={{ color: t.colors[5] }}>// Reconnect with exponential backoff</span>
          {'\n'}
          <span style={{ color: t.colors[3] }}>connect</span>({'{ host: '}
          <span style={{ color: t.colors[2] }}>"prod.example.com"</span>
          {' }'}).<span style={{ color: t.colors[3] }}>then</span>(shell {'=>'} shell.
          <span style={{ color: t.colors[3] }}>write</span>(
          <span style={{ color: t.colors[2] }}>"uname -a\\n"</span>));
        </pre>
        <div className="lunar-theme-preview__swatches">
          {t.colors.map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </div>
      </div>
    </section>
  );
}

window.ThemeShowcase = ThemeShowcase;
