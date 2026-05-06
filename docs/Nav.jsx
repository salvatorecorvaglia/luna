function Nav() {
  return (
    <nav className="lunar-nav">
      <a href="#" className="lunar-nav__brand">
        <img src="assets/lunar-logo.png" alt="" />
        <span>Lunar</span>
      </a>
      <div className="lunar-nav__links">
        <a href="#features">Features</a>
        <a href="#themes">Themes</a>
      </div>
      <div className="lunar-nav__actions">
        <a
          href="https://github.com/salvatorecorvaglia/lunar"
          target="_blank"
          rel="noreferrer"
          className="btn btn-outline"
        >
          <Icon name="github" /> Star on GitHub
        </a>
        <a href="#download" className="btn btn-primary">
          Download
        </a>
      </div>
    </nav>
  );
}

function Icon({ name, size = 16 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (name) {
    case 'github':
      return (
        <svg {...props}>
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...props}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 8l3 3-3 3M13 14h4" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...props}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'command':
      return (
        <svg {...props}>
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
        </svg>
      );
    case 'palette':
      return (
        <svg {...props}>
          <circle cx="13.5" cy="6.5" r=".5" />
          <circle cx="17.5" cy="10.5" r=".5" />
          <circle cx="8.5" cy="7.5" r=".5" />
          <circle cx="6.5" cy="12.5" r=".5" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125 0-.946.75-1.688 1.688-1.688H16c2.5 0 4-1.5 4-4 0-4.5-4-8-8-8z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'zap':
      return (
        <svg {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'split':
      return (
        <svg {...props}>
          <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 3v18" />
        </svg>
      );
    case 'cloud':
      return (
        <svg {...props}>
          <path d="M17.5 19a4.5 4.5 0 1 0-1.42-8.78A6 6 0 0 0 4 12a4 4 0 0 0 1 7h12.5z" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...props}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'apple':
      return (
        <svg {...props}>
          <path d="M12 20.94c1.5 0 2.75-1.06 4-2.94 0 0 .94-1.94.94-3.94C16.94 11.13 14 11 12 11s-4.94.13-4.94 3.06c0 2 .94 3.94.94 3.94 1.25 1.88 2.5 2.94 4 2.94zM12 11c2-2 2-3 2-5 0-2-1-4-2-4s-2 2-2 4 0 3 2 5z" />
        </svg>
      );
    case 'linux':
      return (
        <svg {...props}>
          <path d="M12 2c-2 0-3 2-3 4s0 4 1 5c-2 2-3 5-3 8 0 1 1 3 2 3h6c1 0 2-2 2-3 0-3-1-6-3-8 1-1 1-3 1-5s-1-4-3-4z" />
        </svg>
      );
    case 'windows':
      return (
        <svg {...props}>
          <path d="M3 5l7-1v8H3zM10 4l11-2v11H10zM3 13h7v7l-7-1zM10 13h11v9l-11-2z" />
        </svg>
      );
    default:
      return null;
  }
}

window.Nav = Nav;
window.Icon = Icon;
