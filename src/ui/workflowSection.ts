// About › How I work (docs/device-design.md §32): the workflow figure, its steps and the step on show. Used by
// the About panel (detail.ts) and List view (listView.ts); styles in detail.css (.dt-wf-*).
import { profile, type WorkflowCopy } from '../content/portfolio';
import { ARROW, bindSteps, watchWraps } from './stepChips';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const wf: WorkflowCopy = profile.workflow;
const FW = wf.steps.findIndex((s) => s.subs); // the step with sub-steps

/** The figure's slot, then (in .dt-wf-side) the steps, the step on show and the closing line. */
export function workflowBody() {
  const steps = wf.steps
    .map((s, i) => `<li class="dt-step" data-i="${i}">${i ? ARROW : ''}<button type="button" class="dt-chip">${esc(s.title)}</button></li>`)
    .join('');
  // Every step's text sits in one grid cell, only the one on show visible, so the page never changes height.
  const now = [
    `<div class="dt-wf-now is-on" data-now="-1"><p class="dt-desc">${esc(wf.intro)}</p></div>`,
    ...wf.steps.map(
      (s, i) => `<div class="dt-wf-now" data-now="${i}"><p class="dt-wf-head">${esc(s.title)}</p><p class="dt-desc">${esc(s.text)}</p>${
        s.subs
          ? `<ol class="dt-wf-subs">${s.subs.map((u) => `<li>${esc(u.title)}</li>`).join('')}</ol><div class="dt-wf-subtext">${s.subs.map((u) => `<p>${esc(u.text)}</p>`).join('')}</div>`
          : ''
      }</div>`,
    ),
  ].join('');
  return `<div class="dt-wf-fig"></div>
    <div class="dt-wf-side">
      <ol class="dt-steps" aria-label="Workflow steps, in order">${steps}</ol>
      <div class="dt-wf-text">${now}</div>
      <p class="dt-wf-close">“${esc(wf.closing)}”</p>
    </div>`;
}

/** Draws the figure (its own lazy chunk) into a section made with workflowBody() and keeps the text in step. */
export function mountWorkflowSection(section: HTMLElement): () => void {
  const host = section.querySelector<HTMLElement>('.dt-wf-fig');
  const list = section.querySelector<HTMLElement>('.dt-steps');
  if (!host || !list) return () => {};
  const stopWraps = watchWraps(list);
  const nows = [...section.querySelectorAll<HTMLElement>('.dt-wf-now')];
  const subs = [...section.querySelectorAll<HTMLElement>('.dt-wf-subs li')];
  const subTexts = [...section.querySelectorAll<HTMLElement>('.dt-wf-subtext p')];
  let gone = false;
  let teardown = () => {};
  import('../figures/workflow/live')
    .then(({ mountWorkflow }) => {
      if (gone) return;
      let mark = (_a: number) => {};
      const h = mountWorkflow(host, {
        onStep: (step, sub) => {
          mark(step);
          nows.forEach((el) => el.classList.toggle('is-on', Number(el.dataset.now) === step));
          const at = step === FW ? sub : 0; // off Framework, its first sub-step stays set, so its box keeps its height
          subs.forEach((li, i) => li.classList.toggle('is-on', step === FW && i === sub));
          subTexts.forEach((el, i) => el.classList.toggle('is-on', i === at));
        },
        // the tour's timer: the pill on show (and Framework's sub-step) fills as its time runs out
        onTimer: (p, sp) => {
          const on = list.querySelector<HTMLElement>('.dt-step.is-on');
          const sub = subs.find((li) => li.classList.contains('is-on')) ?? null;
          section.querySelectorAll<HTMLElement>('.is-timing').forEach((el) => el !== on && el !== sub && el.classList.remove('is-timing'));
          for (const [el, v] of [[on, p], [sub, sp]] as const) {
            if (!el) continue;
            el.classList.toggle('is-timing', v >= 0);
            if (v >= 0) el.style.setProperty('--p', v.toFixed(3));
          }
        },
      });
      const chips = bindSteps(list, h, false);
      mark = chips.mark;
      teardown = () => {
        chips.dispose();
        h.destroy();
      };
    })
    .catch(() => host.remove()); // no figure: the steps and their text still say it
  return () => {
    gone = true;
    stopWraps();
    teardown();
  };
}
