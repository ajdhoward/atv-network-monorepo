// The household token, entered on the TV itself.
//
// Option C (decisions.md, 2026-11-23) puts one token in front of `/api/resolve`,
// and the served client is the only place it can be entered without re-sideloading
// every TV: the shell loads this bundle live, so a prompt shipped today reaches a
// TV installed months ago.
//
// It is D-pad first. `main.ts` owns one document-level keydown handler that
// preventDefaults Enter, Backspace, Escape and the arrows, so an `<input>` added
// beside it can be neither corrected nor submitted. While this prompt is open it
// takes the keyboard: it returns true for the keys it used, and leaves Backspace
// and the arrows to the field. Untested on a real remote until L5.

import { normaliseToken, saveToken, type TokenStore } from "./token";
import { colour, font, radius } from "./theme";

export type TokenReason = "missing" | "rejected";

export type TokenPrompt = {
  el: HTMLElement;
  readonly visible: boolean;
  open(reason: TokenReason): void;
  close(): void;
  /** True when the prompt used the key, so the caller must not act on it either. */
  handleKey(event: KeyboardEvent): boolean;
};

// What the viewer is told before typing. "Rejected" is the one that matters: a
// wrong token must not read as a broken channel.
const REASON: Record<TokenReason, string> = {
  missing: "This TV has no household token yet.",
  rejected: "That token was not accepted.",
};

const HINT = "Type the token, then press Enter. Back cancels.";

// `store` is injectable for the same reason as in `token.ts`: a test passes a
// Map-backed stand-in, and a WebView without storage passes null.
export function createTokenPrompt(opts: {
  onSaved: (token: string) => void;
  store?: TokenStore | null;
}): TokenPrompt {
  const el = document.createElement("div");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Household token");
  el.style.cssText = [
    "position:absolute",
    "inset:0",
    "z-index:60",
    "display:none",
    "align-items:center",
    "justify-content:center",
    `background:${colour.scrim}`,
    `font-family:${font}`,
    `color:${colour.text}`,
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:14px",
    "width:min(560px,80vw)",
    "padding:32px",
    `background:${colour.surfaceRaised}`,
    `border:1px solid ${colour.ruleStrong}`,
    `border-radius:${radius.tile}px`,
  ].join(";");

  const heading = document.createElement("h2");
  heading.textContent = "Household token";
  heading.style.cssText = "margin:0;font-size:26px;";

  const reason = document.createElement("p");
  reason.style.cssText = `margin:0;font-size:18px;color:${colour.muted};`;

  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Household token");
  input.style.cssText = [
    "width:100%",
    "box-sizing:border-box",
    "padding:14px 16px",
    "font-size:22px",
    `font-family:${font}`,
    `color:${colour.text}`,
    `background:${colour.surface}`,
    `border:1px solid ${colour.rule}`,
    `border-radius:${radius.badge}px`,
    "outline:none",
  ].join(";");
  input.addEventListener("focus", () => {
    input.style.borderColor = colour.accent;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = colour.rule;
  });

  const hint = document.createElement("p");
  hint.style.cssText = `margin:0;font-size:14px;color:${colour.faint};`;
  hint.textContent = HINT;

  let visible = false;

  function close(): void {
    visible = false;
    el.style.display = "none";
    input.value = "";
    input.blur();
  }

  function submit(): void {
    const token = normaliseToken(input.value);
    if (!token) {
      hint.textContent = "Type the token first. Back cancels.";
      return;
    }
    // False means storage refused it. Saying so is the difference between a
    // household that retypes the token tomorrow and one that knows this TV cannot
    // keep it at all.
    if (!saveToken(token, opts.store)) {
      hint.textContent = "This TV could not save the token. Check that storage is on.";
      return;
    }
    close();
    opts.onSaved(token);
  }

  panel.append(heading, reason, input, hint);
  el.appendChild(panel);

  return {
    el,
    get visible() {
      return visible;
    },
    open(why: TokenReason) {
      reason.textContent = REASON[why];
      hint.textContent = HINT;
      input.value = "";
      el.style.display = "flex";
      visible = true;
      input.focus();
    },
    close,
    handleKey(event: KeyboardEvent) {
      if (!visible) return false;
      if (event.key === "Enter") {
        submit();
        return true;
      }
      // The Fire OS shell reports the remote's Back as BrowserBack; the other two
      // are what a development browser and older WebViews send.
      if (event.key === "Escape" || event.key === "BrowserBack" || event.key === "GoBack") {
        close();
        return true;
      }
      // Backspace edits and the arrows move the caret: leave them to the field.
      return false;
    },
  };
}
