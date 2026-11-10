import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {ObserveYoutubePolicyNotice} from '../extension/lib/youtube-policy-notice.js';

const store = {flavor: 'chrome-store'};
function event() {
 const listeners = new Set();
 return {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
  fire: (...args) => {for (const fn of listeners) fn(...args);}};
}

test('store notice follows the active YouTube page in popup and side panel, without scanning media', async t => {
 let tab = {id: 1, windowId: 7, url: 'https://www.youtube.com/'};
 const tabs = {query: async () => [tab], onActivated: event(), onUpdated: event()};
 globalThis.chrome = {tabs};
 t.after(() => delete globalThis.chrome);
 for (const surface of ['popup', 'sidepanel']) {
  const states = [];
  const stop = ObserveYoutubePolicyNotice((blocked, current) => states.push([blocked, current?.id]), store);
  await settle();
  assert.deepEqual(states.at(-1), [true, 1], surface);
  for (const url of ['https://m.youtube.com/shorts/aqz-KE-bpKQ', 'https://youtu.be/aqz-KE-bpKQ', 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ']) {
   tab = {...tab, url};
   tabs.onUpdated.fire(tab.id, {url});
   await settle();
   assert.equal(states.at(-1)[0], true, url);
  }
  tab = {...tab, id: 2, url: 'https://example.org/?url=https://youtube.com/'};
  tabs.onActivated.fire({tabId: 2, windowId: 7});
  await settle();
  assert.deepEqual(states.at(-1), [false, 2]);
  tab = {...tab, id: 1, url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'};
  tabs.onActivated.fire({tabId: 1, windowId: 7});
  await settle();
  assert.deepEqual(states.at(-1), [true, 1]);
  stop();
 }
});

test('development never shows the store notice or queries tab metadata', () => {
 const states = [];
 const stop = ObserveYoutubePolicyNotice(blocked => states.push(blocked), {flavor: 'development', youtubeEnabled: true});
 assert.deepEqual(states, [false]);
 stop();
});

test('late tab responses cannot restore a notice after a newer navigation or disposal', async t => {
 const pending = [];
 const tabs = {query: () => new Promise(resolve => pending.push(resolve)), onActivated: event(), onUpdated: event()};
 globalThis.chrome = {tabs};
 t.after(() => delete globalThis.chrome);
 const states = [];
 const stop = ObserveYoutubePolicyNotice(blocked => states.push(blocked), store);
 tabs.onActivated.fire({tabId: 2, windowId: 7});
 pending[1]([{id: 2, windowId: 7, url: 'https://example.org/'}]);
 await settle();
 pending[0]([{id: 1, windowId: 7, url: 'https://youtube.com/'}]);
 await settle();
 assert.deepEqual(states, [false]);
 tabs.onUpdated.fire(2, {url: 'https://youtube.com/'});
 stop();
 pending[2]([{id: 2, windowId: 7, url: 'https://youtube.com/'}]);
 await settle();
 assert.deepEqual(states, [false]);
});
