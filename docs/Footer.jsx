function Footer() {
  return (
    <footer className="lunar-footer">
      <div className="lunar-footer__inner">
        <div className="lunar-footer__brand">
          <img src="assets/lunar-logo.png" alt="" />
          <div>
            <div className="lunar-footer__name">Lunar</div>
            <div className="lunar-footer__tag">SSH terminal · SFTP file manager</div>
          </div>
        </div>
        <div className="lunar-footer__cols">
          <div>
            <div className="lunar-footer__heading">Product</div>
            <a href="#features">Features</a>
            <a href="#themes">Themes</a>
            <a href="#download">Download</a>
          </div>
          <div>
            <div className="lunar-footer__heading">Project</div>
            <a href="https://github.com/salvatorecorvaglia/lunar" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a
              href="https://github.com/salvatorecorvaglia/lunar/releases"
              target="_blank"
              rel="noreferrer"
            >
              Releases
            </a>
            <a
              href="https://github.com/salvatorecorvaglia/lunar/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noreferrer"
            >
              Changelog
            </a>
            <a
              href="https://github.com/salvatorecorvaglia/lunar/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noreferrer"
            >
              Contributing
            </a>
          </div>
          <div>
            <div className="lunar-footer__heading">Legal</div>
            <a
              href="https://github.com/salvatorecorvaglia/lunar/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              MIT License
            </a>
            <a
              href="https://github.com/salvatorecorvaglia/lunar/blob/main/SECURITY.md"
              target="_blank"
              rel="noreferrer"
            >
              Security
            </a>
          </div>
        </div>
      </div>
      <div className="lunar-footer__bottom">
        <span>© 2026 Salvatore Corvaglia</span>
        <span>Version 0.2.1</span>
      </div>
    </footer>
  );
}

window.Footer = Footer;
