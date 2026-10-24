/**
 * Tiny DOM helpers used by every screen. Keeps the UI code declarative without
 * pulling in a framework (and keeps the bundle small for phones).
 */

type Props = {
  class?: string;
  text?: string;
  html?: string;
  style?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
  children?: (Node | string | null | undefined)[];
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.style) node.setAttribute('style', props.style);
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === undefined || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (props.on) {
    for (const [type, fn] of Object.entries(props.on)) {
      if (fn) node.addEventListener(type, fn as EventListener);
    }
  }
  const all = [...(props.children ?? []), ...children];
  for (const child of all) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(label: string, opts: {
  variant?: 'primary' | 'gold' | 'ghost' | 'danger';
  small?: boolean;
  wide?: boolean;
  sub?: string;
  disabled?: boolean;
  onClick?: () => void;
  class?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
} = {}): HTMLButtonElement {
  const classes = ['btn'];
  if (opts.variant) classes.push(opts.variant);
  if (opts.small) classes.push('small');
  if (opts.wide) classes.push('wide');
  if (opts.class) classes.push(opts.class);
  const content = h('span');
  content.append(document.createTextNode(label));
  if (opts.sub) content.append(h('span', { class: 'sub', text: opts.sub }));
  const btn = h('button', {
    class: classes.join(' '),
    attrs: { ...(opts.attrs ?? {}), type: 'button', disabled: opts.disabled, 'aria-disabled': opts.disabled },
    on: { click: () => opts.onClick?.() },
  }, content);
  return btn;
}

export function slider(opts: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onInput: (v: number) => void;
  display?: (v: number) => string;
}): HTMLElement {
  const readout = h('span', { class: 'tiny muted', text: opts.display ? opts.display(opts.value) : `${Math.round(opts.value * 100)}%` });
  const input = h('input', {
    attrs: {
      type: 'range',
      min: opts.min ?? 0,
      max: opts.max ?? 1,
      step: opts.step ?? 0.01,
      value: opts.value,
    },
    on: {
      input: (ev: Event) => {
        const v = Number((ev.target as HTMLInputElement).value);
        readout.textContent = opts.display ? opts.display(v) : `${Math.round(v * 100)}%`;
        opts.onInput(v);
      },
    },
  });
  return h('div', { class: 'field' }, h('div', { class: 'spread' }, h('label', { text: opts.label }), readout), input);
}

export function toggle(opts: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string }): HTMLElement {
  const sw = h('div', { class: `sw${opts.value ? ' on' : ''}`, attrs: { role: 'switch', 'aria-checked': opts.value } });
  const wrap = h('div', {
    class: 'switch',
    on: {
      click: () => {
        const next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        sw.setAttribute('aria-checked', String(next));
        opts.onChange(next);
      },
    },
  }, h('div', {}, h('div', { text: opts.label }), opts.note ? h('div', { class: 'tiny muted', text: opts.note }) : null), sw);
  return wrap;
}

export function segmented<T extends string>(opts: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}): HTMLElement {
  const row = h('div', { class: 'seg' });
  for (const option of opts.options) {
    const btn = h('button', {
      class: option.value === opts.value ? 'on' : '',
      attrs: { type: 'button' },
      text: option.label,
      on: {
        click: () => {
          for (const child of row.children) child.classList.remove('on');
          btn.classList.add('on');
          opts.onChange(option.value);
        },
      },
    });
    row.append(btn);
  }
  return h('div', { class: 'field' }, opts.label ? h('label', { text: opts.label }) : null, row);
}

export function sheet(title: string, opts: { onClose?: () => void; subtitle?: string } = {}): { wrap: HTMLElement; body: HTMLElement } {
  const body = h('div', { class: 'col' });
  const sheetEl = h('div', { class: 'sheet glass' });
  const head = h('div', { class: 'sheet-head' },
    h('div', {},
      h('h2', { text: title }),
      opts.subtitle ? h('div', { class: 'tiny muted', text: opts.subtitle }) : null,
    ),
    opts.onClose ? h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'close' }, text: '✕', on: { click: () => opts.onClose?.() } }) : null,
  );
  sheetEl.append(head, h('div', { class: 'divider' }), body);
  const wrap = h('div', { class: 'sheet-wrap' }, sheetEl);
  return { wrap, body };
}

export function modal(opts: { title: string; message: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onCancel?: () => void }): HTMLElement {
  const wrap = h('div', { class: 'modal-wrap' });
  const card = h('div', { class: 'modal glass' },
    h('h3', { text: opts.title }),
    h('p', { class: 'small', text: opts.message }),
    h('div', { class: 'row' },
      button(opts.cancelLabel ?? 'Cancel', { variant: 'ghost', onClick: () => { wrap.remove(); opts.onCancel?.(); } }),
      button(opts.confirmLabel, { variant: 'primary', onClick: () => { wrap.remove(); opts.onConfirm(); } }),
    ),
  );
  wrap.append(card);
  return wrap;
}

export function screenClass(name: string): HTMLElement {
  return h('div', { class: `screen ${name}` });
}

export function statBar(label: string, value: number, hot = false): HTMLElement {
  return h('div', { class: 'statline' },
    h('span', { class: 'tiny', style: 'min-width:64px', text: label }),
    h('div', { class: 'statbar' }, h('i', { class: hot ? 'hot' : '', style: `width:${Math.round(value * 100)}%` })),
    h('span', { class: 'tiny muted', text: `${Math.round(value * 100)}` }),
  );
}
