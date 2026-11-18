// Moonfill's own background script (../../background.js): reading the Moonpull result file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../background.js', import.meta.url), 'utf8');

// Every chrome.* call does nothing (and storage reads come back empty), so the script loads quietly.
function quietChrome() {
  const fn = () => {};
  const handler = {
    get: (target, key) => {
      if (key === 'get') return async () => ({});
      if (key === 'getManifest') return () => ({version: 'test'});
      return new Proxy(fn, handler);
    },
    apply: () => Promise.resolve()
  };
  return new Proxy(fn, handler);
}

function load(answer) {
  const context = vm.createContext({console, setTimeout, clearTimeout, URL, crypto, chrome: quietChrome(), importScripts: () => {}});
  context.fetch = async url => answer(url);
  vm.runInContext(source, context);
  return context;
}

const reply = (text, {status = 200, type = 'text/plain', url = 'https://zanox.sharepoint.com/teams/x/file.txt'} = {}) => ({
  status, ok: status >= 200 && status < 300, url,
  headers: {get: name => (name.toLowerCase() === 'content-type' ? type : null)},
  text: async () => text
});

const SIGN_IN = '<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->\n<!DOCTYPE html>\n<html dir="ltr"><head><title>Sign in to your account</title>';
const RESULT = 'Your Moonpull scan is complete for:\nAlex\nTC\nInput: https://shop.example\nAdvertiser ID: 123456\nEnhanced Memory Cookie Status: appears immediately\n';

test('moonfill: a result file is read as the result', async () => {
  const r = await load(() => reply(RESULT)).readResultFile('42');
  assert.equal(r.status, 'ok');
  assert.match(r.text, /Advertiser ID: 123456/);
});

test('moonfill: Microsoft\'s sign-in page is never taken for a result, however it arrives', async () => {
  const cases = [
    reply(SIGN_IN),                                                                        // starts with a comment (the 2026-11-18 bug)
    reply('<html><body>Sign in</body></html>'),
    reply('plain text', {type: 'text/html; charset=utf-8'}),                               // served as a web page
    reply('plain text', {url: 'https://login.microsoftonline.com/5a9a/oauth2/authorize'})  // redirected to Microsoft's login
  ];
  for (const page of cases) {
    const r = await load(() => page).readResultFile('42');
    assert.equal(r.status, 'auth', `for ${page.url} ${page.headers.get('content-type')}`);
    assert.match(r.detail, /sign in to SharePoint again/);
  }
});

test('moonfill: a sign-in page while waiting keeps the scan waiting, and nothing is posted', async () => {
  const context = load(() => reply(SIGN_IN));
  const job = {id: 'j1', mid: '123456', responseId: '42', state: 'waiting', submittedAt: Date.now(), errors: 0};
  let posted = false;
  context.attemptPost = async () => { posted = true; };
  await context.processJob(job);
  assert.equal(posted, false);
  assert.equal(job.state, 'waiting');
  assert.equal(job.errors, 1, 'counted as a failed read: after 6 the TC is asked to sign in');
  assert.equal(job.resultText, undefined);
});
