const OFFLINE_DEFAULT = String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true';

let offline = OFFLINE_DEFAULT;

function isOffline() {
  return offline;
}

function setOffline(value) {
  offline = !!value;
}

module.exports = { isOffline, setOffline, OFFLINE_DEFAULT };
