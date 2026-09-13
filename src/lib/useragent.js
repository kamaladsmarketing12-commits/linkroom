const { UAParser } = require('ua-parser-js');

// Common bot / crawler signatures worth excluding from "real" click counts.
// Not exhaustive - for serious bot filtering, pair with a service like a
// User-Agent + IP reputation list, or a JS-execution challenge.
const BOT_PATTERNS = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|pingdom|uptime|curl|wget|python-requests|headless/i;

function parseUserAgent(uaString) {
  const parser = new UAParser(uaString || '');
  const result = parser.getResult();

  const isBot = BOT_PATTERNS.test(uaString || '');
  let deviceType = result.device.type || 'desktop'; // ua-parser omits 'type' for desktop
  if (isBot) deviceType = 'bot';

  return {
    device_type: deviceType,
    browser: [result.browser.name, result.browser.version].filter(Boolean).join(' ') || 'Unknown',
    os: [result.os.name, result.os.version].filter(Boolean).join(' ') || 'Unknown',
    is_bot: isBot,
  };
}

module.exports = { parseUserAgent };
