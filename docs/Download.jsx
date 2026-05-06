function Download() {
  const [arch, setArch] = React.useState('x64'); // Default to x64 for Windows/Linux

  React.useEffect(() => {
    // Advanced architecture detection
    if (navigator.userAgentData) {
      navigator.userAgentData.getHighEntropyValues(['architecture']).then((ua) => {
        if (ua.architecture === 'arm' || ua.architecture === 'arm64') setArch('arm64');
        else if (ua.architecture === 'x86') setArch('x64');
      });
    } else {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.indexOf('arm') > -1 || ua.indexOf('aarch64') > -1) setArch('arm64');
    }
  }, []);

  const getMacUrl = (detectedArch) => {
    // For Mac, if we couldn't detect properly, arm64 is a safe default for modern users
    const macArch = detectedArch === 'x64' ? 'x64' : 'arm64';
    const v = window.LUNAR_CONFIG.version;
    return `https://github.com/salvatorecorvaglia/lunar/releases/download/v${v}/lunar-${v}-mac-${macArch}.dmg`;
  };

  const getLinuxUrl = (detectedArch) => {
    const v = window.LUNAR_CONFIG.version;
    return `https://github.com/salvatorecorvaglia/lunar/releases/download/v${v}/lunar-${v}-linux-${detectedArch}.AppImage`;
  };

  const platforms = [
    {
      name: 'macOS',
      icon: 'apple',
      arch: arch === 'x64' ? 'Intel Processor' : 'Apple Silicon (M-series)',
      url: getMacUrl(arch),
      isDetected: navigator.platform.toUpperCase().indexOf('MAC') >= 0,
    },
    {
      name: 'Windows',
      icon: 'windows',
      arch: 'x64 installer · .exe',
      url: `https://github.com/salvatorecorvaglia/lunar/releases/download/v${window.LUNAR_CONFIG.version}/lunar-${window.LUNAR_CONFIG.version}-win-x64-setup.exe`,
      isDetected: navigator.platform.toUpperCase().indexOf('WIN') >= 0,
    },
    {
      name: 'Linux',
      icon: 'linux',
      arch: arch === 'arm64' ? 'AArch64 (ARM64)' : 'x64 (64-bit)',
      url: getLinuxUrl(arch),
      isDetected: navigator.platform.toUpperCase().indexOf('LINUX') >= 0,
    },
  ];

  const hasDetected = platforms.some((p) => p.isDetected);

  return (
    <section id="download" className="lunar-section lunar-download">
      <div className="lunar-download__glow" aria-hidden="true" />
      <div className="lunar-section__head">
        <div className="lunar-eyebrow">Download</div>
        <h2 className="lunar-section__title">Get Lunar.</h2>
        <p className="lunar-section__sub">
          Free and open source under the MIT license. Auto-updates ship through GitHub Releases.
        </p>
      </div>
      <div className="lunar-download__grid">
        {platforms.map((p) => {
          const isDimmed = hasDetected && !p.isDetected;
          const Tag = isDimmed ? 'div' : 'a';
          return (
            <Tag
              key={p.name}
              href={isDimmed ? undefined : p.url}
              className={`lunar-download__card ${p.isDetected ? 'is-detected' : ''} ${
                isDimmed ? 'is-dimmed' : ''
              }`}
            >
              {p.isDetected && <div className="lunar-download__badge">Your OS</div>}
              <div className="lunar-download__icon">
                <Icon name={p.icon} size={28} />
              </div>
              <div className="lunar-download__name">{p.name}</div>
              <div className="lunar-download__arch">{p.arch}</div>
              <div className="lunar-download__cta">
                <Icon name="arrow-right" size={16} />
              </div>
            </Tag>
          );
        })}
      </div>
      <div className="lunar-download__hint">
        Or build from source: <code>git clone https://github.com/salvatorecorvaglia/lunar.git</code>
      </div>
    </section>
  );
}

window.Download = Download;
