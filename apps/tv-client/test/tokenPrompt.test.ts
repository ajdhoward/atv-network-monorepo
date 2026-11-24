// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_KEY, type TokenStore } from "../src/token";
import { createTokenPrompt } from "../src/tokenPrompt";

function key(name: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: name, cancelable: true });
}

function mapStore() {
  const map = new Map<string, string>();
  const store: TokenStore = {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => void map.set(name, value),
    removeItem: (name) => void map.delete(name),
  };
  return { store, map };
}

// What a WebView with storage turned off, or a full quota, looks like.
const refusing: TokenStore = {
  getItem: () => null,
  setItem: () => {
    throw new Error("quota exceeded");
  },
  removeItem: () => {},
};

const field = (el: HTMLElement) => el.querySelector("input") as HTMLInputElement;

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("token prompt", () => {
  it("stays hidden until it is opened, then focuses its field", () => {
    const prompt = createTokenPrompt({ onSaved: vi.fn() });
    document.body.appendChild(prompt.el);

    expect(prompt.visible).toBe(false);
    expect(prompt.el.style.display).toBe("none");

    prompt.open("missing");

    expect(prompt.visible).toBe(true);
    expect(prompt.el.style.display).toBe("flex");
    expect(prompt.el.contains(document.activeElement)).toBe(true);
  });

  it("says why it opened, so a wrong token is not read as a broken channel", () => {
    const prompt = createTokenPrompt({ onSaved: vi.fn() });
    document.body.appendChild(prompt.el);

    prompt.open("missing");
    const missing = prompt.el.textContent;
    prompt.open("rejected");

    expect(missing).toContain("no household token");
    expect(prompt.el.textContent).toContain("was not accepted");
  });

  it("refuses a blank submit and stays open", () => {
    const onSaved = vi.fn();
    const prompt = createTokenPrompt({ onSaved, store: mapStore().store });
    document.body.appendChild(prompt.el);
    prompt.open("missing");
    field(prompt.el).value = "   ";

    expect(prompt.handleKey(key("Enter"))).toBe(true);

    expect(onSaved).not.toHaveBeenCalled();
    expect(prompt.visible).toBe(true);
    expect(prompt.el.textContent).toContain("Type the token first");
  });

  it("saves a trimmed token, closes and hands it on", () => {
    const { store, map } = mapStore();
    const onSaved = vi.fn();
    const prompt = createTokenPrompt({ onSaved, store });
    document.body.appendChild(prompt.el);
    prompt.open("rejected");
    field(prompt.el).value = "  household-secret  ";

    prompt.handleKey(key("Enter"));

    expect(map.get(TOKEN_KEY)).toBe("household-secret");
    expect(onSaved).toHaveBeenCalledWith("household-secret");
    expect(prompt.visible).toBe(false);
    expect(field(prompt.el).value).toBe("");
  });

  it("says so when the TV refuses to store the token", () => {
    const onSaved = vi.fn();
    const prompt = createTokenPrompt({ onSaved, store: refusing });
    document.body.appendChild(prompt.el);
    prompt.open("missing");
    field(prompt.el).value = "household-secret";

    prompt.handleKey(key("Enter"));

    expect(onSaved).not.toHaveBeenCalled();
    expect(prompt.visible).toBe(true);
    expect(prompt.el.textContent).toContain("could not save the token");
  });

  it("closes on Back without saving", () => {
    const { store, map } = mapStore();
    const onSaved = vi.fn();
    const prompt = createTokenPrompt({ onSaved, store });
    document.body.appendChild(prompt.el);

    for (const name of ["Escape", "BrowserBack", "GoBack"]) {
      prompt.open("missing");
      field(prompt.el).value = "half-typed";

      expect(prompt.handleKey(key(name))).toBe(true);
      expect(prompt.visible).toBe(false);
    }

    expect(onSaved).not.toHaveBeenCalled();
    expect(map.has(TOKEN_KEY)).toBe(false);
  });

  // The grid's handler preventDefaults these, which is why the prompt has to claim
  // the keyboard: a swallowed Backspace means the field cannot be corrected.
  it("leaves Backspace and the arrows to the text field", () => {
    const prompt = createTokenPrompt({ onSaved: vi.fn() });
    document.body.appendChild(prompt.el);
    prompt.open("missing");

    for (const name of ["Backspace", "ArrowLeft", "ArrowRight", "a"]) {
      expect(prompt.handleKey(key(name))).toBe(false);
    }
  });

  it("ignores keys while it is closed", () => {
    const prompt = createTokenPrompt({ onSaved: vi.fn() });

    expect(prompt.handleKey(key("Enter"))).toBe(false);
  });
});
