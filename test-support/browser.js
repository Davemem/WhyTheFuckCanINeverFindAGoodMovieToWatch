"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");

function browser(page = "index.html") {
  const dom = new JSDOM(fs.readFileSync(path.join(root, page), "utf8"), {
    url: "https://moviepicker.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.Headers = Headers;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.scrollTo = () => {};
  vm.runInContext(fs.readFileSync(path.join(root, "title-identity.js"), "utf8"), dom.getInternalVMContext());
  return {
    dom,
    window: dom.window,
    evaluate: (source) => vm.runInContext(source, dom.getInternalVMContext()),
    load: (name) => vm.runInContext(fs.readFileSync(path.join(root, name), "utf8"), dom.getInternalVMContext(), { filename: name }),
    close: () => dom.window.close(),
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function json(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function signIn(window, id = 1) {
  window.dispatchEvent(new window.CustomEvent("auth:session", { detail: {
    session: id ? { authenticated: true, user: { id, email: `user${id}@test.invalid` }, csrfToken: `csrf-${id}` } : null,
  } }));
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
module.exports = { browser, deferred, json, signIn, tick };
