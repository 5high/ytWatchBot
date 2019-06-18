const debug = require('debug')('app:tracker');
const got = require('got');
const uuidV4 = require('uuid/v4');
const QuickLRU = require('quick-lru');

class Tracker {
  constructor(/**Main*/main) {
    this.main = main;
    this.tid = main.config.gaId;
    this.lru = new QuickLRU({maxSize: 100});
  }

  async track(chatId, params) {
    const cid = this.getUuid(chatId);

    const defaultParams = {
      v: 1,
      tid: this.tid,
      an: 'bot',
      aid: 'bot'
    };

    let lastError = null;
    for (let i = 0; i < 5; i++) {
      try {
        return await got.post('https://www.google-analytics.com/collect', {
          body: Object.assign({cid}, defaultParams, params),
          form: true,
        });
      } catch (err) {
        lastError = err;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    debug('track error: %o', lastError);
  }

  getUuid(chatId) {
    if (this.lru.has(chatId)) {
      return this.lru.get(chatId);
    }

    let vId = chatId;

    let prefix = 0;
    if (vId < 0) {
      prefix = 1;
      vId *= -1;
    }

    const idParts = vId.toString().split('').reverse().join('').match(/(\d{0,2})/g).reverse();

    const random = new Array(16);
    for (let i = 0; i < 16; i++) {
      random[i] = 0x0;
    }

    let index = random.length;
    let part;
    while (part = idParts.pop()) {
      index--;
      random[index] = parseInt(`${prefix}${part}`, 10);
    }

    const result = uuidV4({random});

    this.lru.set(chatId, result);

    return result;
  }
}

export default Tracker;