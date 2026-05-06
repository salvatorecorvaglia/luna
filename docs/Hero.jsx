function Hero() {
  return (
    <section className="lunar-hero">
      <div className="lunar-hero__glow" aria-hidden="true" />
      <div className="lunar-hero__inner">
        <div className="lunar-pill">
          <span className="lunar-pill__dot" /> v0.2.0 <span className="lunar-pill__sep" /> macOS ·
          Windows · Linux
        </div>
        <h1 className="lunar-hero__title">
          SSH, SFTP, and S3
          <br />
          <span className="lunar-gradient-text">in one calm workspace.</span>
        </h1>
        <p className="lunar-hero__sub">
          Lunar is a high-performance, cross-platform desktop app that pairs a powerful SSH
          terminal with a dual-pane file manager for SFTP servers and S3-compatible object
          storage — AWS, MinIO, R2, B2, Wasabi — side by side.
        </p>
        <div className="lunar-hero__cta">
          <a href="#download" className="btn btn-primary btn-lg">
            Download for Free
            <Icon name="arrow-right" size={14} />
          </a>
          <a
            href="https://github.com/salvatorecorvaglia/lunar"
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline btn-lg"
          >
            <Icon name="github" /> View on GitHub
          </a>
        </div>

        <FakeAppWindow />
      </div>
    </section>
  );
}

function FakeAppWindow() {
  return (
    <div className="lunar-app-window">
      <div className="lunar-app-window__chrome">
        <div className="lunar-app-window__lights">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <div className="lunar-app-window__title">
          <img src="assets/lunar-logo.png" alt="" />
          <span>Lunar — deploy@prod.example.com</span>
        </div>
        <div className="lunar-app-window__chrome-spacer" />
      </div>
      <div className="lunar-app-window__body">
        <aside className="lunar-app-window__sidebar">
          <div className="lunar-side-section">
            <div className="lunar-side-label">Connections</div>
            <div className="lunar-side-item lunar-side-item--active">
              <span className="lunar-side-dot" style={{ background: '#bd93f9' }} />
              <span>prod.example.com</span>
            </div>
            <div className="lunar-side-item">
              <span className="lunar-side-dot" style={{ background: '#7aa2f7' }} />
              <span>staging-eu</span>
            </div>
            <div className="lunar-side-item">
              <span className="lunar-side-dot" style={{ background: '#a6e22e' }} />
              <span>db-replica-01</span>
            </div>
            <div className="lunar-side-item">
              <span className="lunar-side-dot" style={{ background: '#fabd2f' }} />
              <span>edge-cdn</span>
            </div>
          </div>
          <div className="lunar-side-section">
            <div className="lunar-side-label">Recent SFTP</div>
            <div className="lunar-side-item lunar-side-item--muted">
              <Icon name="folder" size={12} /> /var/www/app
            </div>
            <div className="lunar-side-item lunar-side-item--muted">
              <Icon name="folder" size={12} /> /etc/nginx
            </div>
          </div>
        </aside>
        <div className="lunar-app-window__main">
          <div className="lunar-tabs">
            <div className="lunar-tab lunar-tab--active">
              <Icon name="terminal" size={12} /> bash · prod
            </div>
            <div className="lunar-tab">
              <Icon name="terminal" size={12} /> bash · prod (2)
            </div>
            <div className="lunar-tab">
              <Icon name="folder" size={12} /> SFTP
            </div>
            <div className="lunar-tab-add">+</div>
          </div>
          <div className="lunar-terminal">
            <Line>
              <Mono c="#9ece6a">deploy@prod</Mono>
              <Mono c="#7aa2f7">:</Mono>
              <Mono c="#bb9af7">~/app</Mono>
              <Mono>$ </Mono>
              <Mono>git pull origin main</Mono>
            </Line>
            <Line>
              <Mono c="#7dcfff">remote: </Mono>
              <Mono>Counting objects: 24, done.</Mono>
            </Line>
            <Line>
              <Mono c="#7dcfff">remote: </Mono>
              <Mono>Compressing objects: 100% (18/18), done.</Mono>
            </Line>
            <Line>
              <Mono>From github.com:acme/app</Mono>
            </Line>
            <Line>
              <Mono c="#9ece6a"> a4f9c1d..b8e2f30 main → origin/main</Mono>
            </Line>
            <Line>
              <Mono c="#9ece6a">deploy@prod</Mono>
              <Mono c="#7aa2f7">:</Mono>
              <Mono c="#bb9af7">~/app</Mono>
              <Mono>$ </Mono>
              <Mono>pm2 reload ecosystem.config.js</Mono>
            </Line>
            <Line>
              <Mono c="#e0af68">[PM2]</Mono>
              <Mono> Reloading process: api-server</Mono>
            </Line>
            <Line>
              <Mono c="#9ece6a">[PM2] [api-server] ✓ reloaded successfully</Mono>
            </Line>
            <Line>
              <Mono c="#9ece6a">deploy@prod</Mono>
              <Mono c="#7aa2f7">:</Mono>
              <Mono c="#bb9af7">~/app</Mono>
              <Mono>$ </Mono>
              <span className="lunar-cursor" />
            </Line>
          </div>
          <div className="lunar-statusbar">
            <span>
              <span className="lunar-status-dot lunar-status-dot--ok" /> Connected · 22ms
            </span>
            <span>UTF-8</span>
            <span>SSH-2.0-OpenSSH_9.6</span>
            <span style={{ marginLeft: 'auto' }}>Tokyo Night</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({ children }) {
  return <div className="lunar-term-line">{children}</div>;
}
function Mono({ children, c }) {
  return <span style={{ color: c || '#a9b1d6' }}>{children}</span>;
}

window.Hero = Hero;
