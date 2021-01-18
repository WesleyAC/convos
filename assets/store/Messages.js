import hljs from '../js/hljs';
import Reactive from '../js/Reactive';
import Time from '../js/Time';
import {api} from '../js/Api';
import {i18n} from './I18N';
import {jsonhtmlify} from 'jsonhtmlify';
import {md} from '../js/md';
import {q} from '../js/util';
import {str2color} from '../js/util';

const EMBED_CACHE = {};

export default class Messages extends Reactive {
  constructor(params) {
    super();
    this.prop('ro', 'groupBy', params.groupBy || ['fromId']);
    this.prop('ro', 'length', () => this.messages.length);
    this.prop('rw', 'messages', []);
    this.prop('rw', 'expandUrlToMedia', true);
    this.embedCache = EMBED_CACHE;
  }

  clear() {
    return this.update({messages: []});
  }

  get(i) {
    return i < 0 ? this.messages.slice(i)[0] : this.messages[i];
  }

  push(list) {
    return this.update({messages: this.messages.concat(this._fill(list))});
  }

  render() {
    let prev = {};

    return this.messages.map((msg, i) => {
      msg.index = i;
      if (msg.embeds) return (prev = msg); // already processed

      msg.dayChanged = this._dayChanged(msg, prev);
      msg.groupBy = this.groupBy.map(k => msg[k] || '').join(':');
      msg.className = this._className(msg, prev);
      msg.embeds = this._embeds(msg);
      msg.markdown = msg.vars ? i18n.md(msg.message, ...msg.vars) : md(msg.message);

      return (prev = msg);
    });
  }

  toArray() {
    return this.messages;
  }

  unshift(list) {
    return this.update({messages: this._fill(list).concat(this.messages)});
  }

  _className(msg, prev) {
    const classes = ['message'];
    if (msg.type) classes.push('is-type-' + msg.type);
    if (msg.highlight) classes.push('is-highlighted');

    classes.push(!msg.dayChanged && msg.groupBy == prev.groupBy ? 'has-same-from' : 'has-not-same-from');
    return classes.join(' ');
  }

  _dayChanged(msg, prev) {
    return prev.ts && msg.ts.getDate() != prev.ts.getDate();
  }

  _embeds(msg) {
    const p = [];
    if (msg.canToggleDetails) p.push(this._renderDetails(msg));
    if (!this.expandUrlToMedia || msg.type == 'notice') return p;

    (msg.message.match(/https?:\/\/(\S+)/g) || []).forEach(url => {
      url = url.replace(/(\W)?$/, '');
      if (!this.embedCache[url]) this.embedCache[url] = this._loadEmbed(msg, url);
      p.push(this.embedCache[url]);
    });

    return p.map(p => p.catch(err => console.error('[Messages:embed]', msg, err)));
  }

  _fill(messages) {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.from) [msg.internal, msg.from, msg.fromId] = [true, this.connection_id || 'Convos', 'Convos'];
      if (!msg.fromId) msg.fromId = msg.from.toLowerCase();
      if (!msg.type) msg.type = 'notice';

      msg.canToggleDetails = msg.type == 'error' || msg.type == 'notice';
      msg.color = msg.fromId == 'Convos' ? 'inherit' : str2color(msg.from.toLowerCase());
      msg.ts = new Time(msg.ts);
    }

    return messages;
  }

  async _loadEmbed(msg, url) {
    const op = await api('/api', 'embed', {url}).perform();
    const embed = op.res.body;

    if (!embed.html) embed.html = '';
    const provider = embed.provider_name && embed.provider_name.toLowerCase() || '';
    embed.className = provider ? 'for-' + provider : embed.html ? 'for-unknown' : 'hidden';

    const embedEl = document.createRange().createContextualFragment(embed.html).firstChild;
    if (!embedEl) return embed;

    q(embedEl, 'img', [['error', (e) => (e.target.style.display = 'none')]]);
    const types = (embedEl && embedEl.className || '').split(/\s+/);
    if (types.indexOf('le-paste') != -1) this._renderPaste(embed, embedEl);
    if (provider == 'jitsi') this._renderJitsi(embed, embedEl);

    return embed;
  }

  async _renderDetails(msg) {
    const details = {...(msg.sent || msg)};

    [
      'bubbles',   'canToggleDetails',  'className',   'color',
      'command',   'connection_id',     'dayChanged',  'embeds',
      'event',     'groupBy',           'id',          'index',
      'markdown',  'method',            'stopPropagation',
    ].forEach(k => delete details[k]);

    return {className: 'for-jsonhtmlify hidden', html: jsonhtmlify(details).outerHTML};
  }

  _renderPaste(embed, embedEl) {
    const pre = embedEl.querySelector('pre');
    if (!pre) return;
    hljs.lineNumbersBlock(pre);
    embed.html = embedEl.outerHTML;
  }

  _renderJitsi(embed, embedEl) {
    const url = new URL(embed.url);
    const roomName = url.pathname.replace(/^\//, '');
    if (!roomName || roomName.indexOf('/') != -1) return;

    // Turn "Some-Cool-convosTest" into "Some Cool Convos Test"
    let humanName = roomName.replace(/[_-]+/g, ' ')
      .replace(/([a-z ])([A-Z])/g, (all, a, b) => a + ' ' + b.toUpperCase())
      .replace(/([ ]\w)/g, (all) => all.toUpperCase());

    humanName = decodeURIComponent(humanName);
    embed.html
      = '<div class="le-card le-rich le-join-request">'
        + '<a class="le-thumbnail" href="' + embed.url + '" target="' + roomName + '"><i class="fas fa-video"></i></a>'
        + '<h3>' + i18n.l('Do you want to join the %1 video chat with "%2"?', 'Jitsi', humanName) + '</h3>'
        + '<p class="le-description"><a href="' + embed.url + '" target="' + roomName + '">'
          + i18n.l('Yes, I want to join.')
          + '</a></p>'
      + '</div>';
  }
}
