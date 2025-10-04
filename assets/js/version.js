// Version configuration loader
let versionConfig = null;

// Load version configuration synchronously for immediate use
async function loadVersionConfig() {
  if (versionConfig) return versionConfig;

  try {
    const response = await fetch(`./version.json?ts=${Date.now()}`, { cache: 'no-store' });
    versionConfig = await response.json();
    return versionConfig;
  } catch (error) {
    console.warn('Failed to load version config, using fallback:', error);
    versionConfig = { version: '1.18.24', timestamp: '20251004' };
    return versionConfig;
  }
}

// Get version immediately (for synchronous use)
function getVersion() {
  return versionConfig?.version || '1.18.24';
}

// Get timestamp immediately (for synchronous use)
function getTimestamp() {
  return versionConfig?.timestamp || '20251004';
}

// Get service worker version format
function getSWVersion() {
  return `wb-${getVersion()}-${getTimestamp()}`;
}

// Initialize version on load
loadVersionConfig().then(config => {
  // Set global APP_VERSION for service worker
  window.APP_VERSION = config.version;

  // Update sidebar version display
  const sidebarVersion = document.getElementById('sidebarVersion');
  if (sidebarVersion) {
    sidebarVersion.textContent = `v${config.version}`;
  }

  // Dispatch event for other scripts that need version info
  window.dispatchEvent(new CustomEvent('versionLoaded', { detail: config }));
});

// Export for module use
export { loadVersionConfig, getVersion, getTimestamp, getSWVersion };
