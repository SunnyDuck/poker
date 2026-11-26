import assert from "node:assert/strict";
import test from "node:test";
import { useAdminKeyboardNavigation } from "../src/composables/useAdminKeyboardNavigation.ts";

class FakeElement {
  constructor(name, { left = 0, top = 0, enterSubmit = false } = {}) {
    this.name = name;
    this.enterSubmit = enterSubmit;
    this.rect = { left, top, width: 100, height: 36 };
    this.focused = false;
    this.scrolled = false;
  }

  matches(selector) {
    return selector.includes("input");
  }

  closest(selector) {
    return selector === "[data-enter-submit]" && this.enterSubmit ? this : null;
  }

  getClientRects() {
    return [this.rect];
  }

  getBoundingClientRect() {
    return this.rect;
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {
    this.scrolled = true;
  }
}

class FakeMain extends FakeElement {
  constructor(fields) {
    super("main");
    this.fields = fields;
  }

  contains(target) {
    return this.fields.includes(target);
  }

  querySelectorAll() {
    return this.fields;
  }
}

const keyboardEvent = (target, key, options = {}) => ({
  target,
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  ...options,
});

const withAdminFields = (fields, callback) => {
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const main = new FakeMain(fields);
  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    getElementById: (id) => (id === "admin-main" ? main : null),
  };

  try {
    callback(useAdminKeyboardNavigation().handleAdminKeydown);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  }
};

test("Enter focuses the next editable admin field", () => {
  const title = new FakeElement("title");
  const date = new FakeElement("date");

  withAdminFields([title, date], (handleKeydown) => {
    const event = keyboardEvent(title, "Enter");
    handleKeydown(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(date.focused, true);
    assert.equal(date.scrolled, true);
  });
});

test("Alt plus arrow keys focus the nearest field in that direction", () => {
  const current = new FakeElement("current", { left: 0, top: 0 });
  const right = new FakeElement("right", { left: 150, top: 0 });
  const below = new FakeElement("below", { left: 0, top: 80 });

  withAdminFields([current, below, right], (handleKeydown) => {
    const event = keyboardEvent(current, "ArrowRight", { altKey: true });
    handleKeydown(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(right.focused, true);
    assert.equal(below.focused, false);
  });
});

test("preserves form submission and native arrow-key behavior", () => {
  const submitField = new FakeElement("submit", { enterSubmit: true });
  const next = new FakeElement("next", { left: 150 });

  withAdminFields([submitField, next], (handleKeydown) => {
    const enter = keyboardEvent(submitField, "Enter");
    handleKeydown(enter);
    assert.equal(enter.defaultPrevented, false);
    assert.equal(next.focused, false);

    const arrow = keyboardEvent(next, "ArrowRight");
    handleKeydown(arrow);
    assert.equal(arrow.defaultPrevented, false);
    assert.equal(submitField.focused, false);
  });
});
